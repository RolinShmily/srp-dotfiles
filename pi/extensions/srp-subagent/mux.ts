/**
 * srp-subagent/mux.ts — 终端复用器（Terminal Multiplexer）抽象层。
 *
 * 优先且原生支持 Zellij（WSL 环境首选），同时无缝兼容 Tmux。
 * 封装了 Pane 的创建、分屏、堆叠、执行脚本、屏幕读取、按键注入、关闭与退出轮询。
 */

import { execFile, execFileSync, execSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readConfig, type MuxType } from "./config.ts";

const execFileAsync = promisify(execFile);

export type MuxBackend = "zellij" | "tmux";

// ============================ 可用性检测 ============================

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

export function isZellijRuntimeAvailable(): boolean {
  return !!(process.env.ZELLIJ || process.env.ZELLIJ_SESSION_NAME) && hasCommand("zellij");
}

export function isTmuxRuntimeAvailable(): boolean {
  return !!process.env.TMUX && hasCommand("tmux");
}

export function getMuxBackend(preferred?: MuxType): MuxBackend | null {
  const config = readConfig();
  const pref = preferred ?? config.mux;

  if (pref === "zellij") return isZellijRuntimeAvailable() ? "zellij" : null;
  if (pref === "tmux") return isTmuxRuntimeAvailable() ? "tmux" : null;

  // auto: 在 Zellij 会话中优先 Zellij，在 Tmux 会话中优先 Tmux
  if (isZellijRuntimeAvailable()) return "zellij";
  if (isTmuxRuntimeAvailable()) return "tmux";
  return null;
}

export function isMuxAvailable(): boolean {
  return getMuxBackend() !== null;
}

export function muxSetupHint(): string {
  return (
    "请在终端复用器中启动 pi：\n" +
    "  • Zellij: `zellij --session pi`，然后在其中运行 `pi` (推荐 WSL 用户)\n" +
    "  • Tmux:   `tmux new -A -s pi 'pi'`"
  );
}

function requireMuxBackend(): MuxBackend {
  const backend = getMuxBackend();
  if (!backend) {
    throw new Error(`未检测到受支持的终端复用器 (Zellij / Tmux)。\n${muxSetupHint()}`);
  }
  return backend;
}

// ============================ Shell 辅助 ============================

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

export function isFishShell(): boolean {
  const shell = process.env.SHELL ?? "";
  return basename(shell) === "fish";
}

export function exitStatusVar(): string {
  return isFishShell() ? "$status" : "$?";
}

function tailLines(text: string, lines: number): string {
  const split = text.split("\n");
  if (split.length <= lines) return text;
  return split.slice(-lines).join("\n");
}

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// ============================ Zellij 几何与布局算法 ============================

const ZELLIJ_MIN_TERMINAL_WIDTH = 5;
const ZELLIJ_MIN_TERMINAL_HEIGHT = 5;
const ZELLIJ_CURSOR_HEIGHT_WIDTH_RATIO = 4;

export interface ZellijPaneSnapshot {
  id: number;
  is_plugin?: boolean;
  is_floating?: boolean;
  is_selectable?: boolean;
  exited?: boolean;
  pane_rows?: number;
  pane_columns?: number;
  tab_id?: number;
  is_focused?: boolean;
}

export type ZellijSplitDirection = "right";

export type ZellijPlacementPlan =
  | {
      mode: "split";
      anchorPaneId: number;
      targetPaneId: number;
      tabId: number;
      splitDirection: ZellijSplitDirection;
    }
  | { mode: "stack"; anchorPaneId: number; targetPaneId: number; tabId: number };

function paneArea(pane: ZellijPaneSnapshot): number {
  return (pane.pane_rows ?? 0) * (pane.pane_columns ?? 0);
}

function isUsableZellijTiledPane(pane: ZellijPaneSnapshot): boolean {
  return (
    !pane.is_plugin &&
    !pane.is_floating &&
    pane.is_selectable !== false &&
    !pane.exited &&
    typeof pane.pane_rows === "number" &&
    typeof pane.pane_columns === "number"
  );
}

