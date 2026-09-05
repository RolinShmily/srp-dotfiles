/**
 * srp-image.ts — 智能体图片生成与管理扩展 (专注 OpenRouter 官方 Image API)
 *
 * 核心特性：
 * 1. 专注 OpenRouter 专用 Image API：
 *    - 端点：POST https://openrouter.ai/api/v1/images
 *    - 统一支持文生图 (Text-to-Image) 与图生图 (Image-to-Image / input_references)
 *    - 原生 b64_json 解码落盘与 media_type 格式嗅探
 * 2. Pi 原生鉴权对接：
 *    - 优先对接 ctx.modelRegistry.getApiKeyForProvider("openrouter") (支持 /login openrouter)
 *    - 兼容 settings.json / 环境变量 (OPENROUTER_API_KEY)
 * 3. 精选生图模型库与交互式切换：
 *    - 内置 Google Imagen 3, 豆包 Seedream 4.5, FLUX 1.1 Pro, OpenAI Image, SD 3.5 Large 等高质量模型
 *    - 支持 /srp-image model 交互式勾选并持久化保存
 * 4. 沉浸式 Image Mode：
 *    - 无参 /srp-image 命令直接一键开关生图模式
 *    - 激活时输入框上方挂载极简专业横幅，输入提示词直接生图 (0 消耗主模型 Token)
 * 5. 安全沙箱与原子落盘：
 *    - 路径防穿越、SSRF 防护、原子写入 (open wx 递增防覆盖)
 * 6. 工具默认注入：
 *    - 默认挂载 image_generate 工具，仅在 settings.json 中配置 tool: false 时剔除
 *
 * settings.json 配置示例 (在 ~/.pi/agent/settings.json 或 .pi/settings.json 中)：
 * {
 *   "srpImage": {
 *     "tool": true,
 *     "model": "google/imagen-3",
 *     "outputDir": ".pi/generated-images"
 *   }
 * }
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import net from "node:net";
import { lookup } from "node:dns/promises";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Image,
  Text,
  getCapabilities,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ============================ 常量与数据结构 ============================

const OPENROUTER_IMAGE_ENDPOINT = "https://openrouter.ai/api/v1/images";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/images/models";
const DEFAULT_MODEL = "google/gemini-3.1-flash-image";
const DEFAULT_OUTPUT_DIR = ".pi/generated-images";
const CUSTOM_TYPE_IMAGE_RESULT = "srp-image-result";
const WIDGET_KEY_MODE = "srp-image-mode";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

export interface OpenRouterImageModel {
  slug: string;
  label: string;
  description: string;
}

/**
 * 历史废弃或非官方命名到 OpenRouter 官方真实 Image API 模型 Slug 的智能纠偏字典
 */
export const MODEL_ALIASES: Record<string, string> = {
  "google/imagen-3": "google/gemini-3.1-flash-image",
  "google/imagen-3-fast": "google/gemini-3.1-flash-lite-image",
  "imagen-3": "google/gemini-3.1-flash-image",
  "imagen-3-fast": "google/gemini-3.1-flash-lite-image",
  "google/imagen": "google/gemini-3.1-flash-image",
  "black-forest-labs/flux-1.1-pro": "black-forest-labs/flux.2-pro",
  "black-forest-labs/flux-1-schnell": "black-forest-labs/flux.2-klein-4b",
  "stabilityai/stable-diffusion-3.5-large": "black-forest-labs/flux.2-pro",
  "seedream-4.5": "bytedance-seed/seedream-4.5",
  "seedream-5": "bytedance-seed/seedream-5-0-pro",
  "seedream-5-pro": "bytedance-seed/seedream-5-0-pro",
  "seedream-5-lite": "bytedance-seed/seedream-5-0-lite",
  "gpt-image-2": "openai/gpt-image-2",
  "gpt-image-1": "openai/gpt-image-1",
};

export function resolveImageModel(model?: string): string {
  if (!model || !model.trim()) return DEFAULT_MODEL;
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  if (MODEL_ALIASES[lower]) {
    return MODEL_ALIASES[lower];
  }
  return trimmed;
}

