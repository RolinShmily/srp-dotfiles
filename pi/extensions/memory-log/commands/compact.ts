import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Runtime } from "../runtime.ts";

export async function handleCompactCommand(_args: string, ctx: ExtensionContext, runtime: Runtime): Promise<void> {
  if (!runtime.enabled) {
    if (ctx.hasUI) ctx.ui.notify("memory-log is disabled (run /mem-log on to enable)", "info");
    return;
  }
  if (runtime.compactInFlight) {
    if (ctx.hasUI) ctx.ui.notify("memory-log: memory compaction is already in progress", "warning");
    return;
  }
  runtime.compactInFlight = true;
  if (ctx.hasUI) ctx.ui.notify("memory-log: compacting memory (waiting for pending observers)...", "info");
  ctx.compact({
    onComplete: () => {
      runtime.compactInFlight = false;
      if (ctx.hasUI) ctx.ui.notify("memory-log: memory compaction completed", "info");
    },
    onError: (error: { message: string }) => {
      runtime.compactInFlight = false;
      if (error.message === "Compaction cancelled") return;
      if (ctx.hasUI) ctx.ui.notify(`memory-log: compaction failed: ${error.message}`, "error");
    },
  });
}

export function registerCompactCommand(pi: ExtensionAPI, runtime: Runtime): void {
  const handler = async (args: string, ctx: ExtensionContext) => handleCompactCommand(args, ctx, runtime);

  pi.registerCommand("mem-log:compact", {
    description: "Run memory compaction immediately (ignore context threshold)",
    handler,
  });
}
