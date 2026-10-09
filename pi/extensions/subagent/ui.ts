/**
 * subagent/ui.ts — status widget for the observability pane above the editor.
 *
 * Visual style ported from the SRP dotfiles extension suite:
 *   neon pink (#ff7eb3) -> coral (#f75c7e) -> violet (#7c3aed)
 * Cards are box-drawn with a gradient rule so a run stays recognisable at a
 * glance. All text is English because the lines can reach the model.
 *
 * State model is upstream's (`RunState`), not the SRP status snapshot: the child
 * writes `metadata.json` itself, so no screen scraping is involved.
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { readSessionUsage, type RunMetadata, type RunState, type SessionUsage } from "./shared.ts";

// ============================ Gradient palette ============================

const PINK: [number, number, number] = [255, 126, 179];
const CORAL: [number, number, number] = [247, 92, 126];
const VIOLET: [number, number, number] = [124, 58, 237];

function interpolate(from: [number, number, number], to: [number, number, number], t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    Math.round(from[0] + (to[0] - from[0]) * clamped),
    Math.round(from[1] + (to[1] - from[1]) * clamped),
    Math.round(from[2] + (to[2] - from[2]) * clamped),
  ];
}

/** ANSI truecolor escape for position `t` (0..1) along the pink→coral→violet ramp. */
function gradientAnsi(t: number): string {
  const rgb = t < 0.4 ? interpolate(PINK, CORAL, t / 0.4) : interpolate(CORAL, VIOLET, (t - 0.4) / 0.6);
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

const RESET = "\x1b[0m";

/** Paint a rule with the SRP gradient instead of a flat theme colour. */
function gradientRule(text: string): string {
  if (!text) return "";
  const span = Math.max(1, text.length - 1);
  let out = "";
  for (let i = 0; i < text.length; i++) out += gradientAnsi(i / span) + text[i];
  return out + RESET;
}

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
 * Render the subagent widget card. Returns plain lines because
 * `ctx.ui.setWidget` takes rendered strings, not TUI components.
 */
export function renderRunWidget(rows: RunWidgetRow[], theme: Theme, maxRows = 5): string[] {
  if (rows.length === 0) return [];

  const visible = rows.slice(0, maxRows);
  const overflow = rows.length - visible.length;

  const busiest = rows.some((row) => row.state === "busy") ? "busy" : rows.some((row) => row.state === "starting") ? "starting" : "idle";
  const title = `${theme.fg("accent", "◈")} ${theme.bold("Subagents")}`;
  const header: string =
    gradientRule(`╭─ ${title} `) +
    theme.fg("dim", `─── ${rows.length} active · ${busiest} `) +
    gradientRule("─╮");

  const body = visible.map(({ run, state }) => {
    const elapsed = formatElapsed((Date.now() - Date.parse(run.createdAt)) / 1000);
    const { icon, label } = stateStyle(state, theme);

    const name = run.name ?? run.handle;
    const handleTag = run.name ? theme.fg("dim", ` (${run.handle})`) : "";
    const modelTag = theme.fg("muted", ` ${run.model.split("/").pop()}`);

    let detail = "";
    const usage = readSessionUsage(run.sessionFile);
    if (usage) {
      const segments = usageSegments(usage).map((segment) => theme.fg("dim", segment));
      if (segments.length > 0) detail = ` ${segments.join(theme.fg("dim", "  "))}`;
    }
    if (state === "error" && run.error) {
      detail = ` ${theme.fg("error", run.error.split("\n")[0])}`;
    }

    const left = `  ${theme.fg("dim", elapsed.padStart(6))}  ${icon} ${theme.bold(name)}${handleTag}`;
    const right = `${label}${modelTag}${detail}`;
    return left + "  " + right;
  });

  const footer = overflow > 0 ? `╰─ ${theme.fg("muted", `+${overflow} more`)} ` : null;
  const closing = footer ?? "╰";
  const bodyLines = body.map((line) => gradientRule("│") + " " + line);

  return [header, ...bodyLines, closing + gradientRule("─".repeat(24) + "╯")];
}
