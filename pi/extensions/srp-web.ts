/**
 * srp-web.ts — SRP 轻量联网搜索与全功能网页提取扩展。
 *
 * 功能特性：
 * 1. web_search: 免 Key 的 Exa MCP 联网搜索，返回包含标题、来源 URL 与摘要的搜索结果。
 * 2. web_fetch : 现代化多级网页抓取与提取引擎：
 *    - Next.js RSC (React Server Components) 静态数据深度解析；
 *    - 语义化 HTML 转 Markdown 转换（去除广告/脚本/导航，保留代码块、表格、引用与链接）；
 *    - PDF 文档检测与文本提取；
 *    - JS 动态渲染页面自动 Fallback 至 Jina Reader (https://r.jina.ai)；
 *    - 纯 JSON 自动格式化排版。
 *
 * 交互命令：
 *   /srp-web [on|off]
 *   /srp-web status
 *   /srp-web search <query>
 *   /srp-web fetch <url>
 *
 * 配置（settings.json，可选）：
 * {
 *   "srpWeb": { "enabled": true }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text, type AutocompleteItem } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ============================ 配置区 ============================

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_SEARCH_TOOL = "web_search_exa";
const JINA_READER_BASE = "https://r.jina.ai/";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 srp-web/2.0";

const MAX_RETURN_CHARS = 35_000;
const MIN_USEFUL_CONTENT_LENGTH = 300;

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface SrpWebConfig {
  search: boolean;
  fetch: boolean;
}

function readSrpWebConfig(cwd: string): SrpWebConfig {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpWeb;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  const global = read(join(getAgentDir(), "settings.json"));
  const project = read(join(cwd, CONFIG_DIR_NAME, "settings.json"));
  const merged = { ...global, ...project };

  const globalEnabled = merged.enabled !== false;
  const searchEnabled = typeof merged.search === "boolean" ? merged.search : globalEnabled;
  const fetchEnabled = typeof merged.fetch === "boolean" ? merged.fetch : globalEnabled;

  return {
    search: searchEnabled,
    fetch: fetchEnabled,
  };
}

// ============================ 超时控制 ============================

function withTimeout(
  ms: number,
  label: string,
  signal?: AbortSignal,
): { ac: AbortController; done: () => void } {
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

function truncate(text: string, limit = MAX_RETURN_CHARS): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n\n…（内容过长，已截断至 ${limit} 字符）`;
}

// ============================ 联网搜索 (Exa MCP) ============================

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
    } catch {
      /* 继续查找下一个 SSE 事件 */
    }
  }
  try {
    const parsed = JSON.parse(body) as ExaMcpResponse;
    return parsed.result || parsed.error ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function searchWeb(
  query: string,
  signal?: AbortSignal,
): Promise<{ text: string; provider: string }> {
  query = query.trim();
  if (!query) throw new Error("搜索问题不能为空");
  const { ac, done } = withTimeout(
    envNum("SRP_WEB_SEARCH_TIMEOUT_MS", 60_000),
    "搜索超时",
    signal,
  );
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
        params: { name: EXA_SEARCH_TOOL, arguments: { query, numResults: 6 } },
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
      throw new Error(
        `Exa MCP 错误${payload.error.code ? ` ${payload.error.code}` : ""}: ${payload.error.message ?? "未知错误"}`,
      );
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

// ============================ Next.js RSC 提取 ============================

function extractRSCContent(html: string): { title: string; content: string } | null {
  if (!html.includes("self.__next_f.push")) return null;

  const chunkMap = new Map<string, string>();
  const scriptRegex = /<script>self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;

  for (const match of html.matchAll(scriptRegex)) {
    let content: string;
    try {
      content = JSON.parse('"' + match[1] + '"');
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx <= 0 || colonIdx > 4) continue;
      const id = line.slice(0, colonIdx);
      if (!/^[0-9a-f]+$/i.test(id)) continue;
      const payload = line.slice(colonIdx + 1);
      if (!payload) continue;
      const existing = chunkMap.get(id);
      if (!existing || payload.length > existing.length) {
        chunkMap.set(id, payload);
      }
    }
  }

  if (chunkMap.size === 0) return null;

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]?.split("|")[0]?.trim() || "";

  const parsedCache = new Map<string, unknown>();
  function getParsedChunk(id: string): unknown | null {
    if (parsedCache.has(id)) return parsedCache.get(id);
    const chunk = chunkMap.get(id);
    if (!chunk || !chunk.startsWith("[")) {
      parsedCache.set(id, null);
      return null;
    }
    try {
      const parsed = JSON.parse(chunk);
      parsedCache.set(id, parsed);
      return parsed;
    } catch {
      parsedCache.set(id, null);
      return null;
    }
  }

  const visitedRefs = new Set<string>();

  function extractNode(node: unknown, ctx = { inCode: false }): string {
    if (node === null || node === undefined) return "";
    if (typeof node === "string") {
      const refMatch = node.match(/^\$L([0-9a-f]+)$/i);
      if (refMatch) {
        const refId = refMatch[1];
        if (visitedRefs.has(refId)) return "";
        visitedRefs.add(refId);
        const refNode = getParsedChunk(refId);
        const result = refNode ? extractNode(refNode, ctx) : "";
        visitedRefs.delete(refId);
        return result;
      }
      if (!ctx.inCode && (node === "$undefined" || node === "$" || /^\$[A-Z]/.test(node))) {
        return "";
      }
      return node.trim() ? node : "";
    }
    if (typeof node === "number") return String(node);
    if (typeof node === "boolean") return "";
    if (!Array.isArray(node)) return "";

    if (node[0] === "$" && typeof node[1] === "string") {
      const tag = node[1] as string;
      const props = (node[3] || {}) as Record<string, unknown>;
      const skipTags = [
        "script", "style", "svg", "path", "circle", "link", "meta",
        "template", "button", "input", "nav", "footer", "aside",
      ];
      if (skipTags.includes(tag)) return "";

      if (tag.startsWith("$L")) {
        const refId = tag.slice(2);
        if (visitedRefs.has(refId)) return "";
        if (props.baseId && props.children) {
          return `## ${String(props.children)}\n\n`;
        }
        visitedRefs.add(refId);
        const refNode = getParsedChunk(refId);
        let result = "";
        if (refNode) result = extractNode(refNode, ctx);
        else if (props.children) result = extractNode(props.children, ctx);
        visitedRefs.delete(refId);
        return result;
      }

      const children = props.children;
      const content = children ? extractNode(children, ctx) : "";

      switch (tag) {
        case "h1": return `# ${content.trim()}\n\n`;
        case "h2": return `## ${content.trim()}\n\n`;
        case "h3": return `### ${content.trim()}\n\n`;
        case "h4": return `#### ${content.trim()}\n\n`;
        case "h5": return `##### ${content.trim()}\n\n`;
        case "h6": return `###### ${content.trim()}\n\n`;
        case "p": return `${content.trim()}\n\n`;
        case "code": {
          const cc = children ? extractNode(children, { inCode: true }) : "";
          return ctx.inCode ? cc : `\`${cc}\``;
        }
        case "pre": {
          const pc = children ? extractNode(children, { inCode: true }) : "";
          return "```\n" + pc + "\n```\n\n";
        }
        case "strong": case "b": return `**${content}**`;
        case "em": case "i": return `*${content}*`;
        case "li": return `- ${content.trim()}\n`;
        case "ul": case "ol": return content + "\n";
        case "blockquote": return `> ${content.trim()}\n\n`;
        case "a": {
          const href = props.href as string | undefined;
          return href && !href.startsWith("#") ? `[${content}](${href})` : content;
        }
        default: return content;
      }
    }

    return (node as unknown[]).map((n) => extractNode(n, ctx)).join("");
  }

  const contentParts: { order: number; text: string }[] = [];
  for (const [id] of chunkMap) {
    const parsed = getParsedChunk(id);
    if (!parsed) continue;
    visitedRefs.clear();
    const text = extractNode(parsed);
    if (text.trim().length > 50 && !text.includes("404") && !text.includes("not found")) {
      contentParts.push({ order: parseInt(id, 16) || 0, text: text.trim() });
    }
  }

  if (contentParts.length === 0) return null;
  contentParts.sort((a, b) => a.order - b.order);

  const seen = new Set<string>();
  const uniqueParts: string[] = [];
  for (const part of contentParts) {
    const key = part.text.slice(0, 150);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueParts.push(part.text);
    }
  }

  const content = uniqueParts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return content.length > 100 ? { title, content } : null;
}

