import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const MIME_BY_EXTENSION: Record<string, string | undefined> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".gif": "image/gif",
};

/** DashScope caps reference images at 10 MB. */
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

/**
 * Content item accepted by the DashScope multimodal-generation endpoint.
 * `url` is our extension over Pi's native `image` content: DashScope accepts public
 * URLs directly, so inlining them as base64 would be a pointless download.
 */
type DashscopeInput = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  url?: string;
};

/**
 * `parameters.size` uses the `width*height` form (asterisk, not `x`).
 * All values below stay inside qwen-image-3.0's documented bounds: total pixels
 * within 512*512..2048*2048 and aspect ratio within 1:8..8:1.
 */
const DASHSCOPE_RATIO_SIZES: Record<string, string> = {
  "1:1": "1024*1024",
  "2:3": "1024*1536",
  "3:2": "1536*1024",
  "3:4": "1728*2368",
  "4:3": "2368*1728",
  "9:16": "1080*1920",
  "16:9": "1920*1080",
};

export async function generateDashscopeImages(
  model: { api: string; provider: string; id: string; baseUrl?: string },
  context: { input: DashscopeInput[] },
  options?: {
    apiKey?: string;
    signal?: AbortSignal;
    fetch?: typeof fetch;
    onPayload?: (payload: unknown, model: unknown) => unknown | Promise<unknown>;
    onResponse?: (response: { status: number; headers: Record<string, string> }, model: unknown) => void | Promise<void>;
  },
) {
  const result = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    output: [] as { type: "image"; data: string; mimeType: string }[],
    stopReason: "stop" as "stop" | "error" | "aborted",
    timestamp: Date.now(),
    errorMessage: undefined as string | undefined,
  };

  try {
    if (!options?.apiKey) throw new Error("No API key for dashscope; use /login first");

    // DashScope expects image objects before exactly one text instruction.
    const content: Array<{ text: string } | { image: string }> = [];
    for (const item of context.input) {
      if (item.type === "image") {
        if (item.url) content.push({ image: item.url });
        else if (item.data && item.mimeType) content.push({ image: `data:${item.mimeType};base64,${item.data}` });
        else throw new Error("DashScope image input requires either a url or base64 data + mimeType");
      } else if (item.text) {
        content.push({ text: item.text });
      }
    }
    const prompt = content
      .filter((item): item is { text: string } => "text" in item)
      .map((item) => item.text)
      .join("\n")
      .trim();
    if (!prompt) throw new Error("DashScope image generation requires a text prompt");

    let payload: unknown = {
      model: model.id,
      input: { messages: [{ role: "user", content }] },
      parameters: { prompt_extend: true },
    };
    const replacement = await options.onPayload?.(payload, model);
    if (replacement !== undefined) payload = replacement;
    const request = options.fetch ?? fetch;
    const response = await request(`${model.baseUrl}/services/aigc/multimodal-generation/generation`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
    await options.onResponse?.({
      status: response.status,
      headers: Object.fromEntries(response.headers),
    }, model);
    if (!response.ok) throw new Error(`DashScope image request failed (HTTP ${response.status})`);
    const data = await response.json() as {
      request_id?: string;
      output?: { choices?: { message?: { content?: { image?: string }[] } }[] };
    };
    const imageUrls = data.output?.choices?.flatMap((choice) =>
      choice.message?.content?.flatMap((item) => item.image ? [item.image] : []) ?? []
    ) ?? [];
    if (imageUrls.length === 0) throw new Error("DashScope returned no images");

    for (const imageUrl of imageUrls) {
      const url = new URL(imageUrl);
      if (url.protocol !== "https:" || !/^dashscope-result-[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(url.hostname)) {
        throw new Error("DashScope returned an unexpected image URL");
      }
      const imageResponse = await request(url, { signal: options.signal, redirect: "manual" });
      if (!imageResponse.ok) throw new Error(`Image download failed (HTTP ${imageResponse.status})`);
      const mimeType = imageResponse.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
        ?? (url.pathname.toLowerCase().endsWith(".png") ? "image/png" : "");
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
        throw new Error("DashScope returned an unsupported image type");
      }
      if (!imageResponse.body) throw new Error("DashScope returned an empty image body");
      const reader = imageResponse.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 25 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("DashScope image exceeds 25 MB");
        }
        chunks.push(value);
      }
      if (size === 0) throw new Error("DashScope returned an empty image");
      result.output.push({
        type: "image",
        data: Buffer.concat(chunks, size).toString("base64"),
        mimeType,
      });
    }
    return { ...result, responseId: data.request_id };
  } catch (error) {
    result.stopReason = options?.signal?.aborted ? "aborted" : "error";
    result.errorMessage = error instanceof Error ? error.message : String(error);
    result.output = [];
    return result;
  }
}

/**
 * Direct entry point used by `image-generate.ts`: adds the two capabilities Pi's native
 * `ImagesContext` cannot express, an output aspect ratio and a reference image.
 */
export async function generateDashscopeImage(
  ctx: { prompt: string; model: string; aspectRatio?: string; image?: string },
  options: { apiKey: string; baseUrl?: string; cwd?: string; signal?: AbortSignal },
) {
  const input: DashscopeInput[] = [];
  if (ctx.image) input.push(await toDashscopeReference(ctx.image, options.cwd));
  input.push({ type: "text", text: ctx.prompt });

  const size = resolveSize(ctx.aspectRatio);
  const res = await generateDashscopeImages(
    {
      api: "dashscope-images",
      provider: "dashscope",
      id: ctx.model,
      baseUrl: options.baseUrl || "https://dashscope.aliyuncs.com/api/v1",
    },
    { input },
    {
      apiKey: options.apiKey,
      signal: options.signal,
      ...(size
        ? {
            onPayload: (payload: unknown) => {
              const current = payload as { parameters?: Record<string, unknown> };
              return { ...current, parameters: { ...current.parameters, size } };
            },
          }
        : {}),
    },
  );

  if (res.stopReason === "error" || !res.output[0]) {
    throw new Error(`DashScope image generation failed: ${res.errorMessage || "Unknown error"}`);
  }

  const out = res.output[0];
  return {
    buffer: Buffer.from(out.data, "base64"),
    mimeType: out.mimeType,
    model: ctx.model,
    provider: "dashscope",
  };
}

/** Map `16:9`-style ratios onto DashScope's `width*height` sizes. Unknown ratios are dropped. */
export function resolveSize(aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;
  return DASHSCOPE_RATIO_SIZES[aspectRatio.trim()];
}

/** Turn an `image` argument into a DashScope image object, failing loudly on a missing local file. */
async function toDashscopeReference(reference: string, cwd?: string): Promise<DashscopeInput> {
  const value = reference.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return { type: "image", url: value };
  }

  const localPath = resolve(cwd || process.cwd(), value);
  let buffer: Buffer;
  try {
    buffer = await readFile(localPath);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Reference image not readable at ${localPath}: ${reason}`);
  }

  const mimeType = MIME_BY_EXTENSION[extname(localPath).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported reference image type: ${extname(localPath) || localPath}`);
  }
  if (buffer.byteLength > MAX_REFERENCE_BYTES) {
    throw new Error("Reference image exceeds DashScope's 10 MB limit");
  }

  return { type: "image", data: buffer.toString("base64"), mimeType };
}
