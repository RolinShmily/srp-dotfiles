import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, statSync, unlinkSync, utimesSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createSurface, closeSurface, getMuxBackend, renderSubagentCommand, sendLongCommand, sendCommand, readScreenAsync, shellEscape, psEscape, zellijPaneId, type WorkerBackend } from "../subagent/mux.ts";
import { HARNESSES, commandSpec } from "./adapters.mjs";
import { readJson, writeJson } from "./ipc.mjs";

const extensionDir = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(extensionDir, "process-runner.mjs");
type Harness = "pi" | "codex" | "claude" | "opencode";
type Status = "running" | "idle" | "timed_out" | "stopped" | "closed" | "exited" | "failed";
interface Worker {
  id: string; name: string; harness: Harness; cwd: string; model?: string; trusted: boolean;
  artifactDir: string; sessionFile: string; sessionId: string; backend: WorkerBackend;
  surface?: string; panePid?: string; status: Status; taskId?: string; summary?: string;
  watcher?: FSWatcher; timer?: ReturnType<typeof setTimeout>; child?: ChildProcess;
}
const Params = Type.Object({
  action: Type.Optional(Type.Union([Type.Literal("spawn"), Type.Literal("send"), Type.Literal("status"), Type.Literal("stop"), Type.Literal("close")], { description: "Defaults to spawn. Send continues an idle worker; stop terminates active work; close exits an idle TUI. All artifacts remain." })),
  name: Type.Optional(Type.String({ description: "Unique worker name for spawn (letters, digits, hyphen, underscore)." })),
  target: Type.Optional(Type.String({ description: "Existing worker name for send/stop/close; optional for status (lists all)." })),
  harness: Type.Optional(Type.Union([Type.Literal("pi"), Type.Literal("codex"), Type.Literal("claude"), Type.Literal("opencode")], { description: "Required for spawn. Equal CLI peers, not execution modes." })),
  cwd: Type.Optional(Type.String({ description: "Existing working directory for spawn; defaults to the parent cwd. No directory or Git worktree is created." })),
  task: Type.Optional(Type.String({ description: "Task for spawn/send; include scope, deliverables, and verification criteria." })),
  model: Type.Optional(Type.String({ description: "Optional model accepted by the selected CLI. Pi defaults to the parent model; other CLIs use their own defaults." })),
  maxMinutes: Type.Optional(Type.Number({ minimum: 1, maximum: 120, description: "Turn timeout in minutes (default 15), not a spending limit. Native TUIs remain open on timeout until stopped or settled." })),
});
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);
const busy = (worker: Worker) => worker.status === "running" || worker.status === "timed_out";

