/**
 * subagent/index.ts — Unified Homogeneous Subagent Extension
 *
 * Core Principles:
 * - Every subagent is a standard, full-featured Pi instance (peer worker).
 * - Single native tool: `subagent` (supports spawn, message/reply, and stop).
 * - Multi-worker concurrency with smart multiplexer pane management (tmux & Zellij).
 * - Non-blocking async dispatch: results and questions delivered as steer events.
 * - Cross-platform: Native Windows (PowerShell + Zellij) & POSIX (bash + tmux/Zellij).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Container, type SelectItem, SelectList, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ChildProcess } from "node:child_process";
import {
  closeSurface,
  createSurface,
  getWorkerBackend,
  isMuxAvailable,
  isProcessSurface,
  pollForExit,
  renderSubagentCommand,
  sendCommand,
  sendLongCommand,
  spawnProcessWorker,
  type WorkerBackend,
} from "./mux.ts";
import { findLastAssistantMessage } from "./session.ts";
import { renderWorkersWidget, type WorkerStatus } from "./ui.ts";

const extensionDir = dirname(fileURLToPath(import.meta.url));

interface RunningWorker {
  id: string;
  name: string;
  task: string;
  surface: string;
  sessionFile: string;
  startTime: number;
  status: "running" | "waiting" | "done" | "error";
  question?: string;
  error?: string;
  abortController: AbortController;
  childProcess?: ChildProcess;
  backend: WorkerBackend;
  logFile?: string;
}

const SubagentParams = Type.Object({
  task: Type.Optional(
    Type.String({
      description:
        "Task or prompt for the worker. For a new worker, describe the complete objective. " +
        "For an existing worker, provide the follow-up instruction or answer to its question.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "Descriptive label for the worker (e.g. 'frontend', 'db-migration', 'tester'). " +
        "Defaults to 'worker-1', 'worker-2', etc. if omitted.",
    }),
  ),
  target: Type.Optional(
    Type.String({
      description:
        "Name of an existing worker to direct this message to (for replying to its question, " +
        "providing additional guidance, or stopping it).",
    }),
  ),
  action: Type.Optional(
    Type.Union(
      [Type.Literal("spawn"), Type.Literal("send"), Type.Literal("stop")],
      {
        description:
          "Action to perform: 'spawn' (start new worker, default), 'send' (steer/reply to worker), 'stop' (kill worker).",
      },
    ),
  ),
  model: Type.Optional(
    Type.String({
      description: "Optional model override for this worker (e.g. a faster or stronger model).",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Optional working directory for the worker.",
    }),
  ),
});

export default function subagentExtension(pi: ExtensionAPI) {
  // Prevent child subagents from self-hosting or infinite recursion
  if (process.env.PI_SUBAGENT_ACTIVE === "1") {
    return;
  }

  // Active workers state
  const activeWorkers = new Map<string, RunningWorker>();
  const reservedNames = new Set<string>();

  let widgetContext: ExtensionContext | undefined;
  let widgetTimer: ReturnType<typeof setInterval> | undefined;

  const refreshWidget = (): void => {
    if (!widgetContext || !widgetContext.hasUI) return;
    const workers: WorkerStatus[] = Array.from(activeWorkers.values()).map((w) => ({
      name: w.name,
      state: w.status,
      startTime: w.startTime,
      sessionFile: w.sessionFile,
      question: w.question,
      error: w.error,
      backend: w.backend,
    }));

    if (workers.length === 0) {
      widgetContext.ui.setWidget("subagents", undefined);
      if (widgetTimer) {
        clearInterval(widgetTimer);
        widgetTimer = undefined;
      }
      return;
    }

    widgetContext.ui.setWidget("subagents", renderWorkersWidget(workers, widgetContext.ui.theme), {
      placement: "aboveEditor",
    });

    if (!widgetTimer) {
      widgetTimer = setInterval(refreshWidget, 1000);
      widgetTimer.unref();
    }
  };

  function allocateUniqueName(preferred?: string): string {
    const base = preferred?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-") || "worker";
    if (!activeWorkers.has(base) && !reservedNames.has(base)) {
      return base;
    }
    let index = 2;
    while (activeWorkers.has(`${base}-${index}`) || reservedNames.has(`${base}-${index}`)) {
      index++;
    }
    return `${base}-${index}`;
  }

  // ── Watcher Loop ──
  async function watchWorker(worker: RunningWorker, signal: AbortSignal): Promise<void> {
    try {
      const result = await pollForExit(worker.surface, signal, {
        interval: 1000,
        sessionFile: worker.sessionFile,
        childProcess: worker.childProcess,
        onTick: () => {
          // Check for .ask question sidecar
          const askFile = `${worker.sessionFile}.ask`;
          if (existsSync(askFile)) {
            try {
              const data = JSON.parse(readFileSync(askFile, "utf-8"));
              if (worker.status !== "waiting" && data.question) {
                worker.status = "waiting";
                worker.question = data.question;
                refreshWidget();

                pi.sendMessage(
                  {
                    customType: "subagent_question",
                    content:
                      `[Subagent "${worker.name}" question]\n\n${data.question}\n\n` +
                      `Reply with subagent({ target: "${worker.name}", task: "Your answer" }).`,
                    display: true,
                    details: {
                      name: worker.name,
                      question: data.question,
                    },
                  },
                  { triggerTurn: true, deliverAs: "steer" },
                );
              }
            } catch {}
          }
        },
      });

      // Worker finished
      const elapsed = Math.floor((Date.now() - worker.startTime) / 1000);
      const summary =
        findLastAssistantMessage(worker.sessionFile) ??
        (result.errorMessage
          ? `Worker failed with error: ${result.errorMessage}`
          : result.exitCode !== 0
            ? `Worker exited with status ${result.exitCode}`
            : "Worker completed without output text.");

      closeSurface(worker.surface, worker.childProcess);
      activeWorkers.delete(worker.name);
      refreshWidget();

      pi.sendMessage(
        {
          customType: "subagent_result",
          content: `[Subagent "${worker.name}" report]\n\n${summary}`,
          display: true,
          details: {
            name: worker.name,
            task: worker.task,
            exitCode: result.exitCode,
            elapsed,
            sessionFile: worker.sessionFile,
            backend: worker.backend,
            logFile: worker.logFile,
          },
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
    } catch (err: any) {
      closeSurface(worker.surface, worker.childProcess);
      activeWorkers.delete(worker.name);
      refreshWidget();

      if (!signal.aborted) {
        pi.sendMessage(
          {
            customType: "subagent_result",
            content: `[Subagent "${worker.name}" stopped unexpectedly]: ${err?.message ?? String(err)}`,
            display: true,
            details: { name: worker.name, error: err?.message, backend: worker.backend },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      }
    }
  }

  // ── Register Tool: subagent ──
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Dispatch, message, or stop an independent, full-powered Pi worker in a split terminal pane. " +
      "Every worker has complete Pi capabilities (read, write, bash, edit, skills, extensions). " +
      "This call is NON-BLOCKING: it returns immediately after launching or messaging. " +
      "When a worker completes or asks a question, results are delivered automatically as steer messages. " +
      "You can launch MULTIPLE parallel workers in a single turn by calling this tool multiple times.",
    promptSnippet:
      "Spawn or communicate with parallel Pi subagent workers. Returns immediately; results arrive automatically via steer.",
    parameters: SubagentParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const action = params.action ?? (params.target ? "send" : "spawn");

      // ── Action: Stop ──
      if (action === "stop") {
        const targetName = params.target || params.name;
        if (!targetName) {
          return {
            content: [{ type: "text", text: "Error: Please specify the worker 'target' or 'name' to stop." }],
            details: { error: "target required" },
          };
        }
        const worker = activeWorkers.get(targetName);
        if (!worker) {
          return {
            content: [{ type: "text", text: `No active worker named "${targetName}".` }],
            details: { error: "worker not found" },
          };
        }

        worker.abortController.abort();
        closeSurface(worker.surface, worker.childProcess);
        activeWorkers.delete(targetName);
        refreshWidget();

        const typeHint = worker.backend === "process" ? "process killed" : "pane closed";
        return {
          content: [{ type: "text", text: `Worker "${targetName}" stopped (${typeHint}).` }],
          details: { status: "stopped", name: targetName },
        };
      }

      // ── Action: Send (Steer / Reply) ──
      if (action === "send" || params.target) {
        const targetName = params.target || params.name;
        if (!targetName) {
          return {
            content: [{ type: "text", text: "Error: Please specify the 'target' worker to send instructions to." }],
            details: { error: "target required" },
          };
        }

        const worker = activeWorkers.get(targetName);
        if (!worker) {
          const known = Array.from(activeWorkers.keys()).join(", ") || "(none)";
          return {
            content: [{ type: "text", text: `No active worker named "${targetName}". Active workers: ${known}.` }],
            details: { error: "worker not found" },
          };
        }

        if (!params.task?.trim()) {
          return {
            content: [{ type: "text", text: "Error: `task` parameter is required when sending a message." }],
            details: { error: "task required" },
          };
        }

        // Deliver via reply file to unblock ask_question tool
        const replyFile = `${worker.sessionFile}.reply`;
        writeFileSync(replyFile, params.task, "utf8");

        // Clear waiting question if answering
        if (worker.status === "waiting") {
          worker.status = "running";
          worker.question = undefined;
          refreshWidget();
        } else if (!isProcessSurface(worker.surface)) {
          // If in mux mode and not waiting on ask_question, also send keys to terminal pane
          const flatMessage = params.task.replace(/\r?\n/g, " ");
          sendCommand(worker.surface, flatMessage);
        }

        return {
          content: [
            {
              type: "text",
              text:
                `Message delivered to worker "${targetName}". It will process the instruction and ` +
                `steer results back when finished.`,
            },
          ],
          details: { status: "message_delivered", name: targetName },
        };
      }

      // ── Action: Spawn (Default) ──
      if (!params.task?.trim()) {
        return {
          content: [{ type: "text", text: "Error: `task` is required to spawn a new subagent worker." }],
          details: { error: "task required" },
        };
      }

      // Determine backend: tmux, zellij, or process (headless)
      const backend = getWorkerBackend();

      // Allocate and reserve name
      const workerName = allocateUniqueName(params.name);
      reservedNames.add(workerName);

      const id = randomUUID().slice(0, 8);
      let surface: string;
      try {
        surface = createSurface(workerName, backend);
      } catch (err: any) {
        reservedNames.delete(workerName);
        return {
          content: [{ type: "text", text: `Failed to create worker surface: ${err.message}` }],
          details: { error: err.message },
        };
      }

      // Prepare session file & log file
      const sessionsDir = join(homedir(), ".pi", "agent", "subagent-sessions");
      mkdirSync(sessionsDir, { recursive: true });
      const sessionFile = join(sessionsDir, `${Date.now()}_${workerName}_${id}.jsonl`);
      const logFile = `${sessionFile}.log`;

      const bridgePath = join(extensionDir, "bridge.ts");
      const parts: string[] = ["pi", "--session", sessionFile, "-e", bridgePath];

      if (params.model) {
        parts.push("--model", params.model);
      }

      // Environment variables passed to worker
      const envPairs: Array<[string, string]> = [
        ["PI_SUBAGENT_ACTIVE", "1"],
        ["PI_SUBAGENT_NAME", workerName],
        ["PI_SUBAGENT_SESSION", sessionFile],
        ["PI_SUBAGENT_SURFACE", surface],
        ["PI_SUBAGENT_BACKEND", backend],
        ["PI_SUBAGENT_PARENT_ID", ctx.sessionManager.getSessionId()],
      ];

      if (process.env.PI_CODING_AGENT_DIR) {
        envPairs.push(["PI_CODING_AGENT_DIR", process.env.PI_CODING_AGENT_DIR]);
      }

      // Deliver task: if long or multiline, write to artifact file
      let taskArg: string;
      if (params.task.length > 300 || params.task.includes("\n")) {
        const artifactsDir = join(homedir(), ".pi", "agent", "artifacts", "subagents");
        mkdirSync(artifactsDir, { recursive: true });
        const taskPath = join(artifactsDir, `${workerName}-${id}.md`);
        writeFileSync(taskPath, params.task, "utf8");
        taskArg = `@${taskPath}`;
      } else {
        taskArg = params.task;
      }
      parts.push(taskArg);

      let childProcess: ChildProcess | undefined;

      if (backend === "process") {
        childProcess = spawnProcessWorker({
          cwd: params.cwd ?? null,
          env: envPairs,
          args: parts,
          logPath: logFile,
        });
      } else {
        const { script } = renderSubagentCommand({
          cwd: params.cwd ?? null,
          env: envPairs,
          args: parts,
        });
        sendLongCommand(surface, script);
      }

      // Track running worker
      const abortController = new AbortController();
      const worker: RunningWorker = {
        id,
        name: workerName,
        task: params.task,
        surface,
        sessionFile,
        startTime: Date.now(),
        status: "running",
        abortController,
        childProcess,
        backend,
        logFile,
      };

      activeWorkers.set(workerName, worker);
      reservedNames.delete(workerName);
      refreshWidget();

      // Start non-blocking watcher in background
      void watchWorker(worker, abortController.signal);

      const modeHint =
        backend === "process"
          ? "running silently in background process"
          : `running in ${backend} split pane`;

      return {
        content: [
          {
            type: "text",
            text:
              `Worker "${workerName}" launched (${modeHint}). ` +
              `Do NOT write polling loops or sleep commands. The harness will deliver results automatically ` +
              `as a steer message when the worker finishes. You can now continue your work or spawn other workers in parallel.`,
          },
        ],
        details: {
          id,
          name: workerName,
          status: "started",
          surface,
          backend,
          logFile: backend === "process" ? logFile : undefined,
        },
      };
    },

    renderCall(args, theme) {
      const partial = args as Record<string, unknown>;
      const action = String(partial.action || (partial.target ? "send" : "spawn"));
      const name = String(partial.target || partial.name || "worker");
      const title = theme.fg("toolTitle", theme.bold(`subagent (${action}) `));
      const targetTag = theme.fg("accent", `[${name}] `);
      const taskPreview = typeof partial.task === "string" ? partial.task.slice(0, 60).replace(/\n/g, " ") : "";
      return new Text(`${title}${targetTag}${theme.fg("muted", taskPreview)}`, 0, 0);
    },
  });

  // ── Register Message Renderers ──
  pi.registerMessageRenderer("subagent_result", (message, options, theme) => {
    const details = (message.details as any) || {};
    const name = details.name || "worker";
    const pad = options?.outputPad ?? 1;
    const box = new Box(pad, 0, (text: string) => {
      try {
        return theme.bg("toolSuccessBg", text);
      } catch {
        return text;
      }
    });
    const title = theme.bold(theme.fg("success", `✔ [Subagent: ${name}] Completed`));
    const meta = details.elapsed ? theme.fg("dim", ` (${details.elapsed}s)`) : "";
    const body = new Text(`${title}${meta}\n\n${message.content}`, 0, 0);
    box.addChild(body);
    return box;
  });

  pi.registerMessageRenderer("subagent_question", (message, options, theme) => {
    const details = (message.details as any) || {};
    const name = details.name || "worker";
    const pad = options?.outputPad ?? 1;
    const box = new Box(pad, 0, (text: string) => {
      try {
        return theme.bg("customMessageBg", text);
      } catch {
        return text;
      }
    });
    const title = theme.bold(theme.fg("warning", `◆ [Subagent: ${name}] Question / Blocked`));
    const body = new Text(`${title}\n\n${message.content}`, 0, 0);
    box.addChild(body);
    return box;
  });

  // ── Register Interactive Command: /subagent ──
  pi.registerCommand("subagent", {
    description: "Manage and inspect active subagent workers",
    handler: async (_args, ctx) => {
      const workers = Array.from(activeWorkers.values());
      if (workers.length === 0) {
        ctx.ui.notify("No active subagent workers currently running.", "info");
        return;
      }

      const items: SelectItem[] = workers.map((w) => ({
        value: w.name,
        label: `${w.name}  [${w.status}]  pane:${w.surface}  task: ${w.task.slice(0, 30)}...`,
      }));

      await ctx.ui.custom<string | undefined>((customTui, theme, _keybindings, done) => {
        const list = new SelectList(items, Math.min(items.length, 10), {
          selectedPrefix: (text) => theme.fg("accent", text),
          selectedText: (text) => theme.fg("accent", text),
          description: (text) => theme.fg("muted", text),
          scrollInfo: (text) => theme.fg("dim", text),
          noMatch: (text) => theme.fg("warning", text),
        });
        list.onSelect = (item) => {
          ctx.ui.notify(`Selected worker: ${item.value}`, "info");
          done(item.value);
        };
        list.onCancel = () => done(undefined);

        const container = new Container();
        container.addChild(new Text(theme.fg("accent", theme.bold("Active Subagents")), 1, 0));
        container.addChild(list);

        return {
          render: (width) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data) => {
            list.handleInput(data);
            customTui.requestRender();
          },
        };
      });
    },
  });

  // ── Session Lifecycle Hooks ──
  pi.on("session_start", (_event, ctx) => {
    widgetContext = ctx;
    refreshWidget();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (widgetTimer) {
      clearInterval(widgetTimer);
      widgetTimer = undefined;
    }
    widgetContext = undefined;
    ctx.ui.setWidget("subagents", undefined);

    // Clean up all active worker panes
    for (const worker of activeWorkers.values()) {
      worker.abortController.abort();
      closeSurface(worker.surface, worker.childProcess);
    }
    activeWorkers.clear();
  });
}
