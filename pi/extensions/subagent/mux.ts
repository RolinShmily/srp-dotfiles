/**
 * subagent/mux.ts — tmux / Zellij session adapter.
 *
 * The upstream extension hard-codes tmux. This adapter keeps the same six
 * operations but dispatches on the multiplexer recorded for a run, so a child
 * created under Zellij is also inspected, attached and killed through Zellij.
 *
 * Verified against tmux 3.8 and Zellij 0.45.1:
 *   - `zellij attach --create-background <s> -- <argv>` returns immediately,
 *     runs <argv> in the first pane, inherits the client's cwd and env, and
 *     exits 1 with "Session already exists" when the session is present.
 *   - `zellij list-sessions --no-formatting` prints `<name> [Created …]`, with
 *     an `(EXITED …)` suffix for sessions that are not running, so a plain
 *     name match is not enough to decide liveness.
 *   - `zellij action switch-session <s>` is the `tmux switch-client` analogue
 *     and only works from inside a Zellij client.
 */

import { spawn, spawnSync } from "node:child_process";

export type MuxKind = "tmux" | "zellij";

const MUX_KINDS: readonly MuxKind[] = ["tmux", "zellij"];

/** Preference order when pi is not running inside any multiplexer; Zellij is this setup's primary. */
const FALLBACK_ORDER: readonly MuxKind[] = ["zellij", "tmux"];

export function isMuxKind(value: unknown): value is MuxKind {
  return typeof value === "string" && (MUX_KINDS as readonly string[]).includes(value);
}

/**
 * `tmux --version` exits 1 (tmux only accepts `-V`), so the flag has to be per
 * kind. A missing binary surfaces as `status === null`, which is not 0 either.
 */
function hasBinary(binary: MuxKind): boolean {
  const flag = binary === "tmux" ? "-V" : "--version";
  return spawnSync(binary, [flag], { stdio: "ignore" }).status === 0;
}

/** Multiplexer this process is running inside, if any. */
export function currentMux(): MuxKind | undefined {
  if (process.env.ZELLIJ) return "zellij";
  if (process.env.TMUX) return "tmux";
  return undefined;
}

/**
 * Multiplexer to use for a new run. Prefers the one we are already inside so
 * `attach` can switch the existing client; otherwise falls back to whichever
 * binary is installed, Zellij first to match the rest of this dotfiles setup.
 */
export function detectMux(): MuxKind {
  const inside = currentMux();
  if (inside && hasBinary(inside)) return inside;

  for (const kind of FALLBACK_ORDER) {
    if (hasBinary(kind)) return kind;
  }

  throw new Error(
    "No terminal multiplexer found: start pi inside tmux or Zellij.\n" +
      "  • Zellij: `zellij --session pi`, then run `pi`\n" +
      "  • tmux:   `tmux new -s pi`, then run `pi`",
  );
}

/** Names of the running sessions reported by zellij (exited ones are excluded). */
function zellijRunningSessions(): Set<string> {
  const result = spawnSync("zellij", ["list-sessions", "--no-formatting"], { encoding: "utf8" });
  const running = new Set<string>();
  if (result.status !== 0) return running;

  for (const line of (result.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // `<name> [Created …]` when running, plus `(EXITED …)` when not.
    if (trimmed.includes("EXITED")) continue;
    const name = trimmed.split(/\s+/)[0];
    if (name) running.add(name);
  }
  return running;
}

export function sessionExists(kind: MuxKind, name: string): boolean {
  if (kind === "tmux") {
    return spawnSync("tmux", ["has-session", "-t", name], { stdio: "ignore" }).status === 0;
  }
  return zellijRunningSessions().has(name);
}

/**
 * Create a detached session that runs `argv` in its first pane.
 * `cwd` is passed to the spawned client, which Zellij propagates to the pane.
 */
export function createSession(kind: MuxKind, name: string, cwd: string, argv: string[]): void {
  const result =
    kind === "tmux"
      ? spawnSync(
          "tmux",
          ["new-session", "-d", "-s", name, "-x", "120", "-y", "40", "-c", cwd, "--", ...argv],
          { encoding: "utf8", cwd },
        )
      : spawnSync("zellij", ["attach", "--create-background", name, "--", ...argv], {
          encoding: "utf8",
          cwd,
        });

  if (result.status !== 0) {
    const detail = (result.stderr ?? "").trim() || (result.stdout ?? "").trim();
    throw new Error(detail || `Failed to create ${kind} session ${name}`);
  }
}

export function killSession(kind: MuxKind, name: string): void {
  if (kind === "tmux") {
    spawnSync("tmux", ["kill-session", "-t", name], { stdio: "ignore" });
    return;
  }
  spawnSync("zellij", ["kill-session", name], { stdio: "ignore" });
}

/** Command a human would run to reach the run's session directly. */
export function attachCommand(kind: MuxKind, name: string): string {
  return kind === "tmux" ? `tmux attach -t ${name}` : `zellij attach ${name}`;
}

/**
 * Attach the user to a run. Inside the multiplexer the current client is
 * switched; otherwise a client is attached and returns when the user detaches.
 * Resolves to the exit code, or null when the binary could not be spawned.
 */
export function attachSession(kind: MuxKind, name: string): Promise<number | null> {
  const [command, args] =
    kind === "tmux"
      ? ["tmux", currentMux() === "tmux" ? ["switch-client", "-t", name] : ["attach-session", "-t", name]]
      : ["zellij", currentMux() === "zellij" ? ["action", "switch-session", name] : ["attach", name]];

  return new Promise<number | null>((resolve) => {
    const child = spawn(command, args as string[], { stdio: "inherit" });
    child.on("error", () => resolve(null));
    child.on("close", resolve);
  });
}
