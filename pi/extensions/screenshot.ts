/**
 * screenshot.ts — Insert the latest Windows/WSL system screenshot path into Pi's editor.
 *
 * Use /screenshot to reference the most recently modified screenshot.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);
const SKIP_USER_DIRS = /^(Public|Default|Default User|All Users|desktop\.ini)$/i;

function isExpectedFileSystemError(error: unknown): boolean {
  return error instanceof Error && "code" in error &&
    ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code));
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function isWSL(): boolean {
  if (process.platform !== "linux") return false;
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV || existsSync("/mnt/c/Users")) return true;
  try {
    return /microsoft|wsl/i.test(readFileSync("/proc/version", "utf-8"));
  } catch (error) {
    if (isExpectedFileSystemError(error)) return false;
    throw error;
  }
}

function findScreenshotDirs(): string[] {
  const dirs = new Set<string>();
  const addIfDirectory = (path: string) => {
    try {
      if (existsSync(path) && statSync(path).isDirectory()) dirs.add(path);
    } catch (error) {
      if (!isExpectedFileSystemError(error)) throw error;
    }
  };

  if (isWindows()) {
    const profile = process.env.USERPROFILE || process.env.HOME;
    if (profile) {
      addIfDirectory(join(profile, "Pictures", "Screenshots"));
      addIfDirectory(join(profile, "Pictures", "屏幕截图"));
      addIfDirectory(join(profile, "OneDrive", "Pictures", "Screenshots"));
      addIfDirectory(join(profile, "OneDrive", "图片", "屏幕截图"));
      addIfDirectory(join(profile, "OneDrive", "Pictures", "屏幕截图"));
    }
  }

  if (isWSL()) {
    const usersRoot = "/mnt/c/Users";
    try {
      for (const entry of readdirSync(usersRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || SKIP_USER_DIRS.test(entry.name)) continue;
        const profile = join(usersRoot, entry.name);
        addIfDirectory(join(profile, "Pictures", "Screenshots"));
        addIfDirectory(join(profile, "Pictures", "屏幕截图"));
        addIfDirectory(join(profile, "OneDrive", "Pictures", "Screenshots"));
        addIfDirectory(join(profile, "OneDrive", "图片", "屏幕截图"));
      }
    } catch (error) {
      if (!isExpectedFileSystemError(error)) throw error;
    }
  }

  return [...dirs];
}

function findLatestScreenshot(): string | null {
  let latestPath: string | null = null;
  let latestMtime = -1;

  for (const dir of findScreenshotDirs()) {
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch (error) {
      if (isExpectedFileSystemError(error)) continue;
      throw error;
    }

    for (const file of files) {
      if (!SCREENSHOT_EXTENSIONS.has(extname(file).toLowerCase())) continue;
      const path = join(dir, file);
      try {
        const stat = statSync(path);
        if (stat.isFile() && stat.mtimeMs > latestMtime) {
          latestPath = path;
          latestMtime = stat.mtimeMs;
        }
      } catch (error) {
        if (!isExpectedFileSystemError(error)) throw error;
      }
    }
  }

  return latestPath;
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("screenshot", {
    description: "Insert the latest Windows/WSL system screenshot path into the editor",
    handler: async (_args, ctx: ExtensionContext) => {
      if (!isWindows() && !isWSL()) {
        ctx.ui.notify("Current environment is not Windows or WSL; cannot locate Windows screenshots.", "warning");
        return;
      }

      const path = findLatestScreenshot();
      if (!path) {
        ctx.ui.notify("No Windows screenshots found.", "warning");
        return;
      }

      ctx.ui.pasteToEditor(`${path} `);
      ctx.ui.notify(`Referenced screenshot: ${path.split(/[\\/]/).pop()}`, "info");
    },
  });
}
