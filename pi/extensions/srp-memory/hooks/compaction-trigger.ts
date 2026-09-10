import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  findLastCompactionIndex,
  rawTokensAfterIndex,
  rawTokensSinceLastCompaction,
  type Entry,
} from "../ledger/index.ts";
import type { Runtime } from "../runtime.ts";

export const RESUME_PROMPT =
  "[automatic] Your context was just compacted to free space; no user message was sent. " +
  "Continue exactly where you left off, as if the compaction had not happened.";

export const RETRYABLE_ERROR_RE =
  /overloaded|provider.?returned.?error|rate.?limit|too many requests|429|500|502|503|504|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?lost|websocket.?closed|websocket.?error|other side closed|fetch failed|upstream.?connect|reset before headers|socket hang up|ended without|http2 request did not get a response|timed? out|timeout|terminated|retry delay/i;

export function contextPressureTokens(
  ctx: { getContextUsage?: () => { tokens: number | null } | undefined; sessionManager: { getBranch: () => Entry[] } },
  threshold: number,
): { tokens: number; due: boolean } {
  const branch = ctx.sessionManager.getBranch();
  if (branch.length === 0) return { tokens: 0, due: false };

  // If the last entry on the branch is already a compaction, context was just compacted on this branch.
  const lastEntry = branch[branch.length - 1];
  if (lastEntry.type === "compaction") {
    return { tokens: 0, due: false };
  }

  const lastCompactionIdx = findLastCompactionIndex(branch);
  if (lastCompactionIdx !== -1) {
    // If no new source entries exist after compaction, context has not grown since compaction.
    const tokensSinceCompaction = rawTokensAfterIndex(branch, lastCompactionIdx);
    if (tokensSinceCompaction === 0) {
      return { tokens: 0, due: false };
    }

    // Check if any assistant message has responded after the compaction.
    // In Pi, getContextUsage() returns tokens: null until an assistant message responds post-compaction.
    let hasAssistantAfterCompaction = false;
    for (let i = branch.length - 1; i > lastCompactionIdx; i--) {
      const entry = branch[i];
      if (entry.type === "message" && (entry.message as any)?.role === "assistant") {
        hasAssistantAfterCompaction = true;
        break;
      }
    }
    if (!hasAssistantAfterCompaction) {
      return { tokens: 0, due: false };
    }
  }

  const live = ctx.getContextUsage?.()?.tokens;
  if (live != null) {
    return { tokens: live, due: live >= threshold };
  }

  const raw = rawTokensSinceLastCompaction(branch);
  return { tokens: raw, due: raw >= threshold };
}

export function turnWillContinue(event: any): boolean {
  const toolResults = event?.toolResults;
  if (Array.isArray(toolResults) && toolResults.length > 0) return true;
  const stop = event?.message?.stopReason;
  return stop === "tool_use" || stop === "tool_calls";
}

/**
 * Register the automatic compaction trigger.
 *
 * NOTE on safe triggering vs mid-run aborts:
 * In Pi, `AgentSession.compact()` immediately calls `await this.abort()`, which calls
 * `this.agent.abort()`. Calling `ctx.compact()` during an active multi-turn tool chain
 * (`turn_end` while tool calls are executing or turn will continue) violently aborts the agent run.
 * This marks the active assistant message with `stopReason: "error"` and `errorMessage: "This operation was aborted"`,
 * which renders as a red error in the TUI.
 *
 * To trigger compaction safely without aborting active turns, automatic compaction is evaluated on `agent_end`
 * and deferred until the session is truly idle (`ctx.isIdle() === true`).
 */
export function registerCompactionTrigger(pi: ExtensionAPI, runtime: Runtime): void {
  pi.on("agent_start", () => {
    // A new turn is starting — abort any pending deferred auto-compaction wait
    if (runtime.autoCompactionController) {
      runtime.autoCompactionController.abort();
      runtime.autoCompactionController = undefined;
      runtime.compactInFlight = false;
    }
  });

  pi.on("agent_end", (event: any, ctx: any) => {
    if (!runtime.enabled || runtime.config.passive) return;
    if (runtime.compactInFlight) return;

    // Check if the run ended with a retryable error (Pi will auto-retry)
    const lastAssistant = [...(event?.messages ?? [])]
      .reverse()
      .find((m): m is Extract<typeof m, { role: "assistant" }> => m?.role === "assistant");
    if (
      lastAssistant &&
      lastAssistant.stopReason === "error" &&
      lastAssistant.errorMessage &&
      RETRYABLE_ERROR_RE.test(lastAssistant.errorMessage)
    ) {
      return;
    }

    if (!contextPressureTokens(ctx, runtime.config.compactAtContextTokens).due) return;

    const hasUI = ctx.hasUI;
    const ui = ctx.ui;
    runtime.compactInFlight = true;
    const controller = new AbortController();
    runtime.autoCompactionController = controller;
    const signal = controller.signal;

    void (async () => {
      try {
        // Yield to the event loop first so agent_end handlers settle
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Poll isIdle() until the agent is truly idle so ctx.compact() does not abort an active run
        while (typeof ctx.isIdle === "function" && !ctx.isIdle()) {
          if (signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        if (signal.aborted) return;

        // Re-check pressure after settling
        if (!contextPressureTokens(ctx, runtime.config.compactAtContextTokens).due) {
          runtime.compactInFlight = false;
          runtime.autoCompactionController = undefined;
          return;
        }

        if (hasUI) ui?.notify("srp-memory: 已达上下文阈值 — 正在执行记忆压缩（等待处理中的 Observers）…", "info");

        runtime.autoCompactionController = undefined;
        ctx.compact({
          onComplete: () => {
            runtime.compactInFlight = false;
            if (hasUI) ui?.notify("srp-memory: 记忆压缩完成", "info");
          },
          onError: (error: { message: string }) => {
            runtime.compactInFlight = false;
            if (error.message === "Compaction cancelled") return;
            if (hasUI) ui?.notify(`srp-memory: ${error.message}`, "error");
          },
        });
      } catch (error) {
        runtime.compactInFlight = false;
        runtime.autoCompactionController = undefined;
        const msg = error instanceof Error ? error.message : String(error);
        if (hasUI) ui?.notify(`srp-memory: 压缩触发失败 — ${msg}`, "error");
      }
    })();
  });
}
