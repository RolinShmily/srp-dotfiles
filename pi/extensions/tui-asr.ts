/**
 * tui-asr.ts — Terminal streaming ASR voice dictation extension for Pi.
 *
 * Features:
 *   1. Streaming ASR: Real-time recognition using Aliyun DashScope Paraformer WebSocket.
 *   2. Visual metering: Animated braille volume level waveform (● ⣀⣄ listening…).
 *   3. Native Pi auth: Resolves keys from `/login dashscope` (auth.json) or DASHSCOPE_API_KEY.
 *   4. Model selector: Native Pi-style searchable TUI selector dialog (/asr model).
 *   5. Input injection: Directly inserts text into active editor or clipboard.
 *
 * Keybindings:
 *   - Alt+M: Start / Stop voice dictation
 *   - Alt+N: Cancel current dictation
 *
 * Commands:
 *   - /asr: Toggle voice dictation
 *   - /asr model [name]: Interactive searchable model selector
 */

import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  Spacer,
  Text,
  fuzzyFilter,
  getKeybindings,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Readable } from "node:stream";

import { ALL_ASR_MODELS, type AsrModelDefinition } from "./custom-providers/asr/index.ts";

// ============================ Configuration ============================

/** Default startup ASR model ID */
const DEFAULT_ASR_MODEL = "paraformer-realtime-v2";

/** Default shortcuts */
const TOGGLE_SHORTCUTS = ["alt+m"];
const CANCEL_SHORTCUTS = ["alt+n"];

// ============================ Audio Level & Waveform ============================

const BRAILLE_FRAMES = ["⠀", "⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿"];
const METER_CELLS = 4;
const METER_TICK_MS = 80;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

function rmsFromPcm16(buf: Buffer): number {
  if (buf.length < 2) return 0;
  const sampleCount = Math.floor(buf.length / 2);
  let sumSquares = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = buf.readInt16LE(i * 2);
    sumSquares += sample * sample;
  }
  const meanSquare = sumSquares / sampleCount;
  return Math.sqrt(meanSquare);
}

function rmsToBlock(rms: number): string {
  const norm = Math.min(1, Math.max(0, rms / 8000));
  const idx = Math.min(BRAILLE_FRAMES.length - 1, Math.floor(norm * BRAILLE_FRAMES.length));
  return BRAILLE_FRAMES[idx];
}

function formatDimText(ctx: ExtensionContext, text: string): string {
  try {
    if (ctx.ui?.theme?.fg) {
      return ctx.ui.theme.fg("muted", text);
    }
  } catch {}
  return `\x1b[90m${text}\x1b[39m`;
}

// ============================ Clipboard Fallback ============================

function copyToClipboard(text: string): boolean {
  try {
    const isWsl =
      process.platform === "linux" &&
      typeof process.env.WSL_DISTRO_NAME === "string";

    let proc: ChildProcessByStdio<any, any, any>;
    if (isWsl) {
      proc = spawn("clip.exe", [], { stdio: ["pipe", "ignore", "ignore"] });
    } else if (process.platform === "win32") {
      proc = spawn("clip", [], { stdio: ["pipe", "ignore", "ignore"] });
    } else if (process.platform === "darwin") {
      proc = spawn("pbcopy", [], { stdio: ["pipe", "ignore", "ignore"] });
    } else {
      try {
        proc = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
      } catch {
        proc = spawn("xclip", ["-selection", "clipboard"], { stdio: ["pipe", "ignore", "ignore"] });
      }
    }

    proc.stdin.write(text);
    proc.stdin.end();
    return true;
  } catch {
    return false;
  }
}

// ============================ Credentials ============================

async function resolveProviderApiKey(provider: string, ctx?: ExtensionContext | null): Promise<string> {
  if (ctx?.modelRegistry) {
    const candidates = provider === "dashscope" ? ["dashscope", "aliyun"] : [provider];
    for (const id of candidates) {
      try {
        const key = await ctx.modelRegistry.getApiKeyForProvider(id);
        if (key?.trim()) return key.trim();
      } catch {}
      try {
        const auth = await ctx.modelRegistry.getProviderAuth(id);
        if (auth?.auth?.apiKey?.trim()) return auth.auth.apiKey.trim();
      } catch {}
    }
  }
  const envKey = process.env[`${provider.toUpperCase()}_API_KEY`];
  if (envKey?.trim()) return envKey.trim();
  if (provider === "dashscope") {
    return process.env.ALIYUN_API_KEY?.trim() || "";
  }
  return "";
}

// ============================ Focus Target Resolution ============================

interface EditorLike {
  getText(): string;
  setText(text: string): void;
}

