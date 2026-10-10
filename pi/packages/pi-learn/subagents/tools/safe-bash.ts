/**
 * Safe bash extension for the worker subagent.
 * Wraps the built-in bash tool with dangerous command blocking.
 *
 * Loaded into a child pi process via `--extension` when an agent's `tools`
 * frontmatter lists `safe_bash`. See CUSTOM_TOOL_EXTENSIONS in ../index.ts.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const DANGEROUS_PATTERNS = [
	/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?(\/|~\/?\s|~\/?\b)/,
	/\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?(\/|~\/?\s|~\/?\b)/,
	/\bsudo\b/,
	/\bmkfs\b/,
	/\bdd\s+if=/,
	/:\(\)\s*\{\s*:\|:&\s*\}\s*;:/,
	/>\s*\/dev\/[sh]d[a-z]/,
	/\bchmod\s+(-[a-zA-Z]+\s+)?777\s+\//,
	/\bchown\s+(-[a-zA-Z]+\s+)?root/,
	/\bcurl\s.*\|\s*(ba)?sh/,
	/\bwget\s.*\|\s*(ba)?sh/,
	/\bshutdown\b/,
	/\breboot\b/,
	/\binit\s+0\b/,
	/\bkill\s+-9\s+1\b/,
	/\bkillall\b/,
	// ── Windows (cmd.exe / PowerShell) ──
	// Native Windows also ships Git Bash, so the POSIX patterns above still
	// matter there; these cover the cmd/PowerShell idioms that would otherwise
	// slip straight through this guard.
	// Categorical: no safe non-destructive use.
	/\b(format|Format-Volume|Clear-Disk|diskpart|bcdedit|vssadmin|takeown)\b/i,
	/\b(Stop-Computer|Restart-Computer)\b/i,
	// Recursive delete/format aimed at a drive root or the user profile.
	/\b(del|erase)\s+[^|]*\/[a-z]*[sq][a-z]*\b[^|]*\b[a-z]:[\\/]?\*?\s*$/i,
	/\b(rd|rmdir)\s+\/s\b[^|]*\b[a-z]:[\\/]?\s*$/i,
	/\bRemove-Item\b[^|]*-(?:Recurse|Force)[^|]*(?:\b[a-z]:[\\/]?\*?\s*$|\$env:USERPROFILE|\$HOME|~)/i,
];

export function isDangerous(command: string): string | null {
	const normalized = command.replace(/\\\n/g, " ");
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(normalized)) {
			return `Command blocked by safe_bash: matches dangerous pattern ${pattern}`;
		}
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	const bashTool = createBashTool(process.cwd());

	pi.registerTool({
		name: "sub_safe_bash",
		label: "Safe Bash",
		description:
			"Execute a bash command. Blocks dangerous commands (rm -rf /, sudo, mkfs, " +
				"format/diskpart, Remove-Item -Recurse -Force, etc.).",
		parameters: Type.Object({
			command: Type.String({ description: "Bash command to execute" }),
			timeout: Type.Optional(
				Type.Number({ description: "Timeout in seconds (optional)" }),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const danger = isDangerous(params.command);
			if (danger) {
				throw new Error(danger);
			}
			return bashTool.execute(toolCallId, params, signal, onUpdate);
		},
	});
}
