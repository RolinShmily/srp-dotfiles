/**
 * srp-theme.ts — Footer and TPS meter extension.
 *
 * /srp-theme on|off controls both components for the current runtime.
 * Pi's native header is used; no settings.json fields are needed.
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
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

// ============================ Footer Rendering ============================

const POWERLINE_SEP_ANSI = "\x1b[38;5;244m";
const ANSI_RESET = "\x1b[0m";

/** Compact a multiline prompt into a single line, matching powerline's last-prompt behavior. */
export function compactPrompt(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

/**
 * Render last prompt line using powerline's sep color (ANSI 244), displaying '↳ prompt'.
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

export type ClockVariant = "full" | "month_day" | "time_only";
export type FinishedVariant = "full" | "compact" | "duration_only";

export function formatFooterClockVariant(d: Date, variant: ClockVariant): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());

  if (variant === "time_only") {
    return `[ ${hours}:${minutes} ]`;
  }

  const month = pad(d.getMonth() + 1);
  const date = pad(d.getDate());

  if (variant === "month_day") {
    return `[ ${month}-${date} ${hours}:${minutes} ]`;
  }

  const year = d.getFullYear();
  const day = WEEK_DAYS[d.getDay()];
  return `[ ${year}-${month}-${date} ${day} ${hours}:${minutes} ]`;
}

export function formatFooterClock(d: Date, width: number): string {
  if (width < 50) return formatFooterClockVariant(d, "time_only");
  if (width >= 80) return formatFooterClockVariant(d, "full");
  return formatFooterClockVariant(d, "month_day");
}

export function formatLoopEndVariant(
  finished: Date,
  now: Date = new Date(),
  durationMs?: number | null,
  variant: FinishedVariant = "full",
): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const hasDuration = typeof durationMs === "number" && durationMs >= 0;
  const durationStr = hasDuration ? formatDuration(durationMs!) : "";

  // 1. Duration-only compact variant
  if (variant === "duration_only") {
    return hasDuration ? `{ ${durationStr} }` : "";
  }

  const isCrossYear = finished.getFullYear() !== now.getFullYear();
  const isCrossDay =
    finished.getMonth() !== now.getMonth() ||
    finished.getDate() !== now.getDate();

  let dateOrTime = "";
  if (isCrossYear) {
    dateOrTime = `${finished.getFullYear()}`;
  } else if (isCrossDay) {
    dateOrTime = `${pad(finished.getMonth() + 1)}-${pad(finished.getDate())}`;
  } else {
    dateOrTime = `${pad(finished.getHours())}:${pad(finished.getMinutes())}`;
  }

  const durationSuffix = hasDuration ? ` · ${durationStr}` : "";

  // 2. Word-stripped compact variant
  if (variant === "compact") {
    return `{ ${dateOrTime}${durationSuffix} }`;
  }

  // 3. Full variant (retaining prepositions)
  let prefix = "at";
  if (isCrossYear) {
    prefix = "in";
  } else if (isCrossDay) {
    prefix = "on";
  }

  return `{ finished ${prefix} ${dateOrTime}${durationSuffix} }`;
}

export function formatLoopEndTime(
  finished: Date,
  now: Date = new Date(),
  durationMs?: number | null,
): string {
  return formatLoopEndVariant(finished, now, durationMs, "full");
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

    // Find the closest preceding user message from lastAssistantIdx
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
      const lastLoopEnd = getLastLoopEndTime?.() ?? null;
      const lastLoopDuration = getLastLoopDuration?.() ?? null;
      const pwdWidth = visibleWidth(pwd);
      const minGap = 2;

      const candidates: string[] = [];

      if (lastLoopEnd) {
        // 1. Adjust clock variant first while finished capsule stays full
        const fullFinished = formatLoopEndVariant(lastLoopEnd, now, lastLoopDuration, "full");
        if (fullFinished) {
          candidates.push(`${fullFinished} ${formatFooterClockVariant(now, "full")}`);
          candidates.push(`${fullFinished} ${formatFooterClockVariant(now, "month_day")}`);
          candidates.push(`${fullFinished} ${formatFooterClockVariant(now, "time_only")}`);
        }

        // 2. When clock degrades to time_only, compact the finished capsule
        const compactFinished = formatLoopEndVariant(lastLoopEnd, now, lastLoopDuration, "compact");
        if (compactFinished && compactFinished !== fullFinished) {
          candidates.push(`${compactFinished} ${formatFooterClockVariant(now, "time_only")}`);
        }

        const durationFinished = formatLoopEndVariant(lastLoopEnd, now, lastLoopDuration, "duration_only");
        if (durationFinished && durationFinished !== compactFinished && durationFinished !== fullFinished) {
          candidates.push(`${durationFinished} ${formatFooterClockVariant(now, "time_only")}`);
        }

        // 3. Fallback to time-only clock if finished capsule cannot fit
        candidates.push(formatFooterClockVariant(now, "time_only"));
      } else {
        // Smoothly degrade clock when no finished record is available
        candidates.push(formatFooterClockVariant(now, "full"));
        candidates.push(formatFooterClockVariant(now, "month_day"));
        candidates.push(formatFooterClockVariant(now, "time_only"));
      }

      let selectedRight = "";
      let matched = false;

      for (const candidate of candidates) {
        if (pwdWidth + minGap + visibleWidth(candidate) <= width) {
          selectedRight = candidate;
          matched = true;
          break;
        }
      }

      let pwdLine: string;
      if (matched && selectedRight) {
        const rightWidth = visibleWidth(selectedRight);
        const padSpaces = " ".repeat(Math.max(minGap, width - pwdWidth - rightWidth));
        pwdLine = theme.fg("dim", pwd) + padSpaces + theme.fg("dim", selectedRight);
      } else {
        if (pwdWidth <= width) {
          pwdLine = theme.fg("dim", pwd);
        } else {
          pwdLine = truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "..."));
        }
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
        // ctx.thinkingLevel is live getter, matching native footer state
        const thinkingLevel = ctx.thinkingLevel || "off";
        rightSide = thinkingLevel === "off" ? `${modelId} • thinking off` : `${modelId} • ${thinkingLevel}`;
      }
      if (footerData.getAvailableProviderCount() > 1 && ctx.model?.provider) {
        rightSide = `(${ctx.model.provider}) ${rightSide}`;
      }

      // Extract extension statuses
      const statuses = footerData.getExtensionStatuses();
      const memText = statuses.get("memory-log") || statuses.get("srp-memory") || statuses.get("om");

      const minPadding = 2;
      const rightWidth = visibleWidth(rightSide);

      let tpsText = "";
      let tpsWidth = 0;

      if (tpsMeter && tpsMeter.enabled) {
        // Prioritize right-side model/provider visibility, adaptively folding TPS
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
        // Ample space: stats left, TPS center, model right
        const remaining = width - statsLeftWidth - tpsWidth - rightWidth;
        const padLeft = " ".repeat(Math.max(minPadding, Math.floor(remaining / 2)));
        const padRight = " ".repeat(Math.max(minPadding, remaining - Math.floor(remaining / 2)));
        statsLine = theme.fg("dim", statsLeft) + padLeft + tpsText + padRight + theme.fg("dim", rightSide);
      } else {
        // When TPS folded: prioritize statsLeft and rightSide
        if (statsLeftWidth + minPadding + rightWidth <= width) {
          const padding = " ".repeat(Math.max(minPadding, width - statsLeftWidth - rightWidth));
          statsLine = theme.fg("dim", statsLeft) + padding + theme.fg("dim", rightSide);
        } else {
          // Ultra-narrow viewport: truncate right side
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

      // 1. memory-log on a dedicated line below stats
      if (memText) {
        lines.push(truncateToWidth(sanitizeStatusText(memText), width, theme.fg("dim", "...")));
      }

      // 2. Other non-TPS / memory-log statuses
      const otherStatuses: string[] = [];
      for (const [k, v] of statuses.entries()) {
        if (k !== "tps" && k !== "memory-log" && k !== "srp-memory" && k !== "om") {
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

// ============================ TPS Meter Module ============================

export class TpsMeter {
  // Constants
  static readonly WINDOW_SIZE = 60;
  static readonly WINDOW_MS = 60_000;
  static readonly STREAM_INTERVAL_MS = 200;
  static readonly SPARK_LEN = 12;
  static readonly ALLTIME_CAP = 500;
  static readonly FAST = 50;
  static readonly MED = 20;

  // Render glyphs
  static readonly BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  static readonly HBLOCKS = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  static readonly GAUGE_LEN = 11;
  static readonly GAUGE_FLOOR = 40;
  static readonly TRACK = "·";
  static readonly SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  // State variables
  private streamStartMs = 0;
  private firstTokenMs = 0;
  private streamChars = 0;
  private streamTokens = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private streaming = false;

  // 60-second rolling window (ring buffer: [tps, timestamp])
  private readonly winBuf = new Float64Array(TpsMeter.WINDOW_SIZE * 2);
  private winLen = 0;
  private winHead = 0;

  // Session-wide sampling (ring buffer: [tps])
  private readonly atBuf = new Float64Array(TpsMeter.ALLTIME_CAP);
  private atLen = 0;
  private atHead = 0;
  private atSum = 0;

  // Sparkline history for last 12 messages
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
    // Insertion sort
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

    // Attempt full mode with gauge
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

    // 1. Attempt full mode (sparkline 12 + numUnit + μ + p95)
    const spFull = this.sparkline(theme, TpsMeter.SPARK_LEN);
    const sep = theme.fg("dim", "·");
    const m = `${theme.fg("dim", "μ")} ${this.speedColor(mu, this.fmt(mu), theme)}`;
    const p = `${theme.fg("dim", "p95")} ${this.speedColor(p95, this.fmt(p95), theme)}`;
    const l3 = `${spFull} ${numUnit} ${sep} ${m} ${sep} ${p}`;
    if (visibleWidth(l3) <= maxBudget) {
      return l3;
    }

    // 2. Dynamic sparkline (length 12 down to 2)
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

    // 3. Bare numUnit fallback
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

// ============================ Extension Entrypoint ============================

export default function (pi: ExtensionAPI) {
  let lastUserPrompt = "";
  let footerEnabled = true;
  let lastLoopEndTime: Date | null = null;
  let lastLoopDurationMs: number | null = null;
  let currentLoopStartMs = 0;
  const tpsMeter = new TpsMeter();

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
    footerEnabled = true;
    tpsMeter.enabled = true;
    tpsMeter.reset(ctx);

    if (ctx.mode === "tui") {
      // Restore the native header when reloading a previous extension version.
      ctx.ui.setHeader(undefined);
      removeFooter(ctx);
    }
  });

  // Schedule resources_discover after session_start to position widget below powerline widgets
  pi.on("resources_discover", (_event, ctx) => {
    if (footerEnabled && ctx.mode === "tui") {
      installFooter(ctx);
    }
  });

  // event.prompt is expanded user input
  pi.on("before_agent_start", (event) => {
    lastUserPrompt = event.prompt;
    currentLoopStartMs = Date.now();
  });

  // TPS monitoring and lifecycle hooks
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

  pi.registerCommand("srp-theme", {
    description: "Toggle SRP Footer and TPS Meter on/off",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "on", label: "on", description: "Enable Footer and TPS" },
        { value: "off", label: "off", description: "Disable Footer and TPS" },
      ];
      const filtered = candidates.filter((item) => item.value.startsWith(prefix.trimStart()));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const state = args.trim().toLowerCase();
      if (state !== "on" && state !== "off") {
        ctx.ui.notify("Usage: /srp-theme on|off", "info");
        return;
      }

      const enabled = state === "on";
      footerEnabled = enabled;
      tpsMeter.enabled = enabled;

      if (ctx.mode === "tui") {
        if (enabled) installFooter(ctx);
        else removeFooter(ctx);
      }

      if (enabled) {
        const theme = ctx.ui?.theme ?? safeFallbackTheme;
        ctx.ui.setStatus("tps", tpsMeter.renderFinal(theme));
      } else {
        tpsMeter.stopTick();
        ctx.ui.setStatus("tps", undefined);
      }
      ctx.ui.notify(`srp-theme: ${enabled ? "Enabled" : "Disabled"} Footer and TPS`, "info");
    },
  });
}
