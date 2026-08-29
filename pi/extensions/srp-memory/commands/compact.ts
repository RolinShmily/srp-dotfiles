import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.ts";

export async function handleCompactCommand(_args: string, ctx: ExtensionContext, runtime: Runtime): Promise<void> {
  if (!runtime.enabled) {
    if (ctx.hasUI) ctx.ui.notify("srp-memory 已关闭（输入 /srp-memory on 开启）", "info");
    return;
  }
  if (runtime.compactInFlight) {
    if (ctx.hasUI) ctx.ui.notify("srp-memory: 记忆压缩已在进行中", "warning");
    return;
  }
  runtime.compactInFlight = true;
  if (ctx.hasUI) ctx.ui.notify("srp-memory: 正在执行记忆压缩（等待处理中的 Observers）…", "info");
  ctx.compact({
    onComplete: () => {
      runtime.compactInFlight = false;
      if (ctx.hasUI) ctx.ui.notify("srp-memory: 记忆压缩完成", "info");
    },
    onError: (error: { message: string }) => {
      runtime.compactInFlight = false;
      if (error.message === "Compaction cancelled") return;
      if (ctx.hasUI) ctx.ui.notify(`srp-memory: 压缩失败: ${error.message}`, "error");
    },
  });
}

export function registerCompactCommand(pi: ExtensionAPI, runtime: Runtime): void {
  const handler = async (args: string, ctx: ExtensionContext) => handleCompactCommand(args, ctx, runtime);

  pi.registerCommand("srp-memory:compact", {
    description: "立即执行记忆压缩（忽略上下文阈值）",
    handler,
  });
}
