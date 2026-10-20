/**
 * subagent/bridge.ts — Subagent Worker Bridge
 *
 * Loaded exclusively inside the spawned worker Pi process via `-e <bridgePath>`.
 * - Grants the worker an `ask_question` tool to consult the parent orchestrator.
 * - Handles auto-exit on task completion (calling ctx.shutdown() so the pane closes cleanly).
 * - Suppresses auto-exit while waiting for the parent's answer to `ask_question`.
 * - Prevents recursive subagent spawning.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

export default function subagentBridge(pi: ExtensionAPI) {
  if (process.env.PI_SUBAGENT_ACTIVE !== "1") {
    return;
  }

  const workerName = process.env.PI_SUBAGENT_NAME || "worker";
  const sessionFile = process.env.PI_SUBAGENT_SESSION;

  let awaitingAnswer = false;

  // Render a minimal indicator in the child worker's terminal
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setWidget(
      "subagent-worker-banner",
      (_tui, theme) => {
        const box = new Box(1, 0, (text: string) => {
          try {
            return theme.bg("toolSuccessBg", text);
          } catch {
            return text;
          }
        });
        const badge = theme.bold(theme.fg("accent", `[Worker: ${workerName}]`));
        const hint = theme.fg("dim", " · Full Pi worker · ask_question available");
        box.addChild(new Text(`${badge}${hint}`, 0, 0));
        return box;
      },
      { placement: "aboveEditor" },
    );
  });

  // When input arrives (e.g. parent reply or manual steer), answer is received
  pi.on("input", () => {
    awaitingAnswer = false;
  });

  pi.on("agent_start", () => {
    awaitingAnswer = false;
  });

  pi.on("agent_end", (event, ctx) => {
    if (awaitingAnswer) {
      // Park in waiting state, do not exit
      return;
    }

    const messages = (event as any).messages as any[] | undefined;
    let errorMessage: string | undefined;

    if (messages && messages.length > 0) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg?.role === "assistant") {
          if (msg.stopReason === "error") {
            errorMessage = typeof msg.errorMessage === "string" ? msg.errorMessage : "Agent ended with error";
          }
          break;
        }
      }
    }

    if (sessionFile) {
      try {
        writeFileSync(
          `${sessionFile}.exit`,
          JSON.stringify({
            type: errorMessage ? "error" : "done",
            ...(errorMessage ? { errorMessage } : {}),
          }),
        );
      } catch {
        // best effort
      }
    }

    ctx.shutdown();
  });

  // Register `ask_question` tool
  pi.registerTool({
    name: "ask_question",
    label: "Ask Orchestrator",
    description:
      "Ask the orchestrator (the parent agent that spawned you) a clarifying question and pause until they reply. " +
      "Use when requirements are ambiguous, a critical decision needs confirmation, or you are blocked. " +
      "Your session stays open while you wait — the answer will arrive as your next turn message.",
    parameters: Type.Object({
      question: Type.String({
        description: "The question for the parent orchestrator. Include enough context for them to decide.",
      }),
    }),
    async execute(_toolCallId, params, signal) {
      if (!sessionFile) {
        throw new Error("ask_question is only available within a managed subagent session.");
      }

      awaitingAnswer = true;
      const askFile = `${sessionFile}.ask`;
      const replyFile = `${sessionFile}.reply`;

      const askData = {
        name: workerName,
        question: params.question,
        timestamp: new Date().toISOString(),
      };

      writeFileSync(askFile, JSON.stringify(askData));

      try {
        while (!existsSync(replyFile)) {
          if (signal?.aborted) {
            throw new Error("Cancelled while waiting for parent reply");
          }
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 200);
            if (signal) {
              const onAbort = () => {
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                reject(new Error("Cancelled while waiting for parent reply"));
              };
              signal.addEventListener("abort", onAbort, { once: true });
            }
          });
        }

        const reply = readFileSync(replyFile, "utf-8");
        try {
          unlinkSync(replyFile);
        } catch {}
        awaitingAnswer = false;

        return {
          content: [
            {
              type: "text",
              text: `Orchestrator answer:\n\n${reply}`,
            },
          ],
          details: { question: params.question, reply },
        };
      } finally {
        awaitingAnswer = false;
        try {
          if (existsSync(askFile)) unlinkSync(askFile);
        } catch {}
      }
    },
    renderCall(args, theme) {
      const text =
        theme.fg("toolTitle", theme.bold("ask_question ")) +
        theme.fg("muted", String((args as any).question ?? ""));
      return new Text(text, 0, 0);
    },
  });
}
