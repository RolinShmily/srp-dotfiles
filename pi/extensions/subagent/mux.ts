/**
 * subagent/mux.ts — Cross-platform Terminal Multiplexer Layer (tmux & Zellij)
 *
 * Provides:
 * - Surface creation (split pane, tab, or grid layout with scaling for multiple workers)
 * - Cross-platform command rendering (POSIX bash & Windows native PowerShell)
 * - Long command dispatch via wrapper scripts (.sh / .ps1 with UTF-8 BOM)
 * - Screen capture, surface termination, and exit polling
 */

import { type ChildProcess, execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

export type MuxBackend = "tmux" | "zellij";
export type WorkerBackend = "tmux" | "zellij" | "process";

// ── Availability & Detection ──

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    if (process.platform === "win32") {
      execFileSync("where.exe", [command], { stdio: "ignore" });
    } else {
      execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    }
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

export function isTmuxAvailable(): boolean {
  return !!process.env.TMUX && hasCommand("tmux");
}

export function isZellijAvailable(): boolean {
  return !!(process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME) && hasCommand("zellij");
}

export function getMuxBackend(): MuxBackend | null {
  const pref = (process.env.PI_SUBAGENT_MUX ?? "").trim().toLowerCase();
  if (pref === "tmux") return isTmuxAvailable() ? "tmux" : null;
  if (pref === "zellij") return isZellijAvailable() ? "zellij" : null;
  if (isTmuxAvailable()) return "tmux";
  if (isZellijAvailable()) return "zellij";
  return null;
}

export function getWorkerBackend(): WorkerBackend {
  const pref = (process.env.PI_SUBAGENT_BACKEND ?? process.env.PI_SUBAGENT_MUX ?? "").trim().toLowerCase();
  if (pref === "process" || pref === "headless" || pref === "daemon") return "process";
  if (pref === "tmux" && isTmuxAvailable()) return "tmux";
  if (pref === "zellij" && isZellijAvailable()) return "zellij";
  if (isTmuxAvailable()) return "tmux";
  if (isZellijAvailable()) return "zellij";
  return "process";
}

export function getPowerShellCommand(): string {
  if (hasCommand("pwsh")) return "pwsh";
  return "powershell";
}

export function isProcessSurface(surface: string): boolean {
  return surface.startsWith("process:");
}

export function isMuxAvailable(): boolean {
  return getMuxBackend() !== null;
}

export function muxSetupHint(): string {
  if (process.platform === "win32") {
    return "Start pi inside Zellij (`zellij --session pi`, then run `pi`).";
  }
  return "Start pi inside tmux (`tmux new -A -s pi 'pi'`) or Zellij (`zellij --session pi`, then run `pi`).";
}

export function requireMuxBackend(): MuxBackend {
  const backend = getMuxBackend();
  if (!backend) {
    throw new Error(`No supported terminal multiplexer found. ${muxSetupHint()}`);
  }
  return backend;
}

// ── Shell Escaping & Command Rendering ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function psEscape(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

const PS_SAFE_TOKEN = /^[A-Za-z0-9_.:/\\+\-]+$/;
function psToken(s: string): string {
  return s !== "" && PS_SAFE_TOKEN.test(s) ? s : psEscape(s);
}

export interface SubagentCommandSpec {
  cwd: string | null;
  env: Array<[string, string]>;
  args: string[];
}

export function renderSubagentCommand(spec: SubagentCommandSpec, options?: { persistent?: boolean }): {
  script: string;
  scriptExt: ".sh" | ".ps1";
} {
  const renderArgs = (escape: (s: string) => string): string =>
    spec.args.map(escape).join(" ");

  if (process.platform === "win32") {
    const lines: string[] = [
      `$OutputEncoding = [System.Text.Encoding]::UTF8`,
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`,
    ];
    if (spec.cwd) {
      lines.push(
        `try { Set-Location -LiteralPath ${psEscape(spec.cwd)} -ErrorAction Stop } catch { Write-Output '__SUBAGENT_DONE_1__'; exit 1 }`,
      );
    }
    for (const [key, value] of spec.env) {
      lines.push(`$env:${key} = ${psEscape(value)}`);
    }
    lines.push(`& ${renderArgs(psToken)}`);
    lines.push(
      `if ($null -eq $LASTEXITCODE) { Write-Output '__SUBAGENT_DONE_127__' } else { Write-Output "__SUBAGENT_DONE_\${LASTEXITCODE}__" }`,
    );
    return { script: lines.join("\r\n"), scriptExt: ".ps1" };
  }

  const envPrefix = spec.env.map(([key, value]) => `${key}=${shellEscape(value)}`).join(" ");
  const cdPrefix = spec.cwd ? `cd ${shellEscape(spec.cwd)} && ` : "";
  const script = options?.persistent
    ? `${cdPrefix}exec ${envPrefix ? `env ${envPrefix} ` : ""}${renderArgs(shellEscape)}`
    : `${cdPrefix}${envPrefix ? envPrefix + " " : ""}${renderArgs(shellEscape)}; echo '__SUBAGENT_DONE_'$?'__'`;
  return { script, scriptExt: ".sh" };
}

// ── Long Command Execution via Scripts ──

export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const isWin = process.platform === "win32";
  const ext = isWin ? ".ps1" : ".sh";
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `worker-${Date.now()}-${Math.random().toString(16).slice(2, 8)}${ext}`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const isSh = scriptPath.endsWith(".sh");
  const parts: string[] = [];
  if (isSh) parts.push("#!/usr/bin/env bash");
  if (options?.scriptPreamble) parts.push(options.scriptPreamble.trimEnd());
  parts.push(command);

  let content = parts.join(isSh ? "\n" : "\r\n") + "\n";
  if (isSh) {
    content = content.replace(/\r\n/g, "\n");
  } else if (isWin) {
    // Add UTF-8 BOM so PowerShell 5.1/7 parses non-ASCII reliably
    content = "\uFEFF" + content;
  }
  writeFileSync(scriptPath, content, { mode: 0o755 });

  if (isSh) {
    if (isWin) {
      sendCommand(surface, `bash "${scriptPath.replace(/\\/g, "/")}"`);
    } else {
      sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
    }
  } else {
    const ps = getPowerShellCommand();
    sendCommand(
      surface,
      `${ps} -NoProfile -ExecutionPolicy Bypass -Command "& ${psEscape(scriptPath)}; exit $LASTEXITCODE"`,
    );
  }

  return scriptPath;
}

export function sendCommand(surface: string, command: string): void {
  const backend = requireMuxBackend();
  if (backend === "tmux") {
    execFileSync("tmux", ["send-keys", "-t", surface, "-l", command], { encoding: "utf8" });
    execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { encoding: "utf8" });
    return;
  }

  // Zellij: write characters and press return (code 13)
  const paneId = zellijPaneId(surface);
  execFileSync("zellij", ["action", "write-chars", "--pane-id", paneId, command], {
    encoding: "utf8",
  });
  execFileSync("zellij", ["action", "write", "--pane-id", paneId, "13"], { encoding: "utf8" });
}

// ── Zellij Plumbing ──

export function zellijPaneId(surface: string): string {
  return surface.startsWith("pane:") ? surface.slice("pane:".length) : surface;
}

function parseZellijPaneSurface(rawId: string): string {
  const idMatch = rawId.match(/(\d+)/);
  if (!idMatch) {
    throw new Error(`Unexpected zellij pane id: ${rawId || "(empty)"}`);
  }
  return `pane:${idMatch[1]}`;
}

function createZellijSurface(name: string): string {
  // Check available terminal dimensions
  try {
    const stdout = execFileSync("zellij", ["action", "list-clients"], { encoding: "utf8" });
    // Attempt standard right split with no focus
    const args = [
      "action",
      "new-pane",
      "--direction",
      "right",
      "--near-current-pane",
      "--no-focus",
      "--name",
      name,
      "--cwd",
      process.cwd(),
    ];
    const rawId = execFileSync("zellij", args, { encoding: "utf8" }).trim();
    return parseZellijPaneSurface(rawId);
  } catch {
    // Fallback: stacked pane
    const args = [
      "action",
      "new-pane",
      "--stacked",
      "--near-current-pane",
      "--no-focus",
      "--name",
      name,
      "--cwd",
      process.cwd(),
    ];
    const rawId = execFileSync("zellij", args, { encoding: "utf8" }).trim();
    return parseZellijPaneSurface(rawId);
  }
}

// ── tmux Layout & Balancing ──

let rebalanceTimer: ReturnType<typeof setTimeout> | null = null;

function rebalanceTmuxLayout(targetPane?: string): void {
  const target = process.env.TMUX_PANE ?? targetPane;
  if (!target) return;
  if (rebalanceTimer) clearTimeout(rebalanceTimer);

  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    try {
      // Check total panes in the current window
      const countOut = execFileSync(
        "tmux",
        ["list-panes", "-t", target, "-F", "#{pane_id}"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      const paneCount = countOut.split("\n").filter(Boolean).length;

      // <= 3 panes: even-horizontal; > 3 panes: tiled grid so each pane has space
      const layout = paneCount <= 3 ? "even-horizontal" : "tiled";
      execFileSync("tmux", ["select-layout", "-t", target, layout], { encoding: "utf8", stdio: "ignore" });
    } catch {
      // Best effort layout balancing
    }
  }, 100);
}

function createTmuxSurface(name: string): string {
  const parentPane = process.env.TMUX_PANE;

  // Query window width to see if we can safely split horizontally
  let paneCount = 1;
  let windowWidth = 120;
  if (parentPane) {
    try {
      const info = execFileSync(
        "tmux",
        ["display-message", "-p", "-t", parentPane, "#{window_width}:#{window_panes}"],
        { encoding: "utf8" },
      ).trim().split(":");
      windowWidth = parseInt(info[0], 10) || 120;
      paneCount = parseInt(info[1], 10) || 1;
    } catch {}
  }

  // If already overcrowded (> 5 panes or width per pane would be < 35 cols),
  // create a new window in the background to avoid crushing the terminal
  if (paneCount >= 6 || windowWidth / (paneCount + 1) < 35) {
    const out = execFileSync(
      "tmux",
      ["new-window", "-d", "-n", `sub-${name}`, "-c", process.cwd(), "-P", "-F", "#{pane_id}"],
      { encoding: "utf8" },
    ).trim();
    if (out.startsWith("%")) return out;
  }

  // Otherwise, split horizontally to the right of the parent pane
  const splitArgs = ["split-window", "-d", "-h", "-c", process.cwd(), "-P", "-F", "#{pane_id}"];
  if (parentPane) {
    splitArgs.push("-t", parentPane);
  }

  const newPane = execFileSync("tmux", splitArgs, { encoding: "utf8" }).trim();
  if (!newPane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${newPane}`);
  }

  rebalanceTmuxLayout(newPane);
  return newPane;
}

// ── Surface Management (Unified) ──

export function createSurface(name: string, backend?: WorkerBackend): string {
  const effective = backend ?? getWorkerBackend();
  if (effective === "process") {
    return `process:${name}-${Date.now().toString(36)}`;
  }
  if (effective === "zellij") {
    return createZellijSurface(name);
  }
  return createTmuxSurface(name);
}

export function spawnProcessWorker(spec: {
  cwd?: string | null;
  env: Array<[string, string]>;
  args: string[];
  logPath: string;
  useProcessEntrypoint?: boolean;
}): ChildProcess {
  const logFd = openSync(spec.logPath, "a");
  const envObj = {
    ...process.env,
    ...Object.fromEntries(spec.env),
  };

  const rawCommand = spec.args[0] || "pi";
  const userArgs = spec.args.slice(1);

  // On Windows, if process.argv[1] is valid, run Node directly with the script
  // to avoid cmd.exe / shell:true quoting pitfalls and ENOENT on pi.cmd.
  const cliScript = process.argv[1];
  let command = rawCommand;
  let args = userArgs;

  if (spec.useProcessEntrypoint !== false && cliScript && existsSync(cliScript) && (rawCommand === "pi" || rawCommand === process.execPath)) {
    command = process.execPath;
    args = [cliScript, ...userArgs];
  }

  const child = spawn(command, args, {
    cwd: spec.cwd ?? process.cwd(),
    env: envObj,
    stdio: ["ignore", logFd, logFd],
    shell: process.platform === "win32" && command === "pi",
    detached: false,
  });

  child.on("close", () => {
    try {
      closeSync(logFd);
    } catch {}
  });

  return child;
}

export function closeSurface(surface: string, childProcess?: ChildProcess): void {
  if (isProcessSurface(surface)) {
    if (childProcess && childProcess.exitCode === null && !childProcess.killed) {
      if (process.platform === "win32" && childProcess.pid) {
        try {
          execFileSync("taskkill", ["/pid", String(childProcess.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          try {
            childProcess.kill();
          } catch {}
        }
      } else {
        try {
          childProcess.kill("SIGTERM");
          setTimeout(() => {
            if (childProcess.exitCode === null && !childProcess.killed) {
              try {
                childProcess.kill("SIGKILL");
              } catch {}
            }
          }, 1000).unref();
        } catch {}
      }
    }
    return;
  }

  const backend = getMuxBackend();
  if (backend === "zellij") {
    try {
      execFileSync("zellij", ["action", "close-pane", "--pane-id", zellijPaneId(surface)], {
        encoding: "utf8",
        stdio: "ignore",
      });
    } catch {}
    return;
  }

  if (backend === "tmux") {
    try {
      execFileSync("tmux", ["kill-pane", "-t", surface], { encoding: "utf8", stdio: "ignore" });
    } catch {}
    rebalanceTmuxLayout();
  }
}

export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    try {
      const paneId = zellijPaneId(surface);
      const { stdout } = await execFileAsync(
        "zellij",
        ["action", "dump-screen", "--pane-id", paneId, "--full"],
        { encoding: "utf8" },
      );
      const split = stdout.split("\n");
      return split.slice(-lines).join("\n");
    } catch {
      return "";
    }
  }

  try {
    const { stdout } = await execFileAsync(
      "tmux",
      ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
      { encoding: "utf8" },
    );
    return stdout;
  } catch {
    return "";
  }
}

// ── Exit Polling ──

export interface PollResult {
  reason: "done" | "sentinel" | "error";
  exitCode: number;
  errorMessage?: string;
}

export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    childProcess?: ChildProcess;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent worker to finish");
    }

    // 1. Check for .exit sidecar file (written by bridge on completion/error)
    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const raw = readFileSync(exitFile, "utf-8");
          rmSync(exitFile, { force: true });
          const data = JSON.parse(raw);
          if (data?.type === "error") {
            return {
              reason: "error",
              exitCode: 1,
              errorMessage: data.errorMessage || "Worker ended with error",
            };
          }
          return { reason: "done", exitCode: 0 };
        }
      } catch {}
    }

    // 2. If running as a headless child process, check process exit
    if (options.childProcess && options.childProcess.exitCode !== null) {
      const code = options.childProcess.exitCode;
      await new Promise((r) => setTimeout(r, 100));
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const raw = readFileSync(exitFile, "utf-8");
            rmSync(exitFile, { force: true });
            const data = JSON.parse(raw);
            return {
              reason: data?.type === "error" ? "error" : "done",
              exitCode: data?.type === "error" ? 1 : 0,
              errorMessage: data?.errorMessage,
            };
          }
        } catch {}
      }
      return {
        reason: code === 0 ? "done" : "error",
        exitCode: code,
        errorMessage: code !== 0 ? `Process exited with code ${code}` : undefined,
      };
    }

    // 3. Fallback for mux mode: check screen for sentinel output __SUBAGENT_DONE_<code >__
    if (!isProcessSurface(surface)) {
      try {
        const screen = await readScreenAsync(surface, 5);
        const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
        if (match) {
          const code = parseInt(match[1], 10);
          return { reason: "sentinel", exitCode: code };
        }
      } catch {
        // Surface may be destroyed
        if (options.sessionFile) {
          try {
            const exitFile = `${options.sessionFile}.exit`;
            if (existsSync(exitFile)) {
              const raw = readFileSync(exitFile, "utf-8");
              rmSync(exitFile, { force: true });
              const data = JSON.parse(raw);
              return {
                reason: data?.type === "error" ? "error" : "done",
                exitCode: data?.type === "error" ? 1 : 0,
                errorMessage: data?.errorMessage,
              };
            }
          } catch {}
        }
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      let watcher: FSWatcher | undefined;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (watcher) {
          try { watcher.close(); } catch {}
          watcher = undefined;
        }
        resolve();
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (watcher) {
          try { watcher.close(); } catch {}
          watcher = undefined;
        }
        reject(new Error("Aborted"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(done, options.interval);
      if (options.sessionFile) {
        try {
          const dir = dirname(options.sessionFile);
          const target = basename(`${options.sessionFile}.exit`);
          watcher = watch(dir, (_event, filename) => {
            if (filename === target || existsSync(`${options.sessionFile}.exit`)) done();
          });
        } catch {}
      }
    });
  }
}
