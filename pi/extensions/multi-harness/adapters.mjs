import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HARNESSES = Object.freeze(["pi", "codex", "claude", "opencode"]);
const extensionDir = dirname(fileURLToPath(import.meta.url));
export const quotePs = (value) => `'${value.replaceAll("'", "''")}'`;
const quoteSh = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Avoid cmd/npm shim argument re-parsing and preserve Unicode and JSON on Windows. */
export function commandSpec(argv, platform = process.platform) {
  if (platform !== "win32") return { command: argv[0], args: argv.slice(1) };
  const script = `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & ${argv.map(quotePs).join(" ")}; if ($null -eq $LASTEXITCODE) { exit 1 }; exit $LASTEXITCODE`;
  return { command: "pwsh", args: ["-NoProfile", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")] };
}

/** Add a dependency-free local plugin for native OpenCode only; never rewrite user config. */
export function buildEnv(config, inherited = process.env) {
  if (config.harness !== "opencode" || !config.interactive) return inherited;
  let content;
  try { content = inherited.OPENCODE_CONFIG_CONTENT ? JSON.parse(inherited.OPENCODE_CONFIG_CONTENT) : {}; }
  catch { throw new Error("OPENCODE_CONFIG_CONTENT must be valid JSON to append the multi-harness plugin."); }
  if (!content || typeof content !== "object" || Array.isArray(content) || (content.plugin !== undefined && !Array.isArray(content.plugin))) {
    throw new Error("OpenCode config must be an object with an optional plugin array.");
  }
  const plugin = pathToFileURL(join(extensionDir, "opencode-plugin.mjs")).href;
  return { ...inherited, PI_MULTI_HARNESS_CWD: config.cwd,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...content, plugin: [...(content.plugin ?? []).filter((item) => item !== plugin), plugin] }) };
}

export function buildArgs(config) {
  const { harness, cwd, prompt, sessionFile, model, trusted, artifactDir, interactive, resume, sessionId } = config;
  const modelArgs = model ? ["--model", model] : [];
  switch (harness) {
    case "pi":
      return ["pi", ...(interactive ? ["--tui-mode", "regular", "-e", join(extensionDir, "worker-bridge.ts")] : ["--print"]),
        trusted ? "--approve" : "--no-approve", "--session", sessionFile, ...modelArgs, prompt];
    case "codex": {
      const base = ["codex", "--sandbox", "danger-full-access", "-a", "never"];
      if (interactive) {
        const hook = JSON.stringify([process.execPath, join(extensionDir, "turn-hook.mjs"), artifactDir, "codex"]);
        return [...base, "--cd", cwd, ...modelArgs, "-c", `notify=${hook}`, prompt];
      }
      return [...base, "exec", ...(resume ? ["resume", sessionId] : ["--cd", cwd]), "--skip-git-repo-check", "--json", ...modelArgs, "-"];
    }
    case "claude": {
      const base = ["claude", "--permission-mode", "bypassPermissions", ...modelArgs];
      if (interactive) {
        const hook = (kind) => {
          const args = [process.execPath, join(extensionDir, "turn-hook.mjs"), artifactDir, kind];
          // Claude command hooks use a shell, not necessarily the interactive pane's shell.
          if (process.platform === "win32") {
            const script = `& ${args.map(quotePs).join(" ")}; exit $LASTEXITCODE`;
            return `pwsh -NoProfile -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
          }
          return args.map(quoteSh).join(" ");
        };
        const settings = { hooks: {
          UserPromptSubmit: [{ hooks: [{ type: "command", command: hook("claude-start"), timeout: 10 }] }],
          Stop: [{ hooks: [{ type: "command", command: hook("claude"), timeout: 10 }] }],
        } };
        return [...base, "--session-id", sessionId, "--settings", JSON.stringify(settings), prompt];
      }
      return [...base, "-p", "--verbose", "--output-format", "stream-json", "--max-budget-usd", "0.50",
        ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId])];
    }
    case "opencode":
      return interactive
        ? ["opencode", cwd, "--auto", ...modelArgs, "--prompt", prompt]
        : ["opencode", "run", "--dir", cwd, "--format", "json", "--auto", ...modelArgs, ...(resume ? ["--session", sessionId] : [])];
    default: throw new Error(`Unsupported harness: ${harness}`);
  }
}