export const IMAGE_MODELS: OpenRouterImageModel[] = [
  {
    slug: "google/gemini-3.1-flash-image",
    label: "Google Gemini 3.1 Flash Image (Nano Banana 2)",
    description: "Pro级高画质写实与构图，极速响应 (推荐默认)",
  },
  {
    slug: "google/gemini-3-pro-image",
    label: "Google Gemini 3 Pro Image (Nano Banana Pro)",
    description: "顶尖多模态推理、复杂排版与文字排版",
  },
  {
    slug: "google/gemini-3.1-flash-lite-image",
    label: "Google Gemini 3.1 Flash Lite Image",
    description: "超轻量高性价比探索",
  },
  {
    slug: "bytedance-seed/seedream-5-0-pro",
    label: "字节 Seedream 5.0 Pro",
    description: "字节最新旗舰生图，细腻人物与艺术构图",
  },
  {
    slug: "bytedance-seed/seedream-4.5",
    label: "字节 Seedream 4.5",
    description: "高保真编辑与概念创意设计",
  },
  {
    slug: "openai/gpt-image-2",
    label: "OpenAI GPT Image 2",
    description: "OpenAI 旗舰图像生成与智能编辑",
  },
  {
    slug: "openai/gpt-image-1",
    label: "OpenAI GPT Image 1",
    description: "官方精准文字渲染与透明背景",
  },
  {
    slug: "black-forest-labs/flux.2-pro",
    label: "FLUX.2 Pro",
    description: "前沿照片级光影真实感与风格一致性",
  },
  {
    slug: "black-forest-labs/flux.2-max",
    label: "FLUX.2 Max",
    description: "最高精度与画质上限",
  },
  {
    slug: "qwen/qwen-image-3-pro",
    label: "通义千问 Qwen Image 3 Pro",
    description: "高保真中文文字渲染与多模态世界知识",
  },
  {
    slug: "x-ai/grok-imagine-image-2.0",
    label: "xAI Grok Imagine 2.0",
    description: "马斯克 xAI 最新快速高保真生图",
  },
];