// ============================ 语义 HTML 转 Markdown ============================

function extractTitleFromHtml(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() ?? "";
}

function isLikelyJSRendered(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (!bodyMatch) return false;
  const textContent = bodyMatch[1]
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const scriptCount = (html.match(/<script/gi) || []).length;
  return textContent.length < 300 && scriptCount >= 2;
}

function htmlToMarkdown(html: string): string {
  let s = html.replace(/<(script|style|noscript|svg|canvas|form|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  // 标题
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n");
  s = s.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n");
  s = s.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n");

  // 代码块与行内代码
  s = s.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, " `$1` ");

  // 引用与强调
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // 链接
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = text.replace(/<[^>]*>/g, "").trim();
    if (!t) return "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return t;
    return `[${t}](${href})`;
  });

  // 列表
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
  s = s.replace(/<\/(ul|ol)>/gi, "\n\n");

  // 表格
  s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, "\n$1 |");
  s = s.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, " | $1");
  s = s.replace(/<\/(table|thead|tbody)>/gi, "\n\n");

  // 段落与换行
  s = s.replace(/<\/(p|div|section|article)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");

  // 清除剩余标签
  s = s.replace(/<[^>]*>/g, " ");

  // HTML 实体解码
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&hellip;/g, "…")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");

  return s
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")
    .trim();
}

