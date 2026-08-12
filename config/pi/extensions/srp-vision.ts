/**
 * srp-vision.ts — 给纯文本主模型（DeepSeek）加"眼睛"。
 * 注册 `srp_vision` 工具：读图 → 经 omniroute 网关调多模态模型 → 返回文字描述。
 * 图片字节不进入主模型上下文。换视觉模型见下方 VISION 配置区 / 环境变量。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { extname, join } from "node:path";
import { homedir } from "node:os";

// ============================ VISION 配置区 ============================
// 换视觉模型：改 DEFAULT_MODELS（逗号分隔多个候选，前面的失败自动尝试下一个），
// 或运行时用环境变量覆盖：SRP_VISION_BASE_URL / SRP_VISION_MODEL / SRP_VISION_API_KEY / SRP_VISION_PROVIDER / SRP_VISION_TIMEOUT_MS

const DEFAULT_BASE_URL = "http://192.168.22.174:20128/v1";
const DEFAULT_MODELS = ["antigravity/gemini-3.6-flash-high", "antigravity/gemini-3.1-pro-low"];
const DEFAULT_PROVIDER = "omniroute";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOKENS = 8192;

const MIME: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};

const DEFAULT_PROMPT =
  "请详细描述这张图片：包括其中的文字（逐字转录）、界面元素、布局、颜色，以及任何值得注意的异常、报错或危险信息。";

// ============================ 核心逻辑（无 pi 依赖，可独立测试） ============================

/** auth.json 的 key 支持 "$VAR" 插值与 "!cmd" 命令（与 Pi 行为一致） */
function resolveValue(v: string): string {
  if (v.startsWith("!!")) return v.slice(1);
  if (v.startsWith("!")) {
    return execSync(v.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  }
  return v.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => process.env[name] ?? m);
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

async function loadAuthKey(provider: string): Promise<string> {
  const envKey = process.env.SRP_VISION_API_KEY;
  if (envKey) return resolveValue(envKey);
  const authPath = join(agentDir(), "auth.json");
  try {
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    const entry = auth[provider]?.key;
    if (entry) return resolveValue(entry);
  } catch { /* fallthrough */ }
  throw new Error(
    `未找到 provider "${provider}" 的 API key。请先 /login ${provider}，` +
    `或编辑 ${agentDir()}/auth.json，或设置 SRP_VISION_API_KEY。`,
  );
}

async function readImage(image: string, signal: AbortSignal): Promise<string> {
  let buf: Buffer;
  let mime: string;
  if (/^https?:\/\//i.test(image)) {
    const res = await fetch(image, { signal });
    if (!res.ok) throw new Error(`获取图片失败: HTTP ${res.status} ${res.statusText}`);
    buf = Buffer.from(await res.arrayBuffer());
    mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
  } else {
    buf = await readFile(image);
    mime = MIME[extname(image).toLowerCase()] ?? "image/png";
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MiB 限制`);
  }
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/** 解析 OpenAI 兼容响应：普通 JSON 或 SSE 流式（部分网关对视觉请求强制流式） */
async function parseChatResponse(res: Response): Promise<string> {
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    return (msg?.content || msg?.reasoning_content || "").toString().trim();
  }
  let text = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data:")) continue; // 跳过 SSE 注释行与空行
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta;
      if (delta) text += delta.content ?? delta.reasoning_content ?? "";
    } catch { /* 跳过无法解析的行 */ }
  }
  return text.trim();
}

/** 单模型单次调用 */
async function callModel(
  base: string, model: string, key: string, dataUri: string, prompt: string, signal?: AbortSignal,
): Promise<string> {
  const ac = new AbortController();
  const timeout = setTimeout(
    () => ac.abort(new Error(`视觉请求超时（${Math.round(timeoutMs() / 1000)}s）`)),
    timeoutMs(),
  );
  signal?.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  if (signal?.aborted) ac.abort(signal.reason);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUri } },
        ] }],
        max_tokens: MAX_TOKENS,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const text = await parseChatResponse(res);
    if (!text) throw new Error("视觉模型返回了空内容");
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function timeoutMs(): number {
  const n = Number(process.env.SRP_VISION_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

export interface SrpVisionOptions {
  image: string;
  prompt?: string;
}

/** 核心入口：按候选模型依次尝试，全部失败抛聚合错误 */
export async function analyzeWithVision(
  opts: SrpVisionOptions,
  signal?: AbortSignal,
): Promise<{ text: string; model: string; provider: string }> {
  const base = (process.env.SRP_VISION_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const models = (process.env.SRP_VISION_MODEL ?? DEFAULT_MODELS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
  const provider = process.env.SRP_VISION_PROVIDER ?? DEFAULT_PROVIDER;
  const key = await loadAuthKey(provider);
  const dataUri = await readImage(opts.image, signal ?? AbortSignal.timeout(30_000));
  const prompt = opts.prompt?.trim() || DEFAULT_PROMPT;

  let lastErr: Error | undefined;
  for (const model of models) {
    try {
      return { text: await callModel(base, model, key, dataUri, prompt, signal), model, provider };
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(`所有视觉模型均调用失败（${models.join(", ")}）: ${lastErr?.message}`);
}

// ============================ Pi 扩展注册 ============================

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "srp_vision",
    description:
      "视觉工具：理解图片并返回文字内容给主模型。传入本地图片路径或 http(s) URL。",
    parameters: Type.Object({
      image: Type.String({ description: "本地图片路径或 http(s) URL" }),
      prompt: Type.Optional(Type.String({ description: "具体问题（可选）" })),
    }),
    async execute(_toolCallId, params, signal) {
      const { text, model, provider } = await analyzeWithVision(params, signal);
      return { content: [{ type: "text", text }], details: { model, provider } };
    },
  });
}
