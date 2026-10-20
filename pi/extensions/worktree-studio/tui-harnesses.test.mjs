import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { interactiveArgs } from "./tui-harnesses.mjs";

const exec = promisify(execFile);
const hook = join(dirname(fileURLToPath(import.meta.url)), "turn-hook.mjs");

test("native TUI arguments keep the CLI interactive and configure per-turn hooks", () => {
  const base = { directory: "/tmp/repo", prompt: "Multiline\n```js\nconst a = 1;\n```", hookPath: hook, exitFile: "/tmp/route.exit", sessionId: "0986d805-790a-4d35-b23d-1e59a1dc9388" };
  const codex = interactiveArgs({ ...base, harness: "codex" });
  assert.equal(codex[0], "codex");
  assert.ok(!codex.includes("exec"));
  assert.ok(codex.includes("danger-full-access"));
  assert.ok(codex.includes("-a") && codex[codex.indexOf("-a") + 1] === "never");
  assert.match(codex[codex.indexOf("-c") + 1], /notify=/);
  assert.equal(codex.at(-1), base.prompt);
  const claude = interactiveArgs({ ...base, harness: "claude" });
  assert.equal(claude[0], "claude");
  assert.ok(!claude.includes("-p"));
  assert.equal(claude[claude.indexOf("--permission-mode") + 1], "bypassPermissions");
  assert.equal(claude[claude.indexOf("--session-id") + 1], base.sessionId);
  assert.equal(JSON.parse(claude[claude.indexOf("--settings") + 1]).hooks.Stop[0].hooks[0].type, "command");
  assert.throws(() => interactiveArgs({ ...base, harness: "opencode" }), /not supported/);
});

test("Codex and Claude turn hooks write sidecars without exiting their TUI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-tui-hook-"));
  try {
    const exitFile = join(dir, "route.exit");
    const codex = { type: "agent-turn-complete", thread_id: "thread-1", turn_id: "turn-1", last_assistant_message: "Done once" };
    await exec(process.execPath, [hook, exitFile, "codex", JSON.stringify(codex)]);
    assert.equal(JSON.parse(await readFile(exitFile, "utf8")).type, "done");
    assert.equal(JSON.parse(await readFile(join(dir, "route.turn.json"), "utf8")).summary, "Done once");
    assert.equal(JSON.parse(await readFile(join(dir, "route.metadata.json"), "utf8")).sessionId, "thread-1");
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [hook, exitFile, "claude"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(JSON.stringify({ hook_event_name: "Stop", session_id: "claude-session" }));
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    assert.equal(code, 0);
    assert.equal(JSON.parse(await readFile(join(dir, "route.metadata.json"), "utf8")).sessionId, "claude-session");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
