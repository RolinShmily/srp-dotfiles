/**
 * srp-subagent/ui.ts — SRP 赛博朋克风格 TUI 渲染与消息卡片构建器。
 *
 * 遵循 SRP Dotfiles 统一视觉规范：
 * - 霓虹粉 (#ff7eb3) -> 珊瑚粉 (#f75c7e) -> 优雅紫 (#7c3aed)
 * - 赛博青 (#00f0ff) 状态强调色
 * - 结构化卡片与展开折叠 (Ctrl+O)
 */

import { keyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type SessionStats } from "./session.ts";
import { formatElapsed, type StatusSnapshot } from "./status.ts";

// ============================ 渐变与色彩定义 ============================

export const PINK: [number, number, number] = [255, 126, 179];   // #ff7eb3
export const CORAL: [number, number, number] = [247, 92, 126];   // #f75c7e
export const VIOLET: [number, number, number] = [124, 58, 237];  // #7c3aed
export const CYAN: [number, number, number] = [0, 240, 255];     // #00f0ff

export function interpolateRgb(
  r1: number, g1: number, b1: number,
  r2: number, g2: number, b2: number,
  t: number,
): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return [r, g, b];
}

export function getGradientAnsi(t: number): string {
  let rgb: [number, number, number];
  if (t < 0.4) {
    rgb = interpolateRgb(PINK[0], PINK[1], PINK[2], CORAL[0], CORAL[1], CORAL[2], t / 0.4);
  } else {
    rgb = interpolateRgb(CORAL[0], CORAL[1], CORAL[2], VIOLET[0], VIOLET[1], VIOLET[2], (t - 0.4) / 0.6);
  }
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

// ============================ 资源与 Token 格式化 ============================

export function formatTokenCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatUsageSegments(stats: SessionStats): string[] {
  const parts: string[] = [];
  if (stats.inputTokens > 0) parts.push(`↑${formatTokenCount(stats.inputTokens)}`);
  if (stats.outputTokens > 0) parts.push(`↓${formatTokenCount(stats.outputTokens)}`);
  if (stats.cacheReadTokens > 0) parts.push(`R:${formatTokenCount(stats.cacheReadTokens)}`);
  if (stats.cacheWriteTokens > 0) parts.push(`W:${formatTokenCount(stats.cacheWriteTokens)}`);
  if (stats.cost > 0) parts.push(`$${stats.cost < 0.01 ? stats.cost.toFixed(4) : stats.cost.toFixed(3)}`);
  return parts;
}

const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-3.7-flash": 1_048_576,
  "gemini-2.5-flash": 1_048_576,
  "gemini-2.5-pro": 2_097_152,
  "claude-3-7-sonnet": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "deepseek-chat": 64_000,
  "deepseek-reasoner": 64_000,
  "deepseek-v4-flash": 1_000_000,
};

