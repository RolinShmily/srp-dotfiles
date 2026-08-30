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
 *
 * settings.json 配置示例 (在 ~/.pi/agent/settings.json 或 .pi/settings.json 中)：
 *   "srpVoice": {
 *     "enabled": true,
 *     "provider": "auto",                  // "auto" | "aliyun" | "dashscope" | "deepgram"
 *     "model": "paraformer-realtime-v2",    // 或 "nova-3"
 *     "apiKey": "",                         // 可选，留空自动从 ~/.zshrc.local 或系统环境变量读取
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
import { Key, matchesKey, isKeyRelease, isKeyRepeat } from "@earendil-works/pi-tui";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { existsSync, appendFileSync, readFileSync } from "node:fs";
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
  readonly name: string;
  isAvailable(): boolean;
  start(callbacks: VoiceCallbacks): Promise<void>;
  sendAudio(chunk: Buffer): void;
  stop(): Promise<void>;
  cancel(): void;
}

// ── Provider 1: Deepgram Nova-3 ───────────────────────────────────────────
class DeepgramProvider implements StreamingVoiceProvider {
  readonly name = "Deepgram (Nova-3)";
  private ws: WebSocket | null = null;
  private config: SrpVoiceConfig;
  private isCancelled = false;

  constructor(config: SrpVoiceConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    const key = this.config.apiKey || getEnv("DEEPGRAM_API_KEY");
    return !!key;
  }

  async start(callbacks: VoiceCallbacks): Promise<void> {
    this.isCancelled = false;
    const apiKey = this.config.apiKey || getEnv("DEEPGRAM_API_KEY");
    if (!apiKey) {
      throw new Error("DEEPGRAM_API_KEY is not set in settings.json or environment");
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
  readonly name = "Aliyun DashScope (Paraformer)";
  private ws: WebSocket | null = null;
  private taskId: string = "";
  private lastSentenceMap = new Map<number, string>();
  private config: SrpVoiceConfig;
  private isCancelled = false;

  constructor(config: SrpVoiceConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    const key = this.config.apiKey || getEnv("DASHSCOPE_API_KEY");
    return !!key;
  }

  async start(callbacks: VoiceCallbacks): Promise<void> {
    this.isCancelled = false;
    const apiKey = this.config.apiKey || getEnv("DASHSCOPE_API_KEY");
    if (!apiKey) {
      throw new Error("DASHSCOPE_API_KEY is not set in settings.json or environment");
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
function selectProvider(config: SrpVoiceConfig): StreamingVoiceProvider {
  const explicit = (config.provider || "auto").toLowerCase().trim();
  const aliyun = new AliyunDashscopeProvider(config);
  const deepgram = new DeepgramProvider(config);

  if (explicit === "deepgram") return deepgram;
  if (explicit === "aliyun" || explicit === "dashscope" || explicit === "paraformer") return aliyun;

  // Auto 策略：优先使用已配置 Key 的 Provider (国内优先百炼)
  if (aliyun.isAvailable()) return aliyun;
  if (deepgram.isAvailable()) return deepgram;

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
    const provider = selectProvider(config);
    if (!provider.isAvailable()) {
      ctx.ui.notify(
        `No API key configured for ${provider.name}. Please set DASHSCOPE_API_KEY or DEEPGRAM_API_KEY in settings.json or environment.`,
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

  const toggleDictation = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (state === "idle") {
      if (tuiHandle && !resolveTarget()) {
        ctx.ui.notify("No input field is focused — dictation not started", "warning");
        return;
      }
      startDictation(ctx);
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
      toggleDictation(ctx);
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
    description: "Toggle voice dictation (srp-voice)",
    handler: async (_args, ctx) => {
      ensureTuiAttached(ctx);
      toggleDictation(ctx);
    },
  });

  pi.on("session_shutdown", () => {
    if (state !== "idle") cleanup();
    removeInputListener?.();
    removeInputListener = null;
  });
}
