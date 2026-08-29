import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { writeWorkerCost } from "../spawn/runs.ts";

type CostUsage = { cost?: { total?: unknown } };
type MaybeAssistantMessage = { role?: string; usage?: CostUsage };

/**
 * Register shared cost accumulation for subprocess workers.
 */
export function trackWorkerCost(pi: ExtensionAPI): void {
  const costPath = process.env.OM_COST_PATH;
  if (!costPath) return;

  let costUsd = 0;

  pi.on("message_end", async (event: { message?: MaybeAssistantMessage }) => {
    const message = event?.message;
    if (message?.role !== "assistant") return;
    const total = message.usage?.cost?.total;
    if (typeof total === "number" && Number.isFinite(total) && total > 0) {
      costUsd += total;
    }
  });

  pi.on("agent_end", async () => {
    try {
      writeWorkerCost(costPath, { costUsd });
    } catch {
      // ignore — cost is non-critical telemetry
    }
  });
}
