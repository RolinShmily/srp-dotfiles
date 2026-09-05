/**
 * srp-voice — 极简高性能终端流式语音听写扩展 (适用于 Pi Agent)
 *
 * 特性：
 *   1. 实时流式 ASR (边说边推流，停止时一次性无感落盘，保持 300ms 极速响应，不污染光标与撤销栈)
 *   2. 点状盲文微型音量波形动画 (⠀⣀⣄ listening…)
 *   3. 多 Provider 架构：支持 Deepgram (Nova-3) 与 阿里百炼 (DashScope Paraformer 实时语音)，自动探测
 *   4. 支持 settings.json (srpVoice 字段) 动态配置模型、供应商、API Key、语言及热键
 *   5. 全平台与 WSL2 深度适配：音频捕获与剪贴板自动嗅探 (clip.exe / wl-copy / xclip / pbcopy)
 *   6. 全局焦点穿透与安全门禁：通过 TUI 输入层前置拦截快捷键，适配所有弹窗与输入框
 *
 * 快捷键：
 *   - Alt+M: 开始 / 停止语音听写
 *   - Alt+N: 取消并放弃当前音频与文本
 *
 * 斜杠命令：
 *   - /srp-voice: 切换语音听写
 *   - /srp-voice model: 交互式选择并切换 ASR 语音模型
 *   - /srp-voice status: 查看当前 ASR 模型与鉴权状态
 *
 * 认证方式：
 *   - 首选：通过 Pi 原生命令 `/login dashscope` 或 `/login deepgram` 保存凭据到 auth.json
 *   - 兼容：settings.json 中的 srpVoice.apiKey 或系统环境变量 (DASHSCOPE_API_KEY / DEEPGRAM_API_KEY)
 *
 * settings.json 配置示例 (在 ~/.pi/agent/settings.json 或 .pi/settings.json 中)：
 *   "srpVoice": {
 *     "enabled": true,
 *     "provider": "auto",                  // "auto" | "aliyun" | "dashscope" | "deepgram"
 *     "model": "paraformer-realtime-v2",    // 或 "nova-3"
 *     "apiKey": "",                         // 可选，留空自动从 /login 凭证库或环境变量读取
 *     "language": "zh",                     // 语言偏好，如 "zh", "en", "multi"
 *     "shortcuts": ["alt+m"],
 *     "cancelShortcuts": ["alt+n"]
 *   }
 */

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, isKeyRelease, isKeyRepeat, type AutocompleteItem } from "@earendil-works/pi-tui";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

// ── 调试日志 ───────────────────────────────────────────────────────────────
const DEBUG = !!process.env.DICTATE_DEBUG || !!process.env.SRP_VOICE_DEBUG;
const dbg = (msg: string) => {
  if (!DEBUG) return;
  try {
    appendFileSync("/tmp/srp-voice-debug.log", `${new Date().toISOString()} ${msg}\n`);
  } catch {}
};

// ── 音量波形动画配置 (点状式 Braille 字符) ──────────────────────────────────
const METER_CELLS = 6;
const METER_TICK_MS = 60;
const PEAK_BLOCKS = ["⠀", "⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿"];
const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

// ── 环境变量与配置读取 ──────────────────────────────────────────────────────
const envCache = new Map<string, string>();

function getEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  if (envCache.has(name)) return envCache.get(name)!;

  const home = homedir();
  const candidateFiles = [
    join(home, ".zshrc.local"),
    join(home, ".pi", "agent", ".env"),
    join(home, ".pi", ".env"),
    join(home, ".zshrc"),
    join(home, ".bashrc"),
    join(home, ".profile"),
  ];

  for (const file of candidateFiles) {
    if (!existsSync(file)) continue;
    try {
      const content = readFileSync(file, "utf-8");
      const regex = new RegExp(`^(?:export\\s+)?${name}\\s*=\\s*["']?([^"'\\n\\r]+)["']?`, "m");
      const match = content.match(regex);
      if (match && match[1]) {
        const val = match[1].trim();
        envCache.set(name, val);
        return val;
      }
    } catch {}
  }

  return "";
}

export interface SrpVoiceConfig {
  enabled: boolean;
  provider: "auto" | "aliyun" | "dashscope" | "deepgram" | string;
  model: string;
  apiKey: string;
  language: string;
  shortcuts: string[];
  cancelShortcuts: string[];
}

let runtimeOverrides: Partial<SrpVoiceConfig> = {};

