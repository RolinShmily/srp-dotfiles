import type { ImageModelDefinition } from "./types.ts";

export const DASHSCOPE_IMAGE_URL =
  process.env.DASHSCOPE_IMAGE_URL?.trim().replace(/\/+$/, "") ||
  "https://dashscope.aliyuncs.com/api/v1";

/**
 * DashScope is not a Pi built-in image provider, so its catalog is declared here
 * and registered through `imageProviders`.
 *
 * OpenRouter is deliberately absent: Pi already ships its image catalog (61 models)
 * under its built-in `openrouter` provider, using the same `/login openrouter` credential.
 */
export const DASHSCOPE_IMAGE_MODELS: ImageModelDefinition[] = [
  {
    id: "qwen-image-3.0-pro",
    name: "Qwen Image 3.0 Pro",
    provider: "dashscope",
    description: "Aliyun DashScope flagship image generation model with strong typography and rendering capabilities",
  },
];

/** Project a Pi registry image model into the selector's view model. */
export function toImageModelDefinition(model: {
  id: string;
  name?: string;
  provider: string;
}): ImageModelDefinition {
  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    provider: model.provider,
    description: `${model.provider} image model`,
  };
}

/**
 * Resolve a user-supplied model argument against the provider registry.
 *
 * The registry is the single source of truth, so no hand-written alias table is kept:
 * OpenRouter's catalog belongs to Pi and changes without notice, and a stale alias would
 * silently return a model id that no longer exists.
 *
 * Order: exact id -> exact display name -> substring (shortest match wins, so `gpt-image-1`
 * prefers `openai/gpt-image-1` over `openai/gpt-image-1-mini`). Anything unresolved is
 * returned verbatim so the provider reports the real error.
 */
export function resolveImageModel(
  model?: string,
  availableModels?: readonly ImageModelDefinition[],
  defaultModel = "google/gemini-3.1-flash-image",
): string {
  const trimmed = model?.trim() ?? "";
  if (!trimmed) return defaultModel;
  if (!availableModels?.length) return trimmed;

  const lower = trimmed.toLowerCase();

  const exact = availableModels.find((m) => m.id.toLowerCase() === lower);
  if (exact) return exact.id;

  const byName = availableModels.find((m) => m.name.toLowerCase() === lower);
  if (byName) return byName.id;

  const partial = availableModels
    .filter((m) => m.id.toLowerCase().includes(lower))
    .sort((a, b) => a.id.length - b.id.length);
  if (partial.length) return partial[0].id;

  return trimmed;
}