function record(worker: Worker) {
  const { watcher, timer, child, ...data } = worker;
  return data;
}
function save(worker: Worker) { writeJson(join(worker.artifactDir, "worker.json"), record(worker)); }
function backend(): WorkerBackend {
  const preference = process.env.PI_MULTI_HARNESS_BACKEND;
  if (preference && preference !== "process") throw new Error("PI_MULTI_HARNESS_BACKEND only accepts process.");
  return preference === "process" ? "process" : getMuxBackend() ?? "process";
}
function inspectPane(worker: Worker) {
  const runner = readJson(join(worker.artifactDir, "process.json"));
  if (!runner?.pid) throw new Error(`No live runner identity for ${worker.name}.`);
  process.kill(runner.pid, 0); // Fail before pasting if the runner has exited.
  if (worker.backend !== "tmux" || !worker.surface) return;
  const state = execFileSync("tmux", ["display-message", "-p", "-t", worker.surface, "#{pane_pid}:#{pane_dead}"], { encoding: "utf8", timeout: 2000 });
  const [pid, dead] = state.trim().split(":");
  if (pid !== worker.panePid || dead === "1") throw new Error(`The pane for ${worker.name} has exited or been replaced. Refusing to send input.`);
}
function setupBin(directory: string) {
  const bin = join(directory, "bin");
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const done = join(extensionDir, "harness-done.mjs");
  for (const name of ["harness-done", "studio-done"]) {
    writeFileSync(join(bin, name), `#!/usr/bin/env sh\nexec ${shellEscape(process.execPath.replace(/\\/g, "/"))} ${shellEscape(done.replace(/\\/g, "/"))} "$@"\n`, { mode: 0o700 });
    writeFileSync(join(bin, `${name}.ps1`), `\uFEFF& ${psEscape(process.execPath)} ${psEscape(done)} @args\r\nexit $LASTEXITCODE\r\n`);
    writeFileSync(join(bin, `${name}.cmd`), `@"${process.execPath}" "${done}" %*\r\n`);
  }
  return bin;
}
function deliverInbox(worker: Worker, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const watcher = watch(worker.artifactDir, inspect);
    const timer = setTimeout(() => finish(Object.assign(new Error("Worker has not acknowledged delivery. The task may still be accepted; it remains tracked as running. Wait for completion or stop it before retrying."), { deliveryUncertain: true })), 5000);
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      watcher.close();
      error ? reject(error) : resolve();
    }
    function inspect() {
      try {
        const ack = readJson(join(worker.artifactDir, "ack.json"));
        if (ack?.id === worker.taskId) finish(ack.status === "ok" ? undefined : new Error(ack.error ?? "Worker rejected the task."));
      } catch (cause) { finish(Object.assign(new Error(errorText(cause)), { deliveryUncertain: true })); }
    }
    watcher.on("error", (cause) => finish(Object.assign(cause, { deliveryUncertain: true })));
    try {
      const file = join(worker.artifactDir, "inbox.json");
      writeJson(file, { id: worker.taskId, task: text });
      // Some Bun directory watchers coalesce an atomic rename under its temporary filename.
      // A final-file change event is an explicit wakeup, not a polling/re-send loop.
      const now = new Date();
      try { utimesSync(file, now, now); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; } // Already consumed is fine.
      inspect();
    } catch (cause) { finish(Object.assign(new Error(errorText(cause)), { deliveryUncertain: true })); }
  });
}

function prompt(task: string, id: string) {
  return `[Harness task ${id}]\n${task}\n\nCoordinator protocol: keep the native TUI open after completing this task. Finish with a concise summary of artifacts, verification actually performed, and blockers. Optionally run harness-done "summary" (studio-done is an alias) to record your summary. The turn-settlement hook sends completion to the parent automatically; do not exit the application. Do not launch nested multi_harness workers.`;
}
function terminate(worker: Worker) {
  if (worker.timer) clearTimeout(worker.timer);
  worker.timer = undefined;
  if (worker.backend === "process" && worker.child?.pid && worker.child.exitCode === null && worker.child.signalCode === null) {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(worker.child.pid), "/T", "/F"], { stdio: "ignore" });
    else {
      try { process.kill(-worker.child.pid, "SIGTERM"); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause; }
      const pid = worker.child.pid;
      setTimeout(() => {
        try { process.kill(-pid, "SIGKILL"); }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ESRCH") console.error(`Cannot terminate worker group ${pid}: ${errorText(cause)}`); }
      }, 1000).unref();
    }
  } else if (worker.surface) {
    closeSurface(worker.surface);
    worker.surface = undefined;
  }
}

