/**
 * subagent/ui.ts — status widget for the observability pane above the editor.
 *
 * This is intentionally a compact, borderless list. All text is English
 * because the lines can reach the model.
 *
 * State model is upstream's (`RunState`), not the SRP status snapshot: the child
 * writes `metadata.json` itself, so no screen scraping is involved.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { readSessionUsage, type RunMetadata, type RunState, type SessionUsage } from "./shared.ts";

// Theme helpers already produce valid terminal sequences. Avoid adding manual
// ANSI codes here: widgets receive strings that may already be styled.

// ============================ Formatting helpers ============================

export function formatTokenCount(value: number): string {
  if (value < 1000) return `${value}`;
  if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function usageSegments(usage: SessionUsage): string[] {
  const parts: string[] = [];
  if (usage.toolCount > 0) parts.push(`${usage.toolCount} calls`);
  if (usage.input > 0) parts.push(`↑${formatTokenCount(usage.input)}`);
  if (usage.output > 0) parts.push(`↓${formatTokenCount(usage.output)}`);
  if (usage.cacheRead > 0) parts.push(`R:${formatTokenCount(usage.cacheRead)}`);
  if (usage.cacheWrite > 0) parts.push(`W:${formatTokenCount(usage.cacheWrite)}`);
  if (usage.cost > 0) parts.push(`$${usage.cost < 0.1 ? usage.cost.toFixed(4) : usage.cost.toFixed(3)}`);
  return parts;
}

/** Per-state glyph and theme colour, matching the SRP suite's status vocabulary. */
function stateStyle(state: RunState, theme: Theme): { icon: string; label: string } {
  switch (state) {
    case "busy":
      return { icon: theme.fg("warning", "◆"), label: theme.fg("warning", "busy") };
    case "idle":
      return { icon: theme.fg("success", "✔"), label: theme.fg("success", "idle") };
    case "error":
      return { icon: theme.fg("error", "✖"), label: theme.fg("error", "error") };
    case "starting":
      return { icon: theme.fg("accent", "◌"), label: theme.fg("accent", "starting") };
    default:
      return { icon: theme.fg("dim", "·"), label: theme.fg("dim", "exited") };
  }
}

// ============================ Widget ============================

export interface RunWidgetRow {
  run: RunMetadata;
  state: RunState;
}

/**
 * Render the subagent status list. It uses plain lines because
 * `ctx.ui.setWidget` takes rendered strings, not TUI components.
 */
export function renderRunWidget(rows: RunWidgetRow[], theme: Theme, maxRows = 5): string[] {
  if (rows.length === 0) return [];

  const visible = rows.slice(0, maxRows);
  const overflow = rows.length - visible.length;

  const busiest = rows.some((row) => row.state === "busy")
    ? "busy"
    : rows.some((row) => row.state === "starting")
      ? "starting"
      : "idle";
  const header = `${theme.fg("accent", "◆")} ${theme.bold("Subagents")} ${theme.fg("dim", `· ${rows.length} active · ${busiest}`)}`;

  const body = visible.map(({ run, state }) => {
    const elapsed = formatElapsed((Date.now() - Date.parse(run.createdAt)) / 1000);
    const { icon, label } = stateStyle(state, theme);

    const name = run.name ?? run.handle;
    const handleTag = run.name ? theme.fg("dim", ` (${run.handle})`) : "";
    const modelTag = theme.fg("muted", ` · ${run.model.split("/").pop()}`);

    let detail = "";
    const usage = readSessionUsage(run.sessionFile);
    if (usage) {
      const segments = usageSegments(usage).map((segment) => theme.fg("dim", segment));
      if (segments.length > 0) detail = ` ${segments.join(theme.fg("dim", "  "))}`;
    }
    if (state === "error" && run.error) {
      detail = ` ${theme.fg("error", run.error.split("\n")[0])}`;
    }

    return `  ${icon} ${theme.bold(name)}${handleTag} ${label} ${theme.fg("dim", elapsed)}${modelTag}${detail}`;
  });

  if (overflow > 0) body.push(`  ${theme.fg("muted", `+${overflow} more`)}`);
  return [header, ...body];
}
