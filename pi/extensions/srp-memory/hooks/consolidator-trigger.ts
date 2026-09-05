import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveEffectiveModel } from "../config.ts";
import {
  OM_OBSERVATIONS_DROPPED,
  foldLedger,
  lastSourceEntryId,
  observationToLine,
  poolTokens,
  selectPromotionOverflow,
  sortObservations,
  type Entry,
  type Observation,
} from "../ledger/index.ts";
import { nowTimestamp } from "../ledger/serialize.ts";
import { renderIndexFile } from "../memory/index-render.ts";
import { atomicWrite, indexPath, listTopics, readJourney } from "../memory/paths.ts";
import type { Runtime } from "../runtime.ts";
import { buildWorkerArgv, buildWorkerEnv, spawnWorker } from "../spawn/launch.ts";
import { runPromptPath } from "../spawn/runs.ts";
import { recordWorkerCost } from "./observer-trigger.ts";

type TriggerCtx = {
  hasUI: boolean;
  model?: { provider?: string; id?: string };
  ui?: { notify: (message: string, level?: "info" | "warning" | "error") => void };
  sessionManager: { getBranch: () => Entry[]; getEntries: () => Entry[] };
  getContextUsage?: () => { tokens: number | null } | undefined;
};

let runCounter = 0;

function nextRunId(): string {
  runCounter += 1;
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `cons-${stamp}-${process.pid}-${runCounter}`;
}

function buildConsolidatorPrompt(memoryRoot: string, promote: Observation[], journeyTargetTokens: number): string {
  const indexText = renderIndexFile(listTopics(memoryRoot));
  const journeyText = readJourney(memoryRoot);
  const journeyWords = Math.round((journeyTargetTokens * 3) / 4);
  const obsLines = sortObservations(promote).map(observationToLine).join("\n");
  return (
    `Current local time: ${nowTimestamp()}\n\n` +
    "You are folding the observations below into the durable topic files under .memory/. " +
    "Use this exact time string in the `updated` front-matter of any file you write, and in any new JOURNEY.md entry.\n\n" +
    "===== CURRENT MEMORY INDEX (generated; do not edit INDEX.md) =====\n" +
    `${indexText}\n` +
    "===== END MEMORY INDEX =====\n\n" +
    "===== CURRENT JOURNEY (.memory/JOURNEY.md — the running descriptive project history) =====\n" +
    `${journeyText ?? "(empty — no journey yet; start one)"}\n` +
    "===== END JOURNEY =====\n\n" +
    "===== OBSERVATIONS TO CONSOLIDATE (each line is `<timestamp-id>  <content>`) =====\n" +
    `${obsLines}\n` +
    "===== END OBSERVATIONS =====\n\n" +
    "Fold every observation above into topic files (create/merge/rewrite as needed). Then update " +
    `.memory/JOURNEY.md per your instructions — keep it under ~${journeyTargetTokens} tokens (~${journeyWords} words), ` +
    "purely descriptive, no advice or next steps. Finish with a one-sentence confirmation."
  );
}

export function evaluateConsolidatorTrigger(pi: ExtensionAPI, runtime: Runtime, ctx: TriggerCtx): void {
  if (!runtime.enabled || runtime.config.passive) return;
  if (runtime.consolidatorInFlight) return;

  const branch = ctx.sessionManager.getBranch();
  const active = foldLedger(branch).activeObservations;
  if (poolTokens(active) < runtime.config.consolidateAtPoolTokens) return;

  const { promote } = selectPromotionOverflow(active, runtime.config.poolTargetTokens);
  if (promote.length === 0) return;

  runtime.consolidatorInFlight = true;
  if (ctx.hasUI) {
    ctx.ui?.notify(`srp-memory: 长期归档已启动 (${promote.length} 条记录, ~${poolTokens(promote).toLocaleString()} tok)`, "info");
  }
  void dispatchConsolidator(pi, runtime, ctx, promote);
}

async function dispatchConsolidator(
  pi: ExtensionAPI,
  runtime: Runtime,
  ctx: TriggerCtx,
  promote: Observation[],
): Promise<void> {
  const runId = nextRunId();
  const controller = new AbortController();
  runtime.consolidatorController = controller;
  runtime.status.workerStart("consolidator", runId);

  try {
    const prompt = buildConsolidatorPrompt(runtime.memoryRoot, promote, runtime.config.journeyTargetTokens);
    const effectiveModel = resolveEffectiveModel(runtime.config.models.consolidator, ctx.model);
    const promptPath = runPromptPath(runtime.memoryRoot, runId);
    atomicWrite(promptPath, prompt);

    const argv = buildWorkerArgv({
      model: effectiveModel,
      sessionName: `om-consolidator-${runId}`,
      kickoffPrompt: prompt,
      promptPath,
    });
    const env = buildWorkerEnv("consolidator", { memoryRoot: runtime.memoryRoot, runId });
    const exit = await spawnWorker({ argv, cwd: runtime.memoryRoot, env, signal: controller.signal });
    recordWorkerCost(pi, runtime, ctx, "consolidator", runId);
    if (exit.code !== 0) {
      throw new Error(`consolidator exited with code ${exit.code}${exit.stderr ? `: ${exit.stderr.trim().slice(0, 200)}` : ""}`);
    }

    const branch = ctx.sessionManager.getBranch();
    const stillActive = new Set(foldLedger(branch).activeObservations.map((o) => o.timestamp));
    const toDrop = promote.map((o) => o.timestamp).filter((t) => stillActive.has(t));

    if (toDrop.length > 0) {
      const coversUpToId = lastSourceEntryId(branch);
      if (coversUpToId) {
        pi.appendEntry(OM_OBSERVATIONS_DROPPED, { observationTimestamps: toDrop, coversUpToId });
      }
    }

    atomicWrite(indexPath(runtime.memoryRoot), renderIndexFile(listTopics(runtime.memoryRoot)));

    runtime.status.workerDone(runId, toDrop.length);
    runtime.refreshFooterGauges(ctx.sessionManager.getBranch(), ctx.getContextUsage?.()?.tokens ?? null);
    if (ctx.hasUI && ctx.ui) {
      runtime.queueToast(`srp-memory: 长期归档完成，已归档 ${toDrop.length} 条观察记录`, "info", ctx.ui.notify.bind(ctx.ui));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.lastWorkerError = message;
    runtime.status.workerError(runId);
    if (ctx.hasUI) ctx.ui?.notify(`srp-memory: 长期归档运行失败: ${message}`, "error");
  } finally {
    runtime.consolidatorController = undefined;
    runtime.consolidatorInFlight = false;
  }
}

export function registerConsolidatorTrigger(pi: ExtensionAPI, runtime: Runtime): void {
  const handler = (_event: unknown, ctx: TriggerCtx) => evaluateConsolidatorTrigger(pi, runtime, ctx);
  pi.on("turn_end", handler as never);
  pi.on("agent_start", handler as never);
}
