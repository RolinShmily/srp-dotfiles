#!/usr/bin/env node
import { join } from "node:path";
import { readJson, writeJson } from "./ipc.mjs";

const directory = process.env.PI_MULTI_HARNESS_DIR;
if (!directory) throw new Error("harness-done must run inside a multi_harness worker.");
const request = readJson(join(directory, "request.json"));
if (!request) throw new Error("No task is assigned to this worker.");
writeJson(join(directory, "proposal.json"), {
  id: request.id,
  summary: process.argv.slice(2).join(" ").trim() || "Task finished; inspect the artifacts for verification.",
  at: Date.now(),
});
console.log("Summary recorded. The coordinator will be notified when this turn settles; keep the TUI open.");
