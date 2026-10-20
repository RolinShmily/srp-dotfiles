#!/usr/bin/env node
import { existsSync, renameSync, writeFileSync } from "node:fs";

const exitFile = process.env.PI_WORKTREE_STUDIO_EXIT_FILE || process.argv[2];
if (!exitFile) {
  console.error("[studio-done] Error: PI_WORKTREE_STUDIO_EXIT_FILE is not set and no exit path argument was given.");
  process.exit(1);
}

const summaryArg = process.env.PI_WORKTREE_STUDIO_EXIT_FILE ? process.argv.slice(2).join(" ") : process.argv.slice(3).join(" ");
const summary = summaryArg.trim() || "Work completed and verified.";

function atomicJson(path, data) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

const turnFile = exitFile.replace(/\.exit$/, ".turn.json");
const turn = {
  type: "done",
  source: "studio-done",
  summary,
  at: Date.now(),
};

try {
  atomicJson(turnFile, turn);
  atomicJson(exitFile, { type: "done" });
  console.log(`[studio-done] Coordinator notified: ${summary.slice(0, 120)}`);
} catch (error) {
  console.error(`[studio-done] Failed to write completion sidecar: ${error.message}`);
  process.exit(1);
}
