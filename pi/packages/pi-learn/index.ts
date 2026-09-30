/**
 * pi-learn — Package Bootstrap Extension
 *
 * Automatically bootstraps and synchronizes the learning system components:
 * 1. Links or syncs custom subagents (mermaid-maker, svg-maker, researcher) into ~/.pi/agent/agents/
 * 2. Ensures the teaching & visualization ecosystem is ready for the current session.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const PKG_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.join(PKG_DIR, "agents");

function syncAgents(): void {
  if (!fs.existsSync(AGENTS_DIR)) return;

  const targetDir = path.join(homedir(), ".pi", "agent", "agents");
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch {
      return;
    }
  }

  let entries: string[] = [];
  try {
    entries = fs.readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return;
  }

  for (const filename of entries) {
    const src = path.join(AGENTS_DIR, filename);
    const dst = path.join(targetDir, filename);

    try {
      if (fs.existsSync(dst)) {
        // If it already points to the exact source via symlink, nothing to do
        try {
          const realDst = fs.realpathSync(dst);
          const realSrc = fs.realpathSync(src);
          if (realDst === realSrc) continue;
        } catch {}

        // If it exists as a regular file with identical content, nothing to do
        const srcContent = fs.readFileSync(src, "utf-8");
        const dstContent = fs.readFileSync(dst, "utf-8");
        if (srcContent === dstContent) continue;
      }

      // Try creating a symbolic link first
      try {
        if (fs.existsSync(dst) || fs.lstatSync(dst).isSymbolicLink()) {
          fs.unlinkSync(dst);
        }
        fs.symlinkSync(src, dst);
      } catch {
        // Fallback to copy if symlink creation is not permitted (e.g. Windows unprivileged mode)
        fs.copyFileSync(src, dst);
      }
    } catch {
      // Ignore individual file sync failures
    }
  }
}

export default function (pi: ExtensionAPI) {
  // Sync agents at module registration
  syncAgents();

  pi.on("session_start", async () => {
    syncAgents();
  });
}
