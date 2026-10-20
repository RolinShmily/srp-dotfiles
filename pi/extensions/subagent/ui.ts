/**
 * subagent/ui.ts — Status widget for active subagent workers above the editor.
 *
 * Compact, borderless, multi-worker friendly layout matching the SRP theme suite.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { readSessionUsage, type SessionUsage } from "./session.ts";

export type WorkerState = "running" | "waiting" | "done" | "error";

export interface WorkerStatus {
  name: string;
  state: WorkerState;
  startTime: number;
  sessionFile: string;
  question?: string;
  error?: string;
  backend?: string;
}

export function formatTokenCount(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function usageSegments(usage: SessionUsage): string[] {
  const parts: string[] = [];
  if (usage.toolCount > 0) parts.push(`${usage.toolCount} calls`);
  if (usage.input > 0) parts.push(`↑${formatTokenCount(usage.input)}`);
  if (usage.output > 0) parts.push(`↓${formatTokenCount(usage.output)}`);
  if (usage.cost > 0) parts.push(`$${usage.cost < 0.1 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)}`);
  return parts;
}

function stateStyle(state: WorkerState, theme: Theme): { icon: string; label: string } {
  switch (state) {
    case "running":
      return { icon: theme.fg("accent", "●"), label: theme.fg("accent", "running") };
    case "waiting":
      return { icon: theme.fg("warning", "◆"), label: theme.fg("warning", "waiting: ask") };
    case "done":
      return { icon: theme.fg("success", "✔"), label: theme.fg("success", "done") };
    case "error":
      return { icon: theme.fg("error", "✖"), label: theme.fg("error", "error") };
  }
}

/**
 * Render multi-worker status lines for ctx.ui.setWidget.
 */
export function renderWorkersWidget(workers: WorkerStatus[], theme: Theme, maxRows = 4): string[] {
  if (workers.length === 0) return [];

  const waitingCount = workers.filter((w) => w.state === "waiting").length;
  const statusNote = waitingCount > 0 ? theme.fg("warning", ` · ${waitingCount} awaiting reply`) : "";
  const header = `${theme.fg("accent", "◆")} ${theme.bold("Subagents")} ${theme.fg("dim", `· ${workers.length} active`)}${statusNote}`;

  const visible = workers.slice(0, maxRows);
  const overflow = workers.length - visible.length;

  const rows = visible.map((worker) => {
    const elapsed = formatElapsed((Date.now() - worker.startTime) / 1000);
    const { icon, label } = stateStyle(worker.state, theme);

    let detail = "";
    if (worker.state === "waiting" && worker.question) {
      const q = worker.question.length > 40 ? `${worker.question.slice(0, 37)}...` : worker.question;
      detail = ` ${theme.fg("warning", `[Q: "${q}"]`)}`;
    } else {
      const usage = readSessionUsage(worker.sessionFile);
      if (usage) {
        const segments = usageSegments(usage).map((seg) => theme.fg("dim", seg));
        if (segments.length > 0) detail = ` ${segments.join(theme.fg("dim", " · "))}`;
      }
    }

    if (worker.state === "error" && worker.error) {
      detail = ` ${theme.fg("error", worker.error.split("\n")[0])}`;
    }

    const backendTag = worker.backend === "process" ? theme.fg("dim", " [bg]") : "";
    return `  ${icon} ${theme.bold(worker.name)}${backendTag} ${label} ${theme.fg("dim", elapsed)}${detail}`;
  });

  if (overflow > 0) {
    rows.push(`  ${theme.fg("muted", `+${overflow} more workers running...`)}`);
  }

  return [header, ...rows];
}
