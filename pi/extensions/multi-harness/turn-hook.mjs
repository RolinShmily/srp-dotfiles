import { readFileSync } from "node:fs";
import { join } from "node:path";
import { complete, readJson, taskId, writeJson } from "./ipc.mjs";

const [directory, harness, raw] = process.argv.slice(2);
if (!directory || !["codex", "claude", "claude-start"].includes(harness)) throw new Error("Invalid multi-harness hook arguments.");
const event = JSON.parse(harness === "codex" ? raw : readFileSync(0, "utf8"));
const request = readJson(join(directory, "request.json"));
if (!request) process.exit(0);
if (harness === "claude-start") {
  if (event.hook_event_name !== "UserPromptSubmit") process.exit(0);
  writeJson(join(directory, "state.json"), { status: "running", id: taskId(event.prompt), at: Date.now() });
  process.exit(0);
}
if (harness === "codex" && event.type !== "agent-turn-complete") process.exit(0);
if (harness === "claude" && event.hook_event_name !== "Stop") process.exit(0);
const sessionId = event["thread-id"] ?? event.thread_id ?? event.session_id;
const inputs = event["input-messages"] ?? event.input_messages;
const state = readJson(join(directory, "state.json"));
const id = harness === "codex"
  ? (Array.isArray(inputs) ? inputs.map(taskId).filter(Boolean).at(-1) : request.id)
  : state?.id;
if (sessionId) writeJson(join(directory, "metadata.json"), { sessionId, harness });
if (id !== request.id) {
  // Manual turns must return to idle too, without completing a coordinator dispatch.
  writeJson(join(directory, "state.json"), { status: "idle", at: Date.now() });
  process.exit(0);
}
complete(directory, { id, status: "completed", sessionId, summary: event["last-assistant-message"] ?? event.last_assistant_message });
