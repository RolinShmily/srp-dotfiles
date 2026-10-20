import { execFileSync, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  closeSurface,
  createSurface,
  getMuxBackend,
  pollForExit,
  readScreenAsync,
  renderSubagentCommand,
  sendLongCommand,
  spawnProcessWorker,
  type WorkerBackend,
} from "../subagent/mux.ts";
import { findLastAssistantMessage, readSessionUsage } from "../subagent/session.ts";
import { HARNESSES } from "./harnesses.mjs";
import { interactiveArgs } from "./tui-harnesses.mjs";
import {
  collectEvidence,
  createWorktrees,
  inspectRepository,
  writePrompt,
  type Experiment,
  type ExperimentRoute,
} from "./core.ts";

const MAX_MINUTES = 30;
const DEFAULT_MINUTES = 15;
const extensionDir = dirname(fileURLToPath(import.meta.url));
const workerBridgePath = join(extensionDir, "worker-bridge.ts");
const harnessRunnerPath = join(extensionDir, "harness-runner.mjs");
const turnHookPath = join(extensionDir, "turn-hook.mjs");
const studioDoneScript = join(extensionDir, "studio-done.mjs");

async function setupStudioBin(experimentDir: string): Promise<string> {
  const binDir = join(experimentDir, "bin");
  await mkdir(binDir, { recursive: true });
  const scriptPath = join(binDir, "studio-done");
  const psPath = join(binDir, "studio-done.ps1");
  const cmdPath = join(binDir, "studio-done.cmd");
  const shContent = `#!/usr/bin/env sh\nexec "${process.execPath}" "${studioDoneScript}" "$@"\n`;
  const psContent = `& "${process.execPath}" "${studioDoneScript}" $args\n`;
  const cmdContent = `@call "${process.execPath}" "${studioDoneScript}" %*\n`;
  await writeFile(scriptPath, shContent, { mode: 0o755 });
  await writeFile(psPath, psContent, { mode: 0o755 });
  await writeFile(cmdPath, cmdContent, { mode: 0o755 });
  return binDir;
}

interface RouteResult {
  route: ExperimentRoute;
  status: "completed" | "failed" | "timed_out" | "stopped";
  exitCode: number | null;
  summary: string;
  backend: WorkerBackend;
  surface?: string;
  screenFile?: string;
  error?: string;
}

interface ActiveRun {
  experiment: Experiment;
  stopped: boolean;
  shuttingDown: boolean;
  controller: AbortController;
  activeSurfaces: Map<string, string>;
  retainedSurfaces: Map<string, string>;
  busyRoutes: Map<string, AbortController>;
  paneWatchers: Map<string, ReturnType<typeof setInterval>>;
  results: RouteResult[];
  followups: Array<{ route: string; taskFile: string; status: RouteResult["status"]; summary: string; at: string }>;
  done: boolean;
}

const Params = Type.Object({
  action: Type.Optional(Type.Union([Type.Literal("start"), Type.Literal("status"), Type.Literal("send"), Type.Literal("stop"), Type.Literal("close")], {
    description: "Start a two-route experiment (default), inspect status, send a follow-up to an existing native TUI, stop running workers, or close idle TUIs. Worktrees and files are preserved.",
  })),
  runId: Type.Optional(Type.String({ description: "Experiment ID for status, send, or close. Defaults to the latest experiment in this session." })),
  route: Type.Optional(Type.Union([Type.Literal("route-a"), Type.Literal("route-b")], { description: "Which existing route receives a follow-up task (or is stopped)." })),
  task: Type.Optional(Type.String({ description: "Follow-up task for action=send, delivered to the same running TUI session." })),
  goal: Type.Optional(Type.String({ description: "The user goal and concrete success criteria for both alternatives." })),
  routes: Type.Optional(Type.Array(Type.Object({
    name: Type.String({ description: "Short name for this approach." }),
    approach: Type.String({ description: "Specific, meaningfully different approach to test." }),
  }), { minItems: 2, maxItems: 2, description: "Exactly two alternative approaches to the same goal." })),
  maxMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: MAX_MINUTES, description: "Wait time for the initial turn or follow-up, default 15 minutes. In mux mode, an idle native TUI remains open after the turn completes." })),
});

type QuestionDetails = {
  status?: "answered" | "cancelled" | "unavailable";
  answers?: Array<{ value: string }>;
};

