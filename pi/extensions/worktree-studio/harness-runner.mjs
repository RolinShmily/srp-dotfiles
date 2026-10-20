import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { harnessArgs, HARNESSES } from "./harnesses.mjs";

const configPath = process.argv[2];
if (!configPath) throw new Error("A runner configuration path is required.");
const { harness, directory, promptFile, resultFile, eventsFile, stderrFile, metadataFile, exitFile } = JSON.parse(readFileSync(configPath, "utf8"));
if (!HARNESSES.includes(harness)) throw new Error(`Unsupported harness: ${harness}`);
const prompt = readFileSync(promptFile, "utf8");
if (stderrFile) writeFileSync(stderrFile, "", "utf8");
const args = harnessArgs(harness, directory, resultFile);
const quotePs = (value) => `'${value.replaceAll("'", "''")}'`;
const command = process.platform === "win32" ? "pwsh" : harness;
const commandArgs = process.platform === "win32"
  ? ["-NoProfile", "-Command", `& ${quotePs(harness)} ${args.map(quotePs).join(" ")}; exit $LASTEXITCODE`]
  : args;
console.log(`[${harness}] Starting in ${directory}`);

let child;
try {
  child = spawn(command, commandArgs, {
    cwd: directory,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
} catch (error) {
  writeFileSync(exitFile, JSON.stringify({ type: "error", errorMessage: String(error) }));
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal === "SIGHUP" && process.platform === "win32" ? "SIGTERM" : signal));
}

let finalText = "";
const metadata = { harness };
let errors = "";
let stderrTail = "";
let pending = "";
const decoder = new StringDecoder("utf8");
function remember(value) {
  if (typeof value === "string" && value.trim()) finalText = value.slice(-12000);
}
function textBlocks(value) {
  return Array.isArray(value) ? value.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n") : "";
}
function onLine(line) {
  appendFileSync(eventsFile, `${line}\n`, "utf8");
  if (!line.trim()) return;
  let event;
  try { event = JSON.parse(line); } catch {
    console.log(`[${harness}] ${line.slice(0, 500)}`);
    remember(line);
    return;
  }
  if (harness === "codex") {
    const item = event.item;
    if (item?.type === "agent_message") remember(item.text);
    if (event.type === "turn.completed" && event.usage) metadata.usage = event.usage;
    if (event.type === "item.started" || event.type === "item.completed") {
      console.log(`[codex] ${event.type}: ${item?.type ?? "item"}${item?.command ? ` ${String(item.command).slice(0, 220)}` : ""}`);
      if (event.type === "item.completed" && item?.type === "command_execution" && item.aggregated_output) {
        console.log(`[codex] output: ${String(item.aggregated_output).trim().slice(-320)}`);
      }
    } else if (event.type === "turn.failed" || event.type === "error") {
      errors = String(event.message ?? event.error?.message ?? "Codex failed");
      console.error(`[codex] ${errors.slice(0, 500)}`);
    }
  } else if (harness === "claude") {
    if (event.type === "assistant") {
      for (const part of event.message?.content ?? []) {
        if (part.type === "tool_use") {
          const target = part.input?.file_path ?? part.input?.path ?? part.input?.command ?? "";
          console.log(`[claude] tool: ${part.name}${target ? ` ${String(target).slice(0, 220)}` : ""}`);
        }
      }
      remember(textBlocks(event.message?.content));
    } else if (event.type === "user") {
      for (const part of event.message?.content ?? []) {
        if (part.type !== "tool_result") continue;
        const output = typeof part.content === "string" ? part.content : textBlocks(part.content);
        if (output.trim()) console.log(`[claude] tool output: ${output.trim().slice(-320)}`);
      }
    } else if (event.type === "result") {
      remember(event.result);
      if (event.usage) metadata.usage = event.usage;
      if (typeof event.total_cost_usd === "number") metadata.costUSD = event.total_cost_usd;
      if (event.modelUsage) metadata.model = Object.keys(event.modelUsage).join(", ");
      if (event.session_id) metadata.sessionId = event.session_id;
      if (event.is_error) errors = String(event.result ?? "Claude failed");
      console.log(`[claude] result: ${event.subtype ?? "complete"}`);
    }
  }
}
child.stdout.on("data", (chunk) => {
  pending += decoder.write(chunk);
  let end;
  while ((end = pending.indexOf("\n")) !== -1) {
    onLine(pending.slice(0, end));
    pending = pending.slice(end + 1);
  }
});
child.stderr.on("data", (chunk) => {
  const message = chunk.toString("utf8");
  if (stderrFile) appendFileSync(stderrFile, message, "utf8");
  console.error(`[${harness}] ${message.slice(-2000)}`);
  stderrTail = message.slice(-4000);
});
child.stdin.on("error", (error) => { errors = `Prompt delivery failed: ${error.message}`; });
child.stdin.end(prompt);
child.once("error", (error) => { errors = `Could not start ${harness}: ${error.message}`; });
child.once("close", (code) => {
  if (pending) onLine(pending + decoder.end());
  let final = finalText;
  if (harness === "codex") {
    try { final = readFileSync(resultFile, "utf8").trim() || final; } catch (error) {
      if (error?.code !== "ENOENT") errors = `Could not read Codex result: ${error.message}`;
    }
  }
  const status = code === 0 && !errors ? "done" : "error";
  const result = final || "(No final text was returned by the harness.)";
  writeFileSync(resultFile, `# ${harness} result\n\n${result}\n`, "utf8");
  if (metadataFile) writeFileSync(metadataFile, JSON.stringify(metadata, null, 2), "utf8");
  writeFileSync(exitFile, JSON.stringify({ type: status, ...(status === "error" ? { errorMessage: errors || stderrTail || `Process exited with code ${code}` } : {}) }), "utf8");
  console.log(`[${harness}] ${status}: ${resultFile}`);
  process.exitCode = status === "done" ? 0 : (code || 1);
});
