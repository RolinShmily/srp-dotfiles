/**
 * srp-theme.ts — SRP 定制 UI 主题扩展
 *
 * 功能特性：
 * 1. Header: 启动/会话重置时展示 135° 紫粉渐变赛博朋克图形 Logo 与 srprolin 终端身份签名；
 * 2. Footer: 在编辑器下方（belowEditor widget）显示最近一次用户提交的消息提示（↳ <prompt>），状态栏第一行自适应展示 PWD、最后一轮 Agent-Loop 结束时间与用时胶囊（{ finished at HH:mm · 4.2s }）与当前时间胶囊；
 * 3. TPS Meter: 实时测量 Tokens Per Second (TPS) 并在状态栏显示流式平滑槽位条与历史 Sparkline 趋势指标；
 * 4. 单一主控制命令：`/srp-theme [header|footer|tps] [on|off]` 或 `/srp-theme status`。
 *
 * 配色参考：
 *   - 珊瑚粉 / 霓虹粉: #ff7eb3 / #f75c7e
 *   - 优雅紫罗兰 / 霓虹紫: #9b3fe0 / #7c3aed
 *   - 终端文字: #e8e0f0 / #a09bb5
 *
 * 配置（settings.json，全部可选）：
 * {
 *   "srpTheme": {
 *     "header": true,
 *     "footer": true,
 *     "tps": true
 *   }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  type AutocompleteItem,
  type Component,
} from "@earendil-works/pi-tui";

// ============================ 配置读取 ============================

export interface SrpThemeConfig {
  header: boolean;
  footer: boolean;
  tps: boolean;
}

function readSettingsFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readConfig(cwd: string): SrpThemeConfig {
  const global = readSettingsFile(join(getAgentDir(), "settings.json"));
  const project = readSettingsFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));

  const globalTheme = (global.srpTheme as Record<string, unknown>) || {};
  const projectTheme = (project.srpTheme as Record<string, unknown>) || {};
  const themeSection = { ...globalTheme, ...projectTheme };

  // 兼容旧版独立配置字段
  const legacyFooter =
    (project.srpFooter as Record<string, unknown>)?.enabled ??
    (global.srpFooter as Record<string, unknown>)?.enabled;
  const legacyHeader =
    (project.srpHeader as Record<string, unknown>)?.enabled ??
    (global.srpHeader as Record<string, unknown>)?.enabled;
  const legacyTps =
    (project.srpTps as Record<string, unknown>)?.enabled ??
    (global.srpTps as Record<string, unknown>)?.enabled;

  const headerEnabled =
    typeof themeSection.header === "boolean"
      ? themeSection.header
      : typeof legacyHeader === "boolean"
        ? legacyHeader
        : true;

  const footerEnabled =
    typeof themeSection.footer === "boolean"
      ? themeSection.footer
      : typeof legacyFooter === "boolean"
        ? legacyFooter
        : true;

  const tpsEnabled =
    typeof themeSection.tps === "boolean"
      ? themeSection.tps
      : typeof legacyTps === "boolean"
        ? legacyTps
        : true;

  return {
    header: headerEnabled,
    footer: footerEnabled,
    tps: tpsEnabled,
  };
}

// ============================ 渐变与色彩算法 ============================

const PINK: [number, number, number] = [255, 126, 179];   // #ff7eb3 (Bright Neon Pink)
const CORAL: [number, number, number] = [247, 92, 126];   // #f75c7e (Accent Coral Pink)
const VIOLET: [number, number, number] = [124, 58, 237];  // #7c3aed (Accent Violet)

function interpolateRgb(
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

function getGradientColor(t: number): string {
  let rgb: [number, number, number];
  if (t < 0.4) {
    rgb = interpolateRgb(PINK[0], PINK[1], PINK[2], CORAL[0], CORAL[1], CORAL[2], t / 0.4);
  } else {
    rgb = interpolateRgb(CORAL[0], CORAL[1], CORAL[2], VIOLET[0], VIOLET[1], VIOLET[2], (t - 0.4) / 0.6);
  }
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

function applyDiagonalGradient(lines: string[]): string[] {
  const rowCount = lines.length;
  const maxCol = Math.max(...lines.map((l) => l.length));

  return lines.map((line, r) => {
    let result = "";
    for (let c = 0; c < line.length; c++) {
      const char = line[c];
      if (char === " ") {
        result += " ";
        continue;
      }
      // 135° 对角线渐变插值计算
      const t = (r / Math.max(1, rowCount - 1) * 0.4) + (c / Math.max(1, maxCol - 1) * 0.6);
      result += `${getGradientColor(t)}${char}`;
    }
    return `${result}\x1b[0m`;
  });
}

// ============================ Header 渲染 ============================

const ASCII_ART = [
  "   ███████████████████████████╗  ",
  "   ╚══██████╔════════██████╔══╝  ",
  "      ██████║        ██████║     ",
  "      ██████║        ██████║     ",
  "      ██████║        ██████║     ",
  "      ██████║        ██████║     ",
  "      ██████║        ██████║     ",
  "      ██████║        ██████║     ",
  "   ████████████╗  ████████████╗  ",
  "   ╚═══════════╝  ╚═══════════╝  ",
];

export function buildHeader(theme: Theme, width = 80): string[] {
  const artLines = applyDiagonalGradient(ASCII_ART);

  if (width >= 72) {
    const rightCol = [
      `${theme.bold(theme.fg("accent", "pi"))} ${theme.fg("dim", `v${VERSION}`)}`,
      theme.fg("dim", "──────────────────────────────"),
      formatHint(theme, "escape", "to interrupt"),
      `${formatHint(theme, "ctrl+c", "to clear")} ${theme.fg("dim", "·")} ${formatHint(theme, "ctrl+c twice", "to exit")}`,
      formatHint(theme, "shift+tab", "to cycle thinking"),
      formatHint(theme, "ctrl+p / ctrl+l", "to select model"),
      formatHint(theme, "ctrl+o / ctrl+t", "to expand tools/thinking"),
      `${formatHint(theme, "/", "for commands")} ${theme.fg("dim", "·")} ${formatHint(theme, "!", "for bash")}`,
      formatHint(theme, "alt+enter", "to queue follow-up"),
      formatHint(theme, "drop files", "to attach"),
    ];

    const lines = [""];
    for (let i = 0; i < artLines.length; i++) {
      const left = artLines[i];
      const right = rightCol[i] ?? "";
      lines.push(`${left}   ${right}`);
    }
    lines.push("");
    return lines;
  }

  // 窄屏终端响应式回退：居中对齐与精简快捷键行
  const subtitle = `           ${theme.bold(theme.fg("accent", "pi"))} ${theme.fg("dim", `v${VERSION}`)}`;
  const compactHints = `   ${formatHint(theme, "escape", "interrupt")} ${theme.fg("dim", "·")} ${formatHint(theme, "ctrl+c", "clear/exit")} ${theme.fg("dim", "·")} ${formatHint(theme, "/", "commands")} ${theme.fg("dim", "·")} ${formatHint(theme, "!", "bash")} ${theme.fg("dim", "·")} ${formatHint(theme, "ctrl+o", "more")}`;
  return ["", ...artLines, "", subtitle, "", compactHints, ""];
}

function formatHint(theme: Theme, key: string, desc: string): string {
  return `${theme.fg("dim", key)} ${theme.fg("muted", desc)}`;
}

// ============================ Footer 渲染 ============================

const POWERLINE_SEP_ANSI = "\x1b[38;5;244m";
const ANSI_RESET = "\x1b[0m";

/** 将多行 prompt 压缩为一行，与 powerline 的 last-prompt 行为一致。 */
export function compactPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

