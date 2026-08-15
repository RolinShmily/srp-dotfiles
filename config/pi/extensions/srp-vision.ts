/**
 * srp-vision.ts — 给纯文本主模型增加图片理解能力。
 *
 * 注册一个 `model_vision` 工具：读取本地图片或远程图片，经静态视觉候选链
 * 分发到不同 Provider 的视觉模型，只把文字结果返回主模型。
 *
 * 可选环境变量：
 *   SRP_VISION_MODELS    必填候选链，格式 provider=model，逗号分隔
 *   SRP_VISION_PROVIDER  兼容旧配置：与 SRP_VISION_MODEL 一起指定一个 provider
 *   SRP_VISION_MODEL     兼容旧配置：与 SRP_VISION_PROVIDER 一起指定模型
 *   SRP_VISION_BASE_URL  兼容旧配置：覆盖指定 provider 的网关地址
 *   SRP_VISION_TIMEOUT_MS 单个模型超时，默认 90_000
 */

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import net from "node:net";
import { extname, resolve } from "node:path";

type VisionProtocol = "openai-completions";

// 静态默认候选链：OmniRoute 优先，ShuaiAPI 作为回退。
// 可通过 SRP_VISION_MODELS 覆盖，例如：provider=model,provider=model
const DEFAULT_VISION_CHAIN: VisionCandidate[] = [
  {
    provider: "omniroute",
    model: "antigravity/gemini-3.6-flash-high",
    protocol: "openai-completions",
  },
  {
    provider: "shuaiapi",
    model: "gpt-5.6-luna",
    protocol: "openai-completions",
  },
];

interface VisionCandidate {
  provider: string;
  model: string;
  protocol: VisionProtocol;
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOKENS = 8192;
const MAX_REDIRECTS = 5;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};
const SUPPORTED_MIME = new Set(Object.values(MIME));

const DEFAULT_PROMPT =
  "请详细描述这张图片：包括其中的文字（逐字转录）、界面元素、布局、颜色，以及任何值得注意的异常、报错或危险信息。";

interface VisionRequestConfig {
  baseUrl: string;
  headers: Record<string, string>;
  provider: string;
}

interface VisionRequest {
  config: VisionRequestConfig;
  candidate: VisionCandidate;
  dataUri: string;
  prompt: string;
  signal?: AbortSignal;
}

interface VisionBackend {
  analyze(request: VisionRequest): Promise<string>;
}

interface SrpVisionOptions {
  image: string;
  prompt?: string;
}

function parseCandidate(value: string): VisionCandidate {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`视觉候选格式无效: ${value}（应为 provider=model）`);
  }
  const provider = value.slice(0, separator).trim();
  const model = value.slice(separator + 1).trim();
  if (!provider || !model) throw new Error(`视觉候选格式无效: ${value}`);
  return { provider, model, protocol: "openai-completions" };
}

function resolveVisionChain(): VisionCandidate[] {
  const configured = process.env.SRP_VISION_MODELS?.trim();
  if (configured) return configured.split(",").map((item) => parseCandidate(item.trim()));

  const provider = process.env.SRP_VISION_PROVIDER?.trim();
  const legacy = process.env.SRP_VISION_MODEL?.trim();
  if (provider && legacy) {
    return legacy.split(",").map((model) => ({
      provider,
      model: model.trim(),
      protocol: "openai-completions" as const,
    })).filter((candidate) => candidate.model);
  }
  if (provider || legacy) {
    throw new Error("SRP_VISION_PROVIDER 和 SRP_VISION_MODEL 必须同时设置，或改用 SRP_VISION_MODELS");
  }
  return DEFAULT_VISION_CHAIN;
}

function envNum(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function combinedSignal(timeout: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeout);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

function isCallerAbort(_error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`内容超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 限制`);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`内容超过 ${Math.round(maxBytes / 1024 / 1024)} MiB 限制`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.");
}

async function validateRemoteUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("远程图片只支持 http(s) URL");
  }
  if (url.username || url.password) throw new Error("图片 URL 不允许包含用户名或密码");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`禁止访问本机地址: ${hostname}`);
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`禁止访问内网或保留地址: ${hostname}`);
  }
  return url;
}

async function fetchRemoteImage(url: string, signal: AbortSignal): Promise<{ buffer: Buffer; mime: string }> {
  let current = await validateRemoteUrl(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp" },
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`图片重定向缺少 Location: HTTP ${response.status}`);
      if (redirects === MAX_REDIRECTS) throw new Error("图片重定向次数过多");
      current = await validateRemoteUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error(`获取图片失败: HTTP ${response.status} ${response.statusText}`);

    const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!SUPPORTED_MIME.has(mime)) throw new Error(`不支持的远程图片类型: ${mime || "未知"}`);
    return { buffer: await readBounded(response, MAX_IMAGE_BYTES), mime };
  }
  throw new Error("图片重定向次数过多");
}

function detectMime(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  return undefined;
}

