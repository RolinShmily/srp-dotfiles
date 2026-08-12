/**
 * srp-providers.ts — 自建模型提供商注册集合（一个文件可注册多个 provider）
 *
 * 密钥：读 <pi 配置目录>/.env（默认 ~/.pi/agent/.env，config.sh 部署），
 *       注入 process.env 后由 pi 解析 "$VAR" 引用。
 *
 * 注意：模型定义必须带 cost 字段（全 0 即可），否则回合结束算成本会崩
 *       （Cannot read properties of undefined (reading 'tiers')）。
 *
 * 新增 provider：参考下方 registerOmniroute / registerShuaiapi 的写法，
 * 在 registerAll 中调用。网关模型查询见各 provider 段注释。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 读取 <pi 配置目录>/.env（默认 ~/.pi/agent/.env）并注入 process.env。 */
function loadDotEnv(): void {
  const dir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  let text: string;
  try {
    text = readFileSync(join(dir, ".env"), "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue; // 空行或注释
    const body = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const eq = body.indexOf("=");
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue; // 只认合法变量名
    const value = body.slice(eq + 1).trim().replace(/^["']|["']$/g, ""); // 去首尾引号
    if (!value || process.env[key] !== undefined) continue; // 空占位不注入、不覆盖已有
    process.env[key] = value;
  }
}

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
    apiKey: "$OMNIROUTE_API_KEY",
    api: "openai-completions",
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
    apiKey: "$SHUAIAI_API_KEY",
    api: "openai-completions",
    compat: { supportsUsageInStreaming: true },
    models: SHUAIAI_MODELS,
  });
}

function registerAll(pi: ExtensionAPI): void {
  loadDotEnv(); // 先注入 .env，再注册 provider

  registerOmniroute(pi);
  registerShuaiapi(pi);
}

export default registerAll;
