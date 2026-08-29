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
  CONFIG_DIR_NAME,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  getAgentDir,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { lookup } from "node:dns/promises";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import net from "node:net";
import { extname, join, resolve } from "node:path";

type VisionProtocol = "openai-completions" | "pi-native";

// 静态默认候选链：Antigravity gemini-3.7-flash 最高优先级，OmniRoute / ShuaiAPI 作为回退。
// 可通过 SRP_VISION_MODELS 覆盖，例如：provider=model,provider=model
const DEFAULT_VISION_CHAIN: VisionCandidate[] = [
  {
    provider: "antigravity",
    model: "gemini-3.7-flash",
    protocol: "pi-native",
  },
  {
    provider: "omniroute",
    model: "antigravity/gemini-3.6-flash-high",
    protocol: "openai-completions",
  },
  {
    provider: "shuaiapi",
    model: "gpt-5.6-sol",
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
  config?: VisionRequestConfig;
  candidate: VisionCandidate;
  dataUri: string;
  prompt: string;
  signal?: AbortSignal;
  ctx?: ExtensionContext;
}

interface VisionBackend {
  analyze(request: VisionRequest): Promise<string>;
}

interface SrpVisionOptions {
  image: string;
  prompt?: string;
}

function extensionEnabled(cwd: string): boolean {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpVision;
      return section && typeof section === "object" && !Array.isArray(section)
        ? section as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  };

  const config = {
    ...read(join(getAgentDir(), "settings.json")),
    ...read(join(cwd, CONFIG_DIR_NAME, "settings.json")),
  };
  return config.enabled !== false && config.model_vision !== false;
}

function parseCandidate(value: string): VisionCandidate {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`视觉候选格式无效: ${value}（应为 provider=model）`);
  }
  const provider = value.slice(0, separator).trim();
  const model = value.slice(separator + 1).trim();
  if (!provider || !model) throw new Error(`视觉候选格式无效: ${value}`);
  const protocol: VisionProtocol = provider === "antigravity" ? "pi-native" : "openai-completions";
  return { provider, model, protocol };
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

const piNativeBackend: VisionBackend = {
  async analyze({ candidate, dataUri, prompt, signal, ctx }: VisionRequest): Promise<string> {
    if (!ctx) throw new Error("缺少 ExtensionContext");
    const model = ctx.modelRegistry.find(candidate.provider, candidate.model);
    if (!model) {
      throw new Error(`未在 modelRegistry 找到模型 ${candidate.provider}/${candidate.model}`);
    }
    const auth = await ctx.modelRegistry.getProviderAuth(candidate.provider);
    const mimeMatch = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    if (!mimeMatch) throw new Error("无法解析图片 dataUri");
    const mimeType = mimeMatch[1];
    const base64Data = mimeMatch[2];

    const { completeSimple } = await import("@earendil-works/pi-ai/compat");
    const timeoutMs = envNum("SRP_VISION_TIMEOUT_MS", 90_000);
    const combinedSig = combinedSignal(timeoutMs, signal);

    const response = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image", data: base64Data, mimeType },
            ],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth?.auth.apiKey,
        headers: auth?.auth.headers,
        signal: combinedSig,
        maxTokens: MAX_TOKENS,
      },
    );

    if (response.stopReason === "error") {
      throw new Error(response.errorMessage || "Antigravity 视觉模型调用返回错误");
    }

    const text = response.content
      ?.filter((c: any) => c.type === "text")
      ?.map((c: any) => c.text)
      ?.join("\n")
      ?.trim();

    if (!text) throw new Error("视觉模型返回了空内容");
    return text;
  },
};

