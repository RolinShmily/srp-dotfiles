import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import worktreeStudioWorker, { resolveSessionPaths } from "./worker-bridge.ts";

async function waitForFile(path: string, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      try {
        return await readFile(path, "utf8");
      } catch {
        // Retry if reading mid-rename
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for file: ${path}`);
}

test("persistent worker bridge handles two sequential turns, exact multiline input, and no shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-studio-bridge-test-"));
  const sessionBase = join(root, "session-test.jsonl");
  const exitFile = `${sessionBase}.exit`;
  const { exitPath, inboxPath, ackPath } = resolveSessionPaths(exitFile);

  const oldWorker = process.env.PI_WORKTREE_STUDIO_WORKER;
  const oldExit = process.env.PI_WORKTREE_STUDIO_EXIT_FILE;

  try {
    process.env.PI_WORKTREE_STUDIO_WORKER = "1";
    process.env.PI_WORKTREE_STUDIO_EXIT_FILE = exitFile;

    const handlers = new Map<string, (...args: any[]) => void>();
    const sentMessages: Array<{ content: any; options?: any }> = [];

    const mockPi = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
        return () => {};
      },
      sendUserMessage: async (content: any, options?: any) => {
        sentMessages.push({ content, options });
      },
    };

    worktreeStudioWorker(mockPi as any);

    let shutdowns = 0;
    const mockCtx = { shutdown: () => shutdowns++ };

    // Turn 1: Agent starts, ends successfully, and settles
    handlers.get("agent_start")!();
    handlers.get("agent_end")!({
      messages: [{ role: "assistant", stopReason: "stop", content: "Turn 1 answer" }],
    });
    handlers.get("agent_settled")!({ aborted: false }, mockCtx);

    const turn1Exit = JSON.parse(await readFile(exitPath, "utf8"));
    assert.equal(turn1Exit.type, "done");
    assert.equal(shutdowns, 0, "ctx.shutdown must not be called on agent_settled");

    // Parent consumes exit file after turn 1
    await rm(exitPath);
    assert.equal(existsSync(exitPath), false);

    // Follow-up: Parent writes exact multiline input into inbox
    const multilineTask = [
      "Implement persistent follow-up bridge:",
      "Line 1: Special chars: !@#$%^&*()_+~`|}{[]:;?><,./",
      "Line 2: Quotes: \"double\" and 'single'",
      "Line 3: Indented code block:",
      "    function test() {",
      "      return true;",
      "    }",
      "Line 4: Trailing spaces   \nLine 5: Unicode: 🚀 桥接测试",
    ].join("\n");

    const followUpId = "req-multiline-turn-2";
    await writeFile(
      inboxPath,
      JSON.stringify({ id: followUpId, task: multilineTask }),
      "utf8",
    );

    // Wait for bridge to consume inbox and write ack
    const ackRaw = await waitForFile(ackPath);
    const ack = JSON.parse(ackRaw);
    assert.equal(ack.id, followUpId);
    assert.equal(ack.status, "ok");
    assert.equal(existsSync(inboxPath), false, "inbox file must be atomically consumed");

    // Verify pi.sendUserMessage received exact multiline input
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].content, multilineTask);
    assert.deepEqual(sentMessages[0].options, { deliverAs: "followUp" });

    // Turn 2: Agent runs follow-up, ends successfully, and settles
    handlers.get("agent_start")!();
    handlers.get("agent_end")!({
      messages: [{ role: "assistant", stopReason: "stop", content: "Turn 2 answer" }],
    });
    handlers.get("agent_settled")!({ aborted: false }, mockCtx);

    const turn2Exit = JSON.parse(await readFile(exitPath, "utf8"));
    assert.equal(turn2Exit.type, "done");
    assert.equal(shutdowns, 0, "ctx.shutdown must not be called after sequential turns");

    // Clean up on session_shutdown
    handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" });
  } finally {
    if (oldWorker === undefined) delete process.env.PI_WORKTREE_STUDIO_WORKER;
    else process.env.PI_WORKTREE_STUDIO_WORKER = oldWorker;
    if (oldExit === undefined) delete process.env.PI_WORKTREE_STUDIO_EXIT_FILE;
    else process.env.PI_WORKTREE_STUDIO_EXIT_FILE = oldExit;
    await rm(root, { recursive: true, force: true });
  }
});

test("per-turn error sidecar is written without shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-studio-bridge-error-test-"));
  const sessionBase = join(root, "session-err.jsonl");
  const exitFile = `${sessionBase}.exit`;

  const oldWorker = process.env.PI_WORKTREE_STUDIO_WORKER;
  const oldExit = process.env.PI_WORKTREE_STUDIO_EXIT_FILE;

  try {
    process.env.PI_WORKTREE_STUDIO_WORKER = "1";
    process.env.PI_WORKTREE_STUDIO_EXIT_FILE = exitFile;

    const handlers = new Map<string, (...args: any[]) => void>();
    const mockPi = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
        return () => {};
      },
      sendUserMessage: async () => {},
    };

    worktreeStudioWorker(mockPi as any);

    let shutdowns = 0;
    const mockCtx = { shutdown: () => shutdowns++ };

    // Turn with model error
    handlers.get("agent_start")!();
    handlers.get("agent_end")!({
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "Rate limit exceeded" }],
    });
    handlers.get("agent_settled")!({ aborted: false }, mockCtx);

    const errExit = JSON.parse(await readFile(exitFile, "utf8"));
    assert.equal(errExit.type, "error");
    assert.equal(errExit.errorMessage, "Rate limit exceeded");
    assert.equal(shutdowns, 0);

    await rm(exitFile);

    // Turn with aborted run
    handlers.get("agent_start")!();
    handlers.get("agent_end")!({ messages: [] });
    handlers.get("agent_settled")!({ aborted: true }, mockCtx);

    const abortExit = JSON.parse(await readFile(exitFile, "utf8"));
    assert.equal(abortExit.type, "error");
    assert.equal(abortExit.errorMessage, "Worker was aborted");
    assert.equal(shutdowns, 0);

    handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" });
  } finally {
    if (oldWorker === undefined) delete process.env.PI_WORKTREE_STUDIO_WORKER;
    else process.env.PI_WORKTREE_STUDIO_WORKER = oldWorker;
    if (oldExit === undefined) delete process.env.PI_WORKTREE_STUDIO_EXIT_FILE;
    else process.env.PI_WORKTREE_STUDIO_EXIT_FILE = oldExit;
    await rm(root, { recursive: true, force: true });
  }
});