async function ask(ctx: ExtensionToolContext, question: string, options: Array<{ label: string; value: string; description?: string }>, signal?: AbortSignal): Promise<string | undefined> {
  if (!ctx.hasUI || !ctx.tools.some((tool) => tool.name === "ask_user_question")) {
    throw new Error("探索必须先得到用户确认：请在有交互 UI 且已加载 ask_user_question 的 Pi 会话中运行。");
  }
  const result = await ctx.executeTool("ask_user_question", { question, options }, { signal });
  if (result.isError) throw new Error("ask_user_question 执行失败，未创建 worktree。");
  const details = result.result.details as QuestionDetails | undefined;
  if (details?.status === "cancelled") return undefined;
  if (details?.status !== "answered") throw new Error("用户确认不可用，未创建 worktree。");
  return details.answers?.[0]?.value;
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readLogTail(path: string): Promise<string> {
  try {
    const file = await open(path, "r");
    try {
      const { size } = await file.stat();
      const length = Math.min(size, 8000);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, size - length);
      return buffer.toString("utf8", 0, bytesRead);
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "(worker log was not created)";
    throw new Error(`读取 worker 日志失败：${path}`, { cause: error });
  }
}

function toolMessage(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text" as const, text }], details };
}

async function selectHarnesses(ctx: ExtensionToolContext, signal?: AbortSignal): Promise<[string, string] | undefined> {
  if (!ctx.hasUI || !ctx.tools.some((tool) => tool.name === "ask_user_question")) {
    throw new Error("Harness selection requires an interactive ask_user_question dialog.");
  }
  const selected = await ctx.executeTool("ask_user_question", {
    question: "确认两条探索路线分配 codex 与 claude",
    details: "静态支持的 CLI harness 为 codex 与 claude。只检查选中的命令，不扫描本机其他程序。",
    options: [
      { label: "路线 A: codex, 路线 B: claude（推荐）", value: "codex_claude", description: "路线 A 使用 OpenAI Codex CLI，路线 B 使用 Claude Code。" },
      { label: "路线 A: claude, 路线 B: codex", value: "claude_codex", description: "路线 A 使用 Claude Code，路线 B 使用 OpenAI Codex CLI。" },
    ],
  }, { signal });
  if (selected.isError) throw new Error("Could not select harnesses; no worktrees were created.");
  const details = selected.result.details as QuestionDetails | undefined;
  if (details?.status === "cancelled") return undefined;
  if (details?.status !== "answered") throw new Error("Harness selection is unavailable; no worktrees were created.");
  const choice = details.answers?.[0]?.value;
  const harnesses: [string, string] = choice === "claude_codex" ? ["claude", "codex"] : ["codex", "claude"];
  for (const harness of harnesses) {
    const check = spawnSync(harness, ["--version"], { encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 10000 });
    if (check.error || check.status !== 0) throw new Error(`Selected harness ${harness} is unavailable. Install and authenticate it before retrying.`);
  }
  return harnesses;
}

async function selectModels(ctx: ExtensionToolContext, signal?: AbortSignal): Promise<[string, string] | undefined> {
  const models = ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`);
  const available = [...new Set(models)].sort();
  if (available.length === 0) throw new Error("Pi 没有已配置认证的聊天模型，无法启动探索。");
  const different = await ask(ctx, "两个探索路线是否使用不同的 Pi 模型？", [
    { label: "使用同一模型（推荐）", value: "same", description: "先比较方案本身，减少模型差异和决策成本。" },
    { label: "使用不同模型", value: "different" },
  ], signal);
  if (!different) return undefined;
  const current = ctx.model && `${ctx.model.provider}/${ctx.model.id}`;
  if (different === "same" && current && available.includes(current)) return [current, current];
  const options = available.map((value) => ({ label: value, value }));
  const first = await ask(ctx, different === "same" ? "请选择两条路线共用的 Pi 模型" : "请选择路线 A 使用的 Pi 模型", options, signal);
  if (!first) return undefined;
  if (!available.includes(first)) throw new Error("模型不在当前可用模型列表中，未创建 worktree。");
  if (different === "same") return [first, first];
  const second = await ask(ctx, "请选择路线 B 使用的 Pi 模型", options.filter((option) => option.value !== first), signal);
  if (!second) return undefined;
  if (!available.includes(second) || first === second) throw new Error("必须选择两个不同的可用模型。");
  return [first, second];
}

function makeExperiment(repository: string, baseline: string, goal: string, proposals: Array<{ name: string; approach: string }>, selection: { mode: "pi" | "multi-harness"; values: [string, string] }): Experiment {
  const id = randomUUID();
  const directory = join(homedir(), ".pi", "agent", "worktree-studio", id);
  const routes = proposals.map((proposal, index): ExperimentRoute => {
    const name = index === 0 ? "route-a" : "route-b";
    return {
      name,
      approach: `${proposal.name}: ${proposal.approach}`,
      model: selection.mode === "pi" ? selection.values[index] : "harness default",
      harness: selection.mode === "pi" ? "pi" : selection.values[index],
      harnessSessionId: selection.mode === "multi-harness" && selection.values[index] === "claude" ? randomUUID() : undefined,
      directory: join(directory, name),
      sessionFile: join(directory, `${name}.jsonl`),
      logFile: join(directory, `${name}.log`),
      promptFile: join(directory, `${name}.prompt.md`),
    };
  }) as [ExperimentRoute, ExperimentRoute];
  return { id, directory, repository, baseline, goal, mode: selection.mode, routes };
}

async function writeManifest(run: ActiveRun): Promise<void> {
  await writeFile(join(run.experiment.directory, "manifest.json"), JSON.stringify({
    ...run.experiment,
    stopped: run.stopped,
    done: run.done,
    activeSurfaces: Object.fromEntries(run.activeSurfaces),
    retainedSurfaces: Object.fromEntries(run.retainedSurfaces),
    busyRoutes: [...run.busyRoutes.keys()],
    followups: run.followups,
    results: run.results.map(({ route, status, exitCode, backend, surface, screenFile, error }) => ({ route: route.name, status, exitCode, backend, surface, screenFile, error })),
  }, null, 2), "utf8");
}

function nativeTuiAlive(surface: string, backend: WorkerBackend): boolean {
  if (backend !== "tmux") return true; // Zellij process introspection is unavailable here; rely on the shell sentinel.
  try {
    const state = execFileSync("tmux", ["display-message", "-p", "-t", surface, "#{pane_dead}:#{pane_current_command}"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
    }).trim();
    const [dead, command] = state.split(":");
    return dead !== "1" && !["bash", "zsh", "sh", "fish", "pwsh", "powershell"].includes(command?.toLowerCase());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return false; // The pane is absent or tmux is no longer reachable.
  }
}

function chooseBackend(): WorkerBackend {
  const preference = process.env.PI_WORKTREE_STUDIO_BACKEND;
  if (preference && preference !== "process") throw new Error("PI_WORKTREE_STUDIO_BACKEND 目前只接受 process（强制静默运行）。");
  return preference === "process" ? "process" : (getMuxBackend() ?? "process");
}

function awaitExit(child: ChildProcess, timeoutMs: number, signal: AbortSignal): Promise<{ status: RouteResult["status"]; exitCode: number | null; error?: string }> {
  return new Promise((resolve) => {
    let finished = false;
    let timedOut = false;
    let spawnError: string | undefined;
    const surface = `process:studio-${child.pid ?? "pending"}`;
    const timer = setTimeout(() => {
      timedOut = true;
      closeSurface(surface, child);
      // A process that ignores termination must not hold the experiment forever.
      settle({ status: "timed_out", exitCode: null, error: `Worker exceeded ${Math.round(timeoutMs / 60000)} minutes.` });
    }, timeoutMs);
    function onAbort() {
      closeSurface(surface, child);
      settle({ status: "stopped", exitCode: null });
    }
    function settle(value: { status: RouteResult["status"]; exitCode: number | null; error?: string }) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    child.once("error", (error) => { spawnError = error.message; });
    child.once("close", (code) => {
      settle({
        status: timedOut ? "timed_out" : spawnError || code !== 0 ? "failed" : "completed",
        exitCode: code,
        error: spawnError ?? (code !== 0 ? `Process exited with code ${code}` : undefined),
      });
    });
  });
}

async function runRoute(run: ActiveRun, route: ExperimentRoute, minutes: number, trusted: boolean, backend: WorkerBackend): Promise<RouteResult> {
  const external = route.harness && route.harness !== "pi";
  const interactive = backend !== "process";
  const resultFile = `${route.sessionFile}.result.md`;
  const runnerConfig = `${route.sessionFile}.runner.json`;
  let outcome: Awaited<ReturnType<typeof awaitExit>>;
  let surface: string | undefined;
  let screenFile: string | undefined;
  let surfaceClosed = false;
  let cliExited = false;
  let captureError: string | undefined;
  const closePane = () => {
    if (!surface || surfaceClosed) return;
    surfaceClosed = true;
    closeSurface(surface);
  };
  const binDir = join(run.experiment.directory, "bin");
  const studioEnv: Array<[string, string]> = [
    ["PI_SUBAGENT_ACTIVE", "1"],
    ["PI_WORKTREE_STUDIO_WORKER", "1"],
    ["PI_WORKTREE_STUDIO_EXIT_FILE", `${route.sessionFile}.exit`],
    ["PATH", `${binDir}${delimiter}${process.env.PATH || ""}`],
    ...(process.env.PI_CODING_AGENT_DIR ? [["PI_CODING_AGENT_DIR", process.env.PI_CODING_AGENT_DIR] as [string, string]] : []),
  ];
  try {
    if (external && !interactive) {
      writeFileSync(runnerConfig, JSON.stringify({
        harness: route.harness,
        directory: route.directory,
        promptFile: route.promptFile,
        resultFile,
        eventsFile: `${route.sessionFile}.events.jsonl`,
        stderrFile: `${route.sessionFile}.stderr.log`,
        metadataFile: `${route.sessionFile}.metadata.json`,
        exitFile: `${route.sessionFile}.exit`,
      }), "utf8");
    }
    if (backend === "process") {
      const child = spawnProcessWorker({
        cwd: route.directory,
        args: external
          ? [process.execPath, harnessRunnerPath, runnerConfig]
          : ["pi", "--print", trusted ? "--approve" : "--no-approve", "--session", route.sessionFile, "--model", route.model, `@${route.promptFile}`],
        env: studioEnv,
        logPath: route.logFile,
        useProcessEntrypoint: !external,
      });
      outcome = await awaitExit(child, minutes * 60_000, run.controller.signal);
    } else {
      surface = createSurface(route.name, backend);
      run.activeSurfaces.set(route.name, surface);
      const { script, scriptExt } = renderSubagentCommand({
        cwd: route.directory,
        env: studioEnv,
        args: external
          ? interactiveArgs({ harness: route.harness, directory: route.directory, prompt: readFileSync(route.promptFile, "utf8"), hookPath: turnHookPath, exitFile: `${route.sessionFile}.exit`, sessionId: route.harnessSessionId })
          : ["pi", "--tui-mode", "regular", trusted ? "--approve" : "--no-approve", "--session", route.sessionFile, "-e", workerBridgePath, "--model", route.model, `@${route.promptFile}`],
      }, { persistent: true });
      sendLongCommand(surface, script, { scriptPath: join(run.experiment.directory, `${route.name}${scriptExt}`) });
      const controller = new AbortController();
      let timedOut = false;
      const onStop = () => {
        closePane();
        controller.abort();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, minutes * 60_000);
      run.controller.signal.addEventListener("abort", onStop, { once: true });
      if (run.controller.signal.aborted) onStop();
      try {
        const exited = await pollForExit(surface, controller.signal, {
          interval: 1000, sessionFile: route.sessionFile,
          onTick(elapsed) {
            if (elapsed >= 5 && !nativeTuiAlive(surface!, backend)) {
              cliExited = true;
              controller.abort();
            }
          },
        });
        outcome = { status: exited.exitCode === 0 ? "completed" : "failed", exitCode: exited.exitCode, error: exited.errorMessage };
        if (exited.reason === "sentinel") {
          cliExited = true;
          outcome.error = outcome.error ?? "The interactive CLI exited before the turn completion hook fired.";
          outcome.status = "failed";
        }
      } catch (error) {
        outcome = { status: run.stopped ? "stopped" : timedOut ? "timed_out" : "failed", exitCode: null, error: run.stopped ? undefined : cliExited ? "Interactive CLI exited without a turn completion signal." : displayError(error) };
      } finally {
        clearTimeout(timer);
        run.controller.signal.removeEventListener("abort", onStop);
      }
    }
  } catch (error) {
    outcome = { status: run.stopped ? "stopped" : "failed", exitCode: null, error: displayError(error) };
  } finally {
    if (surface && !surfaceClosed) {
      try {
        const screen = await readScreenAsync(surface, 100);
        if (screen.trim()) {
          const path = `${route.sessionFile}.screen.log`;
          await writeFile(path, `${screen}\n`, "utf8");
          screenFile = path;
        }
      } catch (error) {
        captureError = `Could not save the pane output: ${displayError(error)}`;
      }
    }
    if (!interactive || run.stopped || cliExited || surfaceClosed) closePane();
    else if (surface) run.retainedSurfaces.set(route.name, surface);
    run.activeSurfaces.delete(route.name);
  }
  if (captureError) outcome.error = [outcome.error, captureError].filter(Boolean).join("; ");
  let externalSummary: string | undefined;
  if (external) {
    try {
      if (interactive) {
        const turn = JSON.parse(readFileSync(`${route.sessionFile}.turn.json`, "utf8"));
        externalSummary = typeof turn.summary === "string" ? turn.summary.slice(-8000) : undefined;
      } else {
        externalSummary = readFileSync(resultFile, "utf8").slice(-8000);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Could not read harness turn: ${route.sessionFile}`, { cause: error });
    }
  }
  const summary = (external ? externalSummary : findLastAssistantMessage(route.sessionFile)?.slice(-8000))
    ?? (backend === "process" ? await readLogTail(route.logFile) : `No structured final answer; ${screenFile ? `inspect the captured TUI at ${screenFile}` : outcome.error ?? "no screen output was captured"}.`);
  const result: RouteResult = {
    route,
    status: run.stopped ? "stopped" : outcome.status,
    exitCode: outcome.exitCode,
    summary,
    backend,
    surface,
    screenFile,
    error: outcome.error,
  };
  run.results.push(result);
  await writeManifest(run);
  return result;
}