function saveVoiceSettings(updates: Partial<SrpVoiceConfig>, cwd?: string): void {
  const projectPath = cwd ? join(cwd, CONFIG_DIR_NAME, "settings.json") : null;
  const targetPath = projectPath && existsSync(projectPath) ? projectPath : join(getAgentDir(), "settings.json");
  let data: Record<string, unknown> = {};
  try {
    if (existsSync(targetPath)) {
      data = JSON.parse(readFileSync(targetPath, "utf-8")) || {};
    }
  } catch {}
  const currentVoice =
    data.srpVoice && typeof data.srpVoice === "object" && !Array.isArray(data.srpVoice)
      ? (data.srpVoice as Record<string, unknown>)
      : {};
  data.srpVoice = { ...currentVoice, ...updates };
  try {
    writeFileSync(targetPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch {}
}

async function resolveApiKey(
  providerId: string,
  directKey?: string,
  ctx?: ExtensionContext | null,
): Promise<{ key: string; source: string }> {
  // 1. settings.json 或配置中显式指定的 apiKey
  if (directKey?.trim()) {
    return { key: directKey.trim(), source: "settings.json" };
  }

  // 2. Pi 原生 auth.json 凭据仓库 (~/.pi/agent/auth.json via /login)
  if (ctx?.modelRegistry) {
    const candidates = providerId === "dashscope" || providerId === "aliyun"
      ? ["dashscope", "aliyun"]
      : [providerId];

    for (const id of candidates) {
      try {
        const key = await ctx.modelRegistry.getApiKeyForProvider(id);
        if (key?.trim()) {
          return { key: key.trim(), source: `/login ${id} (auth.json)` };
        }
      } catch {}
      try {
        const auth = await ctx.modelRegistry.getProviderAuth(id);
        if (auth?.auth?.apiKey?.trim()) {
          return { key: auth.auth.apiKey.trim(), source: `/login ${id} (auth.json)` };
        }
      } catch {}
    }
  }

  // 3. 环境变量与本地环境配置文件回退
  if (providerId === "dashscope" || providerId === "aliyun") {
    const envKey = getEnv("DASHSCOPE_API_KEY") || getEnv("ALIYUN_API_KEY");
    if (envKey) return { key: envKey, source: "环境变量 (DASHSCOPE_API_KEY)" };
  } else if (providerId === "deepgram") {
    const envKey = getEnv("DEEPGRAM_API_KEY");
    if (envKey) return { key: envKey, source: "环境变量 (DEEPGRAM_API_KEY)" };
  } else {
    const envKey = getEnv(`${providerId.toUpperCase()}_API_KEY`);
    if (envKey) return { key: envKey, source: `环境变量 (${providerId.toUpperCase()}_API_KEY)` };
  }

  return { key: "", source: "none" };
}

function formatDimText(ctx: ExtensionContext, text: string): string {
  try {
    if (ctx.ui?.theme?.fg) {
      return ctx.ui.theme.fg("muted", text);
    }
  } catch {}
  return `\x1b[90m${text}\x1b[39m`;
}

export interface AsrModelItem {
  provider: "dashscope" | "deepgram";
  model: string;
  description: string;
}

export const ASR_MODELS: AsrModelItem[] = [
  {
    provider: "dashscope",
    model: "paraformer-realtime-v2",
    description: "阿里百炼实时语音（中文优先，精准断句与标点，首选推荐）",
  },
  {
    provider: "dashscope",
    model: "paraformer-8k-realtime-v1",
    description: "阿里百炼 8k 窄带电话实时语音",
  },
  {
    provider: "deepgram",
    model: "nova-3",
    description: "Deepgram Nova-3（极速低延迟，英文及多语言首选）",
  },
  {
    provider: "deepgram",
    model: "nova-2",
    description: "Deepgram Nova-2 通用流式语音模型",
  },
];

function loadVoiceConfig(cwd?: string): SrpVoiceConfig {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpVoice;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  const global = read(join(getAgentDir(), "settings.json"));
  const project = cwd ? read(join(cwd, CONFIG_DIR_NAME, "settings.json")) : {};
  const merged = { ...global, ...project };

  const enabled = merged.enabled !== false;
  const provider = typeof merged.provider === "string" ? merged.provider : (getEnv("SRP_VOICE_PROVIDER") || "auto");
  const model = typeof merged.model === "string" ? merged.model : (getEnv("SRP_VOICE_MODEL") || "");
  const apiKey = typeof merged.apiKey === "string" ? merged.apiKey : "";
  const language = typeof merged.language === "string" ? merged.language : (getEnv("SRP_VOICE_LANGUAGE") || "zh");
  const shortcuts = Array.isArray(merged.shortcuts) && merged.shortcuts.length > 0
    ? (merged.shortcuts as string[])
    : ["alt+m"];
  const cancelShortcuts = Array.isArray(merged.cancelShortcuts) && merged.cancelShortcuts.length > 0
    ? (merged.cancelShortcuts as string[])
    : ["alt+n"];

  return {
    enabled,
    provider,
    model,
    apiKey,
    language,
    shortcuts,
    cancelShortcuts,
    ...runtimeOverrides,
  };
}

/** 计算 16-bit 小端 PCM 音频块的均方根能量 (RMS 归一化至 0..1) */
function rmsFromPcm16(buf: Buffer): number {
  const sampleCount = Math.floor(buf.length / 2);
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < sampleCount * 2; i += 2) {
    const s = buf.readInt16LE(i);
    sumSquares += s * s;
  }
  return Math.sqrt(sumSquares / sampleCount) / 32768;
}

/** 将 RMS 转换为 dB 并映射至点状盲文字符 */
function rmsToBlock(rms: number): string {
  if (rms <= 0) return PEAK_BLOCKS[0]!;
  const db = 20 * Math.log10(rms);
  const t = Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB)));
  const idx = Math.floor(t * (PEAK_BLOCKS.length - 1));
  return PEAK_BLOCKS[idx]!;
}

