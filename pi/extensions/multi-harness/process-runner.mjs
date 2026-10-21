import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { buildArgs, buildEnv, commandSpec } from "./adapters.mjs";
import { complete, readJson, writeJson } from "./ipc.mjs";

const config = readJson(process.argv[2]);
if (!config) throw new Error("Missing multi-harness runner configuration.");
const { artifactDir, interactive, harness } = config;
const request = readJson(join(artifactDir, "request.json"));
writeJson(join(artifactDir, "process.json"), { pid: process.pid, at: Date.now() });
let child;
try {
  const spec = commandSpec(buildArgs(config));
  child = spawn(spec.command, spec.args, {
    cwd: config.cwd, env: buildEnv(config), windowsHide: !interactive,
    stdio: interactive ? "inherit" : ["pipe", "pipe", "pipe"],
  });
} catch (error) {
  complete(artifactDir, { id: request.id, status: "failed", error: `Cannot launch ${harness}: ${error.message}` });
  writeJson(join(artifactDir, "state.json"), { status: "exited", code: 1, at: Date.now() });
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal === "SIGHUP" && process.platform === "win32" ? "SIGTERM" : signal));
}
let summary = "";
let failure;
let stderr = "";
let pending = "";
const decoder = new StringDecoder("utf8");
let metadata = readJson(join(artifactDir, "metadata.json")) ?? {};
const seenSteps = new Set();
const openCodeText = new Map();
let openCodeMessageId;
let openCodeSessionSeen = false;
if (harness === "opencode") { delete metadata.usage; delete metadata.costUSD; }
function textBlocks(content) {
  return Array.isArray(content) ? content.filter((part) => part.type === "text").map((part) => part.text).join("\n") : "";
}
function onLine(line) {
  if (harness === "pi") { summary = `${summary}${line}\n`.slice(-16000); return; }
  let event;
  try { event = JSON.parse(line); }
  catch (error) {
    if (error instanceof SyntaxError) return; // CLI diagnostics are preserved in console.log.
    throw error;
  }
  if (harness === "codex") {
    if (event.type === "thread.started") metadata.sessionId = event.thread_id ?? event["thread-id"];
    if (event.item?.type === "agent_message") summary = event.item.text ?? summary;
    if (event.type === "turn.completed") metadata.usage = event.usage;
    if (["turn.failed", "error"].includes(event.type)) failure = event.message ?? event.error?.message ?? "Codex turn failed";
  } else if (harness === "opencode") {
    if (typeof event.sessionID === "string" && event.sessionID) {
      openCodeSessionSeen = true;
      if (config.resume && event.sessionID !== config.sessionId) failure = "OpenCode resumed a different session; refusing to treat it as the requested conversation.";
      else metadata.sessionId = event.sessionID;
    }
    if (event.type === "text" && typeof event.part?.text === "string") {
      if (event.part.messageID !== openCodeMessageId) { openCodeText.clear(); openCodeMessageId = event.part.messageID; }
      openCodeText.set(event.part.id ?? "last", event.part.text);
      summary = [...openCodeText.values()].join("\n");
    }
    if (event.type === "error") failure = event.error?.data?.message ?? event.error?.message ?? event.error?.name ?? "OpenCode turn failed";
    if (event.type === "step_finish" && event.part && (!event.part.id || !seenSteps.has(event.part.id))) {
      if (event.part.id) seenSteps.add(event.part.id);
      if (event.part.tokens) {
        metadata.usage ??= {};
        for (const [key, value] of Object.entries({ input: event.part.tokens.input, output: event.part.tokens.output, reasoning: event.part.tokens.reasoning, cacheRead: event.part.tokens.cache?.read, cacheWrite: event.part.tokens.cache?.write })) {
          if (typeof value === "number") metadata.usage[key] = (metadata.usage[key] ?? 0) + value;
        }
      }
      if (typeof event.part.cost === "number") metadata.costUSD = (metadata.costUSD ?? 0) + event.part.cost;
    }
  } else {
    if (event.type === "assistant") summary = textBlocks(event.message?.content) || summary;
    if (event.session_id) metadata.sessionId = event.session_id;
    if (event.type === "result") {
      summary = event.result ?? summary;
      metadata = { ...metadata, usage: event.usage, costUSD: event.total_cost_usd, model: Object.keys(event.modelUsage ?? {}).join(", ") };
      if (event.is_error) failure = summary || "Claude turn failed";
    }
  }
}
if (!interactive) {
  child.stdout.on("data", (chunk) => {
    appendFileSync(join(artifactDir, "events.log"), chunk);
    process.stdout.write(chunk);
    pending += decoder.write(chunk);
    let end;
    while ((end = pending.indexOf("\n")) !== -1) { onLine(pending.slice(0, end)); pending = pending.slice(end + 1); }
  });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000); process.stderr.write(chunk); });
  child.stdin.on("error", (cause) => { failure = `Prompt delivery failed: ${cause.message}`; });
  // Pi receives its prompt as a CLI argument; the other CLIs receive exact UTF-8 stdin.
  child.stdin.end(harness === "pi" ? undefined : config.prompt);
}
child.once("error", (cause) => { failure = `Cannot start ${harness}: ${cause.message}`; });
child.once("close", (code, signal) => {
  if (!interactive) {
    pending += decoder.end();
    if (pending) onLine(pending);
    if (harness === "opencode" && !openCodeSessionSeen) failure ??= "OpenCode exited without a JSON session ID; inspect events.log for CLI compatibility errors.";
    writeJson(join(artifactDir, "metadata.json"), metadata);
    complete(artifactDir, { id: request.id, status: code === 0 && !failure ? "completed" : "failed", summary: summary.trim(), error: failure ?? (code !== 0 ? stderr || `Process exit ${code ?? signal}` : undefined), sessionId: metadata.sessionId });
  } else {
    const current = readJson(join(artifactDir, "request.json"));
    const previous = readJson(join(artifactDir, "completion.json"));
    if (current && previous?.id !== current.id) complete(artifactDir, { id: current.id, status: "failed", error: failure ?? `TUI exited before settlement (${code ?? signal}).` });
  }
  writeJson(join(artifactDir, "state.json"), { status: "exited", code, signal, at: Date.now() });
  process.exitCode = code ?? 1;
});
