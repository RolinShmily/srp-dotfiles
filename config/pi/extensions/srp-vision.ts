/**
 * srp-vision.ts — 给纯文本主模型（DeepSeek）加"眼睛"
 *
 * 原理：主模型（如 deepseek-v4-flash）的 input 只有 ["text"]，看不到图片。
 * 本扩展注册一个 `srp_vision` 工具：把本地图片路径 / URL 读成 base64，
 * 直接调 omniroute 网关（OpenAI 兼容 /chat/completions）上的多模态模型
 * `antigravity/gemini-3.6-flash-high`，把返回的文字描述交给主模型。
 * 图片字节不进入主模型上下文，只传文字。
 *
 * 依赖（同目录 srp-providers.ts 已注册 provider）：
 *   - provider: omniroute，API key 存 ~/.pi/agent/auth.json（/login omniroute）
 *   - 视觉模型: antigravity/gemini-3.6-flash-high（input 含 "image"）
 *
 * 环境变量覆盖（一般不需要设）：
 *   SRP_VISION_BASE_URL / SRP_VISION_MODEL / SRP_VISION_API_KEY / SRP_VISION_PROVIDER
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { extname, join } from "node:path";
import { homedir } from "node:os";

// ============================ 核心逻辑（无 pi 依赖，可独立测试） ============================

const DEFAULT_BASE_URL = "http://192.168.22.174:20128/v1";
const DEFAULT_MODEL = "antigravity/gemini-3.6-flash-high";
const DEFAULT_PROVIDER = "omniroute";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

/** auth.json 的 key 支持 "$VAR" 插值与 "!cmd" 命令（与 Pi 行为一致） */
function resolveValue(v: string): string {
  if (v.startsWith("!!")) return v.slice(1);
  if (v.startsWith("!")) {
    return execSync(v.slice(1), {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
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
  let auth: Record<string, { key?: string }> = {};
  try {
    auth = JSON.parse(await readFile(authPath, "utf8"));
  } catch {
    /* 无 auth.json 时走下方报错 */
  }
  const entry = auth[provider]?.key;
  if (!entry) {
    throw new Error(
      `未找到 provider "${provider}" 的 API key。请先执行 /login ${provider}，` +
      `或在 ${authPath} 中配置，或设置环境变量 SRP_VISION_API_KEY。`,
    );
  }
  return resolveValue(entry);
}

async function readImage(
  image: string,
  signal: AbortSignal,
): Promise<{ dataUri: string; mime: string }> {
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
  return { dataUri: `data:${mime};base64,${buf.toString("base64")}`, mime };
}

/** 解析 OpenAI 兼容响应：普通 JSON 或 SSE 流式（部分网关对视觉请求强制流式） */
async function parseChatResponse(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    const text = (msg?.content || msg?.reasoning_content || "").toString().trim();
    if (!text) throw new Error("视觉模型返回了空内容");
    return text;
  }
  const raw = await res.text();
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue; // 跳过 SSE 注释行（如 : x-omniroute-...）与空行
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      const delta = chunk?.choices?.[0]?.delta;
      if (delta) text += delta.content ?? delta.reasoning_content ?? "";
    } catch {
      /* 跳过无法解析的行 */
    }
  }
  text = text.trim();
  if (!text) throw new Error("视觉模型返回了空内容（SSE 流无文本）");
  return text;
}

export interface SrpVisionOptions {
  image: string;
  prompt?: string;
}

export async function analyzeWithVision(
  opts: SrpVisionOptions,
  signal?: AbortSignal,
): Promise<{ text: string; model: string; provider: string }> {
  const base = (process.env.SRP_VISION_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.SRP_VISION_MODEL ?? DEFAULT_MODEL;
  const provider = process.env.SRP_VISION_PROVIDER ?? DEFAULT_PROVIDER;
  const key = await loadAuthKey(provider);

  const { dataUri } = await readImage(opts.image, signal ?? AbortSignal.timeout(30_000));
  const prompt =
    opts.prompt?.trim() ||
    "请详细描述这张图片：包括其中的文字（逐字转录）、界面元素、布局、颜色，以及任何值得注意的异常、报错或危险信息。";

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error("视觉请求超时（90s）")), 90_000);
  signal?.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
        max_tokens: 8192,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      throw new Error(`视觉模型调用失败: HTTP ${res.status}\n${body}`);
    }
    const text = await parseChatResponse(res);
    return { text, model, provider };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================ Pi 扩展注册 ============================

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "srp_vision",
    description:
      "识别图片内容（给无视觉能力的模型当眼睛）。传入本地图片路径或 http(s) URL，" +
      "内部调用多模态模型（antigravity/gemini-3.6-flash-high，经 omniroute 网关）返回文字描述，" +
      "主模型只拿到文字、不接触图片字节。用法：" +
      "srp_vision(image='/tmp/screenshot.png', prompt='这张图显示了什么错误？')。",
    parameters: Type.Object({
      image: Type.String({ description: "本地图片绝对路径或 http(s) URL" }),
      prompt: Type.Optional(
        Type.String({ description: "具体问题（默认：详细中文描述图片内容）" }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const { text, model, provider } = await analyzeWithVision(params, signal);
      return {
        content: [{ type: "text", text }],
        details: { model, provider, via: "srp-vision" },
      };
    },
  });
}