test("inbox errors are propagated via ack/status rather than swallowed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-studio-bridge-inbox-err-test-"));
  const sessionBase = join(root, "session-inbox-err.jsonl");
  const exitFile = `${sessionBase}.exit`;
  const { inboxPath, ackPath } = resolveSessionPaths(exitFile);

  const oldWorker = process.env.PI_WORKTREE_STUDIO_WORKER;
  const oldExit = process.env.PI_WORKTREE_STUDIO_EXIT_FILE;

  try {
    process.env.PI_WORKTREE_STUDIO_WORKER = "1";
    process.env.PI_WORKTREE_STUDIO_EXIT_FILE = exitFile;

    const handlers = new Map<string, (...args: any[]) => void>();
    let throwSendError = false;

    const mockPi = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers.set(event, handler);
        return () => {};
      },
      sendUserMessage: async () => {
        if (throwSendError) {
          throw new Error("Disallowed by policy");
        }
      },
    };

    worktreeStudioWorker(mockPi as any);

    // 1. Malformed JSON
    await writeFile(inboxPath, "{ not valid json ", "utf8");
    const ack1 = JSON.parse(await waitForFile(ackPath));
    assert.equal(ack1.status, "error");
    assert.ok(ack1.error.includes("Invalid JSON"));
    await rm(ackPath);

    // 2. Missing id
    await writeFile(inboxPath, JSON.stringify({ task: "do something" }), "utf8");
    const ack2 = JSON.parse(await waitForFile(ackPath));
    assert.equal(ack2.status, "error");
    assert.ok(ack2.error.includes("id"));
    await rm(ackPath);

    // 3. Missing/invalid task
    await writeFile(inboxPath, JSON.stringify({ id: "req-missing-task", task: 12345 }), "utf8");
    const ack3 = JSON.parse(await waitForFile(ackPath));
    assert.equal(ack3.id, "req-missing-task");
    assert.equal(ack3.status, "error");
    assert.ok(ack3.error.includes("task"));
    await rm(ackPath);

    // 4. sendUserMessage exception
    throwSendError = true;
    await writeFile(inboxPath, JSON.stringify({ id: "req-send-fail", task: "trigger error" }), "utf8");
    const ack4 = JSON.parse(await waitForFile(ackPath));
    assert.equal(ack4.id, "req-send-fail");
    assert.equal(ack4.status, "error");
    assert.ok(ack4.error.includes("Disallowed by policy"));

    handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" });
  } finally {
    if (oldWorker === undefined) delete process.env.PI_WORKTREE_STUDIO_WORKER;
    else process.env.PI_WORKTREE_STUDIO_WORKER = oldWorker;
    if (oldExit === undefined) delete process.env.PI_WORKTREE_STUDIO_EXIT_FILE;
    else process.env.PI_WORKTREE_STUDIO_EXIT_FILE = oldExit;
    await rm(root, { recursive: true, force: true });
  }
});

test("inactive when PI_WORKTREE_STUDIO_WORKER is not 1 or exit file is missing", async () => {
  const oldWorker = process.env.PI_WORKTREE_STUDIO_WORKER;
  const oldExit = process.env.PI_WORKTREE_STUDIO_EXIT_FILE;

  try {
    // When PI_WORKTREE_STUDIO_WORKER is not set
    delete process.env.PI_WORKTREE_STUDIO_WORKER;
    process.env.PI_WORKTREE_STUDIO_EXIT_FILE = "/tmp/fake.exit";

    let called = 0;
    const mockPi = {
      on: () => {
        called++;
        return () => {};
      },
    };

    worktreeStudioWorker(mockPi as any);
    assert.equal(called, 0);

    // When EXIT_FILE is not set
    process.env.PI_WORKTREE_STUDIO_WORKER = "1";
    delete process.env.PI_WORKTREE_STUDIO_EXIT_FILE;

    worktreeStudioWorker(mockPi as any);
    assert.equal(called, 0);
  } finally {
    if (oldWorker === undefined) delete process.env.PI_WORKTREE_STUDIO_WORKER;
    else process.env.PI_WORKTREE_STUDIO_WORKER = oldWorker;
    if (oldExit === undefined) delete process.env.PI_WORKTREE_STUDIO_EXIT_FILE;
    else process.env.PI_WORKTREE_STUDIO_EXIT_FILE = oldExit;
  }
});