function watchNativePane(run: ActiveRun, route: ExperimentRoute, backend: WorkerBackend, pi: ExtensionAPI): void {
  const surface = run.retainedSurfaces.get(route.name);
  if (!surface || run.paneWatchers.has(route.name)) return;
  const timer = setInterval(async () => {
    try {
      const exited = backend === "tmux"
        ? !nativeTuiAlive(surface, backend)
        : /__SUBAGENT_DONE_\d+__/.test(await readScreenAsync(surface, 8));
      if (!exited || run.retainedSurfaces.get(route.name) !== surface) return;
      clearInterval(timer);
      run.paneWatchers.delete(route.name);
      run.retainedSurfaces.delete(route.name);
      closeSurface(surface); // Never leave an inert shell pane after the native CLI exits.
      await writeManifest(run);
      if (!run.shuttingDown) pi.sendMessage({ customType: "worktree_studio_result", content: `The ${route.harness ?? "pi"} TUI for ${route.name} exited. Its pane was closed; worktree, report, and logs remain at ${run.experiment.directory}.`, display: true, details: { id: run.experiment.id, route: route.name } }, { triggerTurn: true, deliverAs: "steer" });
    } catch (error) {
      clearInterval(timer);
      run.paneWatchers.delete(route.name);
      console.error(`Could not monitor Studio pane ${surface}: ${displayError(error)}`);
    }
  }, 1000);
  timer.unref();
  run.paneWatchers.set(route.name, timer);
}

