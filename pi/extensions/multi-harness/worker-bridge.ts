import { watch, renameSync, unlinkSync, type FSWatcher } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { complete, readJson, taskId, writeJson } from "./ipc.mjs";

/** Native Pi inbox and settlement events; never shuts down an idle TUI. */
export default function workerBridge(pi: ExtensionAPI) {
  const directory = process.env.PI_MULTI_HARNESS_DIR;
  if (process.env.PI_MULTI_HARNESS_WORKER !== "1" || !directory) return;
  let watcher: FSWatcher | undefined;
  let id: string | undefined;
  let summary = "";
  let error: string | undefined;
  const inbox = join(directory, "inbox.json");

  function receive() {
    let payload: { id?: string; task?: string } | undefined;
    const processing = `${inbox}.processing`;
    try {
      renameSync(inbox, processing);
      payload = readJson(processing);
      unlinkSync(processing);
      if (!payload?.id || !payload.task) throw new Error("Inbox requires id and task.");
      pi.sendUserMessage(payload.task, { deliverAs: "followUp", expandPromptTemplates: false });
      writeJson(join(directory, "ack.json"), { id: payload.id, status: "ok" });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      writeJson(join(directory, "ack.json"), { id: payload?.id, status: "error", error: String(cause) });
    }
  }
  pi.on("session_start", () => {
    watcher = watch(directory, (_event, name) => { if (name?.toString() === "inbox.json") receive(); });
    watcher.on("error", (cause) => console.error(`Multi-harness inbox watcher failed: ${cause.message}`));
    receive();
  });
  pi.on("before_agent_start", (event) => {
    id = event.messageType === "user" ? taskId(event.prompt) : undefined;
    summary = "";
    error = undefined;
    writeJson(join(directory, "state.json"), { status: "running", id, at: Date.now() });
  });
  pi.on("agent_end", (event) => {
    const last = event.messages.filter((message) => message.role === "assistant").at(-1);
    summary = last?.content?.filter((part) => part.type === "text").map((part) => part.text).join("\n") ?? "";
    error = last?.stopReason === "error" ? last.errorMessage || "Model error" : undefined;
  });
  pi.on("agent_settled", (event) => {
    if (id) complete(directory, { id, status: error || event.aborted ? "failed" : "completed", summary, error: error ?? (event.aborted ? "Turn aborted" : undefined) });
    else writeJson(join(directory, "state.json"), { status: "idle", at: Date.now() });
  });
  pi.on("session_shutdown", () => { watcher?.close(); });
}
