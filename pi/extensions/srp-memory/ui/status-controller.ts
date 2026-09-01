/**
 * TUI observability for SRP Observational Memory.
 */

export type WorkerType = "observer" | "consolidator";

export interface FooterGauges {
  /** Raw tokens accrued toward the next observer chunk. */
  nextValue: number;
  nextMax: number;
  /** Active pool tokens accrued toward the consolidation threshold. */
  poolValue: number;
  poolMax: number;
  /** Live context-window tokens toward the compaction threshold. */
  ctxValue: number;
  ctxMax: number;
}

interface Theme {
  fg(color: string, text: string): string;
  bg?(color: string, text: string): string;
  bold?(text: string): string;
}

export interface StatusUI {
  setStatus(key: string, text: string | undefined): void;
  setWidget(
    key: string,
    content: string[] | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void;
  theme: Theme;
}

type WorkerState =
  | { kind: "running" }
  | { kind: "done"; delta?: number }
  | { kind: "error" };

const WIDGET_KEY = "srp-memory";
const LEGACY_WORKERS_WIDGET_KEY = "srp-memory-workers";
const LEGACY_STATUS_KEY = "srp-memory";
const SPINNER_FRAMES = ["◐", "◓", "◑", "◒"] as const;
const WORKER_SEP = "   ";

export interface StatusControllerOptions {
  spinnerIntervalMs?: number;
  settleMs?: number;
}

interface WorkerEntry {
  type: WorkerType;
  state: WorkerState;
  settleTimer?: ReturnType<typeof setTimeout>;
}

export class StatusController {
  private ui: StatusUI | undefined;
  private frame = 0;
  private readonly workers = new Map<string, WorkerEntry>();
  private spinnerTimer: ReturnType<typeof setInterval> | undefined;
  private gauges: FooterGauges | undefined;
  private cost: { costUsd: number; runs: number } | undefined;
  private readonly spinnerIntervalMs: number;
  private readonly settleMs: number;

  constructor(options: StatusControllerOptions = {}) {
    this.spinnerIntervalMs = options.spinnerIntervalMs ?? 120;
    this.settleMs = options.settleMs ?? 5000;
  }

  attach(ui: StatusUI): void {
    this.ui = ui;
    this.ui.setStatus(LEGACY_STATUS_KEY, undefined);
    this.ui.setWidget(LEGACY_WORKERS_WIDGET_KEY, undefined);
    this.renderWidget();
  }

  detach(): void {
    this.stopSpinner();
    for (const entry of this.workers.values()) {
      if (entry.settleTimer) clearTimeout(entry.settleTimer);
    }
    this.workers.clear();
    this.gauges = undefined;
    this.cost = undefined;
    this.ui?.setWidget(WIDGET_KEY, undefined);
    this.ui?.setWidget(LEGACY_WORKERS_WIDGET_KEY, undefined);
    if (this.ui) this.ui.setStatus(LEGACY_STATUS_KEY, undefined);
    this.ui = undefined;
  }

  setGauges(gauges: FooterGauges | undefined): void {
    this.gauges = gauges;
    this.renderWidget();
  }

  setCost(costUsd: number, runs: number): void {
    this.cost = { costUsd, runs };
    this.renderWidget();
  }

  workerStart(type: WorkerType, runId: string): void {
    if (!this.ui) return;
    const existing = this.workers.get(runId);
    if (existing?.settleTimer) clearTimeout(existing.settleTimer);
    this.workers.set(runId, { type, state: { kind: "running" } });
    this.startSpinner();
    this.renderWidget();
  }

  workerDone(runId: string, delta?: number): void {
    this.settle(runId, { kind: "done", delta });
  }

  workerError(runId: string): void {
    this.settle(runId, { kind: "error" });
  }