// ── 跨平台剪贴板复制 ────────────────────────────────────────────────────────
function copyToClipboard(text: string): boolean {
  if (!text) return false;
  // 1. WSL 环境或 Windows clip.exe
  const isWsl = !!process.env.WSL_DISTRO_NAME || existsSync("/mnt/c/WINDOWS/system32/clip.exe");
  if (isWsl && existsSync("/mnt/c/WINDOWS/system32/clip.exe")) {
    try {
      const p = spawn("/mnt/c/WINDOWS/system32/clip.exe", [], { stdio: ["pipe", "ignore", "ignore"] });
      p.stdin.end(text);
      return true;
    } catch {}
  }

  // 2. Linux Wayland (wl-copy)
  if (process.env.WAYLAND_DISPLAY || existsSync("/usr/bin/wl-copy") || existsSync("/usr/sbin/wl-copy")) {
    try {
      const p = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
      p.stdin.end(text);
      return true;
    } catch {}
  }

  // 3. Linux X11 (xclip)
  if (process.env.DISPLAY || existsSync("/usr/bin/xclip") || existsSync("/usr/sbin/xclip")) {
    try {
      const p = spawn("xclip", ["-selection", "clipboard"], { stdio: ["pipe", "ignore", "ignore"] });
      p.stdin.end(text);
      return true;
    } catch {}
  }

  // 4. macOS (pbcopy)
  try {
    const p = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
    p.stdin.end(text);
    return true;
  } catch {}

  return false;
}

// ── 统一流式 ASR Provider 接口 ──────────────────────────────────────────────
interface VoiceCallbacks {
  onFinal: (text: string) => void;
  onError: (err: Error) => void;
  onClose: () => void;
}

interface StreamingVoiceProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  start(callbacks: VoiceCallbacks): Promise<void>;
  sendAudio(chunk: Buffer): void;
  stop(): Promise<void>;
  cancel(): void;
}

// ── Provider 1: Deepgram Nova-3 ───────────────────────────────────────────
class DeepgramProvider implements StreamingVoiceProvider {
  readonly id = "deepgram";
  readonly name = "Deepgram (Nova-3)";
  private ws: WebSocket | null = null;
  private config: SrpVoiceConfig;
  private ctx?: ExtensionContext | null;
  private isCancelled = false;

  constructor(config: SrpVoiceConfig, ctx?: ExtensionContext | null) {
    this.config = config;
    this.ctx = ctx;
  }

  async isAvailable(): Promise<boolean> {
    const { key } = await resolveApiKey("deepgram", this.config.apiKey, this.ctx);
    return !!key;
  }

