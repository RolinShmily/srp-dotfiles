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
 *
 *   2. 手动：直接编辑 auth.json（条目 key 是 provider id，不是显示名）：
 *
 *        {
 *          "omniroute": { "type": "api_key", "key": "sk-..." },
 *          "shuaiapi":  { "type": "api_key", "key": "sk-..." }
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

const OMNIROUTE_BASE_URL = "http://192.168.22.174:20128/v1";

/** 静态模型列表（手动维护）。每个模型必须带 cost（全 0 即可）。 */
const OMNIROUTE_MODELS: Record<string, unknown>[] = [
  {
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (官方)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro (官方)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
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
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_536,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true },
  },
  {
    id: "antigravity/gemini-3.1-pro-low",
    name: "Gemini 3.1 Pro Low (Antigravity)",
    input: ["text", "image"],
    contextWindow: 1_048_576,
    maxTokens: 65_535,
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
// 中转站：https://api.shuaiapi.com/v1 (OpenAI 兼容，Bearer 认证)
// 文档：https://api.shuaiapi.com/llms-full.txt

const SHUAIAI_BASE_URL = "https://oai.sb/v1";

/** 静态模型列表（手动维护）。每个模型必须带 cost（全 0 即可）。 */
const SHUAIAI_MODELS: Record<string, unknown>[] = [
  {
    id: "gpt-image-2",
    name: "GPT Image 2",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
  },
  {
    id: "deepseek-v4-flash-0731",
    name: "DeepSeek V4 Flash (0731)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
  },
  {
    id: "deepseek-v4-pro-0813",
    name: "DeepSeek V4 Pro (0813)",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 384_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT 5.6 Sol",
    reasoning: true,
    input: ["text"],
    contextWindow: 400_000,
    maxTokens: 128_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsUsageInStreaming: true, supportsDeveloperRole: false },
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

function registerAll(pi: ExtensionAPI): void {
  registerOmniroute(pi);
  registerShuaiapi(pi);
}

export default registerAll;
