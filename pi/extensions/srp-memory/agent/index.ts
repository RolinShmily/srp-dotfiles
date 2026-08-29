import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { trackWorkerCost } from "./cost.ts";
import { CONSOLIDATOR_SYSTEM } from "./consolidator/prompt.ts";
import { registerConsolidatorTools } from "./consolidator/tools.ts";
import { OBSERVER_SYSTEM } from "./observer/prompt.ts";
import { registerObserverTool } from "./observer/tool.ts";

export default function omWorker(pi: ExtensionAPI): void {
  const role = process.env.OM_WORKER;
  const resultPath = process.env.OM_RESULT_PATH;

  trackWorkerCost(pi);

  if (role === "observer") {
    if (!resultPath) throw new Error("OM_RESULT_PATH not set for observer worker");
    registerObserverTool(pi, resultPath);

    pi.on("before_agent_start", async () => {
      return { systemPrompt: OBSERVER_SYSTEM };
    });

    pi.on("agent_end", async (_event: unknown, ctx: { shutdown: () => void }) => {
      ctx.shutdown();
    });
    return;
  }

  if (role === "consolidator") {
    const memoryRoot = process.env.OM_MEMORY_DIR;
    if (!memoryRoot) throw new Error("OM_MEMORY_DIR not set for consolidator worker");
    registerConsolidatorTools(pi, memoryRoot);

    pi.on("before_agent_start", async () => {
      return { systemPrompt: CONSOLIDATOR_SYSTEM };
    });

    pi.on("agent_end", async (_event: unknown, ctx: { shutdown: () => void }) => {
      ctx.shutdown();
    });
    return;
  }
}
