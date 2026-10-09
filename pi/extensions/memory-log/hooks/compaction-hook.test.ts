import test from "node:test";
import assert from "node:assert";
import { snapCutoff, snapFirstKeptEntryId } from "./compaction-hook.ts";
import { contextPressureTokens, turnWillContinue } from "./compaction-trigger.ts";
import { OM_OBSERVATIONS_RECORDED, type Entry } from "../ledger/index.ts";

function makeMessageEntry(id: string, role: "user" | "assistant", text: string): Entry {
  return {
    type: "message",
    id,
    message: {
      role,
      content: text,
    },
  };
}

function makeObservationEntry(id: string, coversUpToId: string): Entry {
  return {
    type: "custom",
    customType: OM_OBSERVATIONS_RECORDED,
    id,
    data: {
      coversUpToId,
      observations: [
        {
          timestamp: "2026-09-10T12:00:00",
          content: "Observation content",
          tokenCount: 10,
        },
      ],
    },
  };
}

function makeCompactionEntry(id: string, firstKeptEntryId: string): Entry {
  return {
    type: "compaction",
    id,
    summary: "Compacted conversation summary",
    firstKeptEntryId,
  };
}

test("snapCutoff: without prior compaction, snaps to boundary closest to tailTokens", () => {
  // m0 (100 tok), m1 (100 tok), obs1 (covers m1), m2 (100 tok), m3 (100 tok), obs2 (covers m3), m4 (100 tok)
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)), // 100 tok
    makeMessageEntry("m1", "assistant", "b".repeat(400)), // 100 tok
    makeObservationEntry("obs1", "m1"),
    makeMessageEntry("m2", "user", "c".repeat(400)), // 100 tok
    makeMessageEntry("m3", "assistant", "d".repeat(400)), // 100 tok
    makeObservationEntry("obs2", "m3"),
    makeMessageEntry("m4", "user", "e".repeat(400)), // 100 tok
  ];

  // Tail after boundary m1 (idx 1): m2 (100) + m3 (100) + m4 (100) = 300 tok. First kept = m2.
  // Tail after boundary m3 (idx 4): m4 (100) = 100 tok. First kept = m4.
  // If target tail is 110, boundary m3 is much closer (delta 10 vs 190)
  const snap = snapCutoff(branch, "fallback", 110);
  assert.strictEqual(snap.firstKeptId, "m4");
  assert.strictEqual(snap.tail, 100);
});

test("snapCutoff: NEVER selects a boundary or firstKeptId before or at a prior compaction entry", () => {
  // Scenario:
  // entry 0: m0 (100 tok)
  // entry 1: m1 (100 tok)
  // entry 2: obs1 (covers m1)
  // entry 3: compaction c1 (firstKeptEntryId: m1)
  // entry 4: m2 (100 tok)
  // entry 5: m3 (100 tok)
  // entry 6: obs2 (covers m3)
  // entry 7: m4 (100 tok)
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeMessageEntry("m1", "assistant", "b".repeat(400)),
    makeObservationEntry("obs1", "m1"), // boundary at idx 1 (before compaction at idx 3)
    makeCompactionEntry("c1", "m1"),
    makeMessageEntry("m2", "user", "c".repeat(400)),
    makeMessageEntry("m3", "assistant", "d".repeat(400)),
    makeObservationEntry("obs2", "m3"), // boundary at idx 5 (after compaction at idx 3)
    makeMessageEntry("m4", "user", "e".repeat(400)),
  ];

  // Tail after boundary m1: m2 (100) + m3 (100) + m4 (100) = 300 tok.
  // Tail after boundary m3: m4 (100) = 100 tok.
  // If tailTokens = 295, boundary m1 (tail 300) would be closer (delta 5) than m3 (delta 195).
  // BUT boundary m1 is before compaction c1 (idx 1 < idx 3).
  // snapCutoff MUST NOT select m1 or anything before c1!
  const snap = snapCutoff(branch, "fallback", 295);
  assert.strictEqual(snap.firstKeptId, "m4");
  assert.strictEqual(snap.tail, 100);
  assert.strictEqual(snapFirstKeptEntryId(branch, "fallback", 295), "m4");
});

test("snapCutoff: handles multiple compactions and respects the latest compaction", () => {
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeCompactionEntry("c1", "m0"), // first compaction at idx 1
    makeMessageEntry("m1", "user", "b".repeat(400)),
    makeMessageEntry("m2", "assistant", "c".repeat(400)),
    makeObservationEntry("obs1", "m2"), // boundary at idx 4
    makeCompactionEntry("c2", "m1"), // second compaction at idx 5
    makeMessageEntry("m3", "user", "d".repeat(400)),
    makeMessageEntry("m4", "assistant", "e".repeat(400)),
    makeObservationEntry("obs2", "m4"), // boundary at idx 8
    makeMessageEntry("m5", "user", "f".repeat(400)),
  ];

  // Boundary m2 (idx 4) is after c1 but BEFORE c2 (idx 5).
  // Target tail: 200.
  // Tail after m2 is m3 (100) + m4 (100) + m5 (100) = 300 tok.
  // Tail after m4 is m5 (100) = 100 tok.
  // Even if tailTokens is 290 (closer to 300 than 100), m2 must be excluded because idx 4 <= lastCompactionIdx (5).
  const snap = snapCutoff(branch, "proposedId", 290);
  assert.strictEqual(snap.firstKeptId, "m5");
  assert.strictEqual(snap.tail, 100);
});