async function readImage(image: string, cwd: string, signal?: AbortSignal): Promise<string> {
  image = image.trim();
  if (!image) throw new Error("图片路径或 URL 不能为空");

  let buffer: Buffer;
  let mime: string;
  if (/^https?:\/\//i.test(image)) {
    ({ buffer, mime } = await fetchRemoteImage(image, combinedSignal(30_000, signal)));
  } else {
    const path = resolve(cwd, image);
    const expectedMime = MIME[extname(path).toLowerCase()];
    if (!expectedMime) throw new Error(`不支持的图片扩展名: ${extname(path) || "无扩展名"}`);
    const size = (await stat(path)).size;
    if (size > MAX_IMAGE_BYTES) throw new Error("图片超过 10 MiB 限制");
    buffer = await readFile(path);
    mime = expectedMime;
  }

  const detectedMime = detectMime(buffer);
  if (!detectedMime || detectedMime !== mime) {
    throw new Error(`图片内容与类型不匹配（声明 ${mime}，检测 ${detectedMime ?? "未知"}）`);
  }
  return `data:${mime};base64,${buffer.toString("base64")}`;
}

async function parseChatResponse(response: Response): Promise<string> {
  const raw = (await readBounded(response, MAX_RESPONSE_BYTES)).toString("utf8");
  if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    let json: any;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new Error(`视觉模型返回了无效 JSON: ${raw.slice(0, 200)}`);
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content.map((part) => typeof part === "string" ? part : part?.text ?? "").join("").trim();
    }
    return String(json?.choices?.[0]?.message?.reasoning_content ?? "").trim();
  }

  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta;
      const content = delta?.content ?? delta?.reasoning_content;
      if (typeof content === "string") text += content;
    } catch { /* 忽略非 JSON SSE 事件 */ }
  }
  return text.trim();
}

const openAICompatibleBackend: VisionBackend = {
  async analyze({ config, candidate, dataUri, prompt, signal }: VisionRequest): Promise<string> {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...config.headers },
      body: JSON.stringify({
        model: candidate.model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        }],
        max_tokens: MAX_TOKENS,
      }),
      signal: combinedSignal(envNum("SRP_VISION_TIMEOUT_MS", 90_000), signal),
    });
    if (!response.ok) {
      const body = (await readBounded(response, 16 * 1024)).toString("utf8");
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
    const text = await parseChatResponse(response);
    if (!text) throw new Error("视觉模型返回了空内容");
    return text;
  },
};

const VISION_BACKENDS: Record<VisionProtocol, VisionBackend> = {
  "openai-completions": openAICompatibleBackend,
};

function getBackend(protocol: VisionProtocol): VisionBackend {
  const backend = VISION_BACKENDS[protocol];
  if (!backend) throw new Error(`不支持的视觉协议: ${protocol}`);
  return backend;
}

async function resolveRequestConfig(ctx: ExtensionContext, provider: string): Promise<VisionRequestConfig> {
  const registered = ctx.modelRegistry.getProvider(provider);
  const resolved = await ctx.modelRegistry.getProviderAuth(provider);
  const apiKey = resolved?.auth.apiKey;
  if (!apiKey) throw new Error(`未找到 provider "${provider}" 的 API key，请先执行 /login ${provider}`);

  const legacyBaseUrl = process.env.SRP_VISION_BASE_URL;
  const legacyProvider = process.env.SRP_VISION_PROVIDER?.trim();
  const configuredBaseUrl = (legacyProvider && provider === legacyProvider ? legacyBaseUrl : undefined) ||
    resolved.auth.baseUrl || registered?.baseUrl;
  if (!configuredBaseUrl) throw new Error(`provider "${provider}" 未配置视觉接口地址`);
  const baseUrl = configuredBaseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  for (const source of [registered?.headers, resolved.auth.headers]) {
    for (const [name, value] of Object.entries(source ?? {})) {
      if (typeof value === "string") headers[name] = value;
    }
  }
  return { baseUrl, headers, provider };
}

async function analyzeWithVision(
  opts: SrpVisionOptions,
  cwd: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<{ text: string; model: string; provider: string; truncated: boolean }> {
  const candidates = resolveVisionChain();
  if (!candidates.length) throw new Error("未配置视觉模型");

  const dataUri = await readImage(opts.image, cwd, signal);
  const prompt = opts.prompt?.trim() || DEFAULT_PROMPT;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const config = await resolveRequestConfig(ctx, candidate.provider);
      const text = await getBackend(candidate.protocol).analyze({
        config,
        candidate,
        dataUri,
        prompt,
        signal,
      });
      const output = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
      return { text: output.content, model: candidate.model, provider: candidate.provider, truncated: output.truncated };
    } catch (error) {
      if (isCallerAbort(error, signal)) throw error;
      errors.push(`${candidate.provider}/${candidate.model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`所有视觉模型均调用失败：${errors.join("；")}`);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "model_vision",
    label: "Vision",
    description:
      "使用已配置的视觉Provider理解一张图片并返回文字描述。支持本地 PNG/JPEG/WebP/GIF/BMP 路径或公网 http(s) URL；可用 prompt 指定 OCR、报错分析或界面检查等任务。",
    parameters: Type.Object({
      image: Type.String({ minLength: 1, description: "本地图片路径（相对当前目录或绝对路径）或公网 http(s) URL" }),
      prompt: Type.Optional(Type.String({ description: "希望视觉模型回答的具体问题" })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await analyzeWithVision(params, ctx.cwd, ctx, signal);
      return {
        content: [{ type: "text", text: result.text }],
        details: {
          model: result.model,
          provider: result.provider,
          truncated: result.truncated,
        },
      };
    },
  });
}