type Target =
  | { kind: "editor"; editor: EditorLike }
  | { kind: "typable"; component: { handleInput(data: string): void } };

const asEditorLike = (value: any): EditorLike | null =>
  value && typeof value.getText === "function" && typeof value.setText === "function" ? value : null;

// ============================ Searchable Model Selector TUI ============================

class SearchableAsrModelSelectorComponent {
  private searchInput = new Input();
  private selectedIndex = 0;
  private filteredModels: AsrModelDefinition[] = [];
  private _focused = true;
  private cachedLines?: string[];
  private cachedWidth = -1;

  get focused() {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    private tui: any,
    private theme: any,
    private models: AsrModelDefinition[],
    private currentModelId: string,
    private onSelect: (model: AsrModelDefinition) => void,
    private onCancel: () => void,
    private getLoginStatus?: (provider: string) => boolean,
  ) {
    this.filteredModels = [...models];
    const curIdx = models.findIndex((m) => m.id === currentModelId);
    this.selectedIndex = curIdx >= 0 ? curIdx : 0;
    this.searchInput.focused = true;
  }

  private refresh() {
    this.cachedLines = undefined;
    this.tui.requestRender?.();
  }

  filterModels(query: string) {
    const q = query.trim().toLowerCase();
    if (q) {
      this.filteredModels = fuzzyFilter(
        this.models,
        q,
        (m) => `${m.id} ${m.name} ${m.provider} ${m.description}`,
      );
    } else {
      this.filteredModels = [...this.models];
    }
    this.selectedIndex = q ? 0 : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
    this.refresh();
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const lines: string[] = [];
    const border = this.theme.fg("accent", "─".repeat(Math.max(10, width)));

    lines.push(border);
    lines.push("");

    // Scope & credentials status line (matching Pi native selector screenshot)
    const scopeTitle = `${this.theme.fg("muted", "Scope: ")}${this.theme.fg("accent", "all")}${this.theme.fg("muted", " | dashscope")}`;
    lines.push(`  ${scopeTitle}`);

    if (this.getLoginStatus) {
      const loggedIn = this.getLoginStatus("dashscope");
      const authStatus = loggedIn
        ? this.theme.fg("success", "✓ DashScope credentials: ready (via /login dashscope)")
        : this.theme.fg("warning", "! DashScope credentials: not logged in (run /login dashscope)");
      lines.push(`  ${authStatus}`);
    }
    lines.push("");

    // Search input line (> █)
    for (const l of this.searchInput.render(Math.max(1, width - 4))) {
      lines.push(`  ${l}`);
    }
    lines.push("");

    // Model list (<cursor><check><model-id> [<provider>] [badges])
    if (this.filteredModels.length === 0) {
      lines.push(`  ${this.theme.fg("warning", "No matching ASR models found")}`);
    } else {
      const maxVisible = 6;
      const total = this.filteredModels.length;
      const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), total - maxVisible));
      const endIndex = Math.min(startIndex + maxVisible, total);

      for (let i = startIndex; i < endIndex; i++) {
        const item = this.filteredModels[i];
        const isSelected = i === this.selectedIndex;
        const isCurrent = item.id === this.currentModelId;

        const cursor = isSelected ? this.theme.fg("accent", "→ ") : "  ";
        const check = isCurrent ? this.theme.fg("accent", "✓ ") : "  ";
        const modelText = isSelected
          ? (this.theme.bold ? this.theme.bold(this.theme.fg("accent", item.id)) : this.theme.fg("accent", item.id))
          : this.theme.fg("text", item.id);
        const providerBadge = this.theme.fg("muted", `[${item.provider}]`);
        const currentBadge = isCurrent ? this.theme.fg("muted", " · current") : "";

        lines.push(`  ${cursor}${check}${modelText} ${providerBadge}${currentBadge}`);
      }

      if (startIndex > 0 || endIndex < total) {
        lines.push(`  ${this.theme.fg("muted", `(${this.selectedIndex + 1}/${total})`)}`);
      }
    }
    lines.push("");

    // Selected model detail
    const selected = this.filteredModels[this.selectedIndex];
    if (selected) {
      lines.push(`  ${this.theme.fg("muted", "Model Name: ")}${selected.name}`);
      lines.push(`  ${this.theme.fg("muted", "Description: ")}${selected.description}`);
    }
    lines.push("");

    // Keybinding footer hints
    lines.push(this.theme.fg("dim", "  Enter to select · Escape/Ctrl+C to cancel · ↑↓ to navigate"));
    lines.push(border);

    this.cachedLines = lines;
    this.cachedWidth = width;
    return lines;
  }

  invalidate() {
    this.cachedLines = undefined;
  }

  handleInput(keyData: string) {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
      this.refresh();
      return;
    }
    if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
      this.refresh();
      return;
    }
    if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
      const selected = this.filteredModels[this.selectedIndex];
      if (selected) {
        this.onSelect(selected);
      }
      return;
    }
    if (kb.matches(keyData, "tui.select.cancel") || keyData === "\x1b" || keyData === "\x03") {
      this.onCancel();
      return;
    }
    this.searchInput.handleInput(keyData);
    this.filterModels(this.searchInput.getValue());
  }
}