export async function fetchOnlineImageModels(signal?: AbortSignal): Promise<OpenRouterImageModel[]> {
  try {
    const timeoutSig = makeTimeoutSignal(3500, signal);
    const resp = await fetch(OPENROUTER_MODELS_ENDPOINT, {
      signal: timeoutSig,
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return IMAGE_MODELS;
    const data: any = await resp.json();
    if (!Array.isArray(data?.data)) return IMAGE_MODELS;

    const list: OpenRouterImageModel[] = [];
    const seen = new Set<string>();

    // 1. 优先放入内置的精选推荐模型（置顶展示）
    for (const m of IMAGE_MODELS) {
      list.push(m);
      seen.add(m.slug.toLowerCase());
    }

    // 2. 动态追加 OpenRouter 官方提供的所有全量最新模型
    for (const item of data.data) {
      if (!item || typeof item.id !== "string") continue;
      const slug = item.id.trim();
      const lower = slug.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);

      const name = typeof item.name === "string" ? item.name.trim() : slug;
      const desc =
        typeof item.description === "string" && item.description.trim()
          ? item.description.trim().replace(/\s+/g, " ").slice(0, 60) + "..."
          : "OpenRouter 官方生图模型";

      list.push({
        slug,
        label: name,
        description: desc,
      });
    }

    return list;
  } catch {
    return IMAGE_MODELS;
  }
}

export interface SrpImageConfig {
  tool: boolean;
  model: string;
  outputDir: string;
  apiKey?: string;
}

export interface ImageGenerationOptions {
  prompt: string;
  model: string;
  image?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
  model: string;
  prompt: string;
  revisedPrompt?: string;
}

export interface SaveImageResult {
  savedPath: string;
  relPath: string;
  model: string;
  prompt: string;
  revisedPrompt?: string;
  mimeType: string;
  buffer: Buffer;
}

// ============================ 环境变量与配置持久化 ============================

const envCache = new Map<string, string>();
let runtimeOverrides: Partial<SrpImageConfig> = {};

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

function loadConfig(cwd?: string): SrpImageConfig {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpImage;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  let global: Record<string, unknown> = {};
  try {
    global = read(join(getAgentDir(), "settings.json"));
  } catch {}
  const project = cwd ? read(join(cwd, CONFIG_DIR_NAME, "settings.json")) : {};
  const merged = { ...global, ...project };

  const tool = merged.tool !== false; // 默认注入 true，仅在显式配置 false 时剔除
  const rawModel =
    typeof merged.model === "string" && merged.model.trim()
      ? merged.model.trim()
      : typeof merged.defaultModel === "string" && merged.defaultModel.trim()
        ? merged.defaultModel.trim()
        : DEFAULT_MODEL;
  const model = resolveImageModel(rawModel);
  const outputDir =
    typeof merged.outputDir === "string" && merged.outputDir.trim()
      ? merged.outputDir.trim()
      : DEFAULT_OUTPUT_DIR;
  const apiKey = typeof merged.apiKey === "string" ? merged.apiKey.trim() : "";

  return {
    tool,
    model,
    outputDir,
    apiKey,
    ...runtimeOverrides,
  };
}

function saveImageSettings(updates: Partial<SrpImageConfig>, cwd?: string): void {
  const projectPath = cwd ? join(cwd, CONFIG_DIR_NAME, "settings.json") : null;
  const targetPath = projectPath && existsSync(projectPath) ? projectPath : join(getAgentDir(), "settings.json");
  let data: Record<string, unknown> = {};
  try {
    if (existsSync(targetPath)) {
      data = JSON.parse(readFileSync(targetPath, "utf-8")) || {};
    }
  } catch {}
  const current =
    data.srpImage && typeof data.srpImage === "object" && !Array.isArray(data.srpImage)
      ? (data.srpImage as Record<string, unknown>)
      : {};
  data.srpImage = { ...current, ...updates };
  try {
    writeFileSync(targetPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch {}
}

async function resolveOpenRouterApiKey(
  ctx?: ExtensionContext | null
): Promise<{ key: string; source: string }> {
  const config = loadConfig(ctx?.cwd);
  if (config.apiKey?.trim()) {
    return { key: config.apiKey.trim(), source: "settings.json (srpImage.apiKey)" };
  }

  if (ctx?.modelRegistry) {
    try {
      const key = await ctx.modelRegistry.getApiKeyForProvider("openrouter");
      if (key?.trim()) {
        return { key: key.trim(), source: "/login openrouter (auth.json)" };
      }
    } catch {}
    try {
      const auth = await ctx.modelRegistry.getProviderAuth("openrouter");
      if (auth?.auth?.apiKey?.trim()) {
        return { key: auth.auth.apiKey.trim(), source: "/login openrouter (auth.json)" };
      }
    } catch {}
  }

  const envKey = getEnv("OPENROUTER_API_KEY");
  if (envKey?.trim()) {
    return { key: envKey.trim(), source: "环境变量 (OPENROUTER_API_KEY)" };
  }

  return { key: "", source: "none" };
}

// ============================ 安全沙箱与图片读写 ============================

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function validateRemoteUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`安全限制：仅支持 http(s) 协议的图片 URL (${raw})`);
  }
  if (url.username || url.password) {
    throw new Error("安全限制：图片 URL 不允许包含认证凭据");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`安全限制：禁止访问本机地址: ${hostname}`);
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`安全限制：禁止访问内网或保留地址: ${hostname}`);
  }
  return url;
}

function validateLocalImagePath(cwd: string, inputPath: string): string {
  const resolved = resolve(cwd, inputPath);
  const rel = relative(cwd, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`安全限制：参考图路径必须限定在当前工作区内 (${inputPath})`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`参考图文件不存在: ${inputPath}`);
  }
  return resolved;
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`响应内容超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
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
        throw new Error(`响应内容超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function detectMime(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF: 47 49 46 38
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  // BMP: BM
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }
  return null;
}

function mimeToExtension(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    case "image/png":
    default:
      return ".png";
  }
}

