import { randomUUID } from "node:crypto";

/** Native, persistent interactive CLIs. Never replace them with print/exec event viewers in mux mode. */
export function interactiveArgs({ harness, directory, prompt, hookPath, exitFile, sessionId = randomUUID() }) {
  switch (harness) {
    case "codex": {
      const notify = JSON.stringify([process.execPath, hookPath, exitFile, "codex"]);
      return ["codex", "--cd", directory, "--sandbox", "danger-full-access", "-a", "never", "-c", `notify=${notify}`, prompt];
    }
    case "claude": {
      const quote = (value) => process.platform === "win32"
        ? `"${value.replace(/"/g, '\\"')}"`
        : `'${value.replaceAll("'", "'\\''")}'`;
      const hookCommand = (event) => [process.execPath, hookPath, exitFile, event].map(quote).join(" ");
      const settings = JSON.stringify({ hooks: {
        Stop: [{ hooks: [{ type: "command", command: hookCommand("claude"), timeout: 10 }] }],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: hookCommand("claude-start"), timeout: 10 }] }],
      } });
      // Autonomous command execution without per-command approval; sandbox/trust boundaries confirmed manually if prompted.
      return ["claude", "--session-id", sessionId, "--permission-mode", "bypassPermissions", "--settings", settings, prompt];
    }
    default:
      throw new Error(`Native persistent TUI is not supported for ${harness}. No worktrees were created.`);
  }
}