export default function multiHarness(pi: ExtensionAPI) {
  if (process.env.PI_MULTI_HARNESS_WORKER === "1") return;
  const workers = new Map<string, Worker>();
  const captures = new Set<Promise<void>>();
  const controls = new Set<string>();
  function release(worker: Worker) {
    if (!controls.delete(worker.id)) return;
    unlinkSync(join(worker.artifactDir, "controller.lock"));
  }
  let shuttingDown = false;
  function notify(worker: Worker, status: string, summary: string) {
    if (shuttingDown) return;
    pi.sendMessage({ customType: "multi_harness_result", content: `[Harness "${worker.name}" (${worker.harness}) ${status}]\n${summary.slice(-8000)}\nArtifacts: ${worker.artifactDir}`, display: true, details: { ...record(worker), event: status } }, { triggerTurn: true, deliverAs: "steer" });
  }
  function sync(worker: Worker) {
    const completion = readJson(join(worker.artifactDir, "completion.json"));
    const processReady = worker.backend !== "process" || !worker.child || worker.child.exitCode !== null || worker.child.signalCode !== null;
    if (processReady && busy(worker) && worker.taskId && completion?.id === worker.taskId) {
      if (worker.timer) clearTimeout(worker.timer);
      worker.timer = undefined;
      worker.summary = completion.summary;
      worker.status = worker.backend === "process" ? (completion.status === "completed" ? "idle" : "failed") : "idle";
      save(worker);
      notify(worker, completion.status, [completion.summary, completion.error].filter(Boolean).join("\n"));
      if (worker.surface) {
        const capture = readScreenAsync(worker.surface, 100).then((screen) => {
          if (screen.trim()) writeFileSync(join(worker.artifactDir, `${completion.id}.screen.log`), screen, "utf8");
        }).catch((cause) => console.error(`Could not capture ${worker.name}: ${errorText(cause)}`)).finally(() => captures.delete(capture));
        captures.add(capture);
      }
    }
    const ack = readJson(join(worker.artifactDir, "ack.json"));
    if (busy(worker) && ack?.id === worker.taskId && ack?.status === "error") {
      if (worker.timer) clearTimeout(worker.timer);
      worker.timer = undefined;
      worker.status = "idle";
      save(worker);
      notify(worker, "failed", `Worker rejected the task: ${ack.error}`);
    }
    const state = readJson(join(worker.artifactDir, "state.json"));
    if (worker.backend !== "process" && state?.status === "exited" && !["closed", "stopped", "exited"].includes(worker.status)) {
      worker.status = "exited";
      if (worker.timer) clearTimeout(worker.timer);
      worker.timer = undefined;
      if (worker.surface) closeSurface(worker.surface);
      worker.surface = undefined;
      worker.watcher?.close(); worker.watcher = undefined;
      release(worker);
      save(worker);
      notify(worker, "exited", "The native TUI exited. Its pane was closed; artifacts were preserved.");
    }
  }
  function attach(worker: Worker) {
    if (worker.watcher) return;
    if (!controls.has(worker.id)) {
      try {
        const fd = openSync(join(worker.artifactDir, "controller.lock"), "wx", 0o600);
        try { writeFileSync(fd, JSON.stringify({ pid: process.pid })); } finally { closeSync(fd); }
        controls.add(worker.id);
      } catch (cause) {
        throw new Error(`Cannot take control of ${worker.name}: ${errorText(cause)}. A second session may own it. After a crash, verify the owner process is gone before manually removing controller.lock.`);
      }
    }
    worker.watcher = watch(worker.artifactDir, (_event, name) => {
      if (!["completion.json", "state.json", "ack.json"].includes(name?.toString() ?? "")) return;
      try { sync(worker); }
      catch (cause) { notify(worker, "IPC error", errorText(cause)); }
    });
    worker.watcher.on("error", (cause) => notify(worker, "watcher error", `Automatic completion delivery unavailable: ${cause.message}`));
    sync(worker); // Subscribe before checking to avoid a fast-completion race.
  }
  function arm(worker: Worker, task: string, minutes: number) {
    worker.taskId = randomUUID();
    worker.status = "running";
    writeJson(join(worker.artifactDir, "request.json"), { id: worker.taskId, task, at: Date.now() });
    writeFileSync(join(worker.artifactDir, `${worker.taskId}.prompt.md`), prompt(task, worker.taskId), { mode: 0o600 });
    worker.timer = setTimeout(() => {
      if (!busy(worker)) return;
      worker.status = "timed_out";
      if (worker.backend === "process") { terminate(worker); worker.status = "stopped"; }
      save(worker);
      notify(worker, "timed_out", worker.backend === "process" ? "Process stopped after the time limit." : "No settlement received before the deadline. TUI remains open; inspect it or stop the worker. This is not a token/cost limit.");
    }, minutes * 60_000);
    save(worker);
    return prompt(task, worker.taskId);
  }
  function launch(worker: Worker, text: string, resume = false) {
    const metadata = readJson(join(worker.artifactDir, "metadata.json"));
    if (resume && ["codex", "opencode"].includes(worker.harness) && !metadata?.sessionId) throw new Error(`${worker.harness} did not report a session ID; cannot resume a headless conversation.`);
    const configFile = join(worker.artifactDir, "runner.json");
    writeJson(configFile, { harness: worker.harness, cwd: worker.cwd, prompt: text, sessionFile: worker.sessionFile,
      model: worker.model, trusted: worker.trusted, artifactDir: worker.artifactDir, interactive: worker.backend !== "process", resume,
      sessionId: metadata?.sessionId ?? worker.sessionId });
    const bin = setupBin(worker.artifactDir);
    const env: Array<[string, string]> = [["PI_MULTI_HARNESS_WORKER", "1"], ["PI_SUBAGENT_ACTIVE", "1"], ["PI_MULTI_HARNESS_DIR", worker.artifactDir], ["PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`]];
    if (process.env.PI_CODING_AGENT_DIR) env.push(["PI_CODING_AGENT_DIR", process.env.PI_CODING_AGENT_DIR]);
    if (worker.backend !== "process") {
      worker.surface = createSurface(worker.name, worker.backend);
      if (worker.backend === "tmux") worker.panePid = execFileSync("tmux", ["display-message", "-p", "-t", worker.surface, "#{pane_pid}"], { encoding: "utf8" }).trim();
      const rendered = renderSubagentCommand({ cwd: worker.cwd, env, args: [process.execPath, RUNNER, configFile] });
      if (process.platform === "win32") {
        writeFileSync(join(worker.artifactDir, "launch.ps1"), `\uFEFF${rendered.script}`, "utf8");
        sendCommand(worker.surface, `pwsh -NoProfile -EncodedCommand ${Buffer.from(rendered.script, "utf16le").toString("base64")}`);
      } else sendLongCommand(worker.surface, rendered.script, { scriptPath: join(worker.artifactDir, `launch${rendered.scriptExt}`) });
    } else {
      const fd = openSync(join(worker.artifactDir, "console.log"), "a");
      try {
        const child = spawn(process.execPath, [RUNNER, configFile], { cwd: worker.cwd, env: { ...process.env, ...Object.fromEntries(env) }, detached: process.platform !== "win32", stdio: ["ignore", fd, fd], windowsHide: true });
        worker.child = child;
        child.once("error", (cause) => { if (!busy(worker)) return; terminate(worker); worker.status = "failed"; save(worker); notify(worker, "failed", cause.message); });
        child.once("close", (code) => {
          if (worker.child !== child) return;
          try {
            sync(worker);
            if (busy(worker)) { if (worker.timer) clearTimeout(worker.timer); worker.status = "failed"; save(worker); notify(worker, "failed", `Runner exited (${code}) without completion. Inspect console.log.`); }
          } catch (cause) { notify(worker, "IPC error", `Cannot collect exited runner: ${errorText(cause)}`); }
        });
      } finally { closeSync(fd); }
    }
    save(worker);
  }
  async function dispatch(worker: Worker, text: string) {
    if (worker.backend === "process") {
      if (worker.child && worker.child.exitCode === null) throw new Error("Previous process is still flushing its output; retry after it exits.");
      launch(worker, text, true);
      return;
    }
    inspectPane(worker);
    const state = readJson(join(worker.artifactDir, "state.json"));
    if (state?.status !== "idle") throw new Error("Native TUI is not idle; finish its current turn or permission dialog first.");
    if (worker.harness === "pi" || worker.harness === "opencode") {
      await deliverInbox(worker, text);
      return;
    }
    if (worker.harness === "codex") {
      const metadata = readJson(join(worker.artifactDir, "metadata.json"));
      if (metadata?.sessionId) {
        const spec = commandSpec(["codex", "queue", "--thread", metadata.sessionId, "--message", text]);
        execFileSync(spec.command, spec.args, { cwd: worker.cwd, encoding: "utf8", timeout: 10000, windowsHide: true });
        return;
      }
    }
    // Idle-only bracketed paste preserves multiline tasks without interpreting them as keystrokes.
    if (worker.backend === "tmux") {
      const buffer = `harness-${worker.taskId}`;
      const taskFile = join(worker.artifactDir, `${worker.taskId}.prompt.md`);
      execFileSync("tmux", ["load-buffer", "-b", buffer, taskFile], { stdio: "ignore", timeout: 2000 });
      execFileSync("tmux", ["paste-buffer", "-p", "-d", "-b", buffer, "-t", worker.surface!], { stdio: "ignore", timeout: 2000 });
      execFileSync("tmux", ["send-keys", "-t", worker.surface!, "Enter"], { stdio: "ignore", timeout: 2000 });
    } else {
      execFileSync("zellij", ["action", "write-chars", "--pane-id", zellijPaneId(worker.surface!), `\x1b[200~${text}\x1b[201~`], { stdio: "ignore", timeout: 2000 });
      execFileSync("zellij", ["action", "write", "--pane-id", zellijPaneId(worker.surface!), "13"], { stdio: "ignore", timeout: 2000 });
    }
  }
  pi.registerTool({
    name: "multi_harness", label: "Multi Harness",
    description: "Delegate work to a named pi, codex, claude, or opencode CLI peer in any existing cwd. Spawn/send return immediately; turn completion is pushed to this parent session. Native mux TUIs stay open for follow-ups; no mux uses a silent process with session resume. No Git, worktree, comparison mode, model picker, or confirmation dialog is built in. External CLIs use their own billing; permission defaults are documented in the extension README. Use the worktree-studio skill for isolated alternative implementations.",
    promptSnippet: "Spawn named CLI peers with multi_harness, then wait for automatic completion messages; do not poll terminals or status loops.",
    promptGuidelines: ["Specify scope, existing cwd, and verification criteria. Prevent overlapping file edits yourself. Worker conclusions are unverified; review artifacts before integrating. Use stop for active work and close for idle TUIs."],
    parameters: Params,
    async execute(_id, params, signal, _update, ctx) {
      const action = params.action ?? "spawn";
      const reply = (text: string, details: unknown = {}) => ({ content: [{ type: "text" as const, text }], details });
      if (action === "status") {
        const selected = params.target ? [workers.get(params.target)].filter(Boolean) as Worker[] : [...workers.values()];
        return reply(selected.length ? selected.map((w) => `${w.name} (${w.harness}): ${w.status}; cwd=${w.cwd}; ${w.surface ?? "process"}; artifacts=${w.artifactDir}`).join("\n") : "No matching workers in this session.", { workers: selected.map(record) });
      }
      if ((action === "spawn" || action === "send") && params.task && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(params.task)) throw new Error("Tasks may contain multiline text, but not terminal control characters.");
      if (action === "spawn") {
        if (!params.name || !/^[\w-]{1,64}$/.test(params.name)) throw new Error("Spawn requires a name of 1–64 letters, digits, hyphens or underscores.");
        if (workers.has(params.name)) throw new Error(`Worker ${params.name} already exists. Use send or choose a new name.`);
        if (!params.harness || !HARNESSES.includes(params.harness) || !params.task?.trim()) throw new Error("Spawn requires harness (pi/codex/claude/opencode) and task.");
        const cwd = resolve(ctx.cwd, params.cwd ?? ".");
        if (!statSync(cwd).isDirectory()) throw new Error(`Not a directory: ${cwd}`);
        const check = commandSpec([params.harness, "--version"]);
        execFileSync(check.command, check.args, { cwd, encoding: "utf8", timeout: 10000, windowsHide: true });
        if (signal?.aborted) throw new Error("Spawn cancelled before launch.");
        const id = randomUUID();
        const artifactDir = join(homedir(), ".pi", "agent", "multi-harness", id);
        mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
        const worker: Worker = { id, name: params.name, harness: params.harness, cwd, model: params.model ?? (params.harness === "pi" && ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined), trusted: cwd === resolve(ctx.cwd) && ctx.isProjectTrusted(), artifactDir, sessionFile: join(artifactDir, "session.jsonl"), sessionId: randomUUID(), backend: backend(), status: "running" };
        workers.set(worker.name, worker); // Reserve the name before any asynchronous operation.
        try { attach(worker); const text = arm(worker, params.task, params.maxMinutes ?? 15); launch(worker, text); }
        catch (cause) { terminate(worker); worker.watcher?.close(); release(worker); worker.status = "failed"; save(worker); throw cause; }
        pi.appendEntry("multi_harness_worker", { artifactDir });
        return reply(`Started ${worker.name} (${worker.harness}, ${worker.backend}). Completion will be pushed automatically; do not poll. Artifacts: ${artifactDir}`, record(worker));
      }
      const worker = params.target ? workers.get(params.target) : undefined;
      if (!worker) throw new Error("Specify target: an existing worker name.");
      if (action === "send") {
        if (worker.status !== "idle" || !params.task?.trim()) throw new Error("Send requires an idle worker and non-empty task. Stop active work first.");
        if (signal?.aborted) throw new Error("Send cancelled before dispatch.");
        const oldId = worker.taskId;
        const previousRequest = readJson(join(worker.artifactDir, "request.json"));
        try {
          const text = arm(worker, params.task, params.maxMinutes ?? 15);
          await dispatch(worker, text);
        } catch (cause) {
          if ((cause as { deliveryUncertain?: boolean }).deliveryUncertain) { save(worker); throw cause; }
          if (worker.timer) clearTimeout(worker.timer);
          worker.status = "idle"; worker.taskId = oldId;
          if (previousRequest) writeJson(join(worker.artifactDir, "request.json"), previousRequest);
          save(worker);
          throw cause;
        }
        return reply(`Sent a new task to ${worker.name}. Completion will be pushed automatically.`, record(worker));
      }
      const nativeBusy = worker.backend !== "process" && readJson(join(worker.artifactDir, "state.json"))?.status === "running";
      if (action === "close" && (busy(worker) || nativeBusy)) throw new Error("Worker has active work. Use stop before close.");
      if (action === "stop" && !busy(worker) && !nativeBusy) return reply(`${worker.name} has no active work; use close to exit its idle TUI.`, record(worker));
      if (action === "close") {
        await Promise.all(captures);
        if (shuttingDown || busy(worker) || (worker.backend !== "process" && readJson(join(worker.artifactDir, "state.json"))?.status === "running")) throw new Error("Worker state changed while closing; inspect status and stop active work first.");
      }
      terminate(worker);
      worker.status = action === "stop" ? "stopped" : "closed";
      worker.watcher?.close(); worker.watcher = undefined;
      release(worker);
      save(worker);
      return reply(`${action === "stop" ? "Stopped" : "Closed"} ${worker.name}. Working files, sessions, and artifacts are preserved.`, record(worker));
    },
  });
  pi.on("session_start", (_event, ctx) => {
    shuttingDown = false;
    for (const worker of workers.values()) {
      if (busy(worker)) { terminate(worker); worker.status = "stopped"; save(worker); }
      worker.watcher?.close();
      release(worker);
    }
    workers.clear();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== "multi_harness_worker") continue;
      const saved = readJson(join((entry.data as { artifactDir: string }).artifactDir, "worker.json"));
      if (!saved || workers.has(saved.name)) continue;
      const worker = saved as Worker;
      workers.set(worker.name, worker);
      if (!["closed", "stopped", "exited", "failed"].includes(worker.status)) {
        try { attach(worker); }
        catch (cause) {
          workers.delete(worker.name);
          if (ctx.hasUI) ctx.ui.notify(errorText(cause), "warning");
          else console.error(errorText(cause));
        }
      }
    }
  });
  pi.on("session_shutdown", () => {
    shuttingDown = true;
    for (const worker of workers.values()) {
      if (busy(worker)) { terminate(worker); worker.status = "stopped"; save(worker); }
      worker.watcher?.close(); worker.watcher = undefined;
      release(worker);
    }
  });
}
