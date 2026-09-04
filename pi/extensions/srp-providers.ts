/**
 * srp-providers.ts — 自建模型提供商注册集合（一个文件可注册多个 provider）
 *
 * 认证：完全使用 pi 原生机制，不读 .env / 环境变量。
 *
 *   1. 交互式：用户执行 `/login <provider>` 输入 API key，pi 自动写入
 *      ~/.pi/agent/auth.json（0600 权限，带锁保护）：
 *
 *        /login omniroute
 *        /login shuaiapi
 *        /login bigmodel
 *
 *   2. 手动：直接编辑 auth.json（条目 key 是 provider id，不是显示名）：
 *
 *        {
 *          "omniroute": { "type": "api_key", "key": "sk-..." },
 *          "shuaiapi":  { "type": "api_key", "key": "sk-..." },
 *          "bigmodel":  { "type": "api_key", "key": "..." }
 *        }
 *
 *      key 还支持命令（"!cmd"）与环境变量插值（"$VAR"），见 providers.md。
 *
 * 注意：模型定义必须带 cost 字段（全 0 即可），否则回合结束算成本会崩
 *       （Cannot read properties of undefined (reading 'tiers')）。
 *
 * 新增 provider：参考下方 registerOmniroute / registerShuaiapi 的写法，
 * 在 registerAll 中调用。网关模型查询见各 provider 段注释。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ============================ omniroute ============================

const OMNIROUTE_BASE_URL = "http://192.168.22.172:20128/v1";

/** 静态模型列表（手动维护）。每个模型必须带 cost（全 0 即可）。 */
const OMNIROUTE_MODELS: Record<string, unknown>[] = [
  {
    id: "opencode-zen/deepseek-v4-flash-free",
    name: "DeepSeek V4 Flash Free (OpenCode Zen)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
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

function registerOmniroute(pi: ExtensionAPI): void {
  pi.registerProvider("omniroute", {
    name: "OmniRoute",
    baseUrl: OMNIROUTE_BASE_URL,
    api: "openai-completions",
    // 认证走 /login omniroute（auth.json），不设 apiKey 字段
    compat: { supportsUsageInStreaming: true },
    models: OMNIROUTE_MODELS,
  });
}

// ============================ shuaiapi ============================
// 中转站：https://oai.sb/v1（OpenAI 兼容，Bearer 认证）
// 文档及当前启用模型：https://api.shuaiapi.com/llms-full.txt

const SHUAIAI_BASE_URL = "https://cdn.shuaiapi.com/v1";
const SHUAIAI_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const SHUAIAI_COMPAT = {
  supportsUsageInStreaming: true,
  supportsDeveloperRole: false,
};
const GPT_5_6_THINKING_LEVELS = {
  off: "none",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};
const DEEPSEEK_V4_THINKING_LEVELS = {
  minimal: null,
  low: null,
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
};

/**
 * ShuaiAPI 当前启用、且适用于 pi 对话/编码的精选模型。
 * 网关按分组和动态表达式计费，无法在此准确表示，故成本统一记为 0。
 * gpt-image-2 仅用于图片生成端点，不注册为 Chat Completions 模型。
 */
const SHUAIAI_MODELS: Record<string, unknown>[] = [
  {
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash 0731",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    thinkingLevelMap: DEEPSEEK_V4_THINKING_LEVELS,
    cost: SHUAIAI_COST,
    compat: {
      ...SHUAIAI_COMPAT,
      supportsStore: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    },
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    thinkingLevelMap: DEEPSEEK_V4_THINKING_LEVELS,
    cost: SHUAIAI_COST,
    compat: {
      ...SHUAIAI_COMPAT,
      supportsStore: false,
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    },
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: GPT_5_6_THINKING_LEVELS,
    cost: SHUAIAI_COST,
    compat: SHUAIAI_COMPAT,
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: GPT_5_6_THINKING_LEVELS,
    cost: SHUAIAI_COST,
    compat: SHUAIAI_COMPAT,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: GPT_5_6_THINKING_LEVELS,
    cost: SHUAIAI_COST,
    compat: SHUAIAI_COMPAT,
  },
];

function registerShuaiapi(pi: ExtensionAPI): void {
  pi.registerProvider("shuaiapi", {
    name: "SHUAI API",
    baseUrl: SHUAIAI_BASE_URL,
    api: "openai-completions",
    // 认证走 /login shuaiapi（auth.json），不设 apiKey 字段
    compat: { supportsUsageInStreaming: true },
    models: SHUAIAI_MODELS,
  });
}

// ============================ bigmodel ============================
// 智谱 AI 开放平台：https://open.bigmodel.cn
// 接口文档：https://docs.bigmodel.cn/api-reference/模型-api/对话补全
// 模型指南：https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash

const BIGMODEL_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
const BIGMODEL_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const BIGMODEL_COMPAT = {
  supportsUsageInStreaming: true,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  thinkingFormat: "zai" as const,
  maxTokensField: "max_tokens" as const,
};

const GLM_5_3_THINKING_LEVELS = {
  minimal: null,
  low: "low",
  medium: null,
  high: "high",
  xhigh: null,
  max: "max",
};

/**
 * 智谱官方模型。
 * 认证走 /login bigmodel（auth.json），不设 apiKey 字段。
 */
const BIGMODEL_MODELS: Record<string, unknown>[] = [
  {
    id: "glm-5.3-flash",
    name: "GLM-5.3 Flash",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: GLM_5_3_THINKING_LEVELS,
    cost: BIGMODEL_COST,
    compat: BIGMODEL_COMPAT,
  },
  {
    id: "glm-5.3",
    name: "GLM-5.3",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
    thinkingLevelMap: GLM_5_3_THINKING_LEVELS,
    cost: BIGMODEL_COST,
    compat: BIGMODEL_COMPAT,
  },
];

function registerBigmodel(pi: ExtensionAPI): void {
  pi.registerProvider("bigmodel", {
    name: "BigModel (智谱)",
    baseUrl: BIGMODEL_BASE_URL,
    api: "openai-completions",
    // 认证走 /login bigmodel（auth.json），不设 apiKey 字段
    compat: { supportsUsageInStreaming: true },
    models: BIGMODEL_MODELS,
  });
}

function registerAll(pi: ExtensionAPI): void {
  registerOmniroute(pi);
  registerShuaiapi(pi);
  registerBigmodel(pi);
}

export default registerAll;