const VISION_BACKENDS: Record<VisionProtocol, VisionBackend> = {
  "openai-completions": openAICompatibleBackend,
  "pi-native": piNativeBackend,
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
      let config: VisionRequestConfig | undefined;
      if (candidate.protocol === "openai-completions") {
        config = await resolveRequestConfig(ctx, candidate.provider);
      }
      const text = await getBackend(candidate.protocol).analyze({
        config,
        candidate,
        dataUri,
        prompt,
        signal,
        ctx,
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

function syncVisionActiveTools(pi: ExtensionAPI, enabled: boolean): void {
  let active = pi.getActiveTools();
  if (enabled) {
    if (!active.includes("model_vision")) active = [...active, "model_vision"];
  } else {
    active = active.filter((t) => t !== "model_vision");
  }
  pi.setActiveTools(active);
}

function registerVisionTool(pi: ExtensionAPI): void {
  let runtimeEnabled = extensionEnabled(process.cwd());

  pi.on("session_start", (_event, ctx) => {
    runtimeEnabled = extensionEnabled(ctx.cwd);
    syncVisionActiveTools(pi, runtimeEnabled);
  });

  // 注册主控制命令：/srp-vision
  pi.registerCommand("srp-vision", {
    description: "管理与测试视觉候选模型（/srp-vision [on|off|status|test <path>]）",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "status", label: "status", description: "查看当前视觉候选链与鉴权状态" },
        { value: "on", label: "on", description: "开启 model_vision 视觉工具" },
        { value: "off", label: "off", description: "关闭 model_vision 视觉工具" },
        { value: "test ", label: "test <image>", description: "测试视觉模型分析指定图片" },
      ];
      const trimmed = prefix.trimStart();
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const action = (parts[0] || "status").toLowerCase();

      if (action === "status" || !parts[0]) {
        let chain: VisionCandidate[] = [];
        try {
          chain = resolveVisionChain();
        } catch {}
        const chainSummary = chain
          .map((c, i) => `  ${i + 1}. [${c.provider}] ${c.model}`)
          .join("\n") || "  (无候选)";
        const timeout = envNum("SRP_VISION_TIMEOUT_MS", 90_000) / 1000;
        ctx.ui.notify(
          `srp-vision 状态: ${runtimeEnabled ? "已开启" : "已关闭"}\n• 单次超时: ${timeout}s\n• 候选分发链:\n${chainSummary}`,
          "info",
        );
        return;
      }

      if (action === "on") {
        runtimeEnabled = true;
        syncVisionActiveTools(pi, true);
        ctx.ui.notify("srp-vision: 已开启并激活 model_vision 视觉工具", "info");
        return;
      }

      if (action === "off") {
        runtimeEnabled = false;
        syncVisionActiveTools(pi, false);
        ctx.ui.notify("srp-vision: 已关闭并取消激活 model_vision 视觉工具", "info");
        return;
      }

      if (action === "test") {
        const imagePath = parts.slice(1).join(" ").trim();
        if (!imagePath) {
          ctx.ui.notify("用法: /srp-vision test <图片本地路径或URL>", "warning");
          return;
        }
        try {
          ctx.ui.notify(`正在分析图片: ${imagePath} ...`, "info");
          const result = await analyzeWithVision(
            { image: imagePath, prompt: "请用一句话简要总结这张图片的内容。" },
            ctx.cwd,
            ctx,
          );
          ctx.ui.notify(
            `分析成功 [${result.provider}/${result.model}]:\n${result.text.slice(0, 300)}...`,
            "info",
          );
        } catch (e) {
          ctx.ui.notify(`视觉分析失败: ${String(e)}`, "error");
        }
        return;
      }

      ctx.ui.notify("用法: /srp-vision [on|off|status|test <image>]", "info");
    },
  });

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
      runtimeEnabled = extensionEnabled(ctx.cwd);
      if (!runtimeEnabled) {
        throw new Error("srp-vision 扩展当前已关闭。请在 TUI 中输入 /srp-vision on 开启后重试。");
      }
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
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const { image } = args as { image?: string };
      const display = image && image.length > 50 ? "..." + image.slice(-47) : image || "";
      text.setText(
        theme.fg("toolTitle", theme.bold("vision ")) + theme.fg("accent", display),
      );
      return text;
    },
  });
}

export default function (pi: ExtensionAPI) {
  registerVisionTool(pi);
}
