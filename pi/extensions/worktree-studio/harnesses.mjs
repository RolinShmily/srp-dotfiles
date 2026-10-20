/** Static allowlist: never discover or execute arbitrary local commands. */
export const HARNESSES = Object.freeze(["codex", "claude"]);

/** Build a non-interactive invocation. The prompt is passed through stdin, never a shell string. */
export function harnessArgs(harness, directory, resultFile) {
  switch (harness) {
    case "codex":
      return ["exec", "--sandbox", "danger-full-access", "-a", "never", "--json", "--output-last-message", resultFile, "--cd", directory, "-"];
    case "claude":
      return ["-p", "--verbose", "--output-format", "stream-json", "--permission-mode", "bypassPermissions", "--max-budget-usd", "0.50"];
    default:
      throw new Error(`Unsupported harness: ${harness}`);
  }
}
