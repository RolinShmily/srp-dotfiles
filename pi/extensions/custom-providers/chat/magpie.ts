import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

type ChatModelConfig = Extract<ProviderModelConfig, { type?: "chat" }>;

// Authenticate with a Magpie gateway key via /login magpie (stored in Pi's
// auth.json) or MAGPIE_GATEWAY_KEY. This is not an upstream provider API key.

const BASE_URL = "http://deb-lan.tail.net:3425/v1";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

function toChatModel(id: string): ChatModelConfig {
  // The OpenAI /v1/models list does not guarantee capability or pricing metadata.
  // Keep these conservative; override individual models in models.json if known.
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export const refreshMagpieModels: NonNullable<ProviderConfig["refreshModels"]> = async (context) => {
  const cached = (context.stored?.models ?? [])
    .filter((model) => model.provider === "magpie" && (model.type ?? "chat") === "chat")
    .map((model) => toChatModel(model.id));
  const key = context.credential?.type === "api_key"
    ? context.credential.key
    : process.env.MAGPIE_GATEWAY_KEY;
  if (!context.allowNetwork || !key || context.signal.aborted) return cached;

  // Magpie accepts a gateway key in Bearer, x-api-key, or ?key=; avoid URL/log leakage.
  const response = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`Magpie model discovery failed (HTTP ${response.status})`);
  const catalog: unknown = await response.json();
  if (!catalog || typeof catalog !== "object" || !("data" in catalog) || !Array.isArray(catalog.data)) {
    throw new Error("Magpie model discovery returned an invalid /v1/models response");
  }

  const ids = new Set<string>();
  for (const entry of catalog.data) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id.trim()) continue;
    // Non-chat types are not supported by the OpenAI Chat Completions adapter.
    if (
      "type" in entry &&
      ["image", "video", "audio", "classifier", "embedding", "rerank"].includes(String(entry.type))
    ) continue;
    ids.add(entry.id);
  }
  if (context.signal.aborted) return cached;
  const models = [...ids].map(toChatModel);
  await context.publish({
    persist: {
      checkedAt: Date.now(),
      models: models.map((model) => ({
        ...model,
        type: "chat" as const,
        provider: "magpie",
        api: "openai-completions" as const,
        baseUrl: BASE_URL,
      })),
    },
  });
  return models;
};

export const magpieChatProvider = {
  name: "Magpie",
  baseUrl: BASE_URL,
  api: "openai-completions",
  apiKey: "$MAGPIE_GATEWAY_KEY",
  models: [],
  refreshModels: refreshMagpieModels,
};
