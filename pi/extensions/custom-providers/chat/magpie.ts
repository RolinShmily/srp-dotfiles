import type { AnyModel, Api, Model } from "@earendil-works/pi-ai";
import type { ProviderConfig, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

type ChatModelConfig = Extract<ProviderModelConfig, { type?: "chat" }>;
type ClassifierModelConfig = Extract<ProviderModelConfig, { type: "classifier" }>;
type RefreshContext = Parameters<NonNullable<ProviderConfig["refreshModels"]>>[0];

type MagpieChatModelConfig = ChatModelConfig & {
  api: "anthropic-messages" | "google-generative-ai" | "openai-responses" | "openai-completions";
  baseUrl: string;
};

type MagpieClassifierModelConfig = ClassifierModelConfig & {
  type: "classifier";
  api: "typesafe-system-one";
  baseUrl: string;
};

type MagpieDiscoveredModelConfig = MagpieChatModelConfig | MagpieClassifierModelConfig;

// Authenticate with a Magpie gateway key via /login magpie (stored in Pi's
// auth.json) or MAGPIE_GATEWAY_KEY. This is not an upstream provider API key.

const BASE_URL = "http://deb-lan.tail.net:3425/v1";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const NON_CHAT_TYPES = new Set(["image", "video", "audio", "embedding", "rerank"]);

// Follow Magpie's own Pi adapter and gateway's ThinksOnlyWhenAsked /
// AdaptiveThinking predicates, not a blanket assumption about Messages models:
// internal/agent/agents.go and internal/gateway/anthropic.go (dee5c9d).
const CLAUDE_MODEL = /(?:^|[/.:-])claude-/i;
const CLAUDE_VERSION = /(?:^|[^a-z0-9])(?:claude-)?(?:opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:[-.](\d{1,2}))?(?:[^0-9]|$)|claude-(\d+)(?:[-.](\d))?-(?:opus|sonnet|haiku)/i;
const GEMINI_MODEL = /(?:^|\/)(?:gemini|gemma)[-.]/i;
const DECISION_MODEL = /(?:^|\/)(?:jev(?:-|$)|decision-model)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function reasoningLevels(entry: Record<string, unknown>): string[] {
  const flat = entry.reasoning_levels;
  const levels = Array.isArray(flat) && flat.every((level) => typeof level === "string")
    ? flat
    : Array.isArray(entry.supported_reasoning_levels) ? entry.supported_reasoning_levels : [];
  return levels.flatMap((level) => {
    const effort = isRecord(level) ? level.effort : level;
    return typeof effort === "string" && effort.trim() ? [effort.trim().toLowerCase()] : [];
  });
}

function thinkingLevelMap(levels: string[], claudeOff: boolean): ChatModelConfig["thinkingLevelMap"] {
  // An absent/unknown effort list is not an exhaustive list of unsupported levels
  // (e.g. budget-based thinking). Let Pi's native adapter supply its defaults.
  if (!levels.some((level) => level === "none" || THINKING_LEVELS.some((known) => known !== "off" && known === level))) {
    return undefined;
  }
  const mapping: NonNullable<ChatModelConfig["thinkingLevelMap"]> = Object.fromEntries(THINKING_LEVELS.map((level) => [
    level,
    level === "off" ? (levels.includes("none") ? "none" : null) : levels.includes(level) ? level : null,
  ]));
  // Claude can take thinking.type=disabled even when none is not an effort.
  // Other Messages models (e.g. always-thinking GLM) must not inherit this.
  if (claudeOff && mapping.off === null) delete mapping.off;
  return mapping;
}

function toClassifierModel(entry: Record<string, unknown> & { id: string }, gatewayUrl: string): MagpieClassifierModelConfig {
  return {
    type: "classifier",
    id: entry.id,
    name: typeof entry.display_name === "string" && entry.display_name.trim() ? entry.display_name : entry.id,
    api: "typesafe-system-one",
    // TypeSafe System One transport appends /systemone to baseUrl.
    // Magpie serves POST /v1/systemone, so baseUrl is `${gatewayUrl}/v1`.
    baseUrl: `${gatewayUrl}/v1`,
    contextWindow: positiveInteger(entry.context_window)
      ?? positiveInteger(entry.context_length)
      ?? positiveInteger(entry.max_input_tokens)
      ?? 64_000,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function isDecisionModel(entry: Record<string, unknown>, endpoints: string[]): boolean {
  if (entry.kind === "decision" || entry.type === "classifier") return true;
  if (endpoints.some((ep) => ep.includes("/v1/systemone"))) return true;
  if (typeof entry.id === "string" && (DECISION_MODEL.test(entry.id) || entry.id.startsWith("group/jev"))) return true;
  return false;
}

function toChatModel(entry: Record<string, unknown> & { id: string }, gatewayUrl: string): MagpieChatModelConfig {
  // Follow Magpie's /v1/models metadata, not model-name/vendor heuristics:
  // https://github.com/yetone/magpie/blob/main/docs/integrating.md
  // Protocol precedence: Responses, then Messages, then native Google Gemini, then Chat fallback.
  const endpoints = Array.isArray(entry.native_endpoints)
    ? entry.native_endpoints.filter((ep): ep is string => typeof ep === "string")
    : [];

  const isGemini = endpoints.some((ep) => ep.includes("/v1beta") || ep.includes("generateContent")) ||
    ((typeof entry.owned_by === "string" && ["google", "google-vertex", "gemini"].includes(entry.owned_by.toLowerCase())) ||
      GEMINI_MODEL.test(entry.id)) && !endpoints.includes("/v1/responses") && !endpoints.includes("/v1/messages");

  const api: MagpieChatModelConfig["api"] = endpoints.includes("/v1/responses") ? "openai-responses"
    : endpoints.includes("/v1/messages") ? "anthropic-messages"
    : isGemini ? "google-generative-ai"
    : "openai-completions";

  const version = api === "anthropic-messages" ? CLAUDE_VERSION.exec(entry.id) : null;
  const claudeOff = api === "anthropic-messages" && (CLAUDE_MODEL.test(entry.id) || version !== null);
  const major = Number(version?.[3] ?? version?.[1] ?? 0);
  const minor = Number(version?.[4] ?? version?.[2] ?? 0);
  const adaptive = major > 4 || (major === 4 && minor >= 6);
  const levels = reasoningLevels(entry);
  const reasoning = typeof entry.reasoning === "boolean" ? entry.reasoning : levels.length > 0;
  const effortMap = reasoning ? thinkingLevelMap(levels, claudeOff) : undefined;
  const modalities = isRecord(entry.modalities) ? entry.modalities.input : undefined;
  const input: ChatModelConfig["input"] = Array.isArray(modalities)
    ? [...new Set(modalities.filter((value): value is "text" | "image" => value === "text" || value === "image"))]
    : [];
  const contextWindow = positiveInteger(entry.context_window)
    ?? positiveInteger(entry.context_length)
    ?? positiveInteger(entry.max_input_tokens)
    ?? DEFAULT_CONTEXT_WINDOW;

  // Base URL selection:
  // - Anthropic: gatewayUrl (Anthropic SDK appends /v1/messages)
  // - Gemini: `${gatewayUrl}/v1beta` (Google GenAI SDK appends /models/{model}:streamGenerateContent)
  // - OpenAI: `${gatewayUrl}/v1` (OpenAI SDK appends /responses or /chat/completions)
  const baseUrl = api === "anthropic-messages" ? gatewayUrl
    : api === "google-generative-ai" ? `${gatewayUrl}/v1beta`
    : `${gatewayUrl}/v1`;

  return {
    type: "chat",
    id: entry.id,
    name: typeof entry.display_name === "string" && entry.display_name.trim() ? entry.display_name : entry.id,
    api,
    baseUrl,
    reasoning,
    ...(effortMap ? { thinkingLevelMap: effortMap } : {}),
    // Only recognized Claude versions use Magpie's adaptive policy. Effort
    // names alone do not prove support; opaque aliases need modelOverrides.
    ...(adaptive ? { compat: { forceAdaptiveThinking: true } } : {}),
    input: input.length > 0 ? input : ["text"],
    contextWindow,
    maxTokens: Math.min(positiveInteger(entry.max_output_tokens) ?? DEFAULT_MAX_TOKENS, contextWindow),
    // Magpie does not publish prices here. Zero means unknown, not free;
    // modelOverrides in models.json can provide verified prices and capabilities.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export const refreshMagpieModels = async (context: RefreshContext): Promise<ProviderModelConfig[]> => {
  const gatewayUrl = (context.baseUrl ?? BASE_URL).replace(/\/+$/, "").replace(/\/v1$/, "");
  // Keep the entire snapshot: rebuilding from IDs would silently turn native
  // Messages/Responses/Gemini/System One models back into Chat and discard capabilities.
  // Reject snapshots from another gateway, including during offline startup:
  // otherwise a changed gateway/key could send future prompts to the old host.
  const cached = (context.stored?.models ?? [])
    .filter((model): model is AnyModel => model.provider === "magpie")
    .filter((model) => {
      const type = model.type ?? "chat";
      if (type === "classifier") {
        return model.api === "typesafe-system-one" && model.baseUrl.replace(/\/+$/, "") === `${gatewayUrl}/v1`;
      }
      if (type === "chat") {
        const expectedUrl = model.api === "anthropic-messages" ? gatewayUrl
          : model.api === "google-generative-ai" ? `${gatewayUrl}/v1beta`
          : model.api === "openai-responses" || model.api === "openai-completions" ? `${gatewayUrl}/v1` : undefined;
        return Boolean(expectedUrl && model.baseUrl.replace(/\/+$/, "") === expectedUrl);
      }
      return false;
    })
    .map((model) => ({ ...model }));
  if (!context.allowNetwork || context.signal.aborted) return cached;
  const key = context.credential?.type === "api_key"
    ? context.credential.key
    : process.env.MAGPIE_GATEWAY_KEY;
  if (!key) return cached;

  // Magpie accepts a gateway key in Bearer, x-api-key, or ?key=; avoid URL/log leakage.
  // Send X-Magpie-Deciders to include System One decision models, and X-Magpie-Prices for prices.
  const response = await fetch(`${gatewayUrl}/v1/models`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Magpie-Deciders": "1",
      "X-Magpie-Prices": "1",
    },
    signal: context.signal,
  });
  if (!response.ok) throw new Error(`Magpie model discovery failed (HTTP ${response.status})`);
  const catalog: unknown = await response.json();
  if (!isRecord(catalog) || !Array.isArray(catalog.data)) {
    throw new Error("Magpie model discovery returned an invalid /v1/models response");
  }

  const discovered = new Map<string, MagpieDiscoveredModelConfig>();
  for (const entry of catalog.data) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim()) continue;
    if ((typeof entry.type === "string" && NON_CHAT_TYPES.has(entry.type)) || discovered.has(entry.id)) continue;
    const endpoints = Array.isArray(entry.native_endpoints)
      ? entry.native_endpoints.filter((ep): ep is string => typeof ep === "string")
      : [];
    if (isDecisionModel(entry, endpoints)) {
      discovered.set(entry.id, toClassifierModel({ ...entry, id: entry.id }, gatewayUrl));
    } else {
      discovered.set(entry.id, toChatModel({ ...entry, id: entry.id }, gatewayUrl));
    }
  }
  if (context.signal.aborted) return cached;
  const models = [...discovered.values()];
  await context.publish({
    persist: {
      checkedAt: Date.now(),
      models: models.map((model) => ({
        ...model,
        provider: "magpie",
      })),
    },
  });
  return models;
};

async function loadTypesafeSystemOneClassifier() {
  try {
    const mod = await import("@earendil-works/pi-ai/api/typesafe-system-one.lazy.js");
    return mod.typesafeSystemOneApi();
  } catch {
    try {
      const fallbackUrl = "file:///C:/Users/Rolin/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/typesafe-system-one.lazy.js";
      const mod = await import(fallbackUrl);
      return mod.typesafeSystemOneApi();
    } catch {
      throw new Error("Unable to load @earendil-works/pi-ai System One classifier implementation");
    }
  }
}

export const magpieChatProvider = {
  name: "Magpie",
  baseUrl: BASE_URL,
  api: "openai-completions",
  apiKey: "$MAGPIE_GATEWAY_KEY",
  models: [],
  refreshModels: refreshMagpieModels,
  classifiers: {
    "typesafe-system-one": {
      classify: async (model, context, options) => {
        const impl = await loadTypesafeSystemOneClassifier();
        return impl.classify(model, context, options);
      },
    },
  },
} satisfies ProviderConfig;