test("snapCutoff: falls back to proposedFirstKeptId when all chunk boundaries are before prior compaction", () => {
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeMessageEntry("m1", "assistant", "b".repeat(400)),
    makeObservationEntry("obs1", "m1"), // boundary at idx 1
    makeCompactionEntry("c1", "m1"), // compaction at idx 3
    makeMessageEntry("m2", "user", "c".repeat(400)),
    makeMessageEntry("m3", "assistant", "d".repeat(400)),
  ];

  // No observation chunk boundaries exist after c1.
  // snapCutoff must fall back to proposedFirstKeptId.
  const snap = snapCutoff(branch, "m2", 100);
  assert.strictEqual(snap.firstKeptId, "m2");
  assert.strictEqual(snap.tail, undefined);
});

test("contextPressureTokens: returns due: false when last entry is a compaction", () => {
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeMessageEntry("m1", "assistant", "b".repeat(400)),
    makeCompactionEntry("c1", "m1"),
  ];

  const ctx = {
    getContextUsage: () => ({ tokens: 50_000 }),
    sessionManager: { getBranch: () => branch },
  };

  const result = contextPressureTokens(ctx, 10_000);
  assert.strictEqual(result.due, false);
  assert.strictEqual(result.tokens, 0);
});

test("contextPressureTokens: returns due: false when context was compacted and no assistant has responded", () => {
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeMessageEntry("m1", "assistant", "b".repeat(400)),
    makeCompactionEntry("c1", "m1"),
    makeMessageEntry("m2", "user", "c".repeat(400)), // only user prompt after compaction, no assistant yet
  ];

  const ctx = {
    // In Pi, getContextUsage() returns tokens: null after compaction until assistant responds
    getContextUsage: () => ({ tokens: null }),
    sessionManager: { getBranch: () => branch },
  };

  const result = contextPressureTokens(ctx, 100);
  assert.strictEqual(result.due, false);
  assert.strictEqual(result.tokens, 0);
});

test("contextPressureTokens: returns due: false when no new tokens exist after compaction entry", () => {
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeCompactionEntry("c1", "m0"),
    { type: "custom", id: "cust1", customType: "om.enabled", data: { enabled: true } },
  ];

  const ctx = {
    getContextUsage: () => ({ tokens: null }),
    sessionManager: { getBranch: () => branch },
  };

  const result = contextPressureTokens(ctx, 50);
  assert.strictEqual(result.due, false);
  assert.strictEqual(result.tokens, 0);
});

test("contextPressureTokens: triggers when threshold is exceeded after assistant responds post-compaction", () => {
  const branch: Entry[] = [
    makeMessageEntry("m0", "user", "a".repeat(400)),
    makeMessageEntry("m1", "assistant", "b".repeat(400)),
    makeCompactionEntry("c1", "m1"),
    makeMessageEntry("m2", "user", "c".repeat(400)),
    makeMessageEntry("m3", "assistant", "d".repeat(400)),
  ];

  const ctxLive = {
    getContextUsage: () => ({ tokens: 25_000 }),
    sessionManager: { getBranch: () => branch },
  };

  // Live usage >= threshold
  assert.strictEqual(contextPressureTokens(ctxLive, 20_000).due, true);
  assert.strictEqual(contextPressureTokens(ctxLive, 30_000).due, false);

  // Fallback to rawTokensSinceLastCompaction when getContextUsage() returns null
  const ctxNull = {
    getContextUsage: () => ({ tokens: null }),
    sessionManager: { getBranch: () => branch },
  };
  // m1 (100) + m2 (100) + m3 (100) = 300 raw tokens
  assert.strictEqual(contextPressureTokens(ctxNull, 200).due, true);
  assert.strictEqual(contextPressureTokens(ctxNull, 500).due, false);
});

test("turnWillContinue: correctly detects continuation", () => {
  assert.strictEqual(turnWillContinue({ toolResults: [{ toolCallId: "1" }] }), true);
  assert.strictEqual(turnWillContinue({ message: { stopReason: "tool_use" } }), true);
  assert.strictEqual(turnWillContinue({ message: { stopReason: "tool_calls" } }), true);
  assert.strictEqual(turnWillContinue({ message: { stopReason: "stop" } }), false);
  assert.strictEqual(turnWillContinue({ message: { stopReason: "error" } }), false);
});
