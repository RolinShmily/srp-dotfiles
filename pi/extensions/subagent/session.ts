import { openSync, readFileSync, readSync, closeSync } from "node:fs";

export interface SessionEntry {
  type: string;
  id: string;
  parentId?: string | null;
  [key: string]: unknown;
}

export interface AssistantMessage {
  role: "assistant";
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
  model?: string;
  usage?: Record<string, unknown>;
}

export interface SessionUsage {
  model?: string;
  toolCount: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  contextTokens: number;
  cost: number;
}

export function readEntries(sessionFile: string): SessionEntry[] {
  let content: string;
  try {
    content = readFileSync(sessionFile, "utf8");
  } catch {
    return [];
  }
  const entries: SessionEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // ignore malformed or mid-append lines
    }
  }
  return entries;
}

export function getSessionId(sessionFile: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(sessionFile, "r");
    const buf = Buffer.allocUnsafe(4096);
    const bytes = readSync(fd, buf, 0, 4096, 0);
    if (bytes <= 0) return null;
    const nl = buf.indexOf(0x0a);
    const end = nl === -1 || nl >= bytes ? bytes : nl;
    const firstLine = buf.toString("utf8", 0, end).trim();
    if (!firstLine) return null;
    const parsed = JSON.parse(firstLine);
    return parsed.type === "session" && typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

/**
 * Extracts the last assistant response text from a session JSONL file.
 * Handles auto-retry error messages as fallback.
 */
export function findLastAssistantMessage(sessionFile: string): string | null {
  const entries = readEntries(sessionFile);
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) continue;
    const msg = entry.message as AssistantMessage;
    if (msg.role !== "assistant") continue;

    if (Array.isArray(msg.content)) {
      const texts: string[] = [];
      for (const block of msg.content) {
        if (typeof block === "object" && block !== null && (block as any).type === "text" && typeof (block as any).text === "string") {
          texts.push((block as any).text);
        }
      }
      const combined = texts.join("\n").trim();
      if (combined) return combined;
    }

    if (msg.stopReason === "error" && typeof msg.errorMessage === "string" && msg.errorMessage.trim()) {
      return `Worker error: ${msg.errorMessage.trim()}`;
    }
  }
  return null;
}

/**
 * Summarize token usage and cost across all assistant turns.
 */
export function readSessionUsage(sessionFile: string): SessionUsage | undefined {
  let content: string;
  try {
    content = readFileSync(sessionFile, "utf8");
  } catch {
    return undefined;
  }

  const usage: SessionUsage = {
    toolCount: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    contextTokens: 0,
    cost: 0,
  };

  const num = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type === "model_change" && typeof entry.modelId === "string" && entry.modelId) {
      usage.model = entry.modelId;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message as AssistantMessage | undefined;
    if (!message || message.role !== "assistant") continue;

    if (typeof message.model === "string" && message.model) usage.model = message.model;
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block === "object" && block !== null && (block as any).type === "toolCall") {
          usage.toolCount++;
        }
      }
    }

    const record = message.usage as Record<string, unknown> | undefined;
    if (!record || typeof record !== "object") continue;
    usage.input += num(record.input);
    usage.output += num(record.output);
    usage.cacheRead += num(record.cacheRead);
    usage.cacheWrite += num(record.cacheWrite);
    const total = num(record.totalTokens);
    if (total > 0) usage.contextTokens = total;
    const cost = record.cost as Record<string, unknown> | undefined;
    if (cost && typeof cost === "object") usage.cost += num(cost.total);
  }

  return usage;
}
