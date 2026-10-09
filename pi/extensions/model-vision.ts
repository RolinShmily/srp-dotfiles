/**
 * model-vision.ts — Image understanding extension for Pi.
 *
 * Registers the `model_vision` tool to analyze local or remote images
 * using a vision model and return a textual description.
 */

import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import net from "node:net";
import { extname, resolve } from "node:path";

// ============================ Configuration ============================

/**
 * Configure your default vision model(s) here.
 * The first available model in the chain will be used; subsequent ones act as fallbacks.
 * Supported protocols: "pi-native" (Antigravity/built-in) or "openai-completions".
 */
const DEFAULT_VISION_MODELS: Array<{
  provider: string;
  model: string;
  protocol?: "pi-native" | "openai-completions";
}> = [
  { provider: "antigravity", model: "gemini-3.8-flash", protocol: "pi-native" },
  { provider: "shuaiapi", model: "gpt-6-luna", protocol: "openai-completions" },
];

// ============================ Constants ============================

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOKENS = 8192;
const MAX_REDIRECTS = 5;
const REQUEST_TIMEOUT_MS = 90_000;

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};
const SUPPORTED_MIMES = new Set(Object.values(MIME_MAP));

const DEFAULT_PROMPT =
  "Describe this image in detail: transcribe any visible text verbatim, describe visual elements, layout, colors, and note any errors, anomalies, or important details.";

type VisionCandidate = {
  provider: string;
  model: string;
  protocol?: "pi-native" | "openai-completions";
};

function getVisionCandidates(): VisionCandidate[] {
  const models = DEFAULT_VISION_MODELS as VisionCandidate[] | VisionCandidate;
  const list = Array.isArray(models) ? models : [models];
  return list.map((c) => ({
    ...c,
    protocol: c.protocol ?? (c.provider === "antigravity" ? "pi-native" : "openai-completions"),
  }));
}

function combinedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

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
  const norm = address.toLowerCase();
  return (
    norm === "::" ||
    norm === "::1" ||
    norm.startsWith("fc") ||
    norm.startsWith("fd") ||
    /^fe[89ab]/.test(norm) ||
    norm.startsWith("::ffff:127.") ||
    norm.startsWith("::ffff:10.") ||
    norm.startsWith("::ffff:192.168.")
  );
}

async function validateRemoteUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported for remote images.");
  }
  if (url.username || url.password) {
    throw new Error("Image URL must not contain username or password.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`Access to local address is blocked: ${hostname}`);
  }
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error(`Access to private or local network address is blocked: ${hostname}`);
  }
  return url;
}

