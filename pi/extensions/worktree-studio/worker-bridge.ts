/**
 * worktree-studio/worker-bridge.ts — Persistent Pi Studio Worker Bridge
 *
 * Runs inside the spawned Pi worker TUI process.
 * - Writes per-turn completion to `${sessionFile}.exit` on `agent_settled` without calling ctx.shutdown.
 * - Keeps Pi TUI running idle for follow-up turns.
 * - Polls `${sessionFile}.inbox` for follow-up prompts from the parent process.
 * - Atomically consumes inbox tasks and dispatches via `pi.sendUserMessage(task, { deliverAs: "followUp" })`.
 * - Confirms reception by writing `${sessionFile}.ack` with matching request ID and status.
 * - Cleans up polling resources on `session_shutdown`.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const INBOX_POLL_INTERVAL_MS = 50;

export interface SessionPaths {
  sessionFile: string;
  exitPath: string;
  inboxPath: string;
  ackPath: string;
}

export function resolveSessionPaths(exitFile: string): SessionPaths {
  const sessionFile = exitFile.endsWith(".exit")
    ? exitFile.slice(0, -".exit".length)
    : exitFile;
  const exitPath = exitFile.endsWith(".exit") ? exitFile : `${sessionFile}.exit`;
  return {
    sessionFile,
    exitPath,
    inboxPath: `${sessionFile}.inbox`,
    ackPath: `${sessionFile}.ack`,
  };
}

export function writeAtomicJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = join(
    dir,
    `.${basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  try {
    writeFileSync(tempPath, JSON.stringify(data), "utf8");
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {}
    throw err;
  }
}

export default function worktreeStudioWorker(pi: ExtensionAPI): void {
  if (process.env.PI_WORKTREE_STUDIO_WORKER !== "1") return;
  const exitFile = process.env.PI_WORKTREE_STUDIO_EXIT_FILE;
  if (!exitFile) return;

  const { exitPath, inboxPath, ackPath } = resolveSessionPaths(exitFile);
  let errorMessage: string | undefined;
  let isShutDown = false;
  let checkingInbox = false;

  pi.on("agent_start", () => {
    errorMessage = undefined;
  });

  pi.on("agent_end", (event) => {
    const lastAssistant = event.messages.filter((message) => message.role === "assistant").at(-1);
    errorMessage = lastAssistant?.stopReason === "error"
      ? lastAssistant.errorMessage || "Worker ended with a model error"
      : undefined;
  });

  pi.on("agent_settled", (event) => {
    if (event.aborted) {
      errorMessage = errorMessage ?? "Worker was aborted";
    }
    try {
      writeAtomicJson(exitPath, {
        type: errorMessage ? "error" : "done",
        ...(errorMessage ? { errorMessage } : {}),
      });
    } catch (err) {
      console.error("Worker bridge failed to write exit sidecar:", err);
    } finally {
      errorMessage = undefined;
    }
    void checkInbox();
  });

  async function checkInbox(): Promise<void> {
    if (isShutDown || checkingInbox) return;
    checkingInbox = true;
    try {
      if (!existsSync(inboxPath)) return;

      const processingPath = join(
        dirname(inboxPath),
        `.${basename(inboxPath)}.proc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );

      try {
        renameSync(inboxPath, processingPath);
      } catch (renameErr: any) {
        if (renameErr?.code === "ENOENT") return;
        throw renameErr;
      }

      let raw = "";
      try {
        raw = readFileSync(processingPath, "utf8");
      } finally {
        try {
          if (existsSync(processingPath)) {
            unlinkSync(processingPath);
          }
        } catch {}
      }

      let payload: any;
      try {
        payload = JSON.parse(raw);
      } catch (parseErr: any) {
        const errMsg = `Invalid JSON in inbox file: ${parseErr?.message || String(parseErr)}`;
        writeAtomicJson(ackPath, {
          id: null,
          status: "error",
          error: errMsg,
          errorMessage: errMsg,
        });
        return;
      }

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        const errMsg = "Inbox payload must be a JSON object with 'id' and 'task'";
        writeAtomicJson(ackPath, {
          id: null,
          status: "error",
          error: errMsg,
          errorMessage: errMsg,
        });
        return;
      }

      const { id, task } = payload;
      if (
        id === undefined ||
        id === null ||
        (typeof id !== "string" && typeof id !== "number") ||
        String(id).trim() === ""
      ) {
        const errMsg = "Inbox payload missing valid 'id'";
        writeAtomicJson(ackPath, {
          id: null,
          status: "error",
          error: errMsg,
          errorMessage: errMsg,
        });
        return;
      }

      if (typeof task !== "string" || task.length === 0) {
        const errMsg = "Inbox payload missing valid 'task' string";
        writeAtomicJson(ackPath, {
          id,
          status: "error",
          error: errMsg,
          errorMessage: errMsg,
        });
        return;
      }

      try {
        await Promise.resolve(pi.sendUserMessage(task, { deliverAs: "followUp" }));
        writeAtomicJson(ackPath, {
          id,
          status: "ok",
          ok: true,
        });
      } catch (sendErr: any) {
        const errMsg = `Failed to send user message: ${sendErr?.message || String(sendErr)}`;
        writeAtomicJson(ackPath, {
          id,
          status: "error",
          error: errMsg,
          errorMessage: errMsg,
        });
      }
    } catch (err: any) {
      const errMsg = `Error processing inbox: ${err?.message || String(err)}`;
      try {
        writeAtomicJson(ackPath, {
          id: null,
          status: "error",
          error: errMsg,
          errorMessage: errMsg,
        });
      } catch (writeErr) {
        console.error(errMsg, writeErr);
      }
    } finally {
      checkingInbox = false;
    }
  }

  const pollInterval = setInterval(() => {
    void checkInbox();
  }, INBOX_POLL_INTERVAL_MS);
  pollInterval.unref?.();

  pi.on("session_shutdown", () => {
    isShutDown = true;
    clearInterval(pollInterval);
  });

  void checkInbox();
}
