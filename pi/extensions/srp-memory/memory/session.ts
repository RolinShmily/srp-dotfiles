import { cpSync, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, sep } from "node:path";
import { sessionMemoryRoot } from "./paths.ts";

type SessionCtx = {
  cwd: string;
  sessionManager: {
    getSessionId: () => string;
    getHeader?: () => { id?: string; cwd?: string; parentSession?: string } | null | undefined;
  };
};

/** Read a session file's header id (first JSONL line). Undefined on any parse/IO failure. */
function readSessionHeaderId(file: string): string | undefined {
  try {
    const firstLine = readFileSync(file, "utf-8").split("\n", 1)[0] ?? "";
    const header = JSON.parse(firstLine) as { type?: string; id?: string } | undefined;
    return typeof header?.id === "string" ? header.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the parent session's memory root for fork/clone seeding.
 */
function parentMemoryRoot(ctx: SessionCtx): string | undefined {
  const parentFile = ctx.sessionManager.getHeader?.()?.parentSession;
  if (!parentFile) return undefined;
  const parentId = readSessionHeaderId(parentFile);
  if (!parentId) return undefined;
  const root = sessionMemoryRoot(ctx.cwd, parentId);
  return existsSync(root) ? root : undefined;
}

/** True for any path inside a `.runs` directory (transient IPC; never seeded). */
function isRunsPath(p: string): boolean {
  return basename(p) === ".runs" || p.includes(`${sep}.runs${sep}`);
}

/**
 * Resolve this session's `.memory/<sessionId>/` root, seeding it from the parent session on first touch.
 */
export function ensureSessionMemory(ctx: SessionCtx): string {
  const sessionId = ctx.sessionManager.getSessionId();
  const root = sessionMemoryRoot(ctx.cwd, sessionId);
  if (existsSync(root)) return root;

  const parent = parentMemoryRoot(ctx);
  if (parent) {
    const tmp = `${root}.seed-tmp-${process.pid}-${Date.now()}`;
    try {
      cpSync(parent, tmp, { recursive: true, filter: (src: string) => !isRunsPath(src) });
      renameSync(tmp, root);
    } catch {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
  return root;
}
