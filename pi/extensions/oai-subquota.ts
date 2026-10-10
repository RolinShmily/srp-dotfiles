/**
 * oai-subquota.ts — OpenAI Codex subscription quota & status monitor for Pi
 *
 * Capabilities:
 * - Queries ChatGPT Codex backend usage quota (5-hour window, 7-day weekly window,
 *   banked rate-limit resets, and flexible credits).
 * - Renders a boxed quota summary in chat transcript on `/oai-subquota [codex]`.
 * - Displays a persistent, right-aligned single-line status in the footer:
 *     sub(codex) 5h:100% 7d:71% ↺4d5h
 * - Provider-scoped: active exclusively when current model provider is "openai-codex".
 *   Automatically clears when switching away and restores upon switching back.
 * - Turn-based hot refresh: passively collects x-codex-* headers during agent loops
 *   and refreshes the footer on turn completion (agent_end / agent_settled).
 * - ChatGPT OAuth (provider: "openai") quota querying is parked pending official API.
 */

import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AutocompleteItem,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, visibleWidth } from "@earendil-works/pi-tui";

const CODEX_PROVIDER = "openai-codex";
const CHATGPT_PROVIDER = "openai";
const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_SETTINGS_URL = "https://chatgpt.com/codex/settings/usage";
const STATUS_KEY = "oai-subquota";
const MESSAGE_TYPE = "codex-quota";
const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60_000;

const JWT_AUTH_CLAIM = "https://api.openai.com/auth";
const JWT_PROFILE_CLAIM = "https://api.openai.com/profile";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ----------------- Data Structures -----------------

export interface LimitWindow {
  usedPercent: number;
  leftPercent: number;
  windowSeconds?: number;
  resetAt?: number;
  resetAfterSeconds?: number;
}

export interface RateLimit {
  id: string;
  name: string;
  primary?: LimitWindow;
  secondary?: LimitWindow;
}

export interface CreditsSnapshot {
  hasCredits?: boolean;
  unlimited?: boolean;
  balance?: number | string;
}

export interface ResetsSnapshot {
  availableCount?: number;
  applicableCount?: number;
}

export interface AccountSnapshot {
  email?: string;
  plan?: string;
  accountId?: string;
}

export interface CodexUsageSnapshot {
  source: "api" | "headers" | "cache";
  fetchedAt: string;
  account: AccountSnapshot;
  defaultLimit?: RateLimit;
  credits?: CreditsSnapshot;
  resets?: ResetsSnapshot;
}

// ----------------- Utilities & Cache -----------------

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function getCachePath(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir() || ".", ".cache");
  return join(base, "oai-subquota", "usage.json");
}