/**
 * 复刻 pi-powerline-footer 的 renderLastPromptLines：
 * 使用 powerline 源码中的 sep 色（ANSI 256 色 244），显示 `↳ prompt`。
 */
export function renderLastPromptLine(
  lastUserPrompt: string,
  width: number,
): string[] {
  const compact = compactPrompt(lastUserPrompt);
  const prefix = ` ${POWERLINE_SEP_ANSI}↳${ANSI_RESET} `;
  const availableWidth = width - visibleWidth(prefix);

  if (!compact || availableWidth < 10) return [];

  return [
    truncateToWidth(
      `${prefix}${POWERLINE_SEP_ANSI}${truncateToWidth(compact, availableWidth, "…")}${ANSI_RESET}`,
      width,
      "…",
    ),
  ];
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

export function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export function formatCwdForFooter(cwd: string, home?: string): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const isInside = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (!isInside) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function formatDuration(ms: number): string {
  if (ms < 0) return "0.0s";
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (ms < 3600_000) {
    const totalSecs = Math.round(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}m${secs < 10 ? "0" : ""}${secs}s`;
  }
  const totalMins = Math.round(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hours}h${mins < 10 ? "0" : ""}${mins}m`;
}

export function formatLoopEndTime(
  finished: Date,
  now: Date = new Date(),
  durationMs?: number | null,
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const durationSuffix =
    typeof durationMs === "number" && durationMs >= 0
      ? ` · ${formatDuration(durationMs)}`
      : "";

  // 1. 跨年：显示 in YYYY
  if (finished.getFullYear() !== now.getFullYear()) {
    return `{ finished in ${finished.getFullYear()}${durationSuffix} }`;
  }

  // 2. 同一年、不同天：显示 on MM-DD
  if (
    finished.getMonth() !== now.getMonth() ||
    finished.getDate() !== now.getDate()
  ) {
    const month = pad(finished.getMonth() + 1);
    const date = pad(finished.getDate());
    return `{ finished on ${month}-${date}${durationSuffix} }`;
  }

  // 3. 同一天：显示 at HH:mm
  const hours = pad(finished.getHours());
  const minutes = pad(finished.getMinutes());
  return `{ finished at ${hours}:${minutes}${durationSuffix} }`;
}

export function getLastLoopInfoFromSession(ctx: ExtensionContext): {
  endTime: Date;
  durationMs: number | null;
} | null {
  try {
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    let lastAssistantIdx = -1;
    let lastAssistantDate: Date | null = null;

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i] as any;
      if (entry?.type === "message" && entry?.message?.role === "assistant" && entry?.timestamp) {
        const d = new Date(entry.timestamp);
        if (!isNaN(d.getTime())) {
          lastAssistantIdx = i;
          lastAssistantDate = d;
          break;
        }
      }
    }

    if (!lastAssistantDate || lastAssistantIdx === -1) {
      return null;
    }

    // 从 lastAssistantIdx 往前找距离其最近的一条 user 消息
    let durationMs: number | null = null;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      const entry = entries[i] as any;
      if (entry?.type === "message" && entry?.message?.role === "user" && entry?.timestamp) {
        const startDate = new Date(entry.timestamp);
        if (!isNaN(startDate.getTime())) {
          const diff = lastAssistantDate.getTime() - startDate.getTime();
          if (diff >= 0) {
            durationMs = diff;
          }
          break;
        }
      }
    }

    return {
      endTime: lastAssistantDate,
      durationMs,
    };
  } catch {
    return null;
  }
}

