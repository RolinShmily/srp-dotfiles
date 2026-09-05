import { spawn } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { ConfiguredModel } from "../config.ts";
import { runCostPath, runResultPath } from "./runs.ts";

/** Path to agent/index.ts relative to spawn directory */
export const AGENT_EXTENSION_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "agent", "index.ts");

export function modelArg(model: ConfiguredModel): string {
  return model.provider && model.id ? `${model.provider}/${model.id}` : (model.id || "");
}

/** Resolve the `pi` entry point, falling back to `pi` on PATH. */
export function resolvePiBinary(): { command: string; baseArgs: string[] } {
  const entry = process.argv[1];
  if (entry) {
    try {
      const realEntry = realpathSync(entry);
      if (/\.(?:mjs|cjs|js|ts)$/i.test(realEntry)) {
        return { command: process.execPath, baseArgs: [realEntry] };
      }
    } catch {
      // fall through
    }
  }
  const fallbackCmd = process.platform === "win32" ? "pi.cmd" : "pi";
  return { command: fallbackCmd, baseArgs: [] };
}

export function buildWorkerArgv(opts: {
  model: ConfiguredModel;
  sessionName: string;
  kickoffPrompt: string;
  agentExtensionPath?: string;
}): string[] {
  const pi = resolvePiBinary();
  const args = [
    ...pi.baseArgs,
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-builtin-tools",
  ];
  if (opts.model.provider) {
    args.push("--provider", opts.model.provider);
  }
  if (opts.model.id) {
    args.push("--model", opts.model.id);
  }
  if (opts.model.thinking) {
    args.push("--thinking", opts.model.thinking);
  }
  args.push("-e", opts.agentExtensionPath ?? AGENT_EXTENSION_PATH);
  args.push("-n", opts.sessionName);
  args.push("-p", opts.kickoffPrompt);
  return [pi.command, ...args];
}

export type WorkerExit = { code: number | null; signal: NodeJS.Signals | null; stderr: string };

/**
 * Spawn a headless worker; resolve when it exits.
 */
export function spawnWorker(opts: {
  argv: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}): Promise<WorkerExit> {
  const [command, ...rest] = opts.argv;
  mkdirSync(opts.cwd, { recursive: true });
  return new Promise<WorkerExit>((resolvePromise) => {
    const isWindowsCmd = process.platform === "win32" && (command.endsWith(".cmd") || command.endsWith(".bat"));
    const proc = spawn(command, rest, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "ignore", "pipe"],
      shell: isWindowsCmd,
    });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer | string) => {
      stderr += d.toString();
    });
    proc.on("error", () => resolvePromise({ code: 1, signal: null, stderr: stderr || "spawn error" }));
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => resolvePromise({ code, signal, stderr }));

    if (opts.signal) {
      const kill = () => {
        proc.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 3000);
        (timer as any).unref?.();
      };
      if (opts.signal.aborted) kill();
      else opts.signal.addEventListener("abort", kill, { once: true });
    }
  });
}

export type ObserverLaunchEnv = {
  /** Absolute `.memory/<sessionId>/` root. */
  memoryRoot: string;
  runId: string;
};

/**
 * Build the env a worker subprocess needs to write its result file.
 */
export function buildWorkerEnv(role: "observer" | "consolidator", opts: ObserverLaunchEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OM_WORKER: role,
    OM_RUN_ID: opts.runId,
    OM_RESULT_PATH: runResultPath(opts.memoryRoot, opts.runId),
    OM_COST_PATH: runCostPath(opts.memoryRoot, opts.runId),
    OM_MEMORY_DIR: opts.memoryRoot,
  };
}