// ============================ Jina Reader Fallback ============================

async function fetchViaJinaReader(
  url: string,
  signal?: AbortSignal,
): Promise<{ text: string; title: string } | null> {
  const { ac, done } = withTimeout(30_000, "Jina Reader 超时", signal);
  try {
    const res = await fetch(`${JINA_READER_BASE}${url}`, {
      headers: {
        Accept: "text/markdown",
        "X-No-Cache": "true",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      signal: ac.signal,
    });
    if (!res.ok) return null;

    const raw = await res.text();
    const contentIndex = raw.indexOf("Markdown Content:");
    const markdown = contentIndex >= 0 ? raw.slice(contentIndex + 17).trim() : raw.trim();

    if (
      markdown.length < 80 ||
      markdown.startsWith("Loading...") ||
      markdown.startsWith("Please enable JavaScript")
    ) {
      return null;
    }

    const titleMatch = markdown.match(/^#+\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || "";

    return { text: markdown, title };
  } catch {
    return null;
  } finally {
    done();
  }
}

// ============================ PDF 文档提取 ============================

function isPdfUrl(url: string, contentType?: string): boolean {
  if (contentType?.includes("application/pdf")) return true;
  try {
    return new URL(url).pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

async function extractPdfBuffer(
  buffer: ArrayBuffer,
  url: string,
): Promise<{ text: string; title: string }> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const maxPages = Math.min(pdf.numPages, 80);
    const pages: string[] = [];

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: unknown) => (item as { str?: string }).str || "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) pages.push(`--- Page ${i} ---\n${pageText}`);
    }

    const title = new URL(url).pathname.split("/").pop() || "PDF Document";
    const text = `# ${title}\n\nPages: ${pdf.numPages}\n\n${pages.join("\n\n")}`;
    return { text, title };
  } catch {
    // 降级文本提取
    const text = Buffer.from(buffer).toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    return {
      text: `# PDF Document\n\n${text.slice(0, 8000)}`,
      title: "PDF Document",
    };
  }
}