export function getLastLoopEndTimeFromSession(ctx: ExtensionContext): Date | null {
  return getLastLoopInfoFromSession(ctx)?.endTime ?? null;
}

export function formatFooterClock(d: Date, width: number): string {
  if (width < 50) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const date = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const day = WEEK_DAYS[d.getDay()];

  if (width >= 80) {
    return `[ ${year}-${month}-${date} ${day} ${hours}:${minutes} ]`;
  }
  return `[ ${month}-${date} ${hours}:${minutes} ]`;
}

export function buildCustomFooter(
  ctx: ExtensionContext,
  tui: any,
  theme: Theme,
  footerData: ReadonlyFooterDataProvider,
  tpsMeter?: TpsMeter,
  getLastLoopEndTime?: () => Date | null,
  getLastLoopDuration?: () => number | null,
): Component {
  const unsub = footerData.onBranchChange(() => tui.requestRender());

  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;

  const scheduleTick = () => {
    const now = Date.now();
    const delay = Math.max(100, 60_000 - (now % 60_000));
    timer = setTimeout(() => {
      tui.requestRender();
      interval = setInterval(() => {
        tui.requestRender();
      }, 60_000);
    }, delay);
  };

  scheduleTick();

  return {
    dispose() {
      unsub();
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    },
    invalidate() {},
    render(width: number): string[] {
      let input = 0;
      let output = 0;
      let cacheRead = 0;
      let cacheWrite = 0;
      let cost = 0;

      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type === "message" && entry.message.role === "assistant") {
          input += entry.message.usage?.input ?? 0;
          output += entry.message.usage?.output ?? 0;
          cacheRead += entry.message.usage?.cacheRead ?? 0;
          cacheWrite += entry.message.usage?.cacheWrite ?? 0;
          cost += entry.message.usage?.cost?.total ?? 0;
        } else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage) {
          input += entry.message.usage.input ?? 0;
          output += entry.message.usage.output ?? 0;
          cacheRead += entry.message.usage.cacheRead ?? 0;
          cacheWrite += entry.message.usage.cacheWrite ?? 0;
          cost += entry.message.usage.cost?.total ?? 0;
        }
      }

      const contextUsage = ctx.getContextUsage?.();
      const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
      const contextPercentVal = contextUsage?.percent ?? 0;
      const contextPercentStr = contextUsage?.percent != null ? `${contextPercentVal.toFixed(1)}%` : "?";

      const home = process.env.HOME || process.env.USERPROFILE || "";
      const rawCwd = ctx.cwd || process.cwd();
      let pwd = formatCwdForFooter(rawCwd, home);
      const branch = footerData.getGitBranch();
      if (branch) {
        pwd = `${pwd} (${branch})`;
      }
      const sessionName = ctx.sessionManager.getSessionName?.();
      if (sessionName) {
        pwd = `${pwd} • ${sessionName}`;
      }

      const now = new Date();
      const clockStr = formatFooterClock(now, width);
      const lastLoopEnd = getLastLoopEndTime?.() ?? null;
      const lastLoopDuration = getLastLoopDuration?.() ?? null;
      const loopEndStr =
        clockStr && lastLoopEnd
          ? formatLoopEndTime(lastLoopEnd, now, lastLoopDuration)
          : "";
      let pwdLine: string;

      if (clockStr) {
        const minGap = 2;
        const fullRightStr = loopEndStr ? `${loopEndStr} ${clockStr}` : clockStr;
        const fullRightWidth = visibleWidth(fullRightStr);
        const clockWidth = visibleWidth(clockStr);

        if (width - fullRightWidth - minGap >= 8) {
          const truncPwd = truncateToWidth(pwd, width - fullRightWidth - minGap, "...");
          const padSpaces = " ".repeat(Math.max(minGap, width - visibleWidth(truncPwd) - fullRightWidth));
          pwdLine = theme.fg("dim", truncPwd) + padSpaces + theme.fg("dim", fullRightStr);
        } else if (width - clockWidth - minGap >= 8) {
          const truncPwd = truncateToWidth(pwd, width - clockWidth - minGap, "...");
          const padSpaces = " ".repeat(Math.max(minGap, width - visibleWidth(truncPwd) - clockWidth));
          pwdLine = theme.fg("dim", truncPwd) + padSpaces + theme.fg("dim", clockStr);
        } else {
          pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
        }
      } else {
        pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
      }

      const statsParts: string[] = [];
      if (input) statsParts.push(`↑${formatTokens(input)}`);
      if (output) statsParts.push(`↓${formatTokens(output)}`);
      if (cacheRead) statsParts.push(`R${formatTokens(cacheRead)}`);
      if (cacheWrite) statsParts.push(`W${formatTokens(cacheWrite)}`);
      if (cost > 0) statsParts.push(`$${cost.toFixed(3)}`);

      const contextDisplay = `${contextPercentStr}/${formatTokens(contextWindow)}`;
      if (contextPercentVal > 90) {
        statsParts.push(theme.fg("error", contextDisplay));
      } else if (contextPercentVal > 70) {
        statsParts.push(theme.fg("warning", contextDisplay));
      } else {
        statsParts.push(contextDisplay);
      }

      let statsLeft = statsParts.join(" ");
      let statsLeftWidth = visibleWidth(statsLeft);
      if (statsLeftWidth > width) {
        statsLeft = truncateToWidth(statsLeft, width, "...");
        statsLeftWidth = visibleWidth(statsLeft);
      }

      const modelId = ctx.model?.id || "no-model";
      let rightSide = modelId;
      if (ctx.model?.reasoning) {
        const thinkingLevel = (ctx as any).sessionManager?.getThinkingLevel?.() || "high";
        rightSide = `${modelId} • ${thinkingLevel}`;
      }
      if (footerData.getAvailableProviderCount() > 1 && ctx.model?.provider) {
        rightSide = `(${ctx.model.provider}) ${rightSide}`;
      }

      // 提取扩展 statuses
      const statuses = footerData.getExtensionStatuses();
      const memText = statuses.get("srp-memory") || statuses.get("om");

      const minPadding = 2;
      const rightWidth = visibleWidth(rightSide);

      let tpsText = "";
      let tpsWidth = 0;

      if (tpsMeter && tpsMeter.enabled) {
        // 严格遵循优先级：优先保障右侧模型/Provider完整显示，根据剩余空间自适应折叠 TPS（优先隐藏 μ/p95，空间不足再隐藏走势图/隐藏TPS）
        const availableForTps = width - statsLeftWidth - minPadding - rightWidth - minPadding;
        tpsText = tpsMeter.renderAdaptive(theme, availableForTps);
        tpsWidth = tpsText ? visibleWidth(tpsText) : 0;
      } else {
        const tpsRaw = statuses.get("tps");
        if (tpsRaw) {
          const rawSanitized = sanitizeStatusText(tpsRaw);
          const rawWidth = visibleWidth(rawSanitized);
          if (statsLeftWidth + minPadding + rawWidth + minPadding + rightWidth <= width) {
            tpsText = rawSanitized;
            tpsWidth = rawWidth;
          }
        }
      }

      let statsLine: string;

      if (tpsText && tpsWidth > 0) {
        // 空间充裕：statsLeft 居左，tpsText 居中，rightSide 居右
        const remaining = width - statsLeftWidth - tpsWidth - rightWidth;
        const padLeft = " ".repeat(Math.max(minPadding, Math.floor(remaining / 2)));
        const padRight = " ".repeat(Math.max(minPadding, remaining - Math.floor(remaining / 2)));
        statsLine = theme.fg("dim", statsLeft) + padLeft + tpsText + padRight + theme.fg("dim", rightSide);
      } else {
        // 无 TPS 或空间不足已被优雅折叠：优先完整展示 statsLeft 与 rightSide
        if (statsLeftWidth + minPadding + rightWidth <= width) {
          const padding = " ".repeat(Math.max(minPadding, width - statsLeftWidth - rightWidth));
          statsLine = theme.fg("dim", statsLeft) + padding + theme.fg("dim", rightSide);
        } else {
          // 极端超窄屏（连 Token 统计 + 模型名都放不下）时，才做末尾截断
          const availableForRight = width - statsLeftWidth - minPadding;
          if (availableForRight > 0) {
            const truncRight = truncateToWidth(rightSide, availableForRight, "");
            const padding = " ".repeat(Math.max(1, width - statsLeftWidth - visibleWidth(truncRight)));
            statsLine = theme.fg("dim", statsLeft) + padding + theme.fg("dim", truncRight);
          } else {
            statsLine = theme.fg("dim", statsLeft);
          }
        }
      }

      const lines: string[] = [pwdLine, statsLine];

      // 1. srp-memory 放在统计信息之下，单独一行
      if (memText) {
        lines.push(truncateToWidth(sanitizeStatusText(memText), width, theme.fg("dim", "...")));
      }

      // 2. 其他非 TPS / srp-memory 的 status
      const otherStatuses: string[] = [];
      for (const [k, v] of statuses.entries()) {
        if (k !== "tps" && k !== "srp-memory" && k !== "om") {
          otherStatuses.push(sanitizeStatusText(v));
        }
      }
      if (otherStatuses.length > 0) {
        lines.push(truncateToWidth(otherStatuses.join(" "), width, theme.fg("dim", "...")));
      }

      return lines;
    },
  };
}