async function fetchSafeImage(
  url: string,
  signal?: AbortSignal,
  maxBytes = MAX_IMAGE_BYTES
): Promise<{ buffer: Buffer; mimeType: string }> {
  let current = await validateRemoteUrl(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp,*/*" },
      signal,
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`图片下载重定向缺少 Location 头 (HTTP ${response.status})`);
      if (redirect === MAX_REDIRECTS) throw new Error("图片下载重定向次数过多");
      current = await validateRemoteUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) {
      throw new Error(`下载图片失败: HTTP ${response.status} ${response.statusText}`);
    }
    const declaredMime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    const buffer = await readBounded(response, maxBytes);
    const mimeType = detectMime(buffer) || declaredMime || "image/png";
    return { buffer, mimeType };
  }
  throw new Error("下载图片重定向失败");
}

async function readReferenceImage(
  imagePathOrUrl: string,
  cwd: string,
  signal?: AbortSignal
): Promise<{ buffer: Buffer; mimeType: string; dataUrl: string }> {
  const trimmed = imagePathOrUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const fetched = await fetchSafeImage(trimmed, signal);
    const dataUrl = `data:${fetched.mimeType};base64,${fetched.buffer.toString("base64")}`;
    return { buffer: fetched.buffer, mimeType: fetched.mimeType, dataUrl };
  }
  const resolved = validateLocalImagePath(cwd, trimmed);
  const st = await stat(resolved);
  if (st.size > MAX_IMAGE_BYTES) {
    throw new Error(`参考图文件过大 (${Math.round(st.size / 1024 / 1024)}MB，最大支持 ${MAX_IMAGE_BYTES / 1024 / 1024}MB): ${trimmed}`);
  }
  const buffer = await readFile(resolved);
  const mimeType = detectMime(buffer) || MIME_BY_EXT[extname(resolved).toLowerCase()] || "image/png";
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;
  return { buffer, mimeType, dataUrl };
}

function generateBaseSlug(prompt: string): string {
  const clean = prompt
    .trim()
    .replace(/[\s\r\n\t]+/g, "-")
    .replace(/[^\w\u4e00-\u9fa5\-]/g, "")
    .slice(0, 30)
    .replace(/^-+|-+$/g, "");
  return clean || "image";
}

function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function saveImageAtomically(
  buffer: Buffer,
  mimeType: string,
  prompt: string,
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const ext = mimeToExtension(mimeType);
  const ts = formatTimestamp();
  const slug = generateBaseSlug(prompt);
  const baseName = `img_${ts}_${slug}`;

  let version = 1;
  while (true) {
    const fileName = version === 1 ? `${baseName}${ext}` : `${baseName}-v${version}${ext}`;
    const targetPath = join(outputDir, fileName);
    try {
      const handle = await open(targetPath, "wx");
      try {
        await handle.writeFile(buffer);
      } finally {
        await handle.close();
      }
      return targetPath;
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        version++;
        if (version > 1000) {
          throw new Error(`无法创建唯一的图片文件名 (${baseName})`);
        }
        continue;
      }
      throw err;
    }
  }
}

function formatMarkdownImage(prompt: string, savedPath: string, cwd: string): string {
  let relPath = relative(cwd, savedPath);
  relPath = relPath.replace(/\\/g, "/");
  const cleanPrompt = prompt.replace(/[\[\]]/g, "").slice(0, 80);
  return `![${cleanPrompt}](${relPath})`;
}

function makeTimeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const tSig = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, tSig]) : tSig;
}

// ============================ OpenRouter 官方 Image API 核心实现 ============================

async function generateWithOpenRouter(
  opts: ImageGenerationOptions,
  ctx: ExtensionContext
): Promise<GeneratedImage> {
  const auth = await resolveOpenRouterApiKey(ctx);
  if (!auth.key) {
    throw new Error(
      "未检测到 OpenRouter API Key。请在终端执行 /login openrouter 登录，或在 settings.json / 环境变量中配置。"
    );
  }

  const timeoutSig = makeTimeoutSignal(DEFAULT_TIMEOUT_MS, opts.signal);

  // 构建请求体
  const payload: Record<string, unknown> = {
    model: opts.model,
    prompt: opts.prompt,
  };

  if (opts.aspectRatio) {
    payload.aspect_ratio = opts.aspectRatio;
  }
  if (opts.size) {
    payload.size = opts.size;
  }
  if (opts.quality) {
    payload.quality = opts.quality;
  }

  // 图生图参考图
  if (opts.image) {
    const ref = await readReferenceImage(opts.image, ctx.cwd, opts.signal);
    payload.input_references = [
      {
        type: "image_url",
        image_url: {
          url: ref.dataUrl,
        },
      },
    ];
  }

  const response = await fetch(OPENROUTER_IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pi.dev",
      "X-Title": "Pi SRP Image Extension",
    },
    body: JSON.stringify(payload),
    signal: timeoutSig,
  });

  if (!response.ok) {
    const errText = (await readBounded(response, 32 * 1024)).toString("utf8");
    throw new Error(`OpenRouter 生图 API 请求失败 [HTTP ${response.status}]: ${errText.slice(0, 400)}`);
  }

  const rawJson = (await readBounded(response, 30 * 1024 * 1024)).toString("utf8");
  let json: any;
  try {
    json = JSON.parse(rawJson);
  } catch {
    throw new Error(`解析 OpenRouter 生图响应 JSON 失败: ${rawJson.slice(0, 200)}`);
  }

  if (json?.error) {
    const errMsg = typeof json.error === "string" ? json.error : json.error?.message || JSON.stringify(json.error);
    throw new Error(`OpenRouter 生图 API 错误: ${errMsg}`);
  }

  const item = json?.data?.[0];
  if (!item) {
    throw new Error(`OpenRouter 生图 API 未返回图片数据: ${rawJson.slice(0, 300)}`);
  }

  let buffer: Buffer;
  let mimeType = (item.media_type || "image/png").toLowerCase().trim();
  const revisedPrompt = typeof item.revised_prompt === "string" ? item.revised_prompt : undefined;

  if (item.b64_json) {
    buffer = Buffer.from(item.b64_json, "base64");
    mimeType = detectMime(buffer) || mimeType;
  } else if (item.url) {
    const fetched = await fetchSafeImage(item.url, opts.signal);
    buffer = fetched.buffer;
    mimeType = fetched.mimeType || mimeType;
  } else {
    throw new Error("OpenRouter 生图 API 响应中缺少 b64_json 或 url 数据");
  }

  return {
    buffer,
    mimeType,
    model: opts.model,
    prompt: opts.prompt,
    revisedPrompt,
  };
}

async function generateAndSaveImage(opts: {
  prompt: string;
  model?: string;
  image?: string;
  size?: string;
  aspectRatio?: string;
  quality?: string;
  style?: string;
  cwd: string;
  ctx: ExtensionContext;
  signal?: AbortSignal;
}): Promise<SaveImageResult> {
  const config = loadConfig(opts.cwd);
  const rawModel = (opts.model && opts.model.trim()) || config.model || DEFAULT_MODEL;
  const targetModel = resolveImageModel(rawModel);

  const genResult = await generateWithOpenRouter(
    {
      prompt: opts.prompt,
      model: targetModel,
      image: opts.image,
      size: opts.size,
      aspectRatio: opts.aspectRatio,
      quality: opts.quality,
      style: opts.style,
      signal: opts.signal,
    },
    opts.ctx
  );

  const outputDir = resolve(opts.cwd, config.outputDir || DEFAULT_OUTPUT_DIR);
  const savedPath = await saveImageAtomically(
    genResult.buffer,
    genResult.mimeType,
    opts.prompt,
    outputDir
  );
  const relPath = relative(opts.cwd, savedPath).replace(/\\/g, "/");

  return {
    savedPath,
    relPath,
    model: targetModel,
    prompt: opts.prompt,
    revisedPrompt: genResult.revisedPrompt,
    mimeType: genResult.mimeType,
    buffer: genResult.buffer,
  };
}

// ============================ 扩展主体 ============================

export default function (pi: ExtensionAPI) {
  let imageModeActive = false;
  let currentModel = loadConfig().model;
  let lastCtx: ExtensionContext | null = null;

  // 1. 同步活动工具列表
  function syncActiveTools(toolEnabled: boolean): void {
    let active = pi.getActiveTools();
    if (toolEnabled) {
      if (!active.includes("image_generate")) {
        active = [...active, "image_generate"];
      }
    } else {
      active = active.filter((t) => t !== "image_generate");
    }
    pi.setActiveTools(active);
  }

  // 2. 注册自定义消息渲染组件 (支持终端图形协议自适应渲染)
  pi.registerMessageRenderer(
    CUSTOM_TYPE_IMAGE_RESULT,
    (message, { expanded, outputPad }, theme) => {
      const details = message.details as
        | {
            savedPath?: string;
            relPath?: string;
            model?: string;
            mimeType?: string;
            base64?: string;
            timestamp?: number;
          }
        | undefined;
      const time = details?.timestamp
        ? new Date(details.timestamp).toLocaleTimeString()
        : new Date().toLocaleTimeString();

      const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
      const title = `${theme.bold(theme.fg("accent", "[IMAGE GENERATED]"))} ${theme.fg(
        "muted",
        `[${details?.model || "openrouter"}] [${time}]`
      )}`;
      box.addChild(new Text(title, 0, 0));
      box.addChild(new Text(theme.fg("text", message.content || ""), 0, 0));

      // 若宿主终端具备 Kitty / iTerm2 原生图片协议能力，直接挂载真彩图像组件
      const caps = getCapabilities();
      if (caps.images && details?.base64 && details?.mimeType) {
        box.addChild(
          new Image(
            details.base64,
            details.mimeType,
            { fallbackColor: (s: string) => theme.fg("muted", s) },
            { maxWidthCells: 60 }
          )
        );
      }

      if (expanded && details?.savedPath) {
        box.addChild(
          new Text(theme.fg("dim", `File: ${details.relPath || details.savedPath}`), 0, 0)
        );
      }
      return box;
    }
  );

  // 3. UI 挂载与沉浸式 Image Mode 管理 (不调用 setStatus, 极简无 emoji)
  function updateImageModeUI(ctx: ExtensionContext): void {
    if (!imageModeActive) {
      ctx.ui.setWidget(WIDGET_KEY_MODE, undefined);
      return;
    }

    ctx.ui.setWidget(WIDGET_KEY_MODE, (_tui, theme) => {
      const modeTag = theme.bold(theme.fg("accent", "[IMAGE MODE]"));
      const modelTag = theme.fg("warning", `Model: ${currentModel}`);
      const hint = theme.fg("muted", "Enter prompt to generate (type /srp-image to exit)");
      const box = new Box(0, 0);
      box.addChild(new Text(`${modeTag} ${modelTag} | ${hint}`, 0, 0));
      return box;
    });
  }

  function setImageMode(active: boolean, ctx: ExtensionContext): void {
    imageModeActive = active;
    updateImageModeUI(ctx);
    if (active) {
      ctx.ui.notify(
        `已进入沉浸式生图模式 [${currentModel}]。输入提示词将直接调用 OpenRouter 生图 API 落盘，0 消耗主模型 Token。输入 /srp-image 退出。`,
        "info"
      );
    } else {
      ctx.ui.notify("已退出沉浸式生图模式，恢复常规对话模式。", "info");
    }
  }

  const toggleImageMode = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    setImageMode(!imageModeActive, ctx);
  };

  // 4. 输入拦截 (Prompt Interception)
  pi.on("input", async (event, ctx) => {
    lastCtx = ctx;
    if (!imageModeActive) {
      return { action: "continue" };
    }

    const trimmed = event.text.trim();
    // 斜杠命令放行让命令系统执行
    if (trimmed.startsWith("/") || !trimmed) {
      return { action: "continue" };
    }

    ctx.ui.notify(`[Image Mode] 正在生成图片: "${trimmed.slice(0, 40)}..." (${currentModel})`, "info");

    try {
      const result = await generateAndSaveImage({
        prompt: trimmed,
        model: currentModel,
        cwd: ctx.cwd,
        ctx,
        signal: ctx.signal,
      });

      const md = formatMarkdownImage(trimmed, result.savedPath, ctx.cwd);
      pi.sendMessage(
        {
          customType: CUSTOM_TYPE_IMAGE_RESULT,
          content: md,
          display: true,
          details: {
            savedPath: result.savedPath,
            relPath: result.relPath,
            prompt: trimmed,
            revisedPrompt: result.revisedPrompt,
            model: result.model,
            mimeType: result.mimeType,
            base64: result.buffer.toString("base64"),
            timestamp: Date.now(),
          },
        },
        { triggerTurn: false }
      );
      ctx.ui.notify(`生图成功: ${result.relPath}`, "info");
    } catch (err: any) {
      ctx.ui.notify(`生图失败: ${err?.message || String(err)}`, "error");
    } finally {
      updateImageModeUI(ctx);
    }

    return { action: "handled" };
  });

  // 5. 注册 image_generate 工具
  pi.registerTool({
    name: "image_generate",
    label: "Image Generator",
    description:
      "使用 OpenRouter 官方 Image API 生成或编辑图片。支持文生图 (Text-to-Image) 与图生图 (Image-to-Image)，自动将结果原子保存至工作区安全目录 (默认 .pi/generated-images/)，并返回标准 Markdown 图片引用。支持指定 OpenRouter 生图模型 (如 google/gemini-3.1-flash-image, bytedance-seed/seedream-5-0-pro, openai/gpt-image-2, black-forest-labs/flux.2-pro 等)。",
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1, description: "图片生成的提示词或修改要求" }),
      model: Type.Optional(
        Type.String({ description: "指定 OpenRouter 生图模型 slug，缺省使用当前配置模型" })
      ),
      image: Type.Optional(
        Type.String({
          description: "参考图本地路径（限定在当前工作区内）或公网 http(s) URL（用于图生图/图像编辑）",
        })
      ),
      size: Type.Optional(
        Type.String({
          description: "图片尺寸/分辨率 (例如 1K, 2K, 4K, 1024x1024 等)",
        })
      ),
      aspectRatio: Type.Optional(
        Type.String({
          description: "宽高比 (支持 1:1, 16:9, 9:16, 4:3, 3:4, 21:9 等)",
        })
      ),
      quality: Type.Optional(
        Type.String({
          description: "图片质量 (auto, low, medium, high)",
        })
      ),
      style: Type.Optional(
        Type.String({
          description: "图片风格描述",
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await generateAndSaveImage({
        prompt: params.prompt,
        model: params.model || currentModel,
        image: params.image,
        size: params.size,
        aspectRatio: params.aspectRatio,
        quality: params.quality,
        style: params.style,
        cwd: ctx.cwd,
        ctx,
        signal,
      });

      const md = formatMarkdownImage(params.prompt, result.savedPath, ctx.cwd);
      const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [
        {
          type: "text",
          text: `${md}\n\n图片已生成并保存至 \`${result.relPath}\`（模型: \`${result.model}\`）。`,
        },
      ];

      // 若成功获取二进制数据，挂载标准 image 块（Pi 原生 TUI 在支持的终端上会自动渲染真彩图片）
      if (result.buffer) {
        content.push({
          type: "image",
          data: result.buffer.toString("base64"),
          mimeType: result.mimeType,
        });
      }

      return {
        content,
        details: {
          savedPath: result.savedPath,
          relPath: result.relPath,
          prompt: params.prompt,
          revisedPrompt: result.revisedPrompt,
          model: result.model,
          mimeType: result.mimeType,
        },
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const { prompt, model, image } = args as {
        prompt?: string;
        model?: string;
        image?: string;
      };
      const displayPrompt =
        prompt && prompt.length > 40 ? prompt.slice(0, 37) + "..." : prompt || "";
      const modelTag = model ? ` [${model}]` : "";
      const imgTag = image ? " [i2i]" : "";
      text.setText(
        theme.fg("toolTitle", theme.bold("image_generate ")) +
          theme.fg("accent", `"${displayPrompt}"`) +
          theme.fg("muted", `${modelTag}${imgTag}`)
      );
      return text;
    },
  });

  // 6. 命令处理核心逻辑
  const handleImageCommand = async (args: string, ctx: ExtensionContext) => {
    lastCtx = ctx;
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = (parts[0] || "").toLowerCase();

    // 默认行为（无参数）：直接切换生图模式 (Toggle Image Mode)
    if (!sub) {
      toggleImageMode(ctx);
      return;
    }

    if (sub === "on" || sub === "enable") {
      setImageMode(true, ctx);
      return;
    }

    if (sub === "off" || sub === "disable") {
      setImageMode(false, ctx);
      return;
    }

    if (sub === "model") {
      const explicitModel = parts.slice(1).join(" ").trim();
      if (explicitModel) {
        const resolved = resolveImageModel(explicitModel);
        runtimeOverrides = { ...runtimeOverrides, model: resolved };
        currentModel = resolved;
        saveImageSettings({ model: resolved }, ctx.cwd);
        ctx.ui.notify(`生图模型已切换为: ${resolved}`, "info");
        if (imageModeActive) updateImageModeUI(ctx);
        return;
      }

      // 动态获取 OpenRouter 官方最新生图模型库（含精选置顶保底）
      const modelList = await fetchOnlineImageModels(ctx.signal);
      const options = modelList.map((item) => {
        const isCurrent = item.slug === currentModel;
        return `${item.label} (${item.slug}) — ${item.description}${isCurrent ? " (当前使用)" : ""}`;
      });

      const selected = await ctx.ui.select("选择当前生效的 OpenRouter 生图模型：", options);
      if (!selected) return;

      const matchIndex = options.findIndex((opt) => opt === selected);
      if (matchIndex >= 0) {
        const target = modelList[matchIndex];
        runtimeOverrides = { ...runtimeOverrides, model: target.slug };
        currentModel = target.slug;
        saveImageSettings({ model: target.slug }, ctx.cwd);
        ctx.ui.notify(`生图模型已切换为: ${target.label} (${target.slug})`, "info");
        if (imageModeActive) updateImageModeUI(ctx);
      }
      return;
    }

    if (sub === "status") {
      const conf = loadConfig(ctx.cwd);
      const auth = await resolveOpenRouterApiKey(ctx);
      const authStatus = auth.key
        ? `已就绪 (${auth.source})`
        : "未配置 (可通过 /login openrouter 登录，或在 settings.json / 环境变量中配置)";
      const toolStatus = conf.tool ? "已注入 (可用)" : "已禁用 (tool: false)";

      const summary = [
        `srp-image 状态:`,
        `• 沉浸生图模式 (Image Mode): ${imageModeActive ? "开启 (ON)" : "关闭 (OFF)"}`,
        `• 生图工具 (image_generate): ${toolStatus}`,
        `• 当前生效模型: ${currentModel}`,
        `• OpenRouter 鉴权凭据: ${authStatus}`,
        `• 图片输出目录: ${conf.outputDir}`,
      ].join("\n");

      ctx.ui.notify(summary, "info");
      return;
    }

    if (sub === "generate") {
      const prompt = parts.slice(1).join(" ").trim();
      if (!prompt) {
        ctx.ui.notify("用法: /srp-image generate <图片提示词>", "warning");
        return;
      }

      ctx.ui.notify(`正在生成图片: "${prompt.slice(0, 40)}..." (${currentModel})`, "info");
      try {
        const result = await generateAndSaveImage({
          prompt,
          model: currentModel,
          cwd: ctx.cwd,
          ctx,
          signal: ctx.signal,
        });

        const md = formatMarkdownImage(prompt, result.savedPath, ctx.cwd);
        pi.sendMessage(
          {
            customType: CUSTOM_TYPE_IMAGE_RESULT,
            content: md,
            display: true,
            details: {
              savedPath: result.savedPath,
              relPath: result.relPath,
              prompt,
              revisedPrompt: result.revisedPrompt,
              model: result.model,
              mimeType: result.mimeType,
              base64: result.buffer.toString("base64"),
              timestamp: Date.now(),
            },
          },
          { triggerTurn: false }
        );
        ctx.ui.notify(`生图成功: ${result.relPath}`, "info");
      } catch (err: any) {
        ctx.ui.notify(`生图失败: ${err?.message || String(err)}`, "error");
      }
      return;
    }

    ctx.ui.notify("用法: /srp-image [on|off|model|status|generate <prompt>]", "info");
  };

  const getCompletions = (prefix: string): AutocompleteItem[] | null => {
    const candidates: AutocompleteItem[] = [
      { value: "on", label: "on", description: "开启沉浸式生图模式" },
      { value: "off", label: "off", description: "关闭沉浸式生图模式" },
      { value: "model", label: "model", description: "交互式选择并切换 OpenRouter 生图模型" },
      { value: "status", label: "status", description: "查看当前生图模型、鉴权与配置状态" },
      { value: "generate ", label: "generate <prompt>", description: "执行单次图片生成" },
    ];
    const trimmed = prefix.trimStart();
    const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
    return filtered.length > 0 ? filtered : null;
  };

  // 7. 注册主命令 /srp-image
  pi.registerCommand("srp-image", {
    description: "管理 OpenRouter 图片生成与沉浸式生图模式 (/srp-image [on|off|model|status|generate <prompt>])",
    getArgumentCompletions: getCompletions,
    handler: handleImageCommand,
  });

  // 8. 生命周期钩子
  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx;
    const conf = loadConfig(ctx.cwd);
    currentModel = conf.model;
    syncActiveTools(conf.tool);
  });

  pi.on("session_resume", (_event, ctx) => {
    lastCtx = ctx;
    const conf = loadConfig(ctx.cwd);
    currentModel = conf.model;
    syncActiveTools(conf.tool);
  });

  pi.on("turn_start", (_event, ctx) => {
    lastCtx = ctx;
  });

  pi.on("agent_start", (_event, ctx) => {
    lastCtx = ctx;
  });
}
