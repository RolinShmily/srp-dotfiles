import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { foldLedger, poolTokens, selectPromotionOverflow, type Entry } from "../ledger/index.ts";
import type { Runtime } from "../runtime.ts";
import { evaluateConsolidatorTrigger } from "../hooks/consolidator-trigger.ts";

export async function handleConsolidateCommand(_args: string, ctx: ExtensionContext, runtime: Runtime): Promise<void> {
  if (!runtime.enabled) {
    if (ctx.hasUI) ctx.ui.notify("srp-memory 已关闭（输入 /srp-memory on 开启）", "info");
    return;
  }
  if (runtime.consolidatorInFlight) {
    if (ctx.hasUI) ctx.ui.notify("srp-memory: 长期记忆归档正在进行中", "warning");
    return;
  }
  runtime.ensureConfig(ctx.cwd);
  const branch = ctx.sessionManager.getBranch() as Entry[];
  const active = foldLedger(branch).activeObservations;
  const { promote } = selectPromotionOverflow(active, runtime.config.poolTargetTokens);
  if (promote.length === 0) {
    if (ctx.hasUI) {
      ctx.ui.notify(
        `srp-memory: 当前无需归档（缓冲池 ${poolTokens(active).toLocaleString()} tok <= 目标 ${runtime.config.poolTargetTokens.toLocaleString()} tok）`,
        "info",
      );
    }
    return;
  }
  const saved = runtime.config.consolidateAtPoolTokens;
  runtime.config.consolidateAtPoolTokens = 0;
  try {
    evaluateConsolidatorTrigger(piInstance!, runtime, ctx);
  } finally {
    runtime.config.consolidateAtPoolTokens = saved;
  }
}

let piInstance: ExtensionAPI | undefined;

export function registerConsolidateCommand(pi: ExtensionAPI, runtime: Runtime): void {
  piInstance = pi;
  const handler = async (args: string, ctx: ExtensionContext) => handleConsolidateCommand(args, ctx, runtime);

  pi.registerCommand("srp-memory:consolidate", {
    description: "立即归档短期观察至长期主题文件（忽略缓冲池阈值）",
    handler,
  });
}
