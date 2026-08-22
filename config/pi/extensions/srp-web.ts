/**
 * srp-web.ts — 轻量联网搜索 + 网页抓取（pi-web-access 的极简替代）。
 *
 * web_search: 调用 Exa 公共 MCP 搜索（免 API key），返回带来源的搜索结果。
 * web_fetch : 直接 HTTP 抓取，HTML 转文本 / JSON 格式化，带超时与体积上限。
 *
 * 配置（环境变量，全部可选）：
 *   SRP_WEB_SEARCH_TIMEOUT_MS 搜索超时，默认 60_000
 *   SRP_WEB_FETCH_TIMEOUT_MS  抓取超时，默认 15_000
 *   SRP_WEB_FETCH_MAX_BYTES   抓取体积上限，默认 2 MiB
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ============================ 配置区 ============================

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_SEARCH_TOOL = "web_search_exa";

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ============================ 核心逻辑（无 pi 依赖，可独立测试） ============================

/** 带超时 + 外部 abort 的请求上下文 */
function withTimeout(ms: number, label: string, signal?: AbortSignal): { ac: AbortController; done: () => void } {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${label}（${ms / 1000}s）`)), ms);
  const onAbort = () => ac.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  return {
    ac,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

interface ExaMcpResponse {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { code?: number; message?: string };
}

function parseExaResponse(body: string): ExaMcpResponse | undefined {
  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload) as ExaMcpResponse;
      if (parsed.result || parsed.error) return parsed;
    } catch { /* 继续查找下一个 SSE 事件 */ }
  }
  try {
    const parsed = JSON.parse(body) as ExaMcpResponse;
    return parsed.result || parsed.error ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** 搜索：调用 Exa 公共 MCP，无需 API key。 */
export async function searchWeb(
  query: string,
  signal?: AbortSignal,
): Promise<{ text: string; provider: string }> {
  query = query.trim();
  if (!query) throw new Error("搜索问题不能为空");
  const { ac, done } = withTimeout(envNum("SRP_WEB_SEARCH_TIMEOUT_MS", 60_000), "搜索超时", signal);
  try {
    const res = await fetch(`${EXA_MCP_URL}?tools=${EXA_SEARCH_TOOL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "x-exa-source": "srp-web",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: EXA_SEARCH_TOOL, arguments: { query, numResults: 5 } },
      }),
      signal: ac.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      const hint = res.status === 429 ? "（Exa 免费服务已限流，请稍后重试）" : "";
      throw new Error(`Exa MCP HTTP ${res.status}${hint}: ${body.slice(0, 300)}`);
    }

    const payload = parseExaResponse(body);
    if (!payload) throw new Error("Exa MCP 返回了无法解析的响应");
    if (payload.error) {
      throw new Error(`Exa MCP 错误${payload.error.code ? ` ${payload.error.code}` : ""}: ${payload.error.message ?? "未知错误"}`);
    }

    const text = payload.result?.content
      ?.find((item) => item.type === "text" && item.text?.trim())
      ?.text?.trim();
    if (payload.result?.isError || !text) {
      throw new Error(text || "Exa MCP 返回了空内容");
    }
    return { text: truncate(text), provider: "exa-mcp" };
  } finally {
    done();
  }
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
      "联网搜索：通过免 Key 的 Exa MCP 返回带来源的搜索结果。适合实时信息、最新动态和陌生领域调研；需要核对原文时，再对结果 URL 调用 web_fetch。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "搜索问题，越具体越好" }),
    }),
    async execute(_toolCallId, params, signal) {
      const { text, provider } = await searchWeb(params.query, signal);
      return { content: [{ type: "text", text }], details: { provider } };
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
