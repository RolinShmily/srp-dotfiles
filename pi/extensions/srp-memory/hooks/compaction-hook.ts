import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderMemoryMap } from "../memory/index-render.ts";
import { listTopics, readJourney } from "../memory/paths.ts";
import type { Runtime } from "../runtime.ts";
import {
  buildCompactionProjection,
  entryIndexById,
  isObservationsRecordedEntry,
  isSourceEntry,
  isValidCutPoint,
  rawTokensAfterIndex,
  renderSummary,
  type Entry,
} from "../ledger/index.ts";

/** Distinct, branch-resolved coversUpToId indices of committed observation chunks, ascending. */
function chunkBoundaryIndices(branch: Entry[]): number[] {
  const indexes = entryIndexById(branch);
  const set = new Set<number>();
  for (const entry of branch) {
    if (!isObservationsRecordedEntry(entry)) continue;
    const idx = indexes.get(entry.data.coversUpToId);
    if (idx !== undefined) set.add(idx);
  }
  return Array.from(set).sort((a, b) => a - b);
}

/** First source entry after `boundaryIndex` that is a valid cut point, or undefined. */
function firstKeptAfterBoundary(branch: Entry[], boundaryIndex: number): Entry | undefined {
  for (let i = boundaryIndex + 1; i < branch.length; i++) {
    if (!isSourceEntry(branch[i])) continue;
    return isValidCutPoint(branch[i]) ? branch[i] : undefined;
  }
  return undefined;
}

export function snapCutoff(
  branch: Entry[],
  proposedFirstKeptId: string,
  tailTokens: number,
): { firstKeptId: string; tail: number | undefined } {
  const boundaries = chunkBoundaryIndices(branch);
  let bestId: string | undefined;
  let bestTail: number | undefined;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const boundaryIndex of boundaries) {
    const firstKept = firstKeptAfterBoundary(branch, boundaryIndex);
    if (!firstKept) continue;
    const tail = rawTokensAfterIndex(branch, boundaryIndex);
    const delta = Math.abs(tail - tailTokens);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestId = firstKept.id;
      bestTail = tail;
    }
  }

  return bestId ? { firstKeptId: bestId, tail: bestTail } : { firstKeptId: proposedFirstKeptId, tail: undefined };
}

export function snapFirstKeptEntryId(branch: Entry[], proposedFirstKeptId: string, tailTokens: number): string {
  return snapCutoff(branch, proposedFirstKeptId, tailTokens).firstKeptId;
}

export function canSkipObserverWait(
  branch: Entry[],
  snappedFirstKeptId: string,
  snappedTail: number | undefined,
  tailTokens: number,
  observersInFlight: Iterable<{ coversUpToId: string }>,
): boolean {
  if (snappedTail === undefined || snappedTail > tailTokens) return false;

  const indexes = entryIndexById(branch);
  const cutoffIndex = indexes.get(snappedFirstKeptId);
  if (cutoffIndex === undefined) return false;

  for (const { coversUpToId } of observersInFlight) {
    const idx = indexes.get(coversUpToId);
    if (idx === undefined || idx < cutoffIndex) return false;
  }
  return true;
}

export function registerCompactionHook(pi: ExtensionAPI, runtime: Runtime): void {
  pi.on("session_before_compact", async (event: any, ctx: any) => {
    if (!runtime.enabled || runtime.config.passive) return undefined;

    const hasUI = ctx.hasUI;
    if (runtime.compactHookInFlight) {
      if (hasUI) ctx.ui.notify("srp-memory: 检测到另一项压缩正在进行中，已忽略重复触发", "warning");
      return { cancel: true };
    }

    runtime.compactHookInFlight = true;
    try {
      runtime.ensureConfig(ctx.cwd);
      const tailTokens = runtime.config.tailTokens;
      const { firstKeptEntryId, tokensBefore } = event.preparation;

      let branch = (ctx.sessionManager?.getBranch?.() as Entry[] | undefined) ?? (event.branchEntries as Entry[]);
      let snap = snapCutoff(branch, firstKeptEntryId, tailTokens);

      const skip = canSkipObserverWait(branch, snap.firstKeptId, snap.tail, tailTokens, runtime.observersInFlight.values());
      runtime.lastCompactionObserverWait = skip ? "skipped" : "waited";
      if (!skip) {
        if (hasUI) ctx.ui.notify("srp-memory: 正在等待处理中的 Observers 完成归并…", "info");
        await runtime.whenObserversIdle();
        branch = (ctx.sessionManager?.getBranch?.() as Entry[] | undefined) ?? (event.branchEntries as Entry[]);
        snap = snapCutoff(branch, firstKeptEntryId, tailTokens);
      }

      const snapped = snap.firstKeptId;
      const projection = buildCompactionProjection(branch, snapped);
      const journey = readJourney(runtime.memoryRoot);
      const map = renderMemoryMap(listTopics(runtime.memoryRoot));
      const summary = renderSummary(journey, map, projection.observations);

      return {
        compaction: {
          summary,
          firstKeptEntryId: snapped,
          tokensBefore,
          details: projection.details,
        },
      };
    } finally {
      runtime.compactHookInFlight = false;
    }
  });
}