export function predictZellijSplitDirection(pane: ZellijPaneSnapshot): ZellijSplitDirection | null {
  const columns = pane.pane_columns ?? 0;
  const rows = pane.pane_rows ?? 0;
  if (columns < ZELLIJ_MIN_TERMINAL_WIDTH * 2 || rows < ZELLIJ_MIN_TERMINAL_HEIGHT) return null;

  return "right";
}

export function canSplitZellijPane(
  pane: ZellijPaneSnapshot,
  minColumns = ZELLIJ_MIN_TERMINAL_WIDTH,
  minRows = ZELLIJ_MIN_TERMINAL_HEIGHT,
): boolean {
  const columns = pane.pane_columns ?? 0;
  const rows = pane.pane_rows ?? 0;
  return rows >= minRows && Math.floor(columns / 2) >= minColumns;
}

function zellijTabPanesForParent(
  panes: ZellijPaneSnapshot[],
  parentPaneId: number,
): { parentPane: ZellijPaneSnapshot; tabPanes: ZellijPaneSnapshot[] } | null {
  const parentPane = panes.find((pane) => !pane.is_plugin && pane.id === parentPaneId);
  if (!parentPane || typeof parentPane.tab_id !== "number") return null;

  const tabPanes = panes
    .filter((pane) => pane.tab_id === parentPane.tab_id)
    .filter(isUsableZellijTiledPane);

  return { parentPane, tabPanes };
}

export function selectZellijPlacement(
  panes: ZellijPaneSnapshot[],
  parentPaneId: number,
  minColumns: number,
  minRows: number,
): ZellijPlacementPlan | null {
  const tabInfo = zellijTabPanesForParent(panes, parentPaneId);
  if (!tabInfo) return null;

  // 优先检查主会话 Pane 是否可向右分屏
  if (canSplitZellijPane(tabInfo.parentPane, minColumns, minRows)) {
    return {
      mode: "split",
      anchorPaneId: tabInfo.parentPane.id,
      targetPaneId: tabInfo.parentPane.id,
      tabId: tabInfo.parentPane.tab_id!,
      splitDirection: "right",
    };
  }

  // 其次检查同 Tab 下是否有其它非主会话 Pane（如已有的 Subagent）有足够宽度继续向右分屏
  const otherSplitCandidate = tabInfo.tabPanes
    .filter((pane) => pane.id !== parentPaneId && canSplitZellijPane(pane, minColumns, minRows))
    .sort((a, b) => (b.pane_columns ?? 0) - (a.pane_columns ?? 0))[0];

  if (otherSplitCandidate) {
    return {
      mode: "split",
      anchorPaneId: otherSplitCandidate.id,
      targetPaneId: otherSplitCandidate.id,
      tabId: tabInfo.parentPane.tab_id!,
      splitDirection: "right",
    };
  }

  // 水平可用宽度达到瓶颈时，降级为堆叠 (Stack) 模式，优先堆叠在非主会话 Pane（已有 Subagent）上
  const stackTarget =
    tabInfo.tabPanes
      .filter((pane) => pane.id !== parentPaneId)
      .sort((a, b) => paneArea(b) - paneArea(a))[0] ?? tabInfo.parentPane;

  return {
    mode: "stack",
    anchorPaneId: stackTarget.id,
    targetPaneId: stackTarget.id,
    tabId: tabInfo.parentPane.tab_id!,
  };
}

// ============================ Zellij CLI 交互 ============================

function zellijPaneId(surface: string): string {
  return surface.startsWith("pane:") ? surface.slice("pane:".length) : surface;
}

function parseZellijPaneSurface(rawId: string, context: string): string {
  const idMatch = rawId.match(/(\d+)/);
  if (!idMatch) {
    throw new Error(`无法从 ${context} 解析 Zellij pane ID: ${rawId || "(空)"}`);
  }
  return `pane:${idMatch[1]}`;
}

function zellijActionSync(args: string[]): string {
  return execFileSync("zellij", ["action", ...args], {
    encoding: "utf8",
  });
}

async function zellijActionAsync(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("zellij", ["action", ...args], {
    encoding: "utf8",
  });
  return stdout;
}

