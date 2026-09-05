import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** What the observer model emits, before the orchestrator re-derives precise timestamp-ids. */
export type RawObservation = {
  timestamp: string; // "YYYY-MM-DD HH:MM"
  content: string;
};

export type ObserverRunResult = {
  observations: RawObservation[];
};

export function runsDir(root: string): string {
  return resolve(root, ".runs");
}

export function runResultPath(root: string, runId: string): string {
  return resolve(runsDir(root), `${runId}.result.json`);
}

/**
 * Per-run cost handoff file. Written by the worker EXTENSION from pi's built-in usage.cost.total.
 */
export function runCostPath(root: string, runId: string): string {
  return resolve(runsDir(root), `${runId}.cost.json`);
}

/**
 * Per-run prompt file for workers to avoid command line length limits (spawn ENAMETOOLONG on Windows).
 */
export function runPromptPath(root: string, runId: string): string {
  return resolve(runsDir(root), `${runId}.prompt.txt`);
}

export type WorkerCostResult = {
  costUsd: number;
};

export function writeWorkerCost(path: string, cost: WorkerCostResult): void {
  atomicWrite(path, JSON.stringify(cost));
}

/** Best-effort read of a worker cost file; returns undefined on missing/malformed input. */
export function readWorkerCost(path: string): WorkerCostResult | undefined {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const cost = (raw as { costUsd?: unknown }).costUsd;
    if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) return undefined;
    return { costUsd: cost };
  } catch {
    return undefined;
  }
}

/** Atomic write (temp + rename) so a reader never sees a half-written file. */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

function isRawObservation(value: unknown): value is RawObservation {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.timestamp === "string" && typeof v.content === "string" && v.content.trim().length > 0;
}

/** Parse + validate an observer result file. Throws on malformed input. */
export function readObserverResult(path: string): ObserverRunResult {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { observations?: unknown }).observations)) {
    throw new Error("observer result missing observations array");
  }
  const observations = (raw as { observations: unknown[] }).observations.filter(isRawObservation);
  return { observations };
}

export function writeObserverResult(path: string, result: ObserverRunResult): void {
  atomicWrite(path, JSON.stringify(result));
}