async function waitForAck(file: string, id: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const ack = JSON.parse(readFileSync(file, "utf8"));
      if (ack.id === id) {
        rmSync(file, { force: true });
        if (ack.status !== "ok") throw new Error(ack.error ?? "Pi worker rejected follow-up task.");
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Pi worker did not acknowledge follow-up within five seconds: ${file}`);
}

async function dispatchToTui(route: ExperimentRoute, surface: string, backend: WorkerBackend, task: string, id: string): Promise<void> {
  if (route.harness === "pi") {
    const inbox = `${route.sessionFile}.inbox`;
    const tmp = `${inbox}.${id}.tmp`;
    rmSync(`${route.sessionFile}.ack`, { force: true });
    writeFileSync(tmp, JSON.stringify({ id, task }), { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, inbox);
    await waitForAck(`${route.sessionFile}.ack`, id);
    return;
  }
  if (route.harness === "codex") {
    let sessionId: string | undefined;
    try {
      const metadata = JSON.parse(readFileSync(`${route.sessionFile}.metadata.json`, "utf8"));
      sessionId = metadata.sessionId;
    } catch {}
    if (sessionId) {
      try {
        execFileSync("codex", ["queue", "--thread", sessionId, "--message", `[Studio dispatch ${id}]\n${task}`], {
          cwd: route.directory, encoding: "utf8", timeout: 10000, windowsHide: true,
        });
        return;
      } catch {}
    }
    if (backend === "tmux") {
      if (!nativeTuiAlive(surface, backend)) throw new Error("Codex TUI has exited; refusing to paste into a shell.");
      const file = `${route.sessionFile}.dispatch-${id}.txt`;
      const buffer = `pi-studio-${id}`;
      writeFileSync(file, `[Studio dispatch ${id}]\n${task}`, { encoding: "utf8", mode: 0o600 });
      execFileSync("tmux", ["load-buffer", "-b", buffer, file], { stdio: "ignore", timeout: 2000 });
      execFileSync("tmux", ["paste-buffer", "-p", "-d", "-b", buffer, "-t", surface], { stdio: "ignore", timeout: 2000 });
      execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { stdio: "ignore", timeout: 2000 });
      return;
    }
    throw new Error("Codex TUI follow-up requires either a reported thread ID or a tmux surface.");
  }
  if (route.harness === "claude" && backend === "tmux") {
    const stateFile = `${route.sessionFile}.state.json`;
    if (existsSync(stateFile) && JSON.parse(readFileSync(stateFile, "utf8")).status !== "idle") {
      throw new Error("Claude TUI is processing another prompt. Wait until it becomes idle before sending a follow-up.");
    }
    if (!nativeTuiAlive(surface, backend)) throw new Error("Claude TUI has exited; refusing to paste into a shell.");
    const file = `${route.sessionFile}.dispatch-${id}.txt`;
    const buffer = `pi-studio-${id}`;
    writeFileSync(file, `[Studio dispatch ${id}]\n${task}`, { encoding: "utf8", mode: 0o600 });
    execFileSync("tmux", ["load-buffer", "-b", buffer, file], { stdio: "ignore", timeout: 2000 });
    execFileSync("tmux", ["paste-buffer", "-p", "-d", "-b", buffer, "-t", surface], { stdio: "ignore", timeout: 2000 });
    execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { stdio: "ignore", timeout: 2000 });
    return;
  }
  throw new Error(`Automatic follow-up for ${route.harness} requires a supported native TUI (Claude requires tmux).`);
}

async function renderReport(run: ActiveRun, results: RouteResult[]): Promise<string> {
  const { experiment } = run;
  const sections = [
    `# The Road Not Taken — ${experiment.id}`,
    `Goal: ${experiment.goal}`,
    `Repository: ${experiment.repository}`,
    `Baseline: ${experiment.baseline}`,
    "These are independent alternatives. No changes were applied to the original worktree; no winner was automatically selected.",
  ];
  for (const result of results) {
    const { route } = result;
    const paneStatus = result.surface ? (run.retainedSurfaces.get(route.name) === result.surface ? "retained until explicitly closed" : "closed") : "";
    sections.push(`\n## ${route.name}: ${route.approach}`, `Harness: ${route.harness ?? "pi"}`, `Model: ${route.model}`, `Status: ${result.status} (exit ${result.exitCode ?? "unknown"})`, `Backend: ${result.backend}${result.surface ? ` (pane ${result.surface}; ${paneStatus})` : ""}`, `Worktree: ${route.directory}`);
    if (route.harness && route.harness !== "pi") {
      if (result.backend === "process") sections.push(`Result: ${route.sessionFile}.result.md`, `Event log: ${route.sessionFile}.events.jsonl`, `Harness stderr: ${route.sessionFile}.stderr.log`);
      else sections.push(`Turn record: ${route.sessionFile}.turn.json`, "Full conversation and tool interactions remain visible in the native TUI while it is running.");
    } else {
      sections.push(`Session: ${route.sessionFile}`);
    }
    sections.push(`${result.backend === "process" ? "Console log" : "Pane capture"}: ${result.backend === "process" ? route.logFile : (result.screenFile ?? "(no pane output captured)")}`);
    if (result.error) sections.push(`Process error: ${result.error}`);
    const usage = route.harness && route.harness !== "pi" ? undefined : readSessionUsage(route.sessionFile);
    if (usage) sections.push(`Usage: ${usage.input + usage.output} tokens (excluding cached tokens), provider-reported cost ${usage.cost} (zero may mean pricing is unavailable, not free)`);
    if (route.harness && route.harness !== "pi") {
      try {
        const metadata = JSON.parse(readFileSync(`${route.sessionFile}.metadata.json`, "utf8"));
        if (metadata.model) sections.push(`Reported model: ${metadata.model}`);
        if (metadata.sessionId) sections.push(`Harness session ID: ${metadata.sessionId}`);
        if (metadata.usage) sections.push(`Provider-reported usage: ${JSON.stringify(metadata.usage)}`);
        sections.push(`Provider-reported cost: ${typeof metadata.costUSD === "number" ? `$${metadata.costUSD.toFixed(4)}` : "not available (not necessarily free)"}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") sections.push(`Usage metadata unavailable: ${displayError(error)}`);
      }
    }
    try {
      const evidence = await collectEvidence(experiment, route);
      sections.push(`HEAD: ${evidence.head}${evidence.head === experiment.baseline ? "" : " (worker created commits; inspect before reuse)"}`, `Diff: ${evidence.diffFile}`, `Tracked diff stat:\n\`\`\`\n${evidence.diffStat || "(none)"}\n\`\`\``, `Git status:\n\`\`\`\n${evidence.status || "(clean)"}\n\`\`\``, `Untracked files (not included in the diff): ${evidence.untracked.length ? evidence.untracked.join(", ") : "(none)"}`);
    } catch (error) {
      sections.push(`Git evidence unavailable: ${displayError(error)}`);
    }
    sections.push(`Worker conclusion (unverified):\n${result.summary || "(no final answer)"}`);
  }
  for (const followup of run.followups) {
    sections.push(`\n## Follow-up to ${followup.route} (${followup.at})`, `Task: ${followup.taskFile}`, `Status: ${followup.status}`, `Worker conclusion (unverified):\n${followup.summary}`);
  }
  const reportPath = join(experiment.directory, "report.md");
  await writeFile(reportPath, `${sections.join("\n\n")}\n`, "utf8");
  return reportPath;
}

export default function worktreeStudio(pi: ExtensionAPI) {
  if (process.env.PI_WORKTREE_STUDIO_WORKER === "1") return;
  let active: ActiveRun | undefined;
  const runs = new Map<string, ActiveRun>();
  let lastReport: string | undefined;
  let preparing = false;

  function getRun(runId?: string): ActiveRun | undefined {
    if (runId && runs.has(runId)) return runs.get(runId);
    if (!runId && active) return active;
    const targetId = runId ?? active?.experiment.id;
    if (!targetId) return undefined;
    const manifestPath = join(homedir(), ".pi", "agent", "worktree-studio", targetId, "manifest.json");
    if (!existsSync(manifestPath)) return undefined;
    try {
      const data = JSON.parse(readFileSync(manifestPath, "utf8"));
      const experiment: Experiment = {
        id: data.id,
        repository: data.repository,
        baseline: data.baseline,
        goal: data.goal,
        mode: data.mode,
        directory: data.directory,
        routes: data.routes,
      };
      const loaded: ActiveRun = {
        experiment,
        stopped: data.stopped ?? false,
        shuttingDown: false,
        controller: new AbortController(),
        activeSurfaces: new Map(Object.entries(data.activeSurfaces ?? {})),
        retainedSurfaces: new Map(Object.entries(data.retainedSurfaces ?? {})),
        busyRoutes: new Map(),
        paneWatchers: new Map(),
        done: data.done ?? true,
        results: (data.results ?? []).map((r: any) => ({
          ...r,
          route: experiment.routes.find((cand) => cand.name === r.route) ?? experiment.routes[0],
        })),
        followups: data.followups ?? [],
      };
      runs.set(targetId, loaded);
      if (!active) active = loaded;
      return loaded;
    } catch {
      return undefined;
    }
  }

  pi.registerTool({
    name: "the_road_not_taken",
    label: "The Road Not Taken",
    description: "Opt-in worktree studio for a genuinely ambiguous choice between two viable implementation directions. Propose two concrete approaches and ask the user before creating anything. Choose two independent Pi workers or two selected CLI harnesses (codex, claude) in separate worktrees and visible tmux/Zellij panes when available; compare their changes and tests. In mux mode, native TUIs remain open and interactive across turns so the parent session can delegate follow-up tasks (action=send). Completed or stopped panes can be closed explicitly (action=close). Use only when parallel evidence will clarify the decision, not for routine tasks. Does not merge, commit, or remove worktrees. Supports start/status/send/stop/close.",
    promptSnippet: "Offer The Road Not Taken only for meaningful, unresolved alternatives; the tool asks permission before creating two Git worktrees.",
    promptGuidelines: ["Never launch a worktree experiment for a routine task, an already clear choice, or without an explicit user confirmation. Review evidence and ask before integrating any result."],
    parameters: Params,
    async execute(_id, params, signal, _onUpdate, ctx) {
      const action = params.action ?? "start";
      if (action === "status") {
        const run = getRun(params.runId);
        if (params.runId && !run) return toolMessage(`Unknown experiment: ${params.runId}.`);
        const reportPath = run && existsSync(join(run.experiment.directory, "report.md")) ? join(run.experiment.directory, "report.md") : undefined;
        return toolMessage(preparing ? "正在征求确认或准备 worktree，尚未启动 worker。" : run ? `Experiment ${run.experiment.id}: ${run.done ? "finished" : run.stopped ? "stopping" : "running"}. ${run.results.length}/2 initial workers reported. Active panes: ${[...run.activeSurfaces.entries()].map(([name, pane]) => `${name}=${pane}`).join(", ") || "(none)"}. Persistent TUIs: ${[...run.retainedSurfaces.entries()].map(([name, pane]) => `${name}=${pane}`).join(", ") || "(none)"}. Active follow-ups: ${[...run.busyRoutes.keys()].join(", ") || "(none)"}. Worktrees: ${run.experiment.directory}${reportPath ? `\nReport: ${reportPath}` : ""}` : lastReport ? `Last report: ${lastReport}` : "No experiment in this session.", { id: run?.experiment.id, report: reportPath ?? lastReport });
      }
      if (action === "close") {
        const run = getRun(params.runId);
        if (!run) return toolMessage(params.runId ? `Unknown experiment: ${params.runId}.` : "No experiment in this session.");
        if (!run.done || run.busyRoutes.size) return toolMessage(`Experiment ${run.experiment.id} still has active turns. Use stop before closing their panes.`);
        const panes = [...run.retainedSurfaces.values()];
        for (const timer of run.paneWatchers.values()) clearInterval(timer);
        run.paneWatchers.clear();
        for (const pane of panes) closeSurface(pane);
        run.retainedSurfaces.clear();
        await writeManifest(run);
        return toolMessage(`Closed ${panes.length} pane(s) for experiment ${run.experiment.id}. Worktrees, sessions, and report remain intact.`, { id: run.experiment.id, panes });
      }
      if (action === "send") {
        const run = getRun(params.runId);
        if (!run?.done) return toolMessage("Wait for the initial experiment to finish before sending a follow-up.");
        const route = run.experiment.routes.find((candidate) => candidate.name === params.route);
        if (!route || !params.task?.trim()) return toolMessage("Send requires route (route-a or route-b) and a non-empty task.");
        const surface = run.retainedSurfaces.get(route.name);
        if (!surface) return toolMessage(`No running native TUI for ${route.name}. Headless process runs cannot receive persistent follow-ups.`);
        if (run.busyRoutes.has(route.name)) return toolMessage(`A follow-up is already running for ${route.name}.`);
        if (route.harness === "claude" && run.results.find((result) => result.route.name === route.name)?.backend !== "tmux") {
          return toolMessage("Automatic Claude TUI follow-ups currently require tmux; inspect the pane manually on Zellij.");
        }
        if (!nativeTuiAlive(surface, run.results.find((result) => result.route.name === route.name)?.backend ?? "tmux")) {
          return toolMessage(`The TUI for ${route.name} has exited. Refusing to send input into its shell.`);
        }
        const id = randomUUID();
        const taskFile = join(run.experiment.directory, `${route.name}.followup-${id}.md`);
        writeFileSync(taskFile, params.task, { encoding: "utf8", mode: 0o600 });
        rmSync(`${route.sessionFile}.exit`, { force: true }); // Discard only an already-settled turn marker.
        const controller = new AbortController();
        run.busyRoutes.set(route.name, controller);
        const backend = run.results.find((result) => result.route.name === route.name)?.backend ?? "tmux";
        try {
          await dispatchToTui(route, surface, backend, params.task, id);
          await writeManifest(run);
        } catch (error) {
          run.busyRoutes.delete(route.name);
          await writeManifest(run);
          return toolMessage(`Could not dispatch to ${route.name}: ${displayError(error)}`, { id: run.experiment.id, route: route.name, error: displayError(error) });
        }
        const minutes = params.maxMinutes ?? DEFAULT_MINUTES;
        void (async () => {
          let status: RouteResult["status"] = "completed";
          let summary = "";
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, minutes * 60_000);
          try {
            const completion = await pollForExit(surface, controller.signal, {
              interval: 1000, sessionFile: route.sessionFile,
              onTick(elapsed) { if (elapsed >= 5 && !nativeTuiAlive(surface, backend)) controller.abort(); },
            });
            status = completion.exitCode === 0 && completion.reason !== "sentinel" ? "completed" : "failed";
            const turnPath = `${route.sessionFile}.turn.json`;
            if (route.harness === "pi") summary = findLastAssistantMessage(route.sessionFile)?.slice(-8000) ?? "(No final Pi message)";
            else if (existsSync(turnPath)) summary = JSON.parse(readFileSync(turnPath, "utf8")).summary?.slice(-8000) ?? "(Inspect the native TUI for the final response.)";
            else summary = completion.errorMessage ?? "(No final response was captured.)";
          } catch (error) {
            status = timedOut ? "timed_out" : run.retainedSurfaces.has(route.name) ? "failed" : "stopped";
            summary = timedOut ? `No turn completion signal after ${minutes} minutes; the native TUI remains open.` : displayError(error);
          } finally {
            clearTimeout(timer);
            run.busyRoutes.delete(route.name);
          }
          if (run.retainedSurfaces.get(route.name) === surface) {
            const screen = await readScreenAsync(surface, 100);
            if (screen.trim()) await writeFile(`${route.sessionFile}.followup-${id}.screen.log`, `${screen}\n`, "utf8");
          }
          run.followups.push({ route: route.name, taskFile, status, summary, at: new Date().toISOString() });
          const report = await renderReport(run, run.results);
          await writeManifest(run);
          if (!run.shuttingDown) pi.sendMessage({ customType: "worktree_studio_result", content: `Follow-up for ${route.name}: ${status}. Report: ${report}. The native TUI remains available until you close it.`, display: true, details: { id: run.experiment.id, route: route.name, report, status } }, { triggerTurn: true, deliverAs: "steer" });
        })().catch((error) => {
          run.busyRoutes.delete(route.name);
          console.error(`Studio follow-up failed for ${route.name}: ${displayError(error)}`);
          if (!run.shuttingDown) pi.sendMessage({ customType: "worktree_studio_result", content: `Follow-up for ${route.name} failed: ${displayError(error)}. The TUI and worktree were preserved.`, display: true, details: { id: run.experiment.id, route: route.name, error: displayError(error) } }, { triggerTurn: true, deliverAs: "steer" });
        });
        return toolMessage(`Sent follow-up to ${route.name} in its existing ${route.harness} TUI. You will receive a completion notice; task saved to ${taskFile}.`, { id: run.experiment.id, route: route.name, taskFile, surface });
      }
      if (action === "stop") {
        const run = getRun(params.runId);
        if (!run) return toolMessage("No experiment to stop.");
        if (run.done) {
          const targets = params.route ? [params.route] : [...run.busyRoutes.keys()];
          let stopped = 0;
          for (const name of targets) {
            const controller = run.busyRoutes.get(name);
            if (!controller) continue;
            const pane = run.retainedSurfaces.get(name);
            controller.abort();
            if (pane) closeSurface(pane);
            run.retainedSurfaces.delete(name);
            const watcher = run.paneWatchers.get(name);
            if (watcher) clearInterval(watcher);
            run.paneWatchers.delete(name);
            stopped++;
          }
          await writeManifest(run);
          return toolMessage(stopped ? `Stopped ${stopped} active follow-up(s) and closed their panes. Idle TUIs remain open.` : "No active turn to stop. Use close to exit idle TUIs.");
        }
        run.stopped = true;
        run.controller.abort();
        await writeManifest(run);
        return toolMessage(`Stopping experiment ${run.experiment.id}. Worktrees and logs are preserved; a report will follow.`, { id: run.experiment.id });
      }
      if (preparing) return toolMessage("已有一个实验正在确认或准备中，请勿重复启动。");
      if (active && !active.done) return toolMessage(`Experiment ${active.experiment.id} is already running. Use status or stop before starting another.`);
      if (!params.goal?.trim() || params.routes?.length !== 2 || params.routes.some((r) => !r.name.trim() || !r.approach.trim())) {
        return toolMessage("Start requires a goal and exactly two specific alternative approaches.");
      }
      preparing = true;
      let createdDirectory: string | undefined;
      try {
        const permission = await ask(ctx, `要为「${params.goal.slice(0, 120)}」创建两个独立 Git worktree，让两个 worker（Pi 或所选 CLI）并行探索吗？`, [
          { label: "暂不启动（推荐）", value: "no", description: "继续直接讨论或完成当前任务；不产生额外模型费用。" },
          { label: "启动两个路线", value: "yes", description: "两个 worker 可能消耗大量 token；时间限制不是费用上限。worktree 不是安全沙箱，结果不自动合并。" },
        ], signal);
        if (permission !== "yes") return toolMessage("未启动探索；没有创建 worktree。", { cancelled: true });
        if (signal?.aborted) return toolMessage("已取消；没有创建 worktree。", { cancelled: true });
        const mode = await ask(ctx, "选择本次实验的执行模式", [
          { label: "Pi subagents（推荐）", value: "pi", description: "两个独立 Pi worker，各自使用指定模型。" },
          { label: "Multi-harness", value: "multi-harness", description: "两条路线分别交给 codex 与 claude。" },
        ], signal);
        if (!mode) return toolMessage("未选择执行模式；没有创建 worktree。", { cancelled: true });
        if (mode !== "pi" && mode !== "multi-harness") throw new Error("Unsupported experiment mode.");
        const values = mode === "pi" ? await selectModels(ctx, signal) : await selectHarnesses(ctx, signal);
        if (!values || signal?.aborted) return toolMessage("未完成 worker 选择；没有创建 worktree。", { cancelled: true });
        const { repository, baseline } = await inspectRepository(ctx.cwd);
        const backend = chooseBackend();
        if (signal?.aborted) return toolMessage("已取消；没有创建 worktree。", { cancelled: true });
        const experiment = makeExperiment(repository, baseline, params.goal.trim(), params.routes, { mode, values });
        createdDirectory = experiment.directory;
        await mkdir(experiment.directory, { recursive: true, mode: 0o700 });
        try {
          await createWorktrees(experiment);
          await setupStudioBin(experiment.directory);
        } catch (error) {
          throw new Error(`创建 worktree 失败；已创建的目录保留在 ${experiment.directory}：${displayError(error)}`);
        }
        for (const route of experiment.routes) await writePrompt(experiment, route);
        if (signal?.aborted) return toolMessage(`启动已取消；worktree 保留在 ${experiment.directory}，请检查后手动处理。`, { cancelled: true, directory: experiment.directory });
        const run: ActiveRun = { experiment, stopped: false, shuttingDown: false, controller: new AbortController(), activeSurfaces: new Map(), retainedSurfaces: new Map(), busyRoutes: new Map(), paneWatchers: new Map(), done: false, results: [], followups: [] };
        active = run;
        runs.set(experiment.id, run);
        lastReport = undefined;
        await writeManifest(run);
        const minutes = params.maxMinutes ?? DEFAULT_MINUTES;
        const trusted = ctx.isProjectTrusted();
        void Promise.all(experiment.routes.map((route) => runRoute(run, route, minutes, trusted, backend)))
          .then(async (results) => {
            const report = await renderReport(run, results);
            lastReport = report;
            run.done = true;
            for (const route of experiment.routes) watchNativePane(run, route, backend, pi);
            await writeManifest(run);
            if (!run.shuttingDown) pi.sendMessage({ customType: "worktree_studio_result", content: `探索${run.stopped ? "已停止" : "已完成"}。报告：${report}\n\n可对仍在运行的原生 TUI 使用 send 续派任务，或用 close 显式关闭；worktree 和报告会保留。请比较 Git diff、测试与代价，不要自动合并或提交。`, display: true, details: { id: experiment.id, report, panes: Object.fromEntries(run.retainedSurfaces) } }, { triggerTurn: true, deliverAs: "steer" });
          })
          .catch((error) => {
            run.stopped = true;
            run.controller.abort();
            run.done = true;
            if (!run.shuttingDown) pi.sendMessage({ customType: "worktree_studio_result", content: `探索报告生成失败：${displayError(error)}。已通知仍在运行的 worker 停止；worktrees 保留在 ${experiment.directory}`, display: true, details: { id: experiment.id, error: displayError(error) } }, { triggerTurn: true, deliverAs: "steer" });
          });
        return toolMessage(`实验 ${experiment.id} 已启动（${backend}, ${mode}）：${experiment.routes.map((r) => `${r.name} (${r.harness === "pi" ? r.model : r.harness}): ${r.directory}${run.activeSurfaces.get(r.name) ? ` [pane ${run.activeSurfaces.get(r.name)}]` : ""}`).join("; ")}。每轮最长等待 ${minutes} 分钟；有 mux 时完成后保留原生 TUI，可继续 send 或显式 close。不会自动合并或提交。`, { id: experiment.id, directory: experiment.directory, baseline, backend, mode, panes: Object.fromEntries(run.activeSurfaces) });
      } catch (error) {
        return toolMessage(`未能启动探索：${displayError(error)}。${createdDirectory ? `已创建的文件保留在 ${createdDirectory}，请检查。` : "没有创建 worktree。"}`, { error: displayError(error), directory: createdDirectory });
      } finally {
        preparing = false;
      }
    },
  });

  pi.on("session_shutdown", () => {
    for (const run of runs.values()) {
      run.shuttingDown = true;
      for (const timer of run.paneWatchers.values()) clearInterval(timer);
      run.paneWatchers.clear();
      for (const controller of run.busyRoutes.values()) controller.abort();
      if (!run.done) {
        run.stopped = true;
        run.controller.abort();
      }
    }
  });
}