// ============================ Extension Entrypoint ============================

type State = "idle" | "recording" | "stopping";

export default function (pi: ExtensionAPI) {
  let activeModel = DEFAULT_ASR_MODEL;
  let state: State = "idle";
  let rec: ChildProcessByStdio<null, Readable, Readable> | null = null;
  let activeProvider: StreamingAsrProvider | null = null;
  let finals: string[] = [];
  let activeCtx: ExtensionContext | null = null;
  let flushed = false;
  let cancelled = false;
  let stopTimeout: NodeJS.Timeout | null = null;
  let generation = 0;

  // TUI state
  let tuiHandle: any = null;
  let removeInputListener: (() => void) | null = null;
  let lastCtx: ExtensionContext | null = null;

  // Meter animation
  let meter: number[] = new Array(METER_CELLS).fill(0);
  let currentLevel = 0;
  let meterTimer: NodeJS.Timeout | null = null;

  // Spinner animation
  let spinnerFrame = 0;
  let spinnerTimer: NodeJS.Timeout | null = null;

  const setStatus = (msg: string | undefined) => {
    if (!activeCtx) return;
    activeCtx.ui.setStatus("tui-asr", msg);
  };

  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };

  const stopMeter = () => {
    if (meterTimer) {
      clearInterval(meterTimer);
      meterTimer = null;
    }
  };

  /** Start braille audio level meter animation */
  const startMeter = () => {
    stopMeter();
    meter = new Array(METER_CELLS).fill(0);
    currentLevel = 0;
    const render = () => {
      const dot = activeCtx?.ui.theme.fg("error", "●") ?? "●";
      setStatus(`${dot} ${meter.map(rmsToBlock).join("")} listening…`);
    };
    render();
    meterTimer = setInterval(() => {
      meter.shift();
      meter.push(currentLevel);
      render();
    }, METER_TICK_MS);
  };

  /** Start finalizing spinner */
  const startSpinner = (suffix: string) => {
    stopSpinner();
    spinnerFrame = 0;
    setStatus(`${SPINNER_FRAMES[0]} ${suffix}`);
    spinnerTimer = setInterval(() => {
      spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
      setStatus(`${SPINNER_FRAMES[spinnerFrame]} ${suffix}`);
    }, SPINNER_INTERVAL_MS);
  };

  /** Dynamically resolve currently focused input component */
  const resolveTarget = (): Target | null => {
    const focused = tuiHandle?.focusedComponent;
    if (!focused) return null;
    const editor = asEditorLike(focused) ?? asEditorLike(focused.editor);
    if (editor) return { kind: "editor", editor };
    if (typeof focused.handleInput === "function") return { kind: "typable", component: focused };
    return null;
  };

  /** Flush transcribed text into focused component */
  const flush = () => {
    if (flushed || !activeCtx) return;
    flushed = true;
    if (cancelled) return;

    const text = finals.join(" ").replace(/\s+/g, " ").trim();
    if (!text) return;

    // 1. Fallback: append to main editor if no TUI handle
    if (!tuiHandle) {
      const current = activeCtx.ui.getEditorText() ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      activeCtx.ui.setEditorText(current + sep + text);
      return;
    }

    // 2. Insert into focused editor or typable component
    const target = resolveTarget();
    if (target?.kind === "editor") {
      const current = target.editor.getText() ?? "";
      const sep = current && !/\s$/.test(current) ? " " : "";
      target.editor.setText(current + sep + text);
      tuiHandle.requestRender?.();
      return;
    }

    if (target?.kind === "typable") {
      target.component.handleInput(text);
      tuiHandle.requestRender?.();
      return;
    }

    // 3. Fallback: copy to clipboard if no input focused
    const copied = copyToClipboard(text);
    if (copied) {
      activeCtx.ui.notify("Dictated text copied to clipboard (no input focused)", "info");
    } else {
      activeCtx.ui.notify(`Dictated: ${text}`, "info");
    }
  };

  const cleanup = () => {
    generation++;
    flush();
    stopSpinner();
    stopMeter();
    if (stopTimeout) {
      clearTimeout(stopTimeout);
      stopTimeout = null;
    }
    if (rec) {
      try {
        rec.kill("SIGTERM");
      } catch {}
      rec = null;
    }
    if (activeProvider) {
      try {
        activeProvider.cancel();
      } catch {}
      activeProvider = null;
    }
    finals = [];
    state = "idle";
    setStatus(undefined);
    activeCtx = null;
    flushed = false;
    cancelled = false;
  };

  const startDictation = async (ctx: ExtensionContext) => {
    const modelDef = ALL_ASR_MODELS.find((m) => m.id === activeModel) ?? ALL_ASR_MODELS[0];
    const apiKey = await resolveProviderApiKey(modelDef.provider, ctx);
    if (!apiKey) {
      ctx.ui.notify(
        `API Key not found for ${modelDef.provider}.\nPlease run /login ${modelDef.provider} in terminal or set ${modelDef.provider.toUpperCase()}_API_KEY.`,
        "error",
      );
      return;
    }

    activeCtx = ctx;
    finals = [];
    flushed = false;
    cancelled = false;
    state = "recording";

    const provider = createAsrProvider(modelDef.provider, modelDef.id, apiKey);
    activeProvider = provider;
    const myGeneration = ++generation;
    startMeter();

    // Spawn cross-platform audio recorder (sox / rec)
    const commonAudioArgs = [
      "-q",
      "--buffer", "512",
      "-r", "16000",
      "-c", "1",
      "-b", "16",
      "-e", "signed-integer",
      "-t", "raw",
      "-",
    ];

    let proc: ChildProcessByStdio<null, Readable, Readable>;
    let recorderStderr = "";
    try {
      if (process.platform === "win32") {
        proc = spawn("sox", ["-t", "waveaudio", "default", ...commonAudioArgs], { stdio: ["ignore", "pipe", "pipe"] });
      } else {
        try {
          proc = spawn("rec", commonAudioArgs, { stdio: ["ignore", "pipe", "pipe"] });
        } catch {
          proc = spawn("sox", ["-d", ...commonAudioArgs], { stdio: ["ignore", "pipe", "pipe"] });
        }
      }
    } catch {
      ctx.ui.notify("Failed to spawn audio recorder. Please ensure sox or rec is installed (e.g. sudo pacman -S sox).", "error");
      cleanup();
      return;
    }
    rec = proc;

    proc.stderr?.on("data", (chunk: Buffer) => {
      recorderStderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if (myGeneration !== generation) return;
      ctx.ui.notify(`Audio recording error: ${err.message}`, "error");
      cleanup();
    });

    proc.on("exit", (code) => {
      if (myGeneration !== generation) return;
      if (state === "recording" && code !== null && code !== 0) {
        if (activeCtx) {
          const detail = recorderStderr.trim() ? `: ${recorderStderr.trim()}` : "";
          activeCtx.ui.notify(`Audio recorder exited unexpectedly (code ${code})${detail}`, "warning");
        }
        cleanup();
      }
    });

    // Start provider streaming connection
    try {
      await provider.start({
        onFinal: (t) => {
          if (myGeneration !== generation || cancelled) return;
          if (t) finals.push(t);
        },
        onError: (err) => {
          if (myGeneration !== generation || cancelled) return;
          if (activeCtx) activeCtx.ui.notify(`DashScope ASR error: ${err.message}`, "error");
          cleanup();
        },
        onClose: () => {
          if (myGeneration !== generation || cancelled) return;
          if (state === "recording" || state === "stopping") {
            cleanup();
          }
        },
      });
    } catch (err: any) {
      if (myGeneration !== generation || cancelled) return;
      ctx.ui.notify(`Failed to connect to DashScope: ${err.message}`, "error");
      cleanup();
      return;
    }

    if (myGeneration !== generation || !rec) return;

    rec.stdout.on("data", (chunk: Buffer) => {
      currentLevel = rmsFromPcm16(chunk);
      if (provider && state === "recording") {
        provider.sendAudio(chunk);
      }
    });
  };

  const stopDictation = async () => {
    if (state !== "recording") return;
    state = "stopping";
    stopMeter();
    startSpinner("finalizing…");

    if (rec) {
      try {
        rec.kill("SIGTERM");
      } catch {}
    }

    if (activeProvider) {
      try {
        await activeProvider.stop();
      } catch {
        cleanup();
        return;
      }

      stopTimeout = setTimeout(() => {
        if (state === "stopping") cleanup();
      }, 3000);
    } else {
      cleanup();
    }
  };

  const cancelDictation = () => {
    if (state !== "recording" && state !== "stopping") return;
    cancelled = true;
    finals = [];
    cleanup();
    if (activeCtx) activeCtx.ui.notify("Voice dictation cancelled", "info");
  };

  const toggleDictation = async (ctx: ExtensionContext) => {
    if (state === "idle") {
      await startDictation(ctx);
    } else if (state === "recording") {
      await stopDictation();
    }
  };

  // Key interception
  const ensureTuiAttached = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (ctx.mode === "tui" && !removeInputListener && typeof ctx.ui?.onTerminalInput === "function") {
      removeInputListener = ctx.ui.onTerminalInput((keyData) => {
        const matchesAny = (list: string[]) =>
          list.some((s) => {
            const raw = s.toLowerCase().trim();
            if (raw === "alt+m" && (keyData === "\x1bm" || keyData === "Âµ")) return true;
            if (raw === "alt+n" && (keyData === "\x1bn" || keyData === "Å")) return true;
            return false;
          });

        if (matchesAny(TOGGLE_SHORTCUTS)) {
          if (state === "idle") startDictation(ctx);
          else if (state === "recording") stopDictation();
          return true;
        }

        if (matchesAny(CANCEL_SHORTCUTS)) {
          if (state !== "idle") {
            cancelDictation();
            return true;
          }
        }

        return undefined;
      });
    }
  };

  pi.on("session_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
    if (ctx.mode === "tui") {
      ctx.ui.setWidget("tui-asr-handle", (tui: any) => {
        tuiHandle = tui;
        return {
          render: () => [],
          invalidate: () => {},
          dispose: () => {
            tuiHandle = null;
          },
        };
      });
    }
  });

  // Register shortcuts
  pi.registerShortcut("alt+m", {
    description: "Toggle voice dictation (tui-asr)",
    handler: async (ctx) => {
      ensureTuiAttached(ctx);
      await toggleDictation(ctx);
    },
  });

  pi.registerShortcut("alt+n", {
    description: "Cancel voice dictation (tui-asr)",
    handler: async (ctx) => {
      ensureTuiAttached(ctx);
      cancelDictation();
    },
  });

  // Register command /asr
  pi.registerCommand("asr", {
    description: "Voice dictation control and model switching (/asr [model])",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();
      if (!trimmed || "model".startsWith(trimmed)) {
        return [{ value: "model", label: "model", description: "Select ASR voice model in TUI" }];
      }
      return null;
    },
    handler: async (args, ctx) => {
      ensureTuiAttached(ctx);
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = parts[0]?.toLowerCase();

      if (sub === "model") {
        const modelArg = parts[1]?.toLowerCase();
        if (modelArg) {
          const matched = ALL_ASR_MODELS.find(
            (m) =>
              m.id.toLowerCase() === modelArg ||
              m.name.toLowerCase() === modelArg ||
              m.id.toLowerCase().includes(modelArg),
          );
          if (matched) {
            activeModel = matched.id;
            const isLogged = Boolean(await resolveProviderApiKey(matched.provider, ctx));
            const extra = isLogged ? "" : ` (No key detected: please run /login ${matched.provider})`;
            ctx.ui.notify(`ASR model switched to: ${matched.name} (${matched.id})${extra}`, "info");
            return;
          }
        }

        // Open searchable model selector TUI
        const loginStatusMap = new Map<string, boolean>();
        for (const item of ALL_ASR_MODELS) {
          if (!loginStatusMap.has(item.provider)) {
            const key = await resolveProviderApiKey(item.provider, ctx);
            loginStatusMap.set(item.provider, Boolean(key));
          }
        }

        const selected = await ctx.ui.custom<AsrModelDefinition | undefined>((tui, theme, _kb, done) => {
          return new SearchableAsrModelSelectorComponent(
            tui,
            theme,
            ALL_ASR_MODELS,
            activeModel,
            (model) => done(model),
            () => done(undefined),
            (provider) => loginStatusMap.get(provider) ?? false,
          );
        });

        if (!selected) return;

        activeModel = selected.id;
        const isLogged = loginStatusMap.get(selected.provider);
        const extra = isLogged ? "" : ` (No key detected: please run /login ${selected.provider})`;
        ctx.ui.notify(`ASR model switched to: ${selected.name} (${selected.id})${extra}`, "info");
        return;
      }

      // Default action: toggle dictation
      await toggleDictation(ctx);
    },
  });

  pi.on("session_shutdown", () => {
    if (state !== "idle") cleanup();
    removeInputListener?.();
    removeInputListener = null;
  });
}
