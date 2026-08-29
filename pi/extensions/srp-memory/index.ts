/**
 * srp-memory — SRP Observational Memory (Orchestrator).
 *
 * 分层异步子进程观测记忆系统：
 * - Observers: 后台并发提取会话片段，生成带精准时间戳的原子事实观察记录；
 * - Ledger: 随分支持久化记录到当前主会话；
 * - Compaction: 压缩时模型免调用、确定性渲染恢复上下文（带 Journey、Memory Map 与短期缓冲区）；
 * - Consolidator: 自动归档旧记忆至 .memory/<sessionId>/ durable 长期主题文件与 JOURNEY.md。
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

function readGateFromLedger(branch: Entry[]): boolean {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === OM_ENABLED) {
      return (entry.data as { enabled?: boolean } | undefined)?.enabled ?? false;
    }
  }
  return false;
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
    runtime.enabled = readGateFromLedger(branch);
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
      if (ctx.hasUI) ctx.ui.notify(`srp-memory 当前已处于 ${next ? "开启" : "关闭"} 状态`, "info");
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
    if (ctx.hasUI) ctx.ui.notify(`srp-memory 已${next ? "开启" : "关闭"}`, "info");
  };

  // 统一主控制命令：/srp-memory [status|on|off|compact|consolidate]
  pi.registerCommand("srp-memory", {
    description: "管理观测记忆系统（/srp-memory [status|on|off|compact|consolidate]）",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "status", label: "status", description: "查看当前观测记忆系统状态与时间线" },
        { value: "on", label: "on", description: "为当前会话启用观测记忆" },
        { value: "off", label: "off", description: "为当前会话停用观测记忆" },
        { value: "compact", label: "compact", description: "立即执行记忆压缩（忽略阈值）" },
        { value: "consolidate", label: "consolidate", description: "立即归档短期观察至长期主题文件" },
      ];
      const trimmed = prefix.trimStart();
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx: ExtensionContext) => {
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

      // 切换开关
      setGate(!runtime.enabled, ctx);
    },
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