async function readCachedSnapshot(): Promise<CodexUsageSnapshot | undefined> {
  try {
    const raw = await readFile(getCachePath(), "utf8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? (parsed as unknown as CodexUsageSnapshot) : undefined;
  } catch {
    return undefined;
  }
}

async function writeCachedSnapshot(snapshot: CodexUsageSnapshot): Promise<void> {
  try {
    const file = getCachePath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Non-fatal if filesystem is read-only
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const json = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return isRecord(json) ? json : undefined;
  } catch {
    return undefined;
  }
}

function extractAccountFromToken(token: string): AccountSnapshot {
  const payload = decodeJwtPayload(token);
  if (!payload) return {};

  const auth = isRecord(payload[JWT_AUTH_CLAIM]) ? payload[JWT_AUTH_CLAIM] : undefined;
  const profile = isRecord(payload[JWT_PROFILE_CLAIM]) ? payload[JWT_PROFILE_CLAIM] : undefined;

  const accountId = typeof auth?.chatgpt_account_id === "string" ? auth.chatgpt_account_id : undefined;
  const plan = typeof auth?.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : undefined;
  const email =
    (typeof profile?.email === "string" && profile.email) ||
    (typeof payload.email === "string" && payload.email) ||
    undefined;

  return { accountId, plan, email };
}

function normalizeResetAt(val: unknown): number | undefined {
  if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return undefined;
  return val > 10_000_000_000 ? Math.round(val / 1000) : val;
}

function normalizeWindow(val: unknown, nowMs = Date.now()): LimitWindow | undefined {
  if (!isRecord(val)) return undefined;

  const rawUsed = typeof val.used_percent === "number" ? val.used_percent : val.usedPercent;
  if (typeof rawUsed !== "number" || !Number.isFinite(rawUsed) || rawUsed < 0) return undefined;

  const usedPercent = Math.min(100, Math.max(0, rawUsed));
  const leftPercent = Math.max(0, Math.min(100, 100 - usedPercent));

  const resetAt = normalizeResetAt(val.reset_at ?? val.resetAt);
  const rawAfter = typeof val.reset_after_seconds === "number" ? val.reset_after_seconds : val.resetAfterSeconds;
  const resetAfterSeconds =
    typeof rawAfter === "number" && Number.isFinite(rawAfter) && rawAfter >= 0
      ? rawAfter
      : resetAt !== undefined
        ? Math.max(0, Math.round(resetAt - nowMs / 1000))
        : undefined;

  const rawSec = typeof val.limit_window_seconds === "number" ? val.limit_window_seconds : val.windowSeconds;
  const rawMin = typeof val.window_minutes === "number" ? val.window_minutes : val.windowMinutes;
  const windowSeconds =
    typeof rawSec === "number" && rawSec > 0
      ? rawSec
      : typeof rawMin === "number" && rawMin > 0
        ? rawMin * 60
        : undefined;

  return {
    usedPercent,
    leftPercent,
    ...(windowSeconds !== undefined ? { windowSeconds } : {}),
    ...(resetAt !== undefined ? { resetAt } : {}),
    ...(resetAfterSeconds !== undefined ? { resetAfterSeconds } : {}),
  };
}

function parseCredits(val: unknown): CreditsSnapshot | undefined {
  if (!isRecord(val)) return undefined;
  const hasCredits = val.has_credits === true;
  const unlimited = val.unlimited === true;
  const rawBalance = val.balance;
  const balance =
    typeof rawBalance === "number"
      ? rawBalance
      : typeof rawBalance === "string"
        ? Number(rawBalance.trim())
        : undefined;

  return {
    hasCredits,
    unlimited,
    ...(balance !== undefined && Number.isFinite(balance) ? { balance } : {}),
  };
}

function parseResets(val: unknown): ResetsSnapshot | undefined {
  if (!isRecord(val)) return undefined;
  const available = typeof val.available_count === "number" ? val.available_count : undefined;
  const applicable = typeof val.applicable_available_count === "number" ? val.applicable_available_count : undefined;
  if (available === undefined && applicable === undefined) return undefined;
  return {
    ...(available !== undefined ? { availableCount: available } : {}),
    ...(applicable !== undefined ? { applicableCount: applicable } : {}),
  };
}

function parseUsageApiResponse(data: unknown, tokenAccount: AccountSnapshot): CodexUsageSnapshot {
  if (!isRecord(data)) throw new Error("Usage API returned non-object response");

  const rateLimit = isRecord(data.rate_limit) ? data.rate_limit : undefined;
  const primary = normalizeWindow(rateLimit?.primary_window);
  const secondary = normalizeWindow(rateLimit?.secondary_window);

  const email = (typeof data.email === "string" && data.email) || tokenAccount.email;
  const plan = (typeof data.plan_type === "string" && data.plan_type) || tokenAccount.plan;
  const accountId = (typeof data.account_id === "string" && data.account_id) || tokenAccount.accountId;

  return {
    source: "api",
    fetchedAt: new Date().toISOString(),
    account: { email, plan, accountId },
    defaultLimit: {
      id: "codex",
      name: "Codex",
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
    },
    credits: parseCredits(data.credits),
    resets: parseResets(data.rate_limit_reset_credits),
  };
}

function parseCodexRateLimitHeaders(headers: Record<string, string>): CodexUsageSnapshot | undefined {
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) norm[k.toLowerCase()] = String(v);

  const num = (name: string): number | undefined => {
    const v = norm[name];
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (name: string): boolean | undefined => {
    const v = norm[name]?.trim().toLowerCase();
    return v === "true" || v === "1" ? true : v === "false" || v === "0" ? false : undefined;
  };

  const primaryUsed = num("x-codex-primary-used-percent");
  const secondaryUsed = num("x-codex-secondary-used-percent");
  if (primaryUsed === undefined && secondaryUsed === undefined) return undefined;

  const primary = normalizeWindow({
    used_percent: primaryUsed,
    window_minutes: num("x-codex-primary-window-minutes"),
    reset_at: normalizeResetAt(num("x-codex-primary-reset-at")),
  });
  const secondary = normalizeWindow({
    used_percent: secondaryUsed,
    window_minutes: num("x-codex-secondary-window-minutes"),
    reset_at: normalizeResetAt(num("x-codex-secondary-reset-at")),
  });

  return {
    source: "headers",
    fetchedAt: new Date().toISOString(),
    account: {},
    defaultLimit: {
      id: "codex",
      name: "Codex",
      ...(primary ? { primary } : {}),
      ...(secondary ? { secondary } : {}),
    },
    credits: {
      hasCredits: bool("x-codex-credits-has-credits"),
      unlimited: bool("x-codex-credits-unlimited"),
      balance: num("x-codex-credits-balance"),
    },
  };
}

function mergeSnapshots(existing: CodexUsageSnapshot | undefined, update: CodexUsageSnapshot): CodexUsageSnapshot {
  if (!existing) return update;
  const defaultLimit = update.defaultLimit ?? existing.defaultLimit;
  if (defaultLimit && existing.defaultLimit) {
    defaultLimit.primary = update.defaultLimit?.primary ?? existing.defaultLimit.primary;
    defaultLimit.secondary = update.defaultLimit?.secondary ?? existing.defaultLimit.secondary;
  }
  return {
    ...existing,
    ...update,
    account: { ...existing.account, ...update.account },
    ...(defaultLimit ? { defaultLimit } : {}),
    credits: update.credits ?? existing.credits,
    resets: update.resets ?? existing.resets,
  };
}

// ----------------- Formatters & UI -----------------

function pct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "?%";
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function padLabel(label: string, width = 28): string {
  return `${label}:`.padEnd(width, " ");
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatReset(resetAt: number | undefined, now = new Date()): string {
  if (!resetAt) return "";
  const reset = new Date(resetAt * 1000);
  if (!Number.isFinite(reset.getTime())) return "";
  const time = formatTime(reset);
  if (sameDay(reset, now)) return `resets ${time}`;
  const date = `${reset.getDate()} ${MONTH_NAMES[reset.getMonth()]}`;
  return reset.getFullYear() === now.getFullYear() ? `resets ${time} on ${date}` : `resets ${time} on ${date} ${reset.getFullYear()}`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const rounded = Math.round(seconds);
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  if (days > 0) return `${days}d${hours ? `${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${mins ? `${mins}m` : ""}`;
  return `${mins || 1}m`;
}

function resetSeconds(window: LimitWindow | undefined, now: Date): number | undefined {
  if (!window) return undefined;
  if (window.resetAfterSeconds !== undefined) return window.resetAfterSeconds;
  return window.resetAt !== undefined ? Math.max(0, Math.round(window.resetAt - now.getTime() / 1000)) : undefined;
}

export function bar(leftPercent: number | undefined, width = 20): string {
  const left = Math.max(0, Math.min(100, leftPercent ?? 0));
  const filled = Math.max(0, Math.min(width, Math.round((left / 100) * width)));
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function formatWindowLine(label: string, window: LimitWindow | undefined, now: Date): string | undefined {
  if (!window) return undefined;
  const reset = formatReset(window.resetAt, now) || (formatDuration(window.resetAfterSeconds) ? `resets in ${formatDuration(window.resetAfterSeconds)}` : "");
  const suffix = reset ? ` (${reset})` : "";
  return `${padLabel(label)}${bar(window.leftPercent)} ${pct(window.leftPercent)} left${suffix}`;
}

function formatCreditsLine(snapshot: CodexUsageSnapshot): string | undefined {
  const c = snapshot.credits;
  if (!c) return undefined;
  if (c.unlimited) return `${padLabel("Credits")}unlimited`;
  if (c.balance !== undefined) {
    const val = Number(c.balance);
    if (!Number.isFinite(val) || val <= 0) return undefined;
    return `${padLabel("Credits")}${Math.floor(val).toLocaleString()} credits`;
  }
  return c.hasCredits ? `${padLabel("Credits")}available` : undefined;
}

function formatResetsLine(snapshot: CodexUsageSnapshot): string | undefined {
  const count = snapshot.resets?.availableCount;
  return typeof count === "number" && count > 0 ? `${padLabel("Resets")}${count} available` : undefined;
}

export function formatStatusline(snapshot: CodexUsageSnapshot, now = new Date()): string {
  const parts: string[] = [];
  const primary = snapshot.defaultLimit?.primary;
  const secondary = snapshot.defaultLimit?.secondary;

  if (primary) {
    parts.push(`5h:${pct(primary.leftPercent)}`);
  }

  if (secondary) {
    parts.push(`7d:${pct(secondary.leftPercent)}`);
    const r7d = formatDuration(resetSeconds(secondary, now));
    if (r7d) parts.push(`↺${r7d}`);
  }

  return parts.length > 0 ? `sub(codex) ${parts.join(" ")}` : "sub(codex) unavailable";
}

function makeBox(lines: string[], reqWidth?: number): string {
  const contentWidth = Math.max(...lines.map((l) => visibleWidth(l)), 1);
  const width = Math.max(contentWidth, reqWidth ?? 0);
  const top = `╭${"─".repeat(width + 2)}╮`;
  const bottom = `╰${"─".repeat(width + 2)}╯`;
  const body = lines.map((l) => `│ ${l}${" ".repeat(Math.max(0, width - visibleWidth(l)))} │`);
  return [top, ...body, bottom].join("\n");
}

export function formatBoxedStatus(snapshot: CodexUsageSnapshot, now = new Date()): string {
  const lines: string[] = [
    ">_ Codex usage",
    "",
    `Visit ${USAGE_SETTINGS_URL} for up-to-date`,
    "information on rate limits and credits",
    "",
  ];

  const acct: string[] = [];
  if (snapshot.account.email) acct.push(snapshot.account.email);
  if (snapshot.account.plan) acct.push(`(${snapshot.account.plan[0]?.toUpperCase()}${snapshot.account.plan.slice(1)})`);
  if (acct.length > 0) lines.push(`${padLabel("Account")}${acct.join(" ")}`);
  if (snapshot.fetchedAt) lines.push(`${padLabel("Updated")}${new Date(snapshot.fetchedAt).toLocaleString()}`);
  lines.push("");

  const p = formatWindowLine("5h limit", snapshot.defaultLimit?.primary, now);
  const s = formatWindowLine("Weekly limit", snapshot.defaultLimit?.secondary, now);
  if (p) lines.push(p);
  if (s) lines.push(s);

  const credits = formatCreditsLine(snapshot);
  if (credits) lines.push(credits);

  const resets = formatResetsLine(snapshot);
  if (resets) lines.push(resets);

  return makeBox(lines);
}

function colorForLeft(left: number): "success" | "warning" | "error" {
  return left >= 60 ? "success" : left >= 25 ? "warning" : "error";
}

function colorizeStatusLine(line: string, theme: Theme): string {
  let out = line;
  const match = line.match(/(\[[█░]+\])\s+(\d+(?:\.\d+)?)% left/);
  if (match?.[1] && match[2]) {
    const barText = match[1];
    const pctText = match[2];
    const color = colorForLeft(Number(pctText) || 0);
    out = out.replace(barText, theme.fg(color, barText));
    out = out.replace(`${pctText}% left`, theme.fg(color, `${pctText}% left`));
  }
  out = out.replace(">_ Codex usage", theme.fg("accent", theme.bold(">_ Codex usage")));
  out = out.replace(/(Account|Updated|5h limit|Weekly limit|Credits|Resets):/g, (lbl) => theme.fg("muted", lbl));
  out = out.replace(/(Visit https:\/\/chatgpt\.com\/codex\/settings\/usage for up-to-date|information on rate limits and credits)/g, (txt) => theme.fg("dim", txt));

  if (out.startsWith("╭") || out.startsWith("╰")) return theme.fg("dim", out);
  if (out.startsWith("│") && out.endsWith("│")) {
    return `${theme.fg("dim", out[0] ?? "")}${out.slice(1, -1)}${theme.fg("dim", out.at(-1) ?? "")}`;
  }
  return out;
}

function renderStatusMessage(message: { content: string }, _opt: unknown, theme: Theme): Text {
  return new Text(message.content.split("\n").map((l) => colorizeStatusLine(l, theme)).join("\n"), 0, 0);
}

// ----------------- Core Network Query -----------------

async function queryUsage(accessToken: string, accountId?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": "codex-cli",
    Accept: "application/json",
  };
  if (accountId) headers["ChatGPT-Account-Id"] = accountId;

  const res = await fetch(USAGE_ENDPOINT, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (res.status === 401 || res.status === 403) throw new Error(`Authentication rejected (HTTP ${res.status}). Please run /login openai-codex.`);
  if (res.status === 429) throw new Error("Rate limit exceeded for usage endpoint (HTTP 429). Please try again later.");
  if (!res.ok) throw new Error(`Usage request failed (HTTP ${res.status}).`);

  const body = await res.json();
  if (!isRecord(body)) throw new Error("Invalid JSON received from usage endpoint.");
  return body;
}

// ----------------- Runtime & Provider Scoping -----------------

function isCodexProvider(ctx: ExtensionContext | ExtensionCommandContext): boolean {
  return ctx.model?.provider === CODEX_PROVIDER;
}

function dimText(ctx: ExtensionContext | ExtensionCommandContext, text: string): string {
  try {
    return ctx.ui?.theme?.fg ? ctx.ui.theme.fg("dim", text) : text;
  } catch {
    return text;
  }
}

let activeCtx: ExtensionContext | ExtensionCommandContext | null = null;
let latestSnapshot: CodexUsageSnapshot | undefined;

function getTerminalWidth(): number {
  return process.stdout?.columns ?? process.stderr?.columns ?? 80;
}

export function formatRightAlignedStatusline(snapshot: CodexUsageSnapshot, now = new Date()): string {
  const line = formatStatusline(snapshot, now);
  const termWidth = getTerminalWidth();
  const lineW = visibleWidth(line);
  if (termWidth <= lineW) return line;

  // \u200B zero-width space prevents .trim() from stripping leading \u00A0 non-breaking spaces
  return `\u200b${"\u00a0".repeat(Math.max(0, termWidth - lineW))}${line}`;
}

function setFooterStatus(ctx: ExtensionContext | ExtensionCommandContext, snapshot: CodexUsageSnapshot | undefined): void {
  latestSnapshot = snapshot;
  activeCtx = ctx;
  try {
    if (!ctx.ui?.setStatus) return;
    if (!snapshot || !isCodexProvider(ctx)) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    ctx.ui.setStatus(STATUS_KEY, dimText(ctx, formatRightAlignedStatusline(snapshot)));
  } catch {
    // UI unavailable
  }
}

async function refreshCodexSnapshot(
  ctx: ExtensionContext | ExtensionCommandContext,
  force = false,
): Promise<CodexUsageSnapshot | undefined> {
  const cached = await readCachedSnapshot();
  if (cached) {
    setFooterStatus(ctx, cached);
    if (!force && Date.now() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS) {
      return cached;
    }
  }

  const resolved = await ctx.modelRegistry.getProviderAuth(CODEX_PROVIDER).catch(() => undefined);
  const accessToken = resolved?.auth.apiKey;
  if (!accessToken) {
    if (!cached) setFooterStatus(ctx, undefined);
    return undefined;
  }

  const tokenAccount = extractAccountFromToken(accessToken);
  const rawBody = await queryUsage(accessToken, tokenAccount.accountId);
  const snapshot = parseUsageApiResponse(rawBody, tokenAccount);

  await writeCachedSnapshot(snapshot);
  setFooterStatus(ctx, snapshot);
  return snapshot;
}

// ----------------- Extension Entrypoint -----------------

export default function (pi: ExtensionAPI): void {
  pi.registerMessageRenderer(MESSAGE_TYPE, renderStatusMessage);

  const onResize = () => {
    if (activeCtx && latestSnapshot && isCodexProvider(activeCtx)) {
      setFooterStatus(activeCtx, latestSnapshot);
    }
  };
  process.stdout?.on?.("resize", onResize);

  let queryInFlight = false;
  let isLoopActive = false;
  let latestLoopHeaders: Record<string, string> | null = null;
  let lastLoopRefreshTime = 0;

  pi.on("session_shutdown", () => {
    process.stdout?.off?.("resize", onResize);
    activeCtx = null;
  });

  // Session start: activate only if current model provider is openai-codex
  pi.on("session_start", async (_event, ctx) => {
    if (!isCodexProvider(ctx)) {
      setFooterStatus(ctx, undefined);
      return;
    }
    try {
      const cached = await readCachedSnapshot();
      if (cached) setFooterStatus(ctx, cached);
      void refreshCodexSnapshot(ctx, false).catch(() => undefined);
    } catch {
      // Non-blocking
    }
  });

  // Dynamically react to model selection changes (/model or Ctrl+P)
  pi.on("model_select", async (event, ctx) => {
    if (event.model.provider === CODEX_PROVIDER) {
      try {
        const cached = await readCachedSnapshot();
        if (cached) setFooterStatus(ctx, cached);
        void refreshCodexSnapshot(ctx, false).catch(() => undefined);
      } catch {
        // Non-blocking
      }
    } else {
      setFooterStatus(ctx, undefined);
    }
  });

  // Turn start: activate hot-capture only for openai-codex
  pi.on("before_agent_start", (_event, ctx) => {
    if (!isCodexProvider(ctx)) {
      isLoopActive = false;
      latestLoopHeaders = null;
      return;
    }
    isLoopActive = true;
    latestLoopHeaders = null;
  });

  // Provider response: passively buffer rate limit headers during turn
  pi.on("after_provider_response", (event, ctx) => {
    if (!isCodexProvider(ctx) || !isLoopActive || !event.headers) return;
    for (const [k, v] of Object.entries(event.headers)) {
      if (k.toLowerCase().startsWith("x-codex-")) {
        if (!latestLoopHeaders) latestLoopHeaders = {};
        latestLoopHeaders[k] = v;
      }
    }
  });

  // Turn completion: refresh quota on agent loop boundary
  const onAgentLoopFinished = async (ctx: ExtensionContext) => {
    if (!isCodexProvider(ctx)) {
      isLoopActive = false;
      latestLoopHeaders = null;
      return;
    }
    isLoopActive = false;
    const now = Date.now();
    if (now - lastLoopRefreshTime < 1500) return;
    lastLoopRefreshTime = now;

    try {
      if (latestLoopHeaders) {
        const parsed = parseCodexRateLimitHeaders(latestLoopHeaders);
        latestLoopHeaders = null;
        if (parsed) {
          const cached = await readCachedSnapshot();
          const merged = mergeSnapshots(cached, parsed);
          await writeCachedSnapshot(merged);
          setFooterStatus(ctx, merged);
          return;
        }
      }
      void refreshCodexSnapshot(ctx, false).catch(() => undefined);
    } catch {
      // Non-blocking
    }
  };

  pi.on("agent_end", (_event, ctx) => {
    void onAgentLoopFinished(ctx);
  });
  pi.on("agent_settled", (_event, ctx) => {
    void onAgentLoopFinished(ctx);
  });

  // Slash command registration with English schema
  pi.registerCommand("oai-subquota", {
    description: "Check OpenAI Codex subscription quota (5h, 7d, resets); new ChatGPT OAuth quota is parked",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
        { value: "codex", label: "codex", description: "Display Codex quota summary box and refresh footer" },
        { value: "refresh", label: "refresh", description: "Force fresh quota query from OpenAI backend" },
        { value: "statusline", label: "statusline", description: "Print compact single-line quota text" },
        { value: "chatgpt", label: "chatgpt", description: "Inspect new ChatGPT OAuth status (parked)" },
      ];
      const filtered = items.filter((item) => item.value.startsWith(prefix.trimStart()));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const sub = args.trim().toLowerCase();

      // ChatGPT new provider parked placeholder
      if (sub === "chatgpt") {
        const resolved = await ctx.modelRegistry.getProviderAuth(CHATGPT_PROVIDER).catch(() => undefined);
        const hasAuth = !!resolved?.auth.apiKey;
        const msg = hasAuth
          ? "ChatGPT subscription (provider: openai) is parked: official 5h/weekly rate limit endpoint is not yet supported."
          : "ChatGPT subscription (provider: openai) is not authenticated. Quota querying is parked.";

        if (ctx.hasUI) {
          ctx.ui.notify(msg, "info");
        } else {
          console.log(msg);
        }
        return;
      }

      if (queryInFlight) {
        if (ctx.hasUI) ctx.ui.notify("oai-subquota: Query in progress.", "warning");
        return;
      }

      queryInFlight = true;
      try {
        const force = sub === "refresh";
        const snapshot = await refreshCodexSnapshot(ctx, force);
        if (!snapshot) {
          throw new Error("No openai-codex OAuth credentials found. Please run /login openai-codex first.");
        }

        if (sub === "statusline") {
          const line = formatStatusline(snapshot);
          if (ctx.hasUI === false) {
            console.log(line);
          } else {
            ctx.ui.notify(line, "info");
          }
          return;
        }

        // Render boxed quota summary
        const boxed = formatBoxedStatus(snapshot);
        if (ctx.hasUI === false) {
          console.log(boxed);
        } else if (pi.sendMessage) {
          await pi.sendMessage({
            customType: MESSAGE_TYPE,
            content: boxed,
            display: true,
            details: snapshot,
          });
        } else {
          ctx.ui.notify(formatStatusline(snapshot), "info");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (ctx.hasUI) {
          ctx.ui.notify(`oai-subquota error: ${message}`, "error");
        } else {
          console.error(`oai-subquota error: ${message}`);
        }
      } finally {
        queryInFlight = false;
      }
    },
  });
}
