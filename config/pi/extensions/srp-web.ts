/**
 * srp-web.ts — 轻量联网搜索 + 网页抓取（pi-web-access 的极简替代）。
 *
 * web_search: 双后端 AI 搜索，自动降级：
 *   1. gemini — 原生 Gemini API generateContent + googleSearch grounding
 *      （模型可配；若响应无 grounding 元数据，视为网关不支持，自动降级）
 *   2. felo   — 网关 felo/felo-search 模型，自带实时搜索与来源（当前网关实测可用）
 * web_fetch : 直接 HTTP 抓取，HTML 转文本 / JSON 格式化，带超时与体积上限。
 *
 * 配置（环境变量，全部可选）：
 *   SRP_WEB_BASE_URL          网关地址，默认 http://192.168.22.174:20128/v1
 *   SRP_WEB_PROVIDER          auth.json 里的 provider id，默认 omniroute
 *   SRP_WEB_SEARCH_BACKEND    auto（默认，gemini 优先，无 grounding 则降级 felo）
 *                             | gemini（强制，失败即报错）| felo
 *   SRP_WEB_GEMINI_MODEL      原生 Gemini 模型，默认 gemini-2.5-flash
 *   SRP_WEB_SEARCH_MODEL      felo 模型，默认 felo/felo-search
 *   SRP_WEB_SEARCH_TIMEOUT_MS 搜索超时，默认 60_000
 *   SRP_WEB_FETCH_TIMEOUT_MS  抓取超时，默认 15_000
 *   SRP_WEB_FETCH_MAX_BYTES   抓取体积上限，默认 2 MiB
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================ 配置区 ============================

const DEFAULT_BASE_URL = "http://192.168.22.174:20128/v1";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_FELO_MODEL = "felo/felo-search";
const DEFAULT_PROVIDER = "omniroute";

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ============================ 核心逻辑（无 pi 依赖，可独立测试） ============================

/** auth.json 的 key 支持 "$VAR" 插值与 "!cmd" 命令（与 Pi 行为一致） */
function resolveValue(v: string): string {
  if (v.startsWith("!!")) return v.slice(1);
  if (v.startsWith("!")) {
    return execSync(v.slice(1), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  }
  return v.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => process.env[name] ?? m);
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

async function loadAuthKey(provider: string): Promise<string> {
  const authPath = join(agentDir(), "auth.json");
  try {
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    const entry = auth[provider]?.key;
    if (entry) return resolveValue(entry);
  } catch { /* fallthrough */ }
  throw new Error(
    `未找到 provider "${provider}" 的 API key。请先 /login ${provider}，或编辑 ${agentDir()}/auth.json。`,
  );
}

/** 带超时 + 外部 abort 的请求上下文 */
function withTimeout(ms: number, label: string, signal?: AbortSignal): { ac: AbortController; done: () => void } {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${label}（${ms / 1000}s）`)), ms);
  signal?.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  if (signal?.aborted) ac.abort(signal.reason);
  return { ac, done: () => clearTimeout(timer) };
}

/** 解析 OpenAI 兼容 SSE 流（felo 强制流式） */
async function parseSSE(res: Response): Promise<string> {
  let text = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const delta = JSON.parse(payload)?.choices?.[0]?.delta;
      if (delta) text += delta.content ?? "";
    } catch { /* 跳过无法解析的行 */ }
  }
  return text.trim();
}

/** 后端 1：原生 Gemini API + googleSearch grounding */
async function searchWithGemini(
  query: string,
  signal?: AbortSignal,
): Promise<{ text: string; model: string; grounded: boolean }> {
  const base = (process.env.SRP_WEB_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.SRP_WEB_GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  const key = await loadAuthKey(process.env.SRP_WEB_PROVIDER ?? DEFAULT_PROVIDER);
  const { ac, done } = withTimeout(envNum("SRP_WEB_SEARCH_TIMEOUT_MS", 60_000), "Gemini 搜索超时", signal);
  try {
    const res = await fetch(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: query }] }],
        tools: [{ googleSearch: {} }],
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = await res.json();
    const candidate = json?.candidates?.[0];
    if (!candidate) throw new Error("Gemini 返回空响应");
    const text = (candidate.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Gemini 返回了空内容");
    const chunks = candidate.groundingMetadata?.groundingChunks ?? [];
    const grounded = Array.isArray(chunks) && chunks.length > 0;
    return { text, model, grounded };
  } finally {
    done();
  }
}

/** 后端 2：网关 felo/felo-search（AI 搜索，带来源引用） */
async function searchWithFelo(
  query: string,
  signal?: AbortSignal,
): Promise<{ text: string; model: string }> {
  const base = (process.env.SRP_WEB_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = process.env.SRP_WEB_SEARCH_MODEL ?? DEFAULT_FELO_MODEL;
  const key = await loadAuthKey(process.env.SRP_WEB_PROVIDER ?? DEFAULT_PROVIDER);
  const { ac, done } = withTimeout(envNum("SRP_WEB_SEARCH_TIMEOUT_MS", 60_000), "搜索超时", signal);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: query }],
        max_tokens: 2048,
        stream: true,
      }),
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const text = await parseSSE(res);
    if (!text) throw new Error("搜索模型返回了空内容");
    return { text, model };
  } finally {
    done();
  }
}

/** 搜索入口：auto = gemini 优先，无 grounding 则降级 felo */
export async function searchWeb(
  query: string,
  signal?: AbortSignal,
): Promise<{ text: string; model: string; backend: string }> {
  const backend = (process.env.SRP_WEB_SEARCH_BACKEND ?? "auto").toLowerCase();
  if (backend === "gemini" || backend === "auto") {
    try {
      const r = await searchWithGemini(query, signal);
      if (r.grounded || backend === "gemini") {
        return { text: r.text, model: r.model, backend: "gemini" };
      }
      // auto 且无 grounding：网关不支持搜索透传，降级
    } catch (e) {
      if (backend === "gemini") throw e;
    }
  }
  const r = await searchWithFelo(query, signal);
  return { text: r.text, model: r.model, backend: "felo" };
}

const MAX_RETURN_CHARS = 30_000;

function stripHtml(html: string): string {
  let s = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = stripTags(text).trim();
    return t ? `${t} (${href})` : "";
  });
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|section|article)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<t[dh][^>]*>/gi, " | ");
  s = stripTags(s);
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
       .replace(/&hellip;/g, "…").replace(/&mdash;/g, "—").replace(/&ndash;/g, "–");
  return s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n").trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, " ");
}

function truncate(text: string): string {
  if (text.length <= MAX_RETURN_CHARS) return text;
  return text.slice(0, MAX_RETURN_CHARS) + `\n\n…（内容过长，已截断至 ${MAX_RETURN_CHARS} 字符）`;
}

/** 抓取 URL 内容：HTML 转文本、JSON 格式化，其余类型原样返回（截断） */
export async function fetchUrl(
  url: string,
  opts: { mode?: "readable" | "raw" } = {},
  signal?: AbortSignal,
): Promise<{ text: string; contentType: string; status: number }> {
  const mode = opts.mode ?? "readable";
  const { ac, done } = withTimeout(envNum("SRP_WEB_FETCH_TIMEOUT_MS", 15_000), "抓取超时", signal);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) srp-web/1.0" },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const maxBytes = envNum("SRP_WEB_FETCH_MAX_BYTES", 2 * 1024 * 1024);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) {
      throw new Error(`内容超过 ${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MiB 上限`);
    }
    const body = buf.toString("utf8");

    let text: string;
    if (mode === "raw") {
      text = body;
    } else if (contentType.includes("html")) {
      text = stripHtml(body);
      if (!text) text = body.slice(0, 4000); // 兜底：纯 JS 渲染页面
    } else if (contentType.includes("json")) {
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        text = body;
      }
    } else {
      text = body; // text/* 等原样返回
    }
    return { text: truncate(text), contentType, status: res.status };
  } finally {
    done();
  }
}

// ============================ Pi 扩展注册 ============================

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_search",
    description:
      "联网搜索：经 AI 搜索模型返回带来源的合成答案（支持中文）。适合实时信息、最新动态、陌生领域调研。",
    parameters: Type.Object({
      query: Type.String({ description: "搜索问题，越具体越好" }),
    }),
    async execute(_toolCallId, params, signal) {
      const { text, model, backend } = await searchWeb(params.query, signal);
      return { content: [{ type: "text", text }], details: { backend, model } };
    },
  });

  pi.registerTool({
    name: "web_fetch",
    description:
      "抓取网页内容：HTML 自动转纯文本（保留链接）、JSON 自动格式化。适合读取网页正文、API 返回、文档页面。",
    parameters: Type.Object({
      url: Type.String({ description: "http(s) URL" }),
      mode: Type.Optional(Type.Enum({ readable: "readable", raw: "raw" }, {
        description: "readable=HTML转文本（默认），raw=原样返回原始内容",
      })),
    }),
    async execute(_toolCallId, params, signal) {
      const { text, contentType, status } = await fetchUrl(params.url, { mode: params.mode }, signal);
      return { content: [{ type: "text", text }], details: { contentType, status } };
    },
  });
}
