/**
 * web-reach.ts — Lightweight web search and extraction extension for Pi.
 *
 * Injects `web_search` and `web_fetch` tools by default:
 * 1. web_search: Keyless Exa MCP web search returning structured snippets with source URLs.
 * 2. web_fetch : Multi-tier web content extraction engine:
 *    - Next.js RSC (React Server Components) static data parsing;
 *    - Semantic HTML to Markdown conversion;
 *    - PDF document detection and text extraction;
 *    - Automatic fallback to Jina Reader for JS-rendered pages;
 *    - Pretty-printed JSON formatting.
 */

import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ============================ Constants ============================

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const EXA_SEARCH_TOOL = "web_search_exa";
const JINA_READER_BASE = "https://r.jina.ai/";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 web-reach/2.0";

const MAX_RETURN_CHARS = 35_000;
const MIN_USEFUL_CONTENT_LENGTH = 300;

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ============================ Timeout & Helpers ============================

function withTimeout(
  ms: number,
  label: string,
  signal?: AbortSignal,
): { ac: AbortController; done: () => void } {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(new Error(`${label} timed out (${ms / 1000}s)`)), ms);
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
  return text.slice(0, limit) + `\n\n...(content truncated to ${limit} characters)`;
}

// ============================ Web Search (Exa MCP) ============================

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
      /* continue to next SSE event */
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
  if (!query) throw new Error("Search query cannot be empty.");
  const { ac, done } = withTimeout(
    envNum("SRP_WEB_SEARCH_TIMEOUT_MS", 60_000),
    "Search request timed out",
    signal,
  );
  try {
    const res = await fetch(`${EXA_MCP_URL}?tools=${EXA_SEARCH_TOOL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "x-exa-source": "web-reach",
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
      const hint = res.status === 429 ? " (Exa free tier rate limit reached; please try again later)" : "";
      throw new Error(`Exa MCP HTTP ${res.status}${hint}: ${body.slice(0, 300)}`);
    }

    const payload = parseExaResponse(body);
    if (!payload) throw new Error("Exa MCP returned an unparseable response.");
    if (payload.error) {
      throw new Error(
        `Exa MCP error${payload.error.code ? ` ${payload.error.code}` : ""}: ${payload.error.message ?? "Unknown error"}`,
      );
    }

    const text = payload.result?.content
      ?.find((item) => item.type === "text" && item.text?.trim())
      ?.text?.trim();
    if (payload.result?.isError || !text) {
      throw new Error(text || "Exa MCP returned empty content.");
    }
    return { text: truncate(text), provider: "exa-mcp" };
  } finally {
    done();
  }
}

// ============================ Next.js RSC Extraction ============================

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

// ============================ Semantic HTML to Markdown ============================

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

  // Headings
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n");
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n");
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n");
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n\n#### $1\n\n");
  s = s.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n\n##### $1\n\n");
  s = s.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n\n###### $1\n\n");

  // Code blocks and inline code
  s = s.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n```\n$1\n```\n");
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n```\n$1\n```\n");
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, " `$1` ");

  // Blockquotes and emphasis
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, "\n> $1\n");
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");

  // Links
  s = s.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = text.replace(/<[^>]*>/g, "").trim();
    if (!t) return "";
    if (href.startsWith("#") || href.startsWith("javascript:")) return t;
    return `[${t}](${href})`;
  });

  // Lists
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
  s = s.replace(/<\/(ul|ol)>/gi, "\n\n");

  // Tables
  s = s.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, "\n$1 |");
  s = s.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, " | $1");
  s = s.replace(/<\/(table|thead|tbody)>/gi, "\n\n");

  // Paragraphs and line breaks
  s = s.replace(/<\/(p|div|section|article)>/gi, "\n\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags
  s = s.replace(/<[^>]*>/g, " ");

  // HTML entity decoding
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
  const { ac, done } = withTimeout(30_000, "Jina Reader timed out", signal);
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

// ============================ PDF Document Extraction ============================

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
    // Fallback plain text extraction
    const text = Buffer.from(buffer).toString("latin1").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    return {
      text: `# PDF Document\n\n${text.slice(0, 8000)}`,
      title: "PDF Document",
    };
  }
}

// ============================ Web Fetch Main Entry ============================

export async function fetchUrl(
  url: string,
  opts: { mode?: "readable" | "raw" } = {},
  signal?: AbortSignal,
): Promise<{ text: string; title: string; contentType: string; status: number; engine: string }> {
  const mode = opts.mode ?? "readable";
  const { ac, done } = withTimeout(
    envNum("SRP_WEB_FETCH_TIMEOUT_MS", 20_000),
    "Web fetch timed out",
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
      throw new Error(`Content exceeds ${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MiB limit.`);
    }

    // 1. PDF extraction
    if (isPdfUrl(url, contentType)) {
      const { text, title } = await extractPdfBuffer(arrayBuf, url);
      return { text: truncate(text), title, contentType, status: res.status, engine: "unpdf" };
    }

    const body = Buffer.from(arrayBuf).toString("utf8");

    // 2. Raw mode
    if (mode === "raw") {
      return {
        text: truncate(body),
        title: extractTitleFromHtml(body) || url,
        contentType,
        status: res.status,
        engine: "raw",
      };
    }

    // 3. JSON formatting
    if (contentType.includes("json")) {
      try {
        const text = JSON.stringify(JSON.parse(body), null, 2);
        return { text: truncate(text), title: "JSON Response", contentType, status: res.status, engine: "json" };
      } catch {
        return { text: truncate(body), title: "JSON", contentType, status: res.status, engine: "text" };
      }
    }

    // 4. HTML processing
    if (contentType.includes("html") || contentType.includes("xhtml")) {
      // 4.1 Attempt Next.js RSC extraction
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

      // 4.2 Semantic HTML to Markdown
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

      // 4.3 Dynamic JS page or short content: attempt Jina Reader fallback
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

    // 5. Plain text and other types
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

// ============================ Tool Registration ============================

export default function (pi: ExtensionAPI) {
  // Register web_search tool
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web using Exa MCP without an API key. Returns high-quality search results with titles, source URLs, and text snippets. Ideal for real-time information, latest news, and research; use web_fetch on result URLs to inspect full pages.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Search query, as specific as possible." }),
    }),
    async execute(_toolCallId, params, signal) {
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

  // Register web_fetch tool
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Intelligently fetch and extract content from a web page. Automatically extracts main content and converts to structured Markdown (supports Next.js RSC parsing, PDF extraction, semantic HTML-to-Markdown, and falls back to Jina Reader for JS-rendered pages). Suitable for in-depth reading of documentation and web pages.",
    parameters: Type.Object({
      url: Type.String({ description: "Target http(s) URL." }),
      mode: Type.Optional(
        Type.Enum(
          { readable: "readable", raw: "raw" },
          { description: "readable: intelligently extract Markdown (default); raw: return raw content." },
        ),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      const mode = params.mode as "readable" | "raw" | undefined;
      const { text, title, contentType, status, engine } = await fetchUrl(params.url, { mode }, signal);
      const header = title ? `# ${title}\n\nSource: ${params.url} (Engine: ${engine})\n\n---\n\n` : "";
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