function readZellijPanes(): ZellijPaneSnapshot[] {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const output = zellijActionSync(["list-panes", "--json", "--geometry", "--state", "--tab"]);
      if (!output.trim()) {
        throw new Error("Zellij list-panes 返回为空");
      }
      const parsed = JSON.parse(output);
      if (!Array.isArray(parsed)) {
        throw new Error("Zellij list-panes 格式异常");
      }
      return parsed as ZellijPaneSnapshot[];
    } catch (error) {
      lastError = error;
      if (attempt < 2) sleepSync(50);
    }
  }
  throw lastError;
}

function zellijSurfaceLockPath(): string {
  const session = (process.env.ZELLIJ_SESSION_NAME ?? process.env.ZELLIJ ?? "default").replace(
    /[^A-Za-z0-9_.-]/g,
    "_",
  );
  return join(tmpdir(), `srp-subagent-zellij-${session}.lock`);
}

function withZellijSurfaceLock<T>(callback: () => T): T {
  const lockPath = zellijSurfaceLockPath();
  const deadline = Date.now() + 10000;

  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, "owner"), `${process.pid}\n`);
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30000) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {}

      if (Date.now() > deadline) {
        throw new Error(`等待 Zellij Surface 锁超时: ${lockPath}`);
      }
      sleepSync(50);
    }
  }

  try {
    return callback();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

function createZellijSurface(name: string): string {
  return withZellijSurfaceLock(() => {
    const config = readConfig();
    const parentPaneIdRaw = process.env.ZELLIJ_PANE_ID;
    const parentPaneId = parentPaneIdRaw ? Number(parentPaneIdRaw) : NaN;

    const plan = Number.isInteger(parentPaneId)
      ? selectZellijPlacement(
          readZellijPanes(),
          parentPaneId,
          config.zellijMinColumns,
          config.zellijMinRows,
        )
      : null;

    if (plan?.mode === "split") {
      const args = [
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
      return parseZellijPaneSurface(zellijActionSync(args).trim(), "new-pane --direction right");
    }

    if (plan?.mode === "stack") {
      const args = [
        "new-pane",
        "--stacked",
        "--near-current-pane",
        "--no-focus",
        "--name",
        name,
        "--cwd",
        process.cwd(),
      ];
      return parseZellijPaneSurface(zellijActionSync(args).trim(), "new-pane --stacked");
    }

    // 默认分屏或创建新 Tab
    try {
      const args = [
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
      return parseZellijPaneSurface(zellijActionSync(args).trim(), "new-pane --direction right");
    } catch {
      // 降级为创建新 Tab
      const tabIdRaw = zellijActionSync(["new-tab", "--name", name, "--cwd", process.cwd()]).trim();
      const tabId = Number(tabIdRaw);
      const panes = readZellijPanes();
      const pane = panes.find(
        (candidate) =>
          candidate.tab_id === tabId &&
          isUsableZellijTiledPane(candidate) &&
          typeof candidate.id === "number",
      );
      if (!pane) {
        throw new Error(`未能找到新建 Zellij Tab ${tabId} 的初始 Pane`);
      }
      return `pane:${pane.id}`;
    }
  });
}

// ============================ Tmux 辅助与均衡算法 ============================

const SUBAGENT_TMUX_LAYOUT = "even-horizontal";
let tmuxRebalanceTimer: ReturnType<typeof setTimeout> | null = null;

function rebalanceTmuxSurfaces(hintPane?: string): void {
  const target = process.env.TMUX_PANE ?? hintPane;
  if (!target) return;
  if (tmuxRebalanceTimer) clearTimeout(tmuxRebalanceTimer);
  tmuxRebalanceTimer = setTimeout(() => {
    tmuxRebalanceTimer = null;
    try {
      execFileSync("tmux", ["select-layout", "-t", target, SUBAGENT_TMUX_LAYOUT], {
        encoding: "utf8",
      });
    } catch {
      // 容错忽略
    }
  }, 120);
}

function createTmuxSurface(name: string): string {
  void name;
  const fromSurface = process.env.TMUX_PANE;
  const args = ["split-window", "-d", "-h"];
  if (fromSurface) {
    args.push("-t", fromSurface);
  }
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Tmux split-window 异常输出: ${pane}`);
  }

  rebalanceTmuxSurfaces(pane);
  return pane;
}

// ============================ 统一 Surface API ============================

/**
 * 为 Subagent 创建专属终端 Pane。
 * Zellij 下返回 `pane:12`，Tmux 下返回 `%12`。
 */
export function createSurface(name: string): string {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    return createZellijSurface(name);
  }
  return createTmuxSurface(name);
}

/**
 * 向 Pane 发送命令并回车提交。
 */
export function sendCommand(surface: string, command: string): void {
  const backend = requireMuxBackend();

  if (backend === "zellij") {
    const paneId = zellijPaneId(surface);
    zellijActionSync(["write-chars", "--pane-id", paneId, command]);
    zellijActionSync(["write", "--pane-id", paneId, "13"]);
    return;
  }

  execFileSync("tmux", ["send-keys", "-t", surface, "-l", command], { encoding: "utf8" });
  execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { encoding: "utf8" });
}

/**
 * 将较长命令写入脚本文件并在目标 Pane 执行，避免终端长字符折行破坏参数。
 */
export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "srp-subagent-scripts",
      `subagent-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) {
    scriptParts.push(options.scriptPreamble.trimEnd());
  }
  scriptParts.push(command);

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", { mode: 0o755 });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/**
 * 向目标 Pane 注入单次 Escape 按键（用于打断当前模型推理轮次）。
 */
export function sendEscape(surface: string): void {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    const paneId = zellijPaneId(surface);
    zellijActionSync(["write", "--pane-id", paneId, "27"]);
    return;
  }
  execFileSync("tmux", ["send-keys", "-t", surface, "Escape"], { encoding: "utf8" });
}

/**
 * 同步读取 Pane 终端屏幕输出。
 */
export function readScreen(surface: string, lines = 50): string {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    const paneId = zellijPaneId(surface);
    const raw = execFileSync("zellij", ["action", "dump-screen", "--pane-id", paneId], {
      encoding: "utf8",
    });
    return tailLines(raw, lines);
  }

  return execFileSync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
}

/**
 * 异步读取 Pane 终端屏幕输出。
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    const paneId = zellijPaneId(surface);
    const { stdout } = await execFileAsync(
      "zellij",
      ["action", "dump-screen", "--pane-id", paneId],
      { encoding: "utf8" },
    );
    return tailLines(stdout, lines);
  }

  const { stdout } = await execFileAsync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
  return stdout;
}

/**
 * 重命名指定 Pane。
 */
export function renamePane(surface: string, name: string): void {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    const paneId = zellijPaneId(surface);
    try {
      zellijActionSync(["rename-pane", "--pane-id", paneId, name]);
    } catch {}
    return;
  }
}

