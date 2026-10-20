import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
const script = join(dirname(fileURLToPath(import.meta.url)), "studio-done.mjs");

test("studio-done writes turn and exit sidecars from env var", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-done-test-"));
  try {
    const exitFile = join(dir, "route-a.jsonl.exit");
    const turnFile = join(dir, "route-a.jsonl.turn.json");
    const { stdout } = await exec(process.execPath, [script, "Implemented", "feature", "and", "tests", "passed"], {
      env: { ...process.env, PI_WORKTREE_STUDIO_EXIT_FILE: exitFile },
    });
    assert.match(stdout, /Coordinator notified/);
    const exit = JSON.parse(await readFile(exitFile, "utf8"));
    assert.equal(exit.type, "done");
    const turn = JSON.parse(await readFile(turnFile, "utf8"));
    assert.equal(turn.type, "done");
    assert.equal(turn.source, "studio-done");
    assert.equal(turn.summary, "Implemented feature and tests passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