// ============================ TPS Meter 模块 ============================

export class TpsMeter {
  // 常量配置
  static readonly WINDOW_SIZE = 60;
  static readonly WINDOW_MS = 60_000;
  static readonly STREAM_INTERVAL_MS = 200;
  static readonly SPARK_LEN = 12;
  static readonly ALLTIME_CAP = 500;
  static readonly FAST = 50;
  static readonly MED = 20;

  // 渲染字形
  static readonly BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  static readonly HBLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  static readonly GAUGE_LEN = 11;
  static readonly GAUGE_FLOOR = 40;
  static readonly TRACK = "·";
  static readonly SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  // 状态变量
  private streamStartMs = 0;
  private firstTokenMs = 0;
  private streamChars = 0;
  private streamTokens = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private streaming = false;

  // 60秒滚动窗口 (环形缓冲区: [tps, timestamp])
  private readonly winBuf = new Float64Array(TpsMeter.WINDOW_SIZE * 2);
  private winLen = 0;
  private winHead = 0;

  // 全局会话采样 (环形缓冲区: [tps])
  private readonly atBuf = new Float64Array(TpsMeter.ALLTIME_CAP);
  private atLen = 0;
  private atHead = 0;
  private atSum = 0;

  // 最近 12 条消息 Sparkline 历史
  private readonly sparkBuf = new Float64Array(TpsMeter.SPARK_LEN);
  private sparkLen = 0;
  private sparkHead = 0;
  private sparkMax = 1;
  private sparkCache = "";
  private sparkDirty = true;
  private sparkTheme: Theme | null = null;
  private spinI = 0;
  private lastStatusText: string | undefined = undefined;

