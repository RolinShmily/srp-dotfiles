/**
 * memory-log — Observational Memory Log (Orchestrator).
 *
 * Tiered asynchronous subprocess observational memory system:
 * - Observers: Background concurrent distillation of conversation chunks into timestamped atomic facts;
 * - Ledger: Persists with branches to the current session;
 * - Compaction: Model-free deterministic context reconstruction (Journey, Memory Map, short-term buffer);
 * - Consolidator: Auto-archives older observations to durable topic files under .memory/<sessionId>/ and JOURNEY.md.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { handleCompactCommand, registerCompactCommand } from "./commands/compact.ts";
import { handleConsolidateCommand, registerConsolidateCommand } from "./commands/consolidate.ts";
import { handleStatusCommand, registerStatusCommand } from "./commands/status.ts";
import { registerCompactionHook } from "./hooks/compaction-hook.ts";
import { registerCompactionTrigger } from "./hooks/compaction-trigger.ts";
import { registerConsolidatorTrigger } from "./hooks/consolidator-trigger.ts";
import { registerObserverTrigger } from "./hooks/observer-trigger.ts";
import { OM_ENABLED, type Entry } from "./ledger/index.ts";
import { ensureSessionMemory } from "./memory/session.ts";
import { Runtime } from "./runtime.ts";

function readGateFromLedger(branch: Entry[], defaultEnabled: boolean): boolean {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === OM_ENABLED) {
      return (entry.data as { enabled?: boolean } | undefined)?.enabled ?? defaultEnabled;
    }
  }
  return defaultEnabled;
}

export default function observationalMemory(pi: ExtensionAPI): void {
  const runtime = new Runtime();

  function attachIfEnabled(ctx: any): void {
    if (runtime.enabled && ctx.mode === "tui" && ctx.hasUI && ctx.ui) {
      runtime.status.attach(ctx.ui);
    } else {
      runtime.status.detach();
    }
  }

  pi.on("session_start", (_event: unknown, ctx: any) => {
    runtime.ensureConfig(ctx.cwd);
    runtime.dispatchedCoversUpToId = undefined;
    const branch = ctx.sessionManager.getBranch() as Entry[];
    runtime.enabled = readGateFromLedger(branch, runtime.config.defaultEnabled);
    if (runtime.enabled) runtime.memoryRoot = ensureSessionMemory(ctx);
    attachIfEnabled(ctx);
    runtime.refreshFooterGauges(branch, ctx.getContextUsage?.()?.tokens ?? null);
    runtime.refreshCost(ctx.sessionManager.getEntries() as Entry[]);
  });

  pi.on("session_shutdown", () => {
    runtime.status.detach();
    runtime.abortAllWorkers();
  });

  const setGate = (next: boolean, ctx: ExtensionContext) => {
    if (next === runtime.enabled) {
      if (ctx.hasUI) ctx.ui.notify(`memory-log is already ${next ? "enabled" : "disabled"}`, "info");
      return;
    }
    runtime.enabled = next;
    pi.appendEntry(OM_ENABLED, { enabled: next });
    if (next) {
      runtime.memoryRoot = ensureSessionMemory(ctx as any);
      attachIfEnabled(ctx);
      runtime.refreshFooterGauges(
        (ctx as any).sessionManager.getBranch() as Entry[],
        (ctx as any).getContextUsage?.()?.tokens ?? null,
      );
      runtime.refreshCost((ctx as any).sessionManager.getEntries() as Entry[]);
    } else {
      runtime.abortAllWorkers();
      runtime.status.detach();
    }
    if (ctx.hasUI) ctx.ui.notify(`memory-log is now ${next ? "enabled" : "disabled"}`, "info");
  };

  const getCompletions = (prefix: string): AutocompleteItem[] | null => {
    const candidates: AutocompleteItem[] = [
      { value: "status", label: "status", description: "View memory log system status and timeline" },
      { value: "on", label: "on", description: "Enable memory log for current session" },
      { value: "off", label: "off", description: "Disable memory log for current session" },
      { value: "compact", label: "compact", description: "Run memory compaction immediately (ignore context threshold)" },
      { value: "consolidate", label: "consolidate", description: "Archive short-term observations to durable topic files immediately" },
    ];
    const trimmed = prefix.trimStart();
    const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
    return filtered.length > 0 ? filtered : null;
  };

  const commandHandler = async (args: string, ctx: ExtensionContext) => {
    const action = (args.trim().split(/\s+/)[0] || "").toLowerCase();

    if (action === "on") {
      setGate(true, ctx);
      return;
    }

    if (action === "off") {
      setGate(false, ctx);
      return;
    }

    if (action === "compact") {
      await handleCompactCommand(args, ctx, runtime);
      return;
    }

    if (action === "consolidate") {
      await handleConsolidateCommand(args, ctx, runtime);
      return;
    }

    if (action === "status" || action === "timeline" || !action) {
      if (!action && !runtime.enabled) {
        setGate(true, ctx);
        return;
      }
      await handleStatusCommand(args, ctx, runtime);
      return;
    }

    // Toggle gate if unknown action
    setGate(!runtime.enabled, ctx);
  };

  // Primary command: /mem-log [status|on|off|compact|consolidate]
  pi.registerCommand("mem-log", {
    description: "Manage observational memory log system (/mem-log [status|on|off|compact|consolidate])",
    getArgumentCompletions: getCompletions,
    handler: commandHandler,
  });

  // Aliases for compatibility and convenience
  pi.registerCommand("memory-log", {
    description: "Manage observational memory log system (/memory-log [status|on|off|compact|consolidate])",
    getArgumentCompletions: getCompletions,
    handler: commandHandler,
  });
  pi.registerCommand("memory", {
    description: "Manage observational memory log system (/memory [status|on|off|compact|consolidate])",
    getArgumentCompletions: getCompletions,
    handler: commandHandler,
  });

  // Triggers + hooks
  registerObserverTrigger(pi, runtime);
  registerConsolidatorTrigger(pi, runtime);
  registerCompactionTrigger(pi, runtime);
  registerCompactionHook(pi, runtime);

  // Subcommands (:status, :compact, :consolidate)
  registerStatusCommand(pi, runtime);
  registerCompactCommand(pi, runtime);
  registerConsolidateCommand(pi, runtime);
}
