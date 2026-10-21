import { existsSync, realpathSync, renameSync, unlinkSync, watch } from "node:fs";
import { join } from "node:path";
import { complete, readJson, taskId, writeJson } from "./ipc.mjs";

const text = (parts) => (parts ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
const describe = (error) => error?.data?.message ?? error?.message ?? error?.name ?? String(error);

/** OpenCode 1.x server plugin: native SDK input and idle events, no terminal key injection. */
export default async function multiHarnessOpenCode({ client, directory }) {
  const artifactDir = process.env.PI_MULTI_HARNESS_DIR;
  if (process.env.PI_MULTI_HARNESS_WORKER !== "1" || !artifactDir) return {};
  const assignedCwd = process.env.PI_MULTI_HARNESS_CWD;
  if (assignedCwd && realpathSync(directory) !== realpathSync(assignedCwd)) return {};
  let sessionId = readJson(join(artifactDir, "metadata.json"))?.sessionId;
  let active;
  let settling = false;
  let receiving = false;
  let disposed = false;
  let model;
  let agent;
  const inbox = join(artifactDir, "inbox.json");
  const state = (status, id) => writeJson(join(artifactDir, "state.json"), { status, id, at: Date.now() });

  async function receive() {
    if (disposed || receiving) return;
    receiving = true;
    let payload;
    try {
      const processing = `${inbox}.processing`;
      renameSync(inbox, processing);
      try { payload = readJson(processing); } finally { unlinkSync(processing); }
      const request = readJson(join(artifactDir, "request.json"));
      if (!sessionId || !payload?.id || payload.id !== request?.id || typeof payload.task !== "string" || taskId(payload.task) !== payload.id) {
        throw new Error("OpenCode inbox requires a known session and the current task ID.");
      }
      const current = readJson(join(artifactDir, "state.json"));
      if (current?.status !== "idle") throw new Error("OpenCode is not idle; do not dispatch during another turn or permission dialog.");
      state("running", payload.id);
      // The injected SDK is bound to this backend/directory, so the visible TUI observes this same session.
      const result = await client.session.promptAsync({ path: { id: sessionId }, body: { parts: [{ type: "text", text: payload.task }], ...(model ? { model } : {}), ...(agent ? { agent } : {}) } });
      if (result.error) throw new Error(`OpenCode rejected the prompt: ${describe(result.error)}`);
      writeJson(join(artifactDir, "ack.json"), { id: payload.id, status: "ok" });
    } catch (error) {
      if (error.code !== "ENOENT") {
        if (!active) state("idle");
        writeJson(join(artifactDir, "ack.json"), { id: payload?.id ?? readJson(join(artifactDir, "request.json"))?.id, status: "error", error: describe(error) });
      }
    } finally { receiving = false; }
  }

  async function settled() {
    if (settling || disposed) return;
    if (!active) { state("idle"); return; }
    settling = true;
    const turn = active;
    try {
      const result = await client.session.messages({ path: { id: sessionId } });
      if (result.error || !Array.isArray(result.data)) throw new Error(`Cannot read OpenCode messages: ${result.error ? describe(result.error) : "invalid SDK response"}`);
      const messages = result.data;
      const start = messages.findIndex((message) => message.info?.id === turn.messageId);
      if (start === -1) throw new Error("Assigned user message was not found; refusing to report another turn's answer.");
      // Compaction may add synthetic user continuations; use the last root-session answer after our message.
      const last = messages.slice(start + 1).filter((message) => message.info?.role === "assistant" && (!message.info.sessionID || message.info.sessionID === sessionId)).at(-1);
      const error = last?.info.error ?? (last?.info.finish === "stop" ? undefined : turn.error) ?? (!last ? new Error("No assistant response for the assigned task.") : undefined);
      complete(artifactDir, { id: turn.id, sessionId, status: error ? "failed" : "completed", summary: text(last?.parts), ...(error ? { error: describe(error) } : {}) });
    } catch (error) {
      complete(artifactDir, { id: turn.id, sessionId, status: "failed", error: describe(error) });
    } finally {
      if (active === turn) active = undefined;
      settling = false;
    }
  }

  const watcher = watch(artifactDir, (_event, name) => { if (name?.toString() === "inbox.json" || existsSync(inbox)) void receive(); });
  watcher.unref();
  watcher.on("error", (error) => writeJson(join(artifactDir, "ack.json"), { id: readJson(join(artifactDir, "request.json"))?.id, status: "error", error: `OpenCode inbox watcher failed: ${error.message}` }));
  void receive();
  return {
    "chat.message": async (input, output) => {
      const id = taskId(text(output.parts));
      const request = readJson(join(artifactDir, "request.json"));
      if (sessionId && input.sessionID !== sessionId) return; // Ignore subagents and unrelated sessions.
      if (id && id === request?.id) {
        sessionId = input.sessionID;
        active = { id, messageId: output.message.id ?? input.messageID };
        writeJson(join(artifactDir, "metadata.json"), { harness: "opencode", sessionId });
      } else if (!sessionId) return;
      model = input.model;
      agent = input.agent;
      state("running", id);
    },
    event: async ({ event }) => {
      if (!sessionId || event.properties?.sessionID !== sessionId) return;
      if (event.type === "session.error" && active) active.error = event.properties.error;
      if (event.type === "session.idle" || (event.type === "session.status" && event.properties.status?.type === "idle")) await settled();
    },
    dispose: async () => { disposed = true; watcher.close(); },
  };
}