  public enabled = true;

  private applyStatus(ctx: ExtensionContext, text: string | undefined): void {
    if (this.lastStatusText === text) return;
    this.lastStatusText = text;
    if (ctx.ui?.setStatus) {
      ctx.ui.setStatus("tps", text);
    }
  }

  reset(ctx?: ExtensionContext): void {
    this.streaming = false;
    this.stopTick();
    this.streamStartMs = 0;
    this.firstTokenMs = 0;
    this.streamChars = 0;
    this.streamTokens = 0;
    this.winLen = 0;
    this.winHead = 0;
    this.atLen = 0;
    this.atHead = 0;
    this.atSum = 0;
    this.sparkLen = 0;
    this.sparkHead = 0;
    this.sparkMax = 1;
    this.sparkCache = "";
    this.sparkDirty = true;
    this.sparkTheme = null;
    this.spinI = 0;
    this.lastStatusText = undefined;
    if (ctx) {
      if (this.enabled) {
        const theme = ctx.ui?.theme ?? safeFallbackTheme;
        this.applyStatus(ctx, this.renderFinal(theme));
      } else {
        this.applyStatus(ctx, undefined);
      }
    }
  }

  private now(): number {
    return Date.now();
  }

  private tokEst(ch: number): number {
    return (ch >>> 2) + ((ch & 3) > 0 ? 1 : 0);
  }

  private winPush(tps: number, ms: number): void {
    const b = this.winHead * 2;
    this.winBuf[b] = tps;
    this.winBuf[b + 1] = ms;
    this.winHead = (this.winHead + 1) % TpsMeter.WINDOW_SIZE;
    if (this.winLen < TpsMeter.WINDOW_SIZE) this.winLen++;
  }

  private atPush(tps: number): void {
    this.atSum += tps;
    if (this.atLen >= TpsMeter.ALLTIME_CAP) this.atSum -= this.atBuf[this.atHead];
    this.atBuf[this.atHead] = tps;
    this.atHead = (this.atHead + 1) % TpsMeter.ALLTIME_CAP;
    if (this.atLen < TpsMeter.ALLTIME_CAP) this.atLen++;
  }

  private sparkPush(tps: number): void {
    this.sparkBuf[this.sparkHead] = tps;
    this.sparkHead = (this.sparkHead + 1) % TpsMeter.SPARK_LEN;
    if (this.sparkLen < TpsMeter.SPARK_LEN) this.sparkLen++;
    if (tps > this.sparkMax) this.sparkMax = tps;
    if (this.sparkMax > 10) this.sparkMax *= 0.99;
    this.sparkDirty = true;
  }

  winAvg(): number {
    if (this.winLen === 0) return 0;
    const cutoff = this.now() - TpsMeter.WINDOW_MS;
    let sum = 0;
    let n = 0;
    const oldest = this.winLen < TpsMeter.WINDOW_SIZE ? 0 : this.winHead;
    for (let i = 0; i < this.winLen; i++) {
      const idx = (oldest + i) % TpsMeter.WINDOW_SIZE;
      const b = idx * 2;
      if (this.winBuf[b + 1] < cutoff) continue;
      sum += this.winBuf[b];
      n++;
    }
    return n === 0 ? 0 : sum / n;
  }

  atMean(): number {
    return this.atLen === 0 ? 0 : this.atSum / this.atLen;
  }

  atP95(): number {
    if (this.atLen === 0) return 0;
    const tmp = new Float64Array(this.atLen);
    const oldest = this.atLen < TpsMeter.ALLTIME_CAP ? 0 : this.atHead;
    for (let i = 0; i < this.atLen; i++) tmp[i] = this.atBuf[(oldest + i) % TpsMeter.ALLTIME_CAP];
    // 插入排序
    for (let i = 1; i < tmp.length; i++) {
      const v = tmp[i];
      let j = i - 1;
      while (j >= 0 && tmp[j] > v) {
        tmp[j + 1] = tmp[j];
        j--;
      }
      tmp[j + 1] = v;
    }
    return tmp[Math.ceil(tmp.length * 0.95) - 1] || 0;
  }

  private fmt(v: number): string {
    if (v < 10) return v.toFixed(1);
    if (v < 100) return v.toFixed(0);
    return `${Math.round(v)}`;
  }

  private speedColor(tps: number, text: string, theme: Theme): string {
    if (tps >= TpsMeter.FAST) return theme.fg("success", text);
    if (tps >= TpsMeter.MED) return theme.fg("warning", text);
    if (tps === 0) return theme.fg("dim", text);
    return theme.fg("error", text);
  }

  private spin(): string {
    const s = TpsMeter.SPIN[this.spinI];
    this.spinI = (this.spinI + 1) % TpsMeter.SPIN.length;
    return s;
  }