/**
 * 关闭指定 Pane 并清理布局。
 */
export function closeSurface(surface: string): void {
  const backend = requireMuxBackend();
  if (backend === "zellij") {
    const paneId = zellijPaneId(surface);
    try {
      zellijActionSync(["close-pane", "--pane-id", paneId]);
    } catch {}
    return;
  }

  try {
    execFileSync("tmux", ["kill-pane", "-t", surface], { encoding: "utf8" });
    rebalanceTmuxSurfaces();
  } catch {}
}

// ============================ 退出轮询机制 ============================

export interface PollResult {
  reason: "done" | "sentinel" | "error";
  exitCode: number;
  errorMessage?: string;
}

function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent 异常退出 (stopReason=error)";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

/**
 * 轮询等待 Subagent 执行结束。
 * 1. 优先检测 `.exit` 状态文件；
 * 2. 其次读取终端屏幕捕获 `__SUBAGENT_DONE_<code>__` 标志；
 * 3. 周期性调用 `onTick(elapsed)` 刷新状态监控。
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) {
      throw new Error("等待 Subagent 完成已被取消");
    }

    // 1. 检查 .exit 边车文件
    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf-8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    // 2. 检查 Claude 哨兵文件
    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    // 3. 读取终端屏幕捕获完成哨兵
    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch {
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