export function contextWindowFor(model: string | null): number | null {
  if (!model) return null;
  const base = model.split("/").pop() ?? model;
  for (const [key, val] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (base.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 200_000;
}

export function formatContextGauge(used: number, max: number | null): string {
  if (!max || max <= 0) return `${formatTokenCount(used)}`;
  const pct = (used / max) * 100;
  return `${formatTokenCount(used)}/${formatTokenCount(max)} (${pct.toFixed(1)}%)`;
}

// ============================ 消息卡片渲染器 ============================

/**
 * 渲染 subagent_result 结果卡片
 */
export function renderSubagentResultMessage(
  message: { content?: unknown; details?: unknown },
  options: { expanded: boolean },
  theme: Theme,
  width: number,
): string[] {
  const details = message.details as any;
  if (!details) return [];

  const name = details.name ?? "subagent";
  const exitCode = details.exitCode ?? 0;
  const errorMessage = typeof details.errorMessage === "string" ? details.errorMessage : "";
  const failed = exitCode !== 0 || !!errorMessage;
  const elapsed = details.elapsed != null ? formatElapsed(details.elapsed) : "?";

  const stats = (details.stats ?? null) as SessionStats | null;
  const icon = failed ? theme.fg("error", "✗") : theme.fg("success", "✓");
  const agentTag = details.agent ? theme.fg("dim", ` (${details.agent})`) : "";
  const modelTag = stats?.model ? theme.fg("dim", ` [${stats.model.split("/").pop()}]`) : "";
  const titleSegment = `${icon} ${theme.fg("toolTitle", theme.bold(name))}${agentTag}${modelTag} ${theme.fg("dim", "—")} `;

  let header: string;
  if (failed) {
    const reason = errorMessage ? "执行失败 (智能体报错)" : `退出码 ${exitCode}`;
    header = `${titleSegment}${theme.fg("error", reason)} ${theme.fg("dim", `· ${elapsed}`)}`;
  } else {
    const toolPart = stats ? `${stats.toolCount} 工具调用 · ${elapsed}` : elapsed;
    header = `${titleSegment}${theme.fg("dim", toolPart)}`;
  }

  let usageLine: string | null = null;
  if (stats) {
    const segs = formatUsageSegments(stats).map((s) => theme.fg("dim", s));
    if (stats.contextTokens > 0) {
      const window = contextWindowFor(stats.model);
      const ctxStr = formatContextGauge(stats.contextTokens, window);
      const pct = window ? (stats.contextTokens / window) * 100 : 0;
      const coloredCtx =
        pct > 90 ? theme.fg("error", ctxStr) : pct > 70 ? theme.fg("warning", ctxStr) : theme.fg("dim", ctxStr);
      segs.push(coloredCtx);
    }
    if (segs.length > 0) usageLine = segs.join(theme.fg("dim", "  "));
  }

  const rawContent = typeof message.content === "string" ? message.content : "";
  const summary = rawContent
    .replace(/\n\nFollow up with subagent_message[\s\S]+$/, "")
    .replace(`Sub-agent "${name}" completed (${elapsed}).\n\n`, "")
    .replace(`Sub-agent "${name}" failed (exit code ${exitCode}).\n\n`, "")
    .trim();

  const contentLines = [header];
  if (usageLine) contentLines.push(usageLine);

  if (options.expanded) {
    if (summary) {
      contentLines.push("");
      for (const line of summary.split("\n")) {
        contentLines.push(line.slice(0, width - 6));
      }
    }
    contentLines.push("");
    contentLines.push(
      theme.fg("dim", `后续追问: subagent_message({ name: "${name}", message: "…" })`),
    );
    if (details.sessionFile) {
      contentLines.push(theme.fg("muted", `会话文件: ${details.sessionFile}`));
    }
  } else {
    if (summary) {
      contentLines.push("");
      const previewLines = summary.split("\n").slice(0, 5);
      for (const line of previewLines) {
        contentLines.push(theme.fg("dim", line.slice(0, width - 6)));
      }
      const totalLines = summary.split("\n").length;
      if (totalLines > 5) {
        contentLines.push(theme.fg("muted", `… 还有 ${totalLines - 5} 行内容`));
      }
    }
    contentLines.push("");
    contentLines.push(theme.fg("muted", keyHint("app.tools.expand", "展开详情")));
  }

  const bgFn = failed
    ? (text: string) => theme.bg("toolErrorBg", text)
    : (text: string) => theme.bg("customMessageBg", text);

  const box = new Box(1, 1, bgFn);
  box.addChild(new Text(contentLines.join("\n"), 0, 0));
  return ["", ...box.render(width)];
}

/**
 * 渲染 subagent_question 提问卡片
 */
export function renderSubagentQuestionMessage(
  message: { content?: unknown; details?: unknown },
  options: { expanded: boolean },
  theme: Theme,
  width: number,
): string[] {
  const details = message.details as any;
  if (!details) return [];

  const name = details.name ?? "subagent";
  const agentTag = details.agent ? theme.fg("dim", ` (${details.agent})`) : "";
  const icon = theme.fg("accent", "◈ ?");
  const header = `${icon} ${theme.fg("toolTitle", theme.bold(name))}${agentTag} ${theme.fg("dim", "— 提出决策问题")}`;

  const contentLines = [header];
  const question = details.question ?? "";

  if (options.expanded) {
    contentLines.push("");
    contentLines.push(question);
    contentLines.push("");
    contentLines.push(
      theme.fg("accent", `回复指令: subagent_message({ name: "${name}", message: "…" })`),
    );
  } else {
    contentLines.push("");
    const preview = question.split("\n")[0].slice(0, width - 10);
    contentLines.push(theme.fg("dim", preview));
    contentLines.push("");
    contentLines.push(theme.fg("muted", keyHint("app.tools.expand", "展开详情")));
  }

  const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
  box.addChild(new Text(contentLines.join("\n"), 0, 0));
  return ["", ...box.render(width)];
}

// ============================ 编辑器上方实时状态栏 (Widget) ============================

export interface SubagentWidgetRow {
  name: string;
  agent?: string;
  startTime: number;
  snapshot: StatusSnapshot;
}

export function renderLiveWidget(
  rows: SubagentWidgetRow[],
  width: number,
  theme: Theme,
): string[] {
  if (rows.length === 0) return [];

  const titlePrefix = `${theme.fg("accent", "◈")} ${theme.bold("SRP Subagents")}`;
  const titleCount = `${theme.fg("dim", `${rows.length} 运行中`)}`;
  const header = `╭─ ${titlePrefix} ─── ${titleCount} ─╮`;

  const bodyLines = rows.map((r) => {
    const elapsed = formatElapsed(Math.floor((Date.now() - r.startTime) / 1000));
    const agentLabel = r.agent && r.agent !== r.name ? theme.fg("dim", `(${r.agent})`) : "";
    const nameStr = `${theme.bold(r.name)} ${agentLabel}`.trim();

    let statusText = "";
    switch (r.snapshot.kind) {
      case "starting":
        statusText = theme.fg("dim", "starting…");
        break;
      case "active":
        if (r.snapshot.activeScope) {
          const dur = r.snapshot.activeDurationText ? ` ${r.snapshot.activeDurationText}` : "";
          statusText = `${theme.fg("accent", "active")} · ${theme.fg("dim", `${r.snapshot.activeScope}${dur}`)}`;
        } else {
          statusText = theme.fg("accent", "active");
        }
        break;
      case "waiting":
        statusText = theme.fg("warning", `waiting ${r.snapshot.waitingDurationText ? r.snapshot.waitingDurationText : ""}`.trim());
        break;
      case "stalled":
        statusText = theme.fg("error", "stalled");
        break;
      default:
        statusText = theme.fg("dim", `running ${elapsed}`);
    }

    const rowContent = `  ${theme.fg("dim", elapsed.padStart(5))}  ${nameStr.padEnd(20)}  ${statusText}`;
    return `│ ${truncateToWidth(rowContent, width - 4)} │`;
  });

  const footer = `╰${"─".repeat(Math.max(10, Math.min(width - 2, 50)))}╯`;

  return [header, ...bodyLines, footer];
}