  async start(callbacks: VoiceCallbacks): Promise<void> {
    this.isCancelled = false;
    const { key: apiKey } = await resolveApiKey("deepgram", this.config.apiKey, this.ctx);
    if (!apiKey) {
      throw new Error("未找到 Deepgram API Key，请先执行 /login deepgram 或在 settings.json / 环境变量中配置 DEEPGRAM_API_KEY");
    }

    const model = this.config.model || "nova-3";
    const lang = this.config.language ? `&language=${this.config.language}` : "";
    const url =
      "wss://api.deepgram.com/v1/listen" +
      `?model=${encodeURIComponent(model)}` +
      "&encoding=linear16" +
      "&sample_rate=16000" +
      "&channels=1" +
      "&interim_results=false" +
      "&smart_format=true" +
      "&punctuate=true" +
      "&endpointing=300" +
      lang;

    this.ws = new WebSocket(url, ["token", apiKey]);

    return new Promise((resolve, reject) => {
      let resolved = false;

      this.ws!.addEventListener("open", () => {
        if (this.isCancelled) return;
        resolved = true;
        resolve();
      });

      this.ws!.addEventListener("message", (ev) => {
        if (this.isCancelled) return;
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "Results" && msg.is_final) {
            const t = msg.channel?.alternatives?.[0]?.transcript;
            if (t && typeof t === "string") {
              callbacks.onFinal(t.trim());
            }
          }
        } catch {}
      });

      this.ws!.addEventListener("error", () => {
        if (this.isCancelled) return;
        const err = new Error("Deepgram WebSocket error");
        if (!resolved) {
          resolved = true;
          reject(err);
        } else {
          callbacks.onError(err);
        }
      });

      this.ws!.addEventListener("close", () => {
        if (this.isCancelled) return;
        callbacks.onClose();
      });
    });
  }

  sendAudio(chunk: Buffer): void {
    if (!this.isCancelled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  async stop(): Promise<void> {
    if (!this.isCancelled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {}
    }
  }

  cancel(): void {
    this.isCancelled = true;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
  }
}

// ── Provider 2: 阿里百炼 (DashScope Paraformer 实时语音) ──────────────────────
class AliyunDashscopeProvider implements StreamingVoiceProvider {
  readonly id = "dashscope";
  readonly name = "Aliyun DashScope (Paraformer)";
  private ws: WebSocket | null = null;
  private taskId: string = "";
  private lastSentenceMap = new Map<number, string>();
  private config: SrpVoiceConfig;
  private ctx?: ExtensionContext | null;
  private isCancelled = false;

  constructor(config: SrpVoiceConfig, ctx?: ExtensionContext | null) {
    this.config = config;
    this.ctx = ctx;
  }

  async isAvailable(): Promise<boolean> {
    const { key } = await resolveApiKey("dashscope", this.config.apiKey, this.ctx);
    return !!key;
  }

  async start(callbacks: VoiceCallbacks): Promise<void> {
    this.isCancelled = false;
    const { key: apiKey } = await resolveApiKey("dashscope", this.config.apiKey, this.ctx);
    if (!apiKey) {
      throw new Error("未找到 DashScope API Key，请先执行 /login dashscope 或在 settings.json / 环境变量中配置 DASHSCOPE_API_KEY");
    }

    this.taskId = randomUUID().replace(/-/g, "");
    this.lastSentenceMap.clear();

    const model = this.config.model || "paraformer-realtime-v2";
    const url = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    } as any);
    this.ws = ws;

    return new Promise((resolve, reject) => {
      let taskStarted = false;

      ws.addEventListener("open", () => {
        if (this.isCancelled) return;
        const startMsg = {
          header: {
            action: "run-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: {
            task_group: "audio",
            task: "asr",
            function: "recognition",
            model: model,
            parameters: {
              format: "pcm",
              sample_rate: 16000,
            },
            input: {},
          },
        };
        try {
          ws.send(JSON.stringify(startMsg));
        } catch {}
      });

      ws.addEventListener("message", (ev) => {
        if (this.isCancelled) return;
        try {
          const msg = JSON.parse(ev.data as string);
          const header = msg.header;
          if (header?.event === "task-started") {
            taskStarted = true;
            resolve();
          } else if (header?.event === "result-generated") {
            const sentences = msg.payload?.output?.sentence;
            if (Array.isArray(sentences)) {
              for (let i = 0; i < sentences.length; i++) {
                const s = sentences[i];
                if (s?.text && s.end_time !== undefined) {
                  if (!this.lastSentenceMap.has(i)) {
                    this.lastSentenceMap.set(i, s.text);
                    callbacks.onFinal(s.text.trim());
                  }
                }
              }
            }
          } else if (header?.event === "task-finished") {
            const sentences = msg.payload?.output?.sentence;
            if (Array.isArray(sentences)) {
              for (let i = 0; i < sentences.length; i++) {
                const s = sentences[i];
                if (s?.text && !this.lastSentenceMap.has(i)) {
                  this.lastSentenceMap.set(i, s.text);
                  callbacks.onFinal(s.text.trim());
                }
              }
            }
            callbacks.onClose();
          } else if (header?.event === "task-failed") {
            const err = new Error(header.error_message || "DashScope task failed");
            if (!taskStarted) reject(err);
            else callbacks.onError(err);
          }
        } catch {}
      });

      ws.addEventListener("error", () => {
        if (this.isCancelled) return;
        const err = new Error("DashScope WebSocket error");
        if (!taskStarted) reject(err);
        else callbacks.onError(err);
      });

      ws.addEventListener("close", () => {
        if (this.isCancelled) return;
        callbacks.onClose();
      });
    });
  }

  sendAudio(chunk: Buffer): void {
    if (!this.isCancelled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  async stop(): Promise<void> {
    if (!this.isCancelled && this.ws && this.ws.readyState === WebSocket.OPEN && this.taskId) {
      try {
        const finishMsg = {
          header: {
            action: "finish-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: {
            input: {},
          },
        };
        this.ws.send(JSON.stringify(finishMsg));
      } catch {}
    }
  }

  cancel(): void {
    this.isCancelled = true;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
  }
}

// ── Provider 选择工厂 ───────────────────────────────────────────────────────
async function selectProvider(config: SrpVoiceConfig, ctx?: ExtensionContext | null): Promise<StreamingVoiceProvider> {
  const explicit = (config.provider || "auto").toLowerCase().trim();
  const aliyun = new AliyunDashscopeProvider(config, ctx);
  const deepgram = new DeepgramProvider(config, ctx);

  if (explicit === "deepgram") return deepgram;
  if (explicit === "aliyun" || explicit === "dashscope" || explicit === "paraformer") return aliyun;

  // Auto 策略：优先使用已配置 Key 的 Provider (国内优先百炼)
  if (await aliyun.isAvailable()) return aliyun;
  if (await deepgram.isAvailable()) return deepgram;

  return aliyun;
}

// ── Focus 目标解析 ──────────────────────────────────────────────────────────
interface EditorLike {
  getText(): string;
  setText(text: string): void;
}

type Target =
  | { kind: "editor"; editor: EditorLike }
  | { kind: "typable"; component: { handleInput(data: string): void } };

const asEditorLike = (value: any): EditorLike | null =>
  value && typeof value.getText === "function" && typeof value.setText === "function" ? value : null;

// ── Extension 主逻辑 ────────────────────────────────────────────────────────
type State = "idle" | "recording" | "stopping";

export default function (pi: ExtensionAPI) {
  let state: State = "idle";
  let rec: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let activeProvider: StreamingVoiceProvider | null = null;
  let finals: string[] = [];
  let activeCtx: ExtensionContext | null = null;
  let flushed = false;
  let cancelled = false;
  let stopTimeout: NodeJS.Timeout | null = null;
  let spinnerTimer: NodeJS.Timeout | null = null;
  let spinnerFrame = 0;
  let generation = 0;

  // 音量计状态
  let meterTimer: NodeJS.Timeout | null = null;
  let meter: number[] = new Array(METER_CELLS).fill(0);
  let currentLevel = 0;

  let tuiHandle: any = null;
  let removeInputListener: (() => void) | null = null;
  let lastCtx: ExtensionContext | null = null;

  const getConfig = () => loadVoiceConfig(lastCtx?.cwd);

  const setStatus = (msg: string | undefined) => {
    if (!activeCtx) return;
    activeCtx.ui.setStatus("srp-voice", msg);
  };

  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };

  const stopMeter = () => {
    if (meterTimer) {
      clearInterval(meterTimer);
      meterTimer = null;
    }
  };

  /** 启动点状波形动画 */
  const startMeter = () => {
    stopMeter();
    meter = new Array(METER_CELLS).fill(0);
    currentLevel = 0;
    const render = () => {
      const dot = activeCtx?.ui.theme.fg("error", "●") ?? "●";
      setStatus(`${dot} ${meter.map(rmsToBlock).join("")} listening…`);
    };
    render();
    meterTimer = setInterval(() => {
      meter.shift();
      meter.push(currentLevel);
      render();
    }, METER_TICK_MS);
  };

  /** 启动微调器动画 */
  const startSpinner = (suffix: string) => {
    stopSpinner();
    spinnerFrame = 0;
    setStatus(`${SPINNER_FRAMES[0]} ${suffix}`);
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      setStatus(`${SPINNER_FRAMES[spinnerFrame]} ${suffix}`);
    }, SPINNER_INTERVAL_MS);
  };

  /** 动态解析当前聚焦的输入组件 */
  const resolveTarget = (): Target | null => {
    const focused = tuiHandle?.focusedComponent;
    if (!focused) return null;
    const editor = asEditorLike(focused) ?? asEditorLike(focused.editor);
    if (editor) return { kind: "editor", editor };
    if (typeof focused.handleInput === "function") return { kind: "typable", component: focused };
    return null;
  };

  /** 文本落盘交付 (一次性安全注入) */
  const flush = () => {
    if (flushed || !activeCtx) return;
    flushed = true;
    if (cancelled) return;

    const text = finals.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;

    dbg(`flush text: "${text}"`);

    // 1. 无 TUI Handle 降级：追加到主编辑器
    if (!tuiHandle) {
      const current = activeCtx.ui.getEditorText() ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      activeCtx.ui.setEditorText(current + sep + text);
      return;
    }

    // 2. 动态检测当前焦点
    const target = resolveTarget();
    if (target?.kind === "editor") {
      const current = target.editor.getText() ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      target.editor.setText(current + sep + text);
      tuiHandle.requestRender?.();
      return;
    }
    if (target?.kind === "typable") {
      target.component.handleInput(text);
      tuiHandle.requestRender?.();
      return;
    }

    // 3. 无焦点时复制到剪贴板兜底
    const copied = copyToClipboard(text);
    if (copied) {
      activeCtx.ui.notify("Voice dictation copied to clipboard (no input focused)", "info");
    } else {
      activeCtx.ui.notify(`Dictated: ${text}`, "info");
    }
  };

  const cleanup = () => {
    generation++;
    dbg(`cleanup → generation ${generation}`);
    flush();
    stopSpinner();
    stopMeter();
    if (stopTimeout) {
      clearTimeout(stopTimeout);
      stopTimeout = null;
    }
    if (rec) {
      try {
        rec.kill("SIGTERM");
      } catch {}
      rec = null;
    }
    if (activeProvider) {
      try {
        activeProvider.cancel();
      } catch {}
      activeProvider = null;
    }
    finals = [];
    state = "idle";
    setStatus(undefined);
    activeCtx = null;
    flushed = false;
    cancelled = false;
  };

  const startDictation = async (ctx: ExtensionContext) => {
    const config = getConfig();
    const provider = await selectProvider(config, ctx);
    if (!(await provider.isAvailable())) {
      ctx.ui.notify(
        `未检测到 ${provider.name} 的有效 API Key。\n请在终端执行 /login ${provider.id}，或在 settings.json / 环境变量中配置。`,
        "error",
      );
      return;
    }

    activeCtx = ctx;
    finals = [];
    flushed = false;
    cancelled = false;
    state = "recording";
    activeProvider = provider;
    const myGeneration = ++generation;
    dbg(`start recording with ${provider.name} (gen ${myGeneration})`);
    startMeter();

    // 启动音频捕获 (优先 rec / sox)
    let proc: ChildProcessByStdio<null, Readable, Readable>;
    try {
      proc = spawn(
        "rec",
        [
          "-q",
          "--buffer", "512",
          "-r", "16000",
          "-c", "1",
          "-b", "16",
          "-e", "signed-integer",
          "-t", "raw",
          "-",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e: any) {
      ctx.ui.notify("Failed to spawn 'rec'. Please ensure sox is installed.", "error");
      cleanup();
      return;
    }
    rec = proc;

    proc.on("error", (err) => {
      if (myGeneration !== generation) return;
      ctx.ui.notify(`Audio recording error: ${err.message}`, "error");
      cleanup();
    });

    proc.on("exit", (code) => {
      if (myGeneration !== generation) return;
      if (state === "recording" && code !== null && code !== 0) {
        if (activeCtx) {
          activeCtx.ui.notify(`Audio recorder exited unexpectedly (code ${code})`, "warning");
        }
        cleanup();
      }
    });

    // 启动 Provider 连接
    try {
      await provider.start({
        onFinal: (t) => {
          if (myGeneration !== generation || cancelled) return;
          if (t) finals.push(t);
        },
        onError: (err) => {
          if (myGeneration !== generation || cancelled) return;
          dbg(`provider error: ${err.message}`);
          if (activeCtx) activeCtx.ui.notify(`${provider.name} error: ${err.message}`, "error");
          cleanup();
        },
        onClose: () => {
          if (myGeneration !== generation || cancelled) return;
          dbg(`provider closed (gen ${myGeneration})`);
          if (state === "recording" || state === "stopping") {
            cleanup();
          }
        },
      });
    } catch (err: any) {
      if (myGeneration !== generation || cancelled) return;
      ctx.ui.notify(`Failed to connect ${provider.name}: ${err.message}`, "error");
      cleanup();
      return;
    }

    if (myGeneration !== generation || !rec) return;

    rec.stdout.on("data", (chunk: Buffer) => {
      currentLevel = rmsFromPcm16(chunk);
      if (provider && state === "recording") {
        provider.sendAudio(chunk);
      }
    });
  };

  const stopDictation = async () => {
    if (state !== "recording") return;
    state = "stopping";
    stopMeter();
    startSpinner("finalizing…");

    if (rec) {
      try {
        rec.kill("SIGTERM");
      } catch {}
    }

    if (activeProvider) {
      try {
        await activeProvider.stop();
      } catch {
        cleanup();
        return;
      }

      stopTimeout = setTimeout(() => {
        if (state === "stopping") cleanup();
      }, 3000);
    } else {
      cleanup();
    }
  };

  const cancelDictation = () => {
    if (state !== "recording" && state !== "stopping") return;
    cancelled = true;
    finals = [];
    cleanup();
  };

  const toggleDictation = async (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (state === "idle") {
      if (tuiHandle && !resolveTarget()) {
        ctx.ui.notify("No input field is focused — dictation not started", "warning");
        return;
      }
      await startDictation(ctx);
    } else if (state === "recording") {
      stopDictation();
    }
  };

  // 判断是否匹配开始/停止热键 (仅 Alt+M)
  const isToggleKey = (data: string): boolean => {
    const config = getConfig();
    for (const sc of config.shortcuts) {
      try {
        if (matchesKey(data, sc as any)) return true;
      } catch {}
    }
    // Raw 序列兼容 (Alt+M: \x1bm / \x1bM)
    if (data === "\x1bm" || data === "\x1bM") {
      return true;
    }
    return false;
  };

  // 判断是否匹配取消热键 (仅 Alt+N)
  const isCancelKey = (data: string): boolean => {
    const config = getConfig();
    for (const sc of config.cancelShortcuts) {
      try {
        if (matchesKey(data, sc as any)) return true;
      } catch {}
    }
    // Raw 序列兼容 (Alt+N: \x1bn / \x1bN)
    if (data === "\x1bn" || data === "\x1bN") {
      return true;
    }
    return false;
  };

  // 全局前置输入监听器
  const onGlobalInput = (data: string) => {
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;

    dbg(`onGlobalInput: data=${JSON.stringify(data)} hex=${Buffer.from(data).toString("hex")} state=${state}`);

    if (isToggleKey(data)) {
      dbg(`toggleKey hit, triggering dictation`);
      if (lastCtx) toggleDictation(lastCtx);
      return { consume: true };
    }

    if (isCancelKey(data)) {
      dbg(`cancelKey hit, cancelling dictation`);
      cancelDictation();
      return { consume: true };
    }

    return undefined;
  };

  // 动态捕获并安装 TUI 句柄与全局前置按键监听
  const ensureTuiAttached = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (ctx.mode !== "tui" || tuiHandle) return;
    try {
      ctx.ui.setWidget("srp-voice-tui-handle", (tui: any) => {
        tuiHandle = tui;
        if (!removeInputListener) {
          removeInputListener = tui.addInputListener(onGlobalInput);
        }
        return { render: () => [], invalidate: () => {} };
      });
    } catch {}
  };

  pi.on("session_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("session_resume", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  // 注册快捷键 (仅 Alt+M 与 Alt+N)
  pi.registerShortcut(Key.alt("m"), {
    description: "Toggle voice dictation (srp-voice)",
    handler: async (ctx) => {
      ensureTuiAttached(ctx);
      await toggleDictation(ctx);
    },
  });

  pi.registerShortcut(Key.alt("n"), {
    description: "Cancel voice dictation (srp-voice)",
    handler: async (ctx) => {
      ensureTuiAttached(ctx);
      cancelDictation();
    },
  });

  // 注册主命令 /srp-voice
  pi.registerCommand("srp-voice", {
    description: "语音听写管理与模型切换 (/srp-voice [toggle|model|status])",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();
      if (trimmed.startsWith("model ") || trimmed === "model") {
        const subPrefix = trimmed.startsWith("model ") ? trimmed.slice(6).trimStart() : "";
        const modelCandidates: AutocompleteItem[] = ASR_MODELS.map((item) => ({
          value: `model ${item.model}`,
          label: `${item.model} (${item.provider})`,
          description: item.description,
        }));
        if (!subPrefix) return modelCandidates;
        const filtered = modelCandidates.filter(
          (c) =>
            c.value.toLowerCase().includes(subPrefix.toLowerCase()) ||
            c.label.toLowerCase().includes(subPrefix.toLowerCase()),
        );
        return filtered.length > 0 ? filtered : null;
      }

      const candidates: AutocompleteItem[] = [
        { value: "toggle", label: "toggle", description: "开始 / 停止语音听写" },
        { value: "model", label: "model", description: "交互式选择并切换 ASR 语音模型" },
        { value: "status", label: "status", description: "查看当前 ASR 模型与鉴权状态" },
      ];
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      ensureTuiAttached(ctx);
      const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const sub = parts[0];

      if (sub === "model") {
        const currentConfig = getConfig();
        const modelArg = parts[1];
        if (modelArg) {
          const matched = ASR_MODELS.find(
            (m) =>
              m.model.toLowerCase() === modelArg ||
              m.provider.toLowerCase() === modelArg ||
              `${m.model} (${m.provider})`.toLowerCase() === modelArg ||
              `${m.provider}/${m.model}`.toLowerCase() === modelArg ||
              m.model.toLowerCase().includes(modelArg),
          );
          if (matched) {
            runtimeOverrides = {
              ...runtimeOverrides,
              provider: matched.provider,
              model: matched.model,
            };
            saveVoiceSettings({ provider: matched.provider, model: matched.model }, ctx.cwd);
            ctx.ui.notify(`ASR 语音模型已切换为: ${matched.model} (${matched.provider})`, "info");
            return;
          }
        }

        const options = ASR_MODELS.map((item) => {
          const isCurrent =
            (currentConfig.provider === item.provider ||
              (currentConfig.provider === "auto" && item.provider === "dashscope")) &&
            (currentConfig.model === item.model || (!currentConfig.model && item.model === "paraformer-realtime-v2"));
          const currentBadge = isCurrent ? " (当前使用)" : "";
          const descLine = `  ${formatDimText(ctx, item.description)}`;
          return `${item.model} (${item.provider})${currentBadge}\n${descLine}`;
        });

        const selected = await ctx.ui.select("选择当前生效的 ASR 语音模型：", options);
        if (!selected) return;

        const matchIndex = options.findIndex((opt, idx) => {
          if (opt === selected) return true;
          const item = ASR_MODELS[idx];
          return selected.startsWith(`${item.model} (${item.provider})`);
        });

        if (matchIndex >= 0) {
          const target = ASR_MODELS[matchIndex];
          runtimeOverrides = {
            ...runtimeOverrides,
            provider: target.provider,
            model: target.model,
          };
          saveVoiceSettings({ provider: target.provider, model: target.model }, ctx.cwd);
          ctx.ui.notify(`ASR 语音模型已切换为: ${target.model} (${target.provider})`, "info");
        }
        return;
      }

      if (sub === "status") {
        const current = getConfig();
        const dashAuth = await resolveApiKey("dashscope", current.apiKey, ctx);
        const deepgramAuth = await resolveApiKey("deepgram", current.apiKey, ctx);

        const dashStatus = dashAuth.key ? `已就绪 (${dashAuth.source})` : "未配置 (可通过 /login dashscope 登录)";
        const deepStatus = deepgramAuth.key ? `已就绪 (${deepgramAuth.source})` : "未配置 (可通过 /login deepgram 登录)";

        const summary = [
          `srp-voice 状态:`,
          `• 当前服务商: ${current.provider} (${current.provider === "auto" ? "自动探测" : "显式指定"})`,
          `• 当前 ASR 模型: ${current.model || "paraformer-realtime-v2 (默认)"}`,
          `• 语言偏好: ${current.language}`,
          `• DashScope 凭据: ${dashStatus}`,
          `• Deepgram 凭据: ${deepStatus}`,
          `• 听写热键: ${current.shortcuts.join(", ")}`,
          `• 取消热键: ${current.cancelShortcuts.join(", ")}`,
        ].join("\n");

        ctx.ui.notify(summary, "info");
        return;
      }

      // 默认行为：开始 / 停止听写
      await toggleDictation(ctx);
    },
  });

  pi.on("session_shutdown", () => {
    if (state !== "idle") cleanup();
    removeInputListener?.();
    removeInputListener = null;
  });
}