async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`Content exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit.`);
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
        throw new Error(`Content exceeds ${Math.round(maxBytes / (1024 * 1024))} MiB limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function detectMime(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
    buffer.subarray(0, 6).toString("ascii") === "GIF89a"
  ) {
    return "image/gif";
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  return undefined;
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
      if (!location) throw new Error(`Image redirect missing Location header: HTTP ${response.status}`);
      if (redirects === MAX_REDIRECTS) throw new Error("Too many image redirects.");
      current = await validateRemoteUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok) throw new Error(`Failed to fetch image: HTTP ${response.status} ${response.statusText}`);

    const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!SUPPORTED_MIMES.has(mime)) throw new Error(`Unsupported remote image MIME type: ${mime || "unknown"}`);
    return { buffer: await readBounded(response, MAX_IMAGE_BYTES), mime };
  }
  throw new Error("Too many image redirects.");
}

async function readImage(image: string, cwd: string, signal?: AbortSignal): Promise<string> {
  const trimmed = image.trim();
  if (!trimmed) throw new Error("Image path or URL cannot be empty.");

  let buffer: Buffer;
  let mime: string;
  if (/^https?:\/\//i.test(trimmed)) {
    ({ buffer, mime } = await fetchRemoteImage(trimmed, combinedSignal(30_000, signal)));
  } else {
    const filePath = resolve(cwd, trimmed);
    const expectedMime = MIME_MAP[extname(filePath).toLowerCase()];
    if (!expectedMime) throw new Error(`Unsupported image file extension: ${extname(filePath) || "none"}`);
    const fileStat = await stat(filePath);
    if (fileStat.size > MAX_IMAGE_BYTES) throw new Error("Image file exceeds 10 MiB limit.");
    buffer = await readFile(filePath);
    mime = expectedMime;
  }

  const detected = detectMime(buffer);
  if (!detected || detected !== mime) {
    throw new Error(`Image content does not match MIME type (expected ${mime}, detected ${detected ?? "unknown"}).`);
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
      throw new Error(`Vision model returned invalid JSON: ${raw.slice(0, 200)}`);
    }
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
        .join("")
        .trim();
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
    } catch {}
  }
  return text.trim();
}

async function callOpenAICompatible(
  ctx: ExtensionContext,
  candidate: VisionCandidate,
  dataUri: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const registered = ctx.modelRegistry.getProvider(candidate.provider);
  const resolved = await ctx.modelRegistry.getProviderAuth(candidate.provider);
  const apiKey = resolved?.auth.apiKey;
  if (!apiKey) {
    throw new Error(`No API key found for provider "${candidate.provider}". Run /login ${candidate.provider} first.`);
  }

  const baseUrl = (resolved.auth.baseUrl || registered?.baseUrl)?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(`Provider "${candidate.provider}" has no base URL configured.`);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  for (const source of [registered?.headers, resolved.auth.headers]) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (typeof value === "string") headers[key] = value;
    }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: candidate.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
      max_tokens: MAX_TOKENS,
    }),
    signal: combinedSignal(REQUEST_TIMEOUT_MS, signal),
  });

  if (!response.ok) {
    const errorBody = (await readBounded(response, 16 * 1024)).toString("utf8");
    throw new Error(`HTTP ${response.status}: ${errorBody.slice(0, 300)}`);
  }
  const text = await parseChatResponse(response);
  if (!text) throw new Error("Vision model returned an empty response.");
  return text;
}

async function callPiNative(
  ctx: ExtensionContext,
  candidate: VisionCandidate,
  dataUri: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const model = ctx.modelRegistry.find(candidate.provider, candidate.model);
  if (!model) {
    throw new Error(`Model ${candidate.provider}/${candidate.model} not found in modelRegistry.`);
  }
  const auth = await ctx.modelRegistry.getProviderAuth(candidate.provider);
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Failed to parse image data URI.");
  const [, mimeType, base64Data] = match;

  const { completeSimple } = await import("@earendil-works/pi-ai/compat");
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
      signal: combinedSignal(REQUEST_TIMEOUT_MS, signal),
      maxTokens: MAX_TOKENS,
    },
  );

  if (response.stopReason === "error") {
    throw new Error(response.errorMessage || "Vision model request failed.");
  }

  const text = response.content
    ?.filter((c: any) => c.type === "text")
    ?.map((c: any) => c.text)
    ?.join("\n")
    ?.trim();

  if (!text) throw new Error("Vision model returned an empty response.");
  return text;
}

async function analyzeImage(
  image: string,
  promptText: string | undefined,
  cwd: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
): Promise<{ text: string; model: string; provider: string; truncated: boolean }> {
  const candidates = getVisionCandidates();
  if (!candidates.length) throw new Error("No vision models configured.");

  const dataUri = await readImage(image, cwd, signal);
  const prompt = promptText?.trim() || DEFAULT_PROMPT;
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const text =
        candidate.protocol === "pi-native"
          ? await callPiNative(ctx, candidate, dataUri, prompt, signal)
          : await callOpenAICompatible(ctx, candidate, dataUri, prompt, signal);
      const output = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
      return {
        text: output.content,
        model: candidate.model,
        provider: candidate.provider,
        truncated: output.truncated,
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${candidate.provider}/${candidate.model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All vision models failed: ${errors.join("; ")}`);
}

// ============================ Tool Registration ============================

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "model_vision",
    label: "Vision",
    description:
      "Analyze an image using a vision model and return a textual description. Supports local PNG/JPEG/WebP/GIF/BMP file paths or public http(s) URLs. Use prompt to specify OCR, error diagnosis, UI inspection, or detailed description.",
    parameters: Type.Object({
      image: Type.String({
        minLength: 1,
        description: "Local image path (relative to cwd or absolute) or public http(s) URL",
      }),
      prompt: Type.Optional(
        Type.String({
          description: "Specific question or instruction for the vision model",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await analyzeImage(params.image, params.prompt, ctx.cwd, ctx, signal);
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
      text.setText(theme.fg("toolTitle", theme.bold("vision ")) + theme.fg("accent", display));
      return text;
    },
  });
}