// ============================ 网页抓取主入口 ============================

export async function fetchUrl(
  url: string,
  opts: { mode?: "readable" | "raw" } = {},
  signal?: AbortSignal,
): Promise<{ text: string; title: string; contentType: string; status: number; engine: string }> {
  const mode = opts.mode ?? "readable";
  const { ac, done } = withTimeout(
    envNum("SRP_WEB_FETCH_TIMEOUT_MS", 20_000),
    "网页抓取超时",
    signal,
  );

  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,text/plain,*/*;q=0.8",
      },
      signal: ac.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const maxBytes = envNum("SRP_WEB_FETCH_MAX_BYTES", 4 * 1024 * 1024);
    const arrayBuf = await res.arrayBuffer();

    if (arrayBuf.byteLength > maxBytes) {
      throw new Error(`内容超过 ${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MiB 上限`);
    }

    // 1. PDF 提取
    if (isPdfUrl(url, contentType)) {
      const { text, title } = await extractPdfBuffer(arrayBuf, url);
      return { text: truncate(text), title, contentType, status: res.status, engine: "unpdf" };
    }

    const body = Buffer.from(arrayBuf).toString("utf8");

    // 2. Raw 原始模式
    if (mode === "raw") {
      return {
        text: truncate(body),
        title: extractTitleFromHtml(body) || url,
        contentType,
        status: res.status,
        engine: "raw",
      };
    }

    // 3. JSON 格式化
    if (contentType.includes("json")) {
      try {
        const text = JSON.stringify(JSON.parse(body), null, 2);
        return { text: truncate(text), title: "JSON Response", contentType, status: res.status, engine: "json" };
      } catch {
        return { text: truncate(body), title: "JSON", contentType, status: res.status, engine: "text" };
      }
    }

    // 4. HTML 处理
    if (contentType.includes("html") || contentType.includes("xhtml")) {
      // 4.1 尝试 Next.js RSC 提取
      const rsc = extractRSCContent(body);
      if (rsc && rsc.content.length >= MIN_USEFUL_CONTENT_LENGTH) {
        return {
          text: truncate(rsc.content),
          title: rsc.title || extractTitleFromHtml(body),
          contentType,
          status: res.status,
          engine: "nextjs-rsc",
        };
      }

      // 4.2 语义化 HTML 转 Markdown
      const title = extractTitleFromHtml(body);
      const markdown = htmlToMarkdown(body);

      if (markdown.length >= MIN_USEFUL_CONTENT_LENGTH && !isLikelyJSRendered(body)) {
        return {
          text: truncate(markdown),
          title,
          contentType,
          status: res.status,
          engine: "html-markdown",
        };
      }

      // 4.3 动态 JS 页面或内容过短：尝试 Jina Reader Fallback
      const jina = await fetchViaJinaReader(url, signal);
      if (jina && jina.text.length >= 100) {
        return {
          text: truncate(jina.text),
          title: jina.title || title,
          contentType: "text/markdown",
          status: res.status,
          engine: "jina-reader",
        };
      }

      return {
        text: truncate(markdown || body.slice(0, 4000)),
        title,
        contentType,
        status: res.status,
        engine: "html-fallback",
      };
    }

    // 5. 纯文本及其他类型
    return {
      text: truncate(body),
      title: url.split("/").pop() || "Plain Text",
      contentType,
      status: res.status,
      engine: "text",
    };
  } finally {
    done();
  }
}

// ============================ Pi 扩展注册 ============================

function syncWebActiveTools(pi: ExtensionAPI, search: boolean, fetch: boolean): void {
  let active = pi.getActiveTools();
  if (search) {
    if (!active.includes("web_search")) active = [...active, "web_search"];
  } else {
    active = active.filter((t) => t !== "web_search");
  }
  if (fetch) {
    if (!active.includes("web_fetch")) active = [...active, "web_fetch"];
  } else {
    active = active.filter((t) => t !== "web_fetch");
  }
  pi.setActiveTools(active);
}

export default function (pi: ExtensionAPI) {
  let searchEnabled = false;
  let fetchEnabled = false;

  pi.on("session_start", (_event, ctx) => {
    const cfg = readSrpWebConfig(ctx.cwd);
    searchEnabled = cfg.search;
    fetchEnabled = cfg.fetch;
    syncWebActiveTools(pi, searchEnabled, fetchEnabled);
  });

  // 注册主控制命令：/srp-web
  pi.registerCommand("srp-web", {
    description: "管理与测试轻量联网工具（/srp-web [search|fetch] [on|off] 或 /srp-web [on|off|status]）",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "status", label: "status", description: "查看当前网络工具状态与配置" },
        { value: "search on", label: "search on", description: "开启 web_search 联网搜索工具" },
        { value: "search off", label: "search off", description: "关闭 web_search 联网搜索工具" },
        { value: "fetch on", label: "fetch on", description: "开启 web_fetch 网页提取工具" },
        { value: "fetch off", label: "fetch off", description: "关闭 web_fetch 网页提取工具" },
        { value: "on", label: "on", description: "开启全部网络工具 (search + fetch)" },
        { value: "off", label: "off", description: "关闭全部网络工具" },
        { value: "search ", label: "search <query>", description: "测试执行联网搜索" },
        { value: "fetch ", label: "fetch <url>", description: "测试抓取网页内容" },
      ];
      const trimmed = prefix.trimStart();
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const target = (parts[0] || "status").toLowerCase();
      const state = (parts[1] || "").toLowerCase();

      if (target === "status" || parts.length === 0) {
        const timeoutSearch = envNum("SRP_WEB_SEARCH_TIMEOUT_MS", 60_000) / 1000;
        const timeoutFetch = envNum("SRP_WEB_FETCH_TIMEOUT_MS", 20_000) / 1000;
        const maxMb = Math.round((envNum("SRP_WEB_FETCH_MAX_BYTES", 4 * 1024 * 1024) / 1024 / 1024) * 10) / 10;
        ctx.ui.notify(
          `srp-web 状态:\n• Search: ${searchEnabled ? "已开启" : "已关闭"} (源: Exa MCP, 超时 ${timeoutSearch}s)\n• Fetch: ${fetchEnabled ? "已开启" : "已关闭"} (引擎: RSC/Markdown/PDF/Jina, 上限 ${maxMb}MB, 超时 ${timeoutFetch}s)`,
          "info",
        );
        return;
      }

      if (target === "search") {
        if (state === "on") {
          searchEnabled = true;
          syncWebActiveTools(pi, searchEnabled, fetchEnabled);
          ctx.ui.notify("srp-web: web_search 已开启（工具已激活）", "info");
          return;
        }
        if (state === "off") {
          searchEnabled = false;
          syncWebActiveTools(pi, searchEnabled, fetchEnabled);
          ctx.ui.notify("srp-web: web_search 已关闭（工具已取消激活）", "info");
          return;
        }
        // 测试搜索
        const query = parts.slice(1).join(" ").trim();
        if (!query) {
          ctx.ui.notify("用法: /srp-web search on|off 或 /srp-web search <query>", "warning");
          return;
        }
        try {
          ctx.ui.notify(`正在搜索: "${query}" ...`, "info");
          const { text } = await searchWeb(query);
          ctx.ui.notify(`搜索完成 (${text.length} 字符):\n${text.slice(0, 300)}...`, "info");
        } catch (e) {
          ctx.ui.notify(`搜索失败: ${String(e)}`, "error");
        }
        return;
      }

      if (target === "fetch") {
        if (state === "on") {
          fetchEnabled = true;
          syncWebActiveTools(pi, searchEnabled, fetchEnabled);
          ctx.ui.notify("srp-web: web_fetch 已开启（工具已激活）", "info");
          return;
        }
        if (state === "off") {
          fetchEnabled = false;
          syncWebActiveTools(pi, searchEnabled, fetchEnabled);
          ctx.ui.notify("srp-web: web_fetch 已关闭（工具已取消激活）", "info");
          return;
        }
        // 测试抓取
        const targetUrl = parts.slice(1).join(" ").trim();
        if (!targetUrl) {
          ctx.ui.notify("用法: /srp-web fetch on|off 或 /srp-web fetch <url>", "warning");
          return;
        }
        try {
          ctx.ui.notify(`正在抓取: ${targetUrl} ...`, "info");
          const res = await fetchUrl(targetUrl);
          ctx.ui.notify(
            `抓取成功 [${res.engine}] 《${res.title || "Untitled"}》(${res.text.length} 字符):\n${res.text.slice(0, 300)}...`,
            "info",
          );
        } catch (e) {
          ctx.ui.notify(`抓取失败: ${String(e)}`, "error");
        }
        return;
      }

      if (target === "on" || target === "off") {
        const enable = target === "on";
        searchEnabled = enable;
        fetchEnabled = enable;
        syncWebActiveTools(pi, searchEnabled, fetchEnabled);
        ctx.ui.notify(`srp-web: 已${enable ? "开启并激活" : "关闭并取消激活"}全部网络工具`, "info");
        return;
      }

      ctx.ui.notify("用法: /srp-web [search|fetch] [on|off] 或 /srp-web [on|off|status]", "info");
    },
  });

  // 注册 web_search 工具
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "联网搜索：通过免 Key 的 Exa MCP 返回带来源的高质量搜索结果。适合实时信息、最新动态和陌生领域调研；需要核对原文时，再对结果 URL 调用 web_fetch。",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "搜索问题，越具体越好" }),
    }),
    async execute(_toolCallId, params, signal) {
      if (!searchEnabled) {
        throw new Error("web_search 当前已关闭。请在 TUI 中输入 /srp-web search on 开启后重试。");
      }
      const { text, provider } = await searchWeb(params.query, signal);
      return { content: [{ type: "text", text }], details: { provider } };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const { query } = args as { query?: string };
      const display = query && query.length > 60 ? query.slice(0, 57) + "..." : query || "";
      text.setText(
        theme.fg("toolTitle", theme.bold("search ")) + theme.fg("accent", `"${display}"`),
      );
      return text;
    },
  });

  // 注册 web_fetch 工具
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "智能抓取网页内容：自动提取正文并转为结构化 Markdown（支持 Next.js RSC 解析、PDF 提取、HTML 语义转换，并在 JS 渲染站点自动调用 Jina Reader 兜底）。适合深度阅读文档与网页详情。",
    parameters: Type.Object({
      url: Type.String({ description: "目标 http(s) URL" }),
      mode: Type.Optional(
        Type.Enum(
          { readable: "readable", raw: "raw" },
          { description: "readable=智能提取 Markdown（默认），raw=返回原始内容" },
        ),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      if (!fetchEnabled) {
        throw new Error("web_fetch 当前已关闭。请在 TUI 中输入 /srp-web fetch on 开启后重试。");
      }
      const mode = params.mode as "readable" | "raw" | undefined;
      const { text, title, contentType, status, engine } = await fetchUrl(params.url, { mode }, signal);
      const header = title ? `# ${title}\n\n来源: ${params.url} (引擎: ${engine})\n\n---\n\n` : "";
      return {
        content: [{ type: "text", text: header + text }],
        details: { contentType, status, engine, title, chars: text.length },
      };
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const { url } = args as { url?: string };
      const display = url && url.length > 70 ? url.slice(0, 67) + "..." : url || "";
      text.setText(
        theme.fg("toolTitle", theme.bold("fetch ")) + theme.fg("accent", display),
      );
      return text;
    },
  });
}
