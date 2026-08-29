import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { foldLedger, poolTokens, rawTokensSinceObservationCoverage, sumSessionCost, type Entry } from "../ledger/index.ts";
import { listTopics, readJourney } from "../memory/paths.ts";
import { estimateStringTokens } from "../tokens.ts";
import type { Runtime } from "../runtime.ts";
import { renderTimeline } from "../ui/timeline.ts";

export async function handleStatusCommand(_args: string, ctx: ExtensionContext, runtime: Runtime): Promise<void> {
  if (!ctx.hasUI) return;
  if (!runtime.enabled) {
    ctx.ui.notify("srp-memory 已关闭（输入 /srp-memory on 开启）", "info");
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
    `─── SRP Observational Memory 状态 ───`,
    `  • Observers 并发数   : ${runtime.observersInFlight.size} / ${runtime.config.observerConcurrency}`,
    `  • 活跃观察记录 (条)  : ${folded.activeObservations.length}`,
    `  • 下次观察切片进度   : ${sinceObservation.toLocaleString()} / ${runtime.config.chunkTokens.toLocaleString()} tok`,
    `  • 活跃观察缓冲池     : ${pool.toLocaleString()} tok (目标: ${runtime.config.poolTargetTokens.toLocaleString()}, 触发: ${runtime.config.consolidateAtPoolTokens.toLocaleString()})`,
    `  • 长期归档状态 (Cons): ${runtime.consolidatorInFlight ? "运行中" : "空闲"}`,
    `  • 最近压缩等待状态   : ${runtime.lastCompactionObserverWait ?? "n/a"}`,
    `  • 长期主题文件数     : ${topicCount} 个 (.memory/<sessionId>/)`,
    `  • 演进简史 (Journey) : ${journey ? `~${estimateStringTokens(journey).toLocaleString()} / ${runtime.config.journeyTargetTokens.toLocaleString()} tok` : "暂无"}`,
    `  • 上下文容量使用     : ${contextTokens != null ? contextTokens.toLocaleString() : "?"} / ${runtime.config.compactAtContextTokens.toLocaleString()} tok`,
    `  • 会话累计支出 (Cost): $${costUsd.toFixed(4)} (${runs} 次运行)`,
    `  • 最近 Worker 异常   : ${runtime.lastWorkerError || "无"}`,
    ``,
    renderTimeline(branch, runtime.config),
  ];
  ctx.ui.notify(lines.join("\n"), "info");
}

export function registerStatusCommand(pi: ExtensionAPI, runtime: Runtime): void {
  const handler = async (args: string, ctx: ExtensionContext) => handleStatusCommand(args, ctx, runtime);

  pi.registerCommand("srp-memory:status", {
    description: "查看 SRP Observational Memory 运行状态",
    handler,
  });
}
