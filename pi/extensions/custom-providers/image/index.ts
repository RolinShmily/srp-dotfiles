import type { ModalityProvidersRecord } from "../types.ts";
import {
  DASHSCOPE_IMAGE_URL,
  DASHSCOPE_IMAGE_MODELS,
  resolveImageModel,
  toImageModelDefinition,
} from "./models.ts";
import { generateDashscopeImages, generateDashscopeImage } from "./handlers/dashscope.ts";
import { generateOpenrouterImage, fetchOpenrouterCatalog } from "./handlers/openrouter.ts";
import type { GenerateImageContext, GeneratedImageOutput, ImageModelDefinition } from "./types.ts";

export * from "./types.ts";
export * from "./models.ts";
export * from "./handlers/dashscope.ts";
export * from "./handlers/openrouter.ts";

/** Minimal shape of a Pi registry image model. */
export type RegistryImageModel = { id: string; name?: string; provider: string };

/**
 * Only DashScope is registered here.
 *
 * `openrouter` must NOT be registered: `pi.registerProvider()` with a `models` list
 * replaces that provider's entire built-in catalog (chat included). Pi already ships
 * the OpenRouter image models natively under the same provider + credential.
 */
export const imageProviders: ModalityProvidersRecord = {
  dashscope: {
    name: "Aliyun DashScope",
    models: DASHSCOPE_IMAGE_MODELS.map((m) => ({
      type: "image",
      id: m.id,
      name: m.name,
      api: "dashscope-images",
      baseUrl: DASHSCOPE_IMAGE_URL,
      input: ["text", "image"],
      output: ["image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
    images: {
      "dashscope-images": {
        generateImages: generateDashscopeImages as any,
      },
    },
  },
};

/**
 * Build the catalog shown by the model selector.
 *
 * Sources, in priority order: the provider registry (`ctx.modelRegistry.getModelsOfType("image")`,
 * which already covers both OpenRouter's built-in catalog and the DashScope registration above),
 * followed by the live OpenRouter catalog for models newer than the bundled snapshot.
 */
export async function fetchAllAvailableImageModels(
  registryModels: readonly RegistryImageModel[] = [],
  signal?: AbortSignal,
): Promise<ImageModelDefinition[]> {
  const map = new Map<string, ImageModelDefinition>();
  const add = (model: ImageModelDefinition) => {
    const key = model.id.toLowerCase();
    if (!map.has(key)) map.set(key, model);
  };

  for (const model of DASHSCOPE_IMAGE_MODELS) add(model);
  for (const model of registryModels) add(toImageModelDefinition(model));
  for (const model of await fetchOpenrouterCatalog(signal)) add(model);

  return Array.from(map.values());
}

export async function generateImage(
  ctx: GenerateImageContext,
  options: {
    apiKey: string;
    provider?: string;
    baseUrl?: string;
    signal?: AbortSignal;
    cwd?: string;
  },
): Promise<GeneratedImageOutput> {
  const model = resolveImageModel(ctx.model);
  const provider = options.provider ?? (model.startsWith("qwen-image") ? "dashscope" : "openrouter");

  if (provider === "dashscope") {
    return generateDashscopeImage(
      { prompt: ctx.prompt, model, aspectRatio: ctx.aspectRatio, image: ctx.image },
      { apiKey: options.apiKey, baseUrl: options.baseUrl || DASHSCOPE_IMAGE_URL, cwd: options.cwd, signal: options.signal },
    );
  }

  return generateOpenrouterImage(
    { ...ctx, model },
    { apiKey: options.apiKey, signal: options.signal, cwd: options.cwd },
  );
}
