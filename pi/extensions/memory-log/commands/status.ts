import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { foldLedger, poolTokens, rawTokensSinceObservationCoverage, sumSessionCost, type Entry } from "../ledger/index.ts";
import { listTopics, readJourney } from "../memory/paths.ts";
import { estimateStringTokens } from "../tokens.ts";
import type { Runtime } from "../runtime.ts";
import { renderTimeline } from "../ui/timeline.ts";

export async function handleStatusCommand(_args: string, ctx: ExtensionContext, runtime: Runtime): Promise<void> {
  if (!ctx.hasUI) return;
  if (!runtime.enabled) {
    ctx.ui.notify("memory-log is disabled (run /mem-log on to enable)", "info");
    return;
  }
  runtime.ensureConfig(ctx.cwd);
  const branch = ctx.sessionManager.getBranch() as Entry[];
  const folded = foldLedger(branch);
  const sinceObservation = rawTokensSinceObservationCoverage(branch);
  const contextTokens = ctx.getContextUsage?.()?.tokens ?? null;
  const pool = poolTokens(folded.activeObservations);
  const topicCount = listTopics(runtime.memoryRoot).length;
  const journey = readJourney(runtime.memoryRoot);
  const { costUsd, runs } = sumSessionCost(ctx.sessionManager.getEntries() as Entry[]);

  const lines = [
    `─── Observational Memory Log Status ───`,
    `  • Active observers      : ${runtime.observersInFlight.size} / ${runtime.config.observerConcurrency}`,
    `  • Active observations   : ${folded.activeObservations.length}`,
    `  • Next chunk progress   : ${sinceObservation.toLocaleString()} / ${runtime.config.chunkTokens.toLocaleString()} tok`,
    `  • Active observation pool: ${pool.toLocaleString()} tok (target: ${runtime.config.poolTargetTokens.toLocaleString()}, trigger: ${runtime.config.consolidateAtPoolTokens.toLocaleString()})`,
    `  • Consolidator status   : ${runtime.consolidatorInFlight ? "running" : "idle"}` ,
    `  • Compaction wait status : ${runtime.lastCompactionObserverWait ?? "n/a"}`,
    `  • Topic files count     : ${topicCount} (.memory/<sessionId>/)`,
    `  • Journey history       : ${journey ? `~${estimateStringTokens(journey).toLocaleString()} / ${runtime.config.journeyTargetTokens.toLocaleString()} tok` : "none"}`,
    `  • Context window usage  : ${contextTokens != null ? contextTokens.toLocaleString() : "?"} / ${runtime.config.compactAtContextTokens.toLocaleString()} tok`,
    `  • Session total cost    : $${costUsd.toFixed(4)} (${runs} run${runs === 1 ? "" : "s"})`,
    `  • Last worker error     : ${runtime.lastWorkerError || "none"}`,
    ``,
    renderTimeline(branch, runtime.config),
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export function registerStatusCommand(pi: ExtensionAPI, runtime: Runtime): void {
  const handler = async (args: string, ctx: ExtensionContext) => handleStatusCommand(args, ctx, runtime);

  pi.registerCommand("mem-log:status", {
    description: "View observational memory log running status",
    handler,
  });
}
