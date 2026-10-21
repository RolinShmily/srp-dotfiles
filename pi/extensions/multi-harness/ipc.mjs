import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw new Error(`Cannot read IPC file ${path}: ${error.message}`, { cause: error });
  }
}

export function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function taskId(prompt) {
  return typeof prompt === "string" ? prompt.match(/\[Harness task ([\w-]+)\]/)?.[1] : undefined;
}

/** Record a settled turn, not a model's early claim that it has finished. */
export function complete(directory, result) {
  const request = readJson(join(directory, "request.json"));
  if (!request || !result.id || request.id !== result.id) return;
  const previous = readJson(join(directory, "completion.json"));
  if (previous?.id === result.id) return;
  const proposal = readJson(join(directory, "proposal.json"));
  const value = {
    ...result,
    summary: result.summary || (proposal?.id === result.id ? proposal.summary : undefined) || "No final text captured; inspect the session or log.",
    at: Date.now(),
  };
  writeJson(join(directory, "state.json"), { status: "idle", id: result.id, at: value.at });
  writeJson(join(directory, "completion.json"), value);
}