  private settle(runId: string, state: WorkerState): void {
    if (!this.ui) return;
    const entry = this.workers.get(runId);
    if (!entry) return;
    if (entry.settleTimer) clearTimeout(entry.settleTimer);
    entry.state = state;
    this.renderWidget();
    entry.settleTimer = setTimeout(() => {
      this.workers.delete(runId);
      this.renderWidget();
      if (!this.hasRunningWorker()) this.stopSpinner();
    }, this.settleMs);
    (entry.settleTimer as any)?.unref?.();
    if (!this.hasRunningWorker()) this.stopSpinner();
  }

  private hasRunningWorker(): boolean {
    for (const entry of this.workers.values()) {
      if (entry.state.kind === "running") return true;
    }
    return false;
  }

  private startSpinner(): void {
    if (this.spinnerTimer) return;
    this.spinnerTimer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      if (this.hasRunningWorker()) this.renderWidget();
    }, this.spinnerIntervalMs);
    (this.spinnerTimer as any)?.unref?.();
  }

  private stopSpinner(): void {
    if (!this.spinnerTimer) return;
    clearInterval(this.spinnerTimer);
    this.spinnerTimer = undefined;
  }

  private gaugeBar(value: number, max: number, cells = 6): string {
    const theme = this.ui!.theme;
    const frac = max <= 0 ? 0 : Math.max(0, value / max);
    const filled = Math.min(cells, Math.round(Math.min(1, frac) * cells));
    const fillColor = frac >= 1 ? "warning" : "dim";
    return (
      theme.fg(fillColor, "▕") +
      theme.fg(fillColor, "█".repeat(filled)) +
      theme.fg(fillColor, "░".repeat(cells - filled)) +
      theme.fg(fillColor, "▏")
    );
  }

  private renderWorkersLine(): string | undefined {
    if (this.workers.size === 0) return undefined;
    const theme = this.ui!.theme;
    const parts: string[] = [];
    for (const entry of this.workers.values()) {
      if (entry.state.kind === "running") {
        parts.push(`${theme.fg("accent", SPINNER_FRAMES[this.frame])} ${theme.fg("accent", `[${entry.type}]`)}`);
      } else if (entry.state.kind === "error") {
        parts.push(`${theme.fg("error", "✗")} ${theme.fg("muted", `[${entry.type}]`)}`);
      } else {
        const delta =
          entry.state.delta && entry.state.delta > 0
            ? ` ${theme.fg("success", `+${entry.state.delta}`)}`
            : "";
        parts.push(`${theme.fg("success", "✓")} ${theme.fg("muted", `[${entry.type}]`)}${delta}`);
      }
    }
    return parts.length > 0 ? parts.join(WORKER_SEP) : undefined;
  }

  private renderMemLine(): string {
    const theme = this.ui?.theme;
    if (!theme) return "srp-memory";
    const base = `${theme.fg("success", "● mem")}`;
    const g = this.gauges;
    if (!g) return base;
    const next = `${theme.fg("muted", "O")}${this.gaugeBar(g.nextValue, g.nextMax)}`;
    const pool = `${theme.fg("muted", "C")}${this.gaugeBar(g.poolValue, g.poolMax)}`;
    const ctx = `${theme.fg("muted", "X")}${this.gaugeBar(g.ctxValue, g.ctxMax)}`;
    const cost = this.cost && this.cost.costUsd > 0 ? ` ${theme.fg("dim", `$${this.cost.costUsd.toFixed(3)}`)}` : "";
    return `${base} ${next} ${pool} ${ctx}${cost}`;
  }

  private renderWidget(): void {
    const ui = this.ui;
    if (!ui) return;

    const lines: string[] = [];
    const workersLine = this.renderWorkersLine();
    if (workersLine) {
      lines.push(workersLine);
    }
    const memLine = this.renderMemLine();
    if (memLine) {
      lines.push(memLine);
    }

    ui.setWidget(WIDGET_KEY, lines.length > 0 ? lines : undefined, { placement: "aboveEditor" });
  }
}