  sparkline(theme: Theme, len = TpsMeter.SPARK_LEN): string {
    len = Math.max(1, Math.min(TpsMeter.SPARK_LEN, Math.floor(len)));

    if (this.sparkLen === 0) {
      return theme.fg("dim", TpsMeter.TRACK.repeat(len));
    }

    const available = Math.min(this.sparkLen, len);
    const vals = new Float64Array(available);
    for (let i = 0; i < available; i++) {
      const idx =
        (this.sparkHead - available + i + TpsMeter.SPARK_LEN) %
        TpsMeter.SPARK_LEN;
      vals[i] = this.sparkBuf[idx];
    }

    let mn = Infinity;
    let mx = 0;
    for (let i = 0; i < available; i++) {
      const v = vals[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const range = mx - mn;
    const pad = len - available;
    let result = pad > 0 ? theme.fg("dim", TpsMeter.TRACK.repeat(pad)) : "";

    for (let i = 0; i < available; i++) {
      const v = vals[i];
      const norm =
        range < 1e-6
          ? mx > 0
            ? 4
            : 0
          : Math.min(7, Math.max(0, Math.round(((v - mn) / range) * 7)));
      const ch = TpsMeter.BLOCKS[norm];
      result += this.speedColor(v, ch, theme);
    }
    return result;
  }

  gauge(tps: number, theme: Theme, gaugeLen = TpsMeter.GAUGE_LEN): string {
    gaugeLen = Math.max(1, Math.floor(gaugeLen));
    const scale = Math.max(this.sparkMax, TpsMeter.GAUGE_FLOOR);
    let frac = scale > 0 ? tps / scale : 0;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;

    const eighths = Math.round(frac * gaugeLen * 8);
    const full = (eighths / 8) | 0;
    const rem = eighths % 8;

    let fill = "█".repeat(Math.min(gaugeLen, full));
    let used = Math.min(gaugeLen, full);
    if (full < gaugeLen && rem > 0) {
      fill += TpsMeter.HBLOCKS[rem];
      used++;
    }
    const track = TpsMeter.TRACK.repeat(Math.max(0, gaugeLen - used));

    return (
      theme.fg("dim", "▕") +
      this.speedColor(tps, fill, theme) +
      theme.fg("dim", track + "▏")
    );
  }

  isStreaming(): boolean {
    return this.streaming;
  }

  renderLive(theme: Theme, maxBudget?: number): string {
    const ref = this.firstTokenMs > 0 ? this.firstTokenMs : this.streamStartMs;
    const elapsed = (this.now() - ref) / 1000;
    const tps = elapsed > 0.3 ? this.streamTokens / elapsed : 0;

    const s = theme.fg("accent", this.spin());
    const num = this.speedColor(tps, this.fmt(tps), theme);
    const unit = theme.fg("dim", "tps");
    const numUnit = `${num} ${unit}`;
    const minCompact = `${s} ${numUnit}`;
    const bareNumUnit = numUnit;

    if (maxBudget == null) {
      const g = this.gauge(tps, theme, TpsMeter.GAUGE_LEN);
      return `${s} ${g} ${numUnit}`;
    }

    if (maxBudget < visibleWidth(bareNumUnit)) {
      return "";
    }

    // 尝试带 gauge 的完整模式（根据 maxBudget 动态调整 gauge 长度）
    const fixedOverhead = visibleWidth(s) + 1 + 2 + 1 + visibleWidth(numUnit);
    const availableGaugeLen = maxBudget - fixedOverhead;

    if (availableGaugeLen >= 3) {
      const targetGaugeLen = Math.min(TpsMeter.GAUGE_LEN, availableGaugeLen);
      const g = this.gauge(tps, theme, targetGaugeLen);
      const fullStr = `${s} ${g} ${numUnit}`;
      if (visibleWidth(fullStr) <= maxBudget) {
        return fullStr;
      }
    }

    if (maxBudget >= visibleWidth(minCompact)) {
      return minCompact;
    }

    return bareNumUnit;
  }

  renderFinal(theme: Theme, maxBudget?: number): string {
    const avg = this.winAvg();
    const mu = this.atMean();
    const p95 = this.atP95();

    const a = this.speedColor(avg, this.fmt(avg), theme);
    const label = theme.fg("dim", "tps");
    const numUnit = `${a} ${label}`;

    if (maxBudget == null) {
      const sp = this.sparkline(theme, TpsMeter.SPARK_LEN);
      const sep = theme.fg("dim", "·");
      const m = `${theme.fg("dim", "μ")} ${this.speedColor(mu, this.fmt(mu), theme)}`;
      const p = `${theme.fg("dim", "p95")} ${this.speedColor(p95, this.fmt(p95), theme)}`;
      return `${sp} ${numUnit} ${sep} ${m} ${sep} ${p}`;
    }

    if (maxBudget < visibleWidth(numUnit)) {
      return "";
    }

    // 1. 尝试完整模式 (l3: sparkline 12 + numUnit + μ + p95)
    const spFull = this.sparkline(theme, TpsMeter.SPARK_LEN);
    const sep = theme.fg("dim", "·");
    const m = `${theme.fg("dim", "μ")} ${this.speedColor(mu, this.fmt(mu), theme)}`;
    const p = `${theme.fg("dim", "p95")} ${this.speedColor(p95, this.fmt(p95), theme)}`;
    const l3 = `${spFull} ${numUnit} ${sep} ${m} ${sep} ${p}`;
    if (visibleWidth(l3) <= maxBudget) {
      return l3;
    }

    // 2. 尝试动态 sparkline (长度从 12 逐渐减少到 2)
    const fixedOverhead = 1 + visibleWidth(numUnit);
    const availableSparkLen = maxBudget - fixedOverhead;

    if (availableSparkLen >= 2) {
      const targetSparkLen = Math.min(TpsMeter.SPARK_LEN, availableSparkLen);
      const sp = this.sparkline(theme, targetSparkLen);
      const l2 = `${sp} ${numUnit}`;
      if (visibleWidth(l2) <= maxBudget) {
        return l2;
      }
    }

    // 3. 实在不够时只剩下 "数字 tps"
    return numUnit;
  }

  renderAdaptive(theme: Theme, maxBudget: number): string {
    if (!this.enabled) return "";
    if (this.streaming) {
      return this.renderLive(theme, maxBudget);
    }
    return this.renderFinal(theme, maxBudget);
  }

  private startTick(ctx: ExtensionContext): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      if (!this.streaming || !this.enabled) {
        this.stopTick(ctx);
        return;
      }
      const theme = ctx.ui?.theme ?? safeFallbackTheme;
      this.applyStatus(ctx, this.renderLive(theme));
    }, TpsMeter.STREAM_INTERVAL_MS);
    (this.tickTimer as any)?.unref?.();
  }

  stopTick(ctx?: ExtensionContext): void {
    this.streaming = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (ctx && this.enabled) {
      const theme = ctx.ui?.theme ?? safeFallbackTheme;
      this.applyStatus(ctx, this.renderFinal(theme));
    }
  }

  onMessageStart(ctx: ExtensionContext): void {
    if (!this.enabled) return;
    this.streamStartMs = this.now();
    this.firstTokenMs = 0;
    this.streamChars = 0;
    this.streamTokens = 0;
    this.streaming = true;
    this.spinI = 0;
    this.startTick(ctx);
  }

  onMessageUpdate(evt?: { type: string; delta?: unknown }): void {
    if (!this.enabled || !evt) return;
    if (evt.type === "text_delta" || evt.type === "thinking_delta") {
      const d = evt.delta as string;
      if (!d) return;
      if (this.firstTokenMs === 0) this.firstTokenMs = this.now();
      this.streamChars += d.length;
      this.streamTokens = this.tokEst(this.streamChars);
    }
  }

  onMessageEnd(usageOutput: number | undefined, ctx: ExtensionContext): void {
    if (!this.enabled) return;
    this.streaming = false;
    this.stopTick();

    const realOut = usageOutput;
    const tokens =
      typeof realOut === "number" && realOut > 0 ? realOut : this.streamTokens;

    const ref = this.firstTokenMs > 0 ? this.firstTokenMs : this.streamStartMs;
    const elapsed = (this.now() - ref) / 1000;
    if (elapsed >= 0.1 && tokens > 0) {
      const tps = tokens / elapsed;
      this.winPush(tps, this.now());
      this.atPush(tps);
      this.sparkPush(tps);
    }

    const theme = ctx.ui?.theme ?? safeFallbackTheme;
    const txt = this.renderFinal(theme);
    this.applyStatus(ctx, txt || undefined);
  }

  onToolStart(ctx: ExtensionContext): void {
    this.stopTick(ctx);
  }

  onTurnEnd(ctx?: ExtensionContext): void {
    this.stopTick(ctx);
  }

  onAgentEnd(ctx?: ExtensionContext): void {
    this.stopTick(ctx);
  }

  onAgentSettled(ctx?: ExtensionContext): void {
    this.stopTick(ctx);
  }
}

const safeFallbackTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

// ============================ 扩展入口 ============================

export default function (pi: ExtensionAPI) {
  let lastUserPrompt = "";
  let headerEnabled = true;
  let footerEnabled = true;
  let lastLoopEndTime: Date | null = null;
  let lastLoopDurationMs: number | null = null;
  let currentLoopStartMs = 0;
  const tpsMeter = new TpsMeter();

  const installHeader = (ctx: ExtensionContext): void => {
    ctx.ui.setHeader((_tui, theme) => ({
      render(width: number): string[] {
        return buildHeader(theme, width);
      },
      invalidate() {},
    }));
  };

  const removeHeader = (ctx: ExtensionContext): void => {
    ctx.ui.setHeader(undefined);
  };

  const installFooter = (ctx: ExtensionContext): void => {
    ctx.ui.setWidget(
      "srp-footer",
      () => ({
        invalidate() {},
        render(width: number): string[] {
          return renderLastPromptLine(lastUserPrompt, width);
        },
      }),
      { placement: "belowEditor" },
    );
    ctx.ui.setFooter((tui, theme, footerData) =>
      buildCustomFooter(
        ctx,
        tui,
        theme,
        footerData,
        tpsMeter,
        () => lastLoopEndTime,
        () => lastLoopDurationMs,
      ),
    );
  };

  const removeFooter = (ctx: ExtensionContext): void => {
    ctx.ui.setWidget("srp-footer", undefined);
    ctx.ui.setFooter(undefined);
  };

  pi.on("session_start", (_event, ctx) => {
    lastUserPrompt = "";
    currentLoopStartMs = 0;
    const info = getLastLoopInfoFromSession(ctx);
    lastLoopEndTime = info?.endTime ?? null;
    lastLoopDurationMs = info?.durationMs ?? null;
    const cfg = readConfig(ctx.cwd);
    headerEnabled = cfg.header;
    footerEnabled = cfg.footer;
    tpsMeter.enabled = cfg.tps;
    tpsMeter.reset(ctx);

    if (ctx.mode === "tui") {
      if (headerEnabled) {
        installHeader(ctx);
      } else {
        removeHeader(ctx);
      }
      if (tpsMeter.enabled) {
        const theme = ctx.ui?.theme ?? safeFallbackTheme;
        ctx.ui.setStatus("tps", tpsMeter.renderFinal(theme));
      }
      removeFooter(ctx);
    }
  });

  // resources_discover 紧跟在 session_start 之后执行，使该 widget 排在
  // powerline 的 belowEditor widgets 后面，稳定显示在最底部。
  pi.on("resources_discover", (_event, ctx) => {
    if (footerEnabled && ctx.mode === "tui") {
      installFooter(ctx);
    }
  });

  // event.prompt 是 pi 接受并展开后的实际用户输入
  pi.on("before_agent_start", (event) => {
    lastUserPrompt = event.prompt;
    currentLoopStartMs = Date.now();
  });

  // TPS 监控与生命周期防御
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    tpsMeter.onMessageStart(ctx);
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    tpsMeter.onMessageUpdate(event.assistantMessageEvent as { type: string; delta?: unknown });
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const realOut = (event.message as { usage?: { output?: number } })?.usage?.output;
    tpsMeter.onMessageEnd(realOut, ctx);
  });

  pi.on("tool_execution_start", (_event, ctx) => {
    tpsMeter.onToolStart(ctx);
  });

  pi.on("tool_call", (_event, ctx) => {
    tpsMeter.onToolStart(ctx);
  });

  pi.on("turn_end", (_event, ctx) => {
    tpsMeter.onTurnEnd(ctx);
  });

  pi.on("agent_end", (_event, ctx) => {
    lastLoopEndTime = new Date();
    if (currentLoopStartMs > 0) {
      lastLoopDurationMs = Math.max(0, Date.now() - currentLoopStartMs);
    }
    tpsMeter.onAgentEnd(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    lastLoopEndTime = new Date();
    if (currentLoopStartMs > 0) {
      lastLoopDurationMs = Math.max(0, Date.now() - currentLoopStartMs);
    }
    tpsMeter.onAgentSettled(ctx);
  });

  // 注册统一主题管理主命令
  pi.registerCommand("srp-theme", {
    description: "管理 SRP 主题组件（Header、Footer 与 TPS Meter）",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "status", label: "status", description: "查看当前主题组件状态" },
        { value: "header on", label: "header on", description: "开启自定义 Header" },
        { value: "header off", label: "header off", description: "关闭自定义 Header（恢复原生）" },
        { value: "footer on", label: "footer on", description: "开启自定义 Footer（提示最后输入）" },
        { value: "footer off", label: "footer off", description: "关闭自定义 Footer" },
        { value: "tps on", label: "tps on", description: "开启实时 TPS 速度计与趋势图" },
        { value: "tps off", label: "tps off", description: "关闭 TPS 速度计" },
        { value: "on", label: "on", description: "开启全部主题组件" },
        { value: "off", label: "off", description: "关闭全部主题组件" },
      ];
      const trimmed = prefix.trimStart();
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (parts.length === 0 || parts[0] === "status") {
        ctx.ui.notify(
          `srp-theme 状态: Header=${headerEnabled ? "已开启" : "已关闭"}, Footer=${footerEnabled ? "已开启" : "已关闭"}, TPS=${tpsMeter.enabled ? "已开启" : "已关闭"}`,
          "info",
        );
        return;
      }

      if (parts[0] === "header") {
        const state = parts[1];
        if (state === "on") {
          headerEnabled = true;
          if (ctx.mode === "tui") installHeader(ctx);
          ctx.ui.notify("srp-theme: Header 已开启", "info");
          return;
        }
        if (state === "off") {
          headerEnabled = false;
          if (ctx.mode === "tui") removeHeader(ctx);
          ctx.ui.notify("srp-theme: Header 已关闭（恢复原生）", "info");
          return;
        }
      } else if (parts[0] === "footer") {
        const state = parts[1];
        if (state === "on") {
          footerEnabled = true;
          if (ctx.mode === "tui") installFooter(ctx);
          ctx.ui.notify("srp-theme: Footer 已开启", "info");
          return;
        }
        if (state === "off") {
          footerEnabled = false;
          if (ctx.mode === "tui") removeFooter(ctx);
          ctx.ui.notify("srp-theme: Footer 已关闭", "info");
          return;
        }
      } else if (parts[0] === "tps") {
        const state = parts[1];
        if (state === "on") {
          tpsMeter.enabled = true;
          const theme = ctx.ui?.theme ?? safeFallbackTheme;
          const txt = tpsMeter.renderFinal(theme);
          if (txt) ctx.ui.setStatus("tps", txt);
          ctx.ui.notify("srp-theme: TPS Meter 已开启", "info");
          return;
        }
        if (state === "off") {
          tpsMeter.enabled = false;
          tpsMeter.stopTick();
          ctx.ui.setStatus("tps", undefined);
          ctx.ui.notify("srp-theme: TPS Meter 已关闭", "info");
          return;
        }
      } else if (parts[0] === "on" || parts[0] === "off") {
        const enable = parts[0] === "on";
        headerEnabled = enable;
        footerEnabled = enable;
        tpsMeter.enabled = enable;

        if (enable) {
          if (ctx.mode === "tui") {
            installHeader(ctx);
            installFooter(ctx);
          }
          const theme = ctx.ui?.theme ?? safeFallbackTheme;
          const txt = tpsMeter.renderFinal(theme);
          if (txt) ctx.ui.setStatus("tps", txt);
        } else {
          if (ctx.mode === "tui") {
            removeHeader(ctx);
            removeFooter(ctx);
          }
          tpsMeter.stopTick();
          ctx.ui.setStatus("tps", undefined);
        }
        ctx.ui.notify(`srp-theme: 已${enable ? "开启" : "关闭"}全部组件`, "info");
        return;
      }

      ctx.ui.notify("用法: /srp-theme [header|footer|tps] on|off 或 /srp-theme status", "info");
    },
  });
}
