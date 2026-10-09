/**
 * OpenRouter image generation over OpenRouter's dedicated Images API (`POST /api/v1/images`).
 *
 * This deliberately does NOT reuse Pi's built-in `openrouter-images` api: Pi implements that
 * on top of chat completions with `modalities: ["image"]`, which carries neither `aspect_ratio`
 * nor `input_references`. Both are supported here, so `image-generate.ts` calls this handler
 * directly instead of `ctx.modelRegistry.generateImages()`.
 * The model list still comes from Pi's registry (`getModelsOfType("image")`) and auth from
 * `getApiKeyForProvider("openrouter")` -- the same credential Pi's built-in provider uses.
 */
import { open } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { GenerateImageContext, GeneratedImageOutput, ImageModelDefinition } from "../types.ts";

const OPENROUTER_IMAGE_ENDPOINT = "https://openrouter.ai/api/v1/images";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/images/models";
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

const MIME_BY_EXTENSION: Record<string, string | undefined> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

async function fetchRemoteImageBuffer(
  url: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string }> {
  let currentUrl = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
    }

    const response = await fetch(currentUrl, {
      redirect: "manual",
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif,image/bmp,*/*" },
      signal,
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const loc = response.headers.get("location");
      if (!loc) throw new Error(`Redirect missing location header (HTTP ${response.status})`);
      if (redirect === MAX_REDIRECTS) throw new Error("Too many redirects downloading image");
      currentUrl = new URL(loc, currentUrl).href;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to download image (HTTP ${response.status})`);
    }

    const rawMime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "image/png";
    const arrayBuf = await response.arrayBuffer();
    if (arrayBuf.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Image exceeds maximum allowed size (25 MB)");
    }

    return { buffer: Buffer.from(arrayBuf), mimeType: rawMime };
  }
  throw new Error("Failed to download image: too many redirects");
}

export async function generateOpenrouterImage(
  ctx: GenerateImageContext,
  options: { apiKey: string; signal?: AbortSignal; cwd?: string },
): Promise<GeneratedImageOutput> {
  const payload: Record<string, unknown> = {
    model: ctx.model,
    prompt: ctx.prompt,
  };

  if (ctx.aspectRatio) {
    payload.aspect_ratio = ctx.aspectRatio;
  }

  if (ctx.image) {
    const imgRef = ctx.image.trim();
    if (imgRef.startsWith("http://") || imgRef.startsWith("https://")) {
      payload.input_references = [{ type: "image_url", image_url: { url: imgRef } }];
    } else {
      const localImgPath = resolve(options.cwd || process.cwd(), imgRef);
      let buf: Buffer;
      try {
        const fileHandle = await open(localImgPath, "r");
        buf = await fileHandle.readFile();
        await fileHandle.close();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Reference image not readable at ${localImgPath}: ${reason}`);
      }
      const ext = extname(localImgPath).toLowerCase();
      const mime = MIME_BY_EXTENSION[ext];
      if (!mime) {
        throw new Error(`Unsupported reference image type: ${ext || localImgPath}`);
      }
      payload.input_references = [
        {
          type: "image_url",
          image_url: { url: `data:${mime};base64,${buf.toString("base64")}` },
        },
      ];
    }
  }

  const response = await fetch(OPENROUTER_IMAGE_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pi.dev",
      "X-Title": "Pi Image Generate Extension",
    },
    body: JSON.stringify(payload),
    signal: options.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter image request failed (HTTP ${response.status}): ${errText.slice(0, 400)}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };

  const item = data.data?.[0];
  if (!item) {
    throw new Error("OpenRouter returned an empty image list.");
  }

  let imgBuffer: Buffer;
  let mimeType = "image/png";

  if (item.b64_json) {
    imgBuffer = Buffer.from(item.b64_json, "base64");
  } else if (item.url) {
    const downloaded = await fetchRemoteImageBuffer(item.url, options.signal);
    imgBuffer = downloaded.buffer;
    mimeType = downloaded.mimeType;
  } else {
    throw new Error("OpenRouter response did not contain image data or URL.");
  }

  return {
    buffer: imgBuffer,
    mimeType,
    model: ctx.model,
    provider: "openrouter",
    revisedPrompt: item.revised_prompt,
  };
}

export async function fetchOpenrouterCatalog(signal?: AbortSignal): Promise<ImageModelDefinition[]> {
  const list: ImageModelDefinition[] = [];
  try {
    const timeoutSig = AbortSignal.any([AbortSignal.timeout(4000), ...(signal ? [signal] : [])]);
    const resp = await fetch(OPENROUTER_MODELS_ENDPOINT, {
      signal: timeoutSig,
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const data = (await resp.json()) as { data?: Array<{ id?: string; name?: string; description?: string }> };
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (!item?.id || typeof item.id !== "string") continue;
          const id = item.id.trim();
          const name = typeof item.name === "string" ? item.name.trim() : id;
          const desc =
            typeof item.description === "string" && item.description.trim()
              ? item.description.trim().replace(/\s+/g, " ").slice(0, 60) + "..."
              : "OpenRouter Image Model";

          list.push({ id, name, provider: "openrouter", description: desc });
        }
      }
    }
  } catch {}
  return list;
}
