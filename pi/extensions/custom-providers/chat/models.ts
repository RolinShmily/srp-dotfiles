export const OMNIROUTE_MODELS: Record<string, unknown>[] = [
  {
    id: "antigravity/gemini-3.6-flash-high",
    name: "Gemini 3.6 Flash High (Antigravity)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
];

export const SHUAIAPI_MODELS: Record<string, unknown>[] = [
  {
    id: "gpt-6-sol",
    name: "GPT-6 Sol",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: {
      off: "none", minimal: null, low: "low", medium: "medium",
      high: "high", xhigh: "xhigh", max: "max",
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
  },
  {
    id: "gpt-6-astra",
    name: "GPT-6 Astra",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: {
      off: "none", minimal: null, low: "low", medium: "medium",
      high: "high", xhigh: "xhigh", max: "max",
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: {
      off: "none", minimal: null, low: "low", medium: "medium",
      high: "high", xhigh: "xhigh", max: "max",
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
  },
];

export const BIGMODEL_MODELS: Record<string, unknown>[] = [
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3 Flash",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: {
      minimal: null, low: "low", medium: null,
      high: "high", xhigh: null, max: "max",
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsUsageInStreaming: true,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      thinkingFormat: "zai",
      maxTokensField: "max_tokens",
    },
  },
  {
    id: "glm-5.3",
    name: "GLM-5.3",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: {
      minimal: null, low: "low", medium: null,
      high: "high", xhigh: null, max: "max",
    },
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: {
      supportsUsageInStreaming: true,
      supportsDeveloperRole: false,
      supportsReasoningEffort: true,
      thinkingFormat: "zai",
      maxTokensField: "max_tokens",
    },
  },
];

export const DASHSCOPE_CHAT_MODELS: Record<string, unknown>[] = [
  {
    id: "qwen3.8-max",
    name: "Qwen 3.8 Max (通义千问)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
  {
    id: "qwen3.8-flash",
    name: "Qwen 3.8 Flash (通义千问)",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 131_072,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
  // Pending: qwen-audio-3.1-asr-flash-streaming (ASR; Pi has no audio model type).
];
