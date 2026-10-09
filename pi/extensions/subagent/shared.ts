import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createSession, isMuxKind, killSession, sessionExists, type MuxKind } from "./mux.ts";

export type RunState = "starting" | "busy" | "idle" | "exited" | "error";

export interface RunMetadata {
  version: 1;
  handle: string;
  name?: string;
  parentSessionId?: string;
  parentSessionFile?: string;
  childSessionId?: string;
  /** Multiplexer that owns `sessionName`; a run is always managed through the one that created it. */
  mux: MuxKind;
  sessionName: string;
  runDir: string;
  sessionFile: string;
  cwd: string;
  provider: string;
  model: string;
  thinking: string;
  /** Extra pi CLI flags (tools, isolation) reused when the run is relaunched. */
  launchArgs?: string[];
  /** Set by the parent when it stops the child on quit or session switch; the child is relaunched on resume. */
  suspended?: boolean;
  state: RunState;
  hasStarted: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export interface InboxMessage {
  message: string;
  delivery: "auto" | "followUp";
}

interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  message?: unknown;
}

interface AssistantMessage {
  role: "assistant";
  content?: unknown;
  stopReason?: string;
  errorMessage?: string;
}

interface AssistantEntry extends SessionEntry {
  type: "message";
  message: AssistantMessage;
}

export function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function getRunsDir(): string {
  return join(getAgentDir(), "subagents");
}

export function metadataPath(runDir: string): string {
  return join(runDir, "metadata.json");
}

export function inboxDir(runDir: string): string {
  return join(runDir, "inbox");
}

export function isValidRunName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 64 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function runDisplayName(metadata: RunMetadata): string {
  return metadata.name ? `${metadata.name} (${metadata.handle})` : metadata.handle;
}

export function readMetadata(runDir: string): RunMetadata | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(metadataPath(runDir), "utf8"));
    if (typeof value !== "object" || value === null) return undefined;
    const metadata = value as Partial<RunMetadata>;
    if (
      metadata.version !== 1 ||
      typeof metadata.handle !== "string" ||
      (metadata.name !== undefined && !isValidRunName(metadata.name)) ||
      !isMuxKind(metadata.mux) ||
      typeof metadata.sessionName !== "string" ||
      typeof metadata.sessionFile !== "string" ||
      typeof metadata.runDir !== "string"
    ) {
      return undefined;
    }
    return metadata as RunMetadata;
  } catch {
    return undefined;
  }
}

export function writeMetadata(metadata: RunMetadata): void {
  mkdirSync(dirname(metadataPath(metadata.runDir)), { recursive: true, mode: 0o700 });
  const target = metadataPath(metadata.runDir);
  const temporary = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, target);
}

export function updateMetadata(runDir: string, patch: Partial<RunMetadata>): RunMetadata | undefined {
  const current = readMetadata(runDir);
  if (!current) return undefined;
  const next: RunMetadata = {
    ...current,
    ...patch,
    version: 1,
    handle: current.handle,
    runDir: current.runDir,
    updatedAt: new Date().toISOString(),
  };
  writeMetadata(next);
  return next;
}

export async function waitForRunShutdown(runDir: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const metadata = readMetadata(runDir);
    if (!metadata || metadata.state === "exited") return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 50));
  }
}

export function removeRunDir(runDir: string): void {
  rmSync(runDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

export function runSessionExists(metadata: RunMetadata): boolean {
  return sessionExists(metadata.mux, metadata.sessionName);
}

/** Kill the run's session in whichever multiplexer owns it. */
export function killRunSession(metadata: RunMetadata): void {
  killSession(metadata.mux, metadata.sessionName);
}

/** Start the child pi process for a run in its multiplexer session. `initialArgs` are only passed on first spawn. */
export function launchRun(metadata: RunMetadata, initialArgs: string[] = []): void {
  let launcher = "pi";
  const testLauncher = join(metadata.cwd, "pi-test.sh");
  try {
    accessSync(testLauncher, constants.X_OK);
    launcher = testLauncher;
  } catch {
    // Use the installed pi executable.
  }

  createSession(metadata.mux, metadata.sessionName, metadata.cwd, [
    "env",
    `PI_SUBAGENT_RUN_DIR=${metadata.runDir}`,
    launcher,
    "--session",
    metadata.sessionFile,
    "--provider",
    metadata.provider,
    "--model",
    metadata.model,
    "--thinking",
    metadata.thinking,
    ...(metadata.launchArgs ?? []),
    ...initialArgs,
  ]);
}

export function effectiveRunState(metadata: RunMetadata): RunState {
  if (
    (metadata.state === "starting" || metadata.state === "busy" || metadata.state === "idle") &&
    !runSessionExists(metadata)
  ) {
    return "exited";
  }
  return metadata.state;
}

export function listRuns(parentSessionId?: string): RunMetadata[] {
  const root = getRunsDir();
  if (!existsSync(root)) return [];
  const runs: RunMetadata[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metadata = readMetadata(join(root, entry.name));
    if (!metadata) continue;
    if (parentSessionId && metadata.parentSessionId !== parentSessionId) continue;
    runs.push(metadata);
  }
  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function isSessionEntry(value: unknown): value is SessionEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.type === "string" &&
    typeof entry.id === "string" &&
    (entry.parentId === null || typeof entry.parentId === "string")
  );
}

function activeBranch(entries: SessionEntry[]): SessionEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: SessionEntry[] = [];
  const seen = new Set<string>();
  let current = entries.at(-1);
  while (current && !seen.has(current.id)) {
    branch.push(current);
    seen.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return branch.reverse();
}

function isAssistantEntry(entry: SessionEntry): entry is AssistantEntry {
  if (entry.type !== "message" || typeof entry.message !== "object" || entry.message === null) return false;
  return (entry.message as Record<string, unknown>).role === "assistant";
}

export function readLatestAssistant(sessionFile: string): AssistantMessage | undefined {
  let content: string;
  try {
    content = readFileSync(sessionFile, "utf8");
  } catch {
    return undefined;
  }
  const entries: SessionEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (isSessionEntry(value)) entries.push(value);
    } catch {
      // The final JSONL record may still be in the process of being appended.
    }
  }
  return activeBranch(entries).findLast(isAssistantEntry)?.message;
}

export function assistantText(message: AssistantMessage): string {
  if (!Array.isArray(message.content)) return message.errorMessage ?? "(no response text)";
  const parts: string[] = [];
  for (const item of message.content) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as Record<string, unknown>;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n").trim() || message.errorMessage || "(no response text)";
}

/** Aggregated usage of a child session, used by the status widget. */
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

/** Sum the assistant usage records of a child session. Never throws; returns undefined when unreadable. */
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
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // the last JSONL record may still be mid-append
    }

    if (entry.type === "model_change" && typeof entry.modelId === "string" && entry.modelId) {
      usage.model = entry.modelId;
      continue;
    }
    if (entry.type !== "message") continue;
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message || message.role !== "assistant") continue;

    if (typeof message.model === "string" && message.model) usage.model = message.model;
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (typeof block === "object" && block !== null && (block as Record<string, unknown>).type === "toolCall") {
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
