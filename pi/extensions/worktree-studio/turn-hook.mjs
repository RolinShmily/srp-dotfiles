import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const [exitFile, harness, codexEvent] = process.argv.slice(2);
if (!exitFile || !["codex", "claude", "claude-start"].includes(harness)) throw new Error("Expected a supported harness and absolute turn sidecar path.");
const raw = harness === "codex" ? codexEvent : readFileSync(0, "utf8");
const event = JSON.parse(raw ?? "null");
if (harness === "codex" && event?.type !== "agent-turn-complete") process.exit(0);
if (harness === "claude" && event?.hook_event_name !== "Stop") process.exit(0);
if (harness === "claude-start" && event?.hook_event_name !== "UserPromptSubmit") process.exit(0);

function atomicJson(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

const stateFile = exitFile.replace(/\.exit$/, ".state.json");
if (harness === "claude-start") {
  atomicJson(stateFile, { status: "running", at: Date.now(), sessionId: event.session_id });
  process.exit(0);
}
const metadataFile = exitFile.replace(/\.exit$/, ".metadata.json");
let metadata = { harness };
if (existsSync(metadataFile)) metadata = { ...JSON.parse(readFileSync(metadataFile, "utf8")), harness };
const sessionId = harness === "codex" ? event.thread_id : event.session_id;
if (sessionId) metadata.sessionId = sessionId;
atomicJson(metadataFile, metadata);
atomicJson(stateFile, { status: "idle", at: Date.now(), sessionId });
const turn = {
  type: "done",
  harness,
  sessionId,
  turnId: harness === "codex" ? event.turn_id : undefined,
  summary: event.last_assistant_message ?? undefined,
  at: Date.now(),
};
atomicJson(exitFile.replace(/\.exit$/, ".turn.json"), turn);
// The sidecar is written last: the parent can immediately read the completed turn and metadata.
atomicJson(exitFile, { type: "done" });
