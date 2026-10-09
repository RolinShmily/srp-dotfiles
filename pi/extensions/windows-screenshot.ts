/**
 * windows-screenshot.ts — 将 Windows 最新系统截图路径插入 Pi 输入框。
 *
 * 使用 /win-screenshot 引用最近修改的截图。
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
  pi.registerCommand("win-screenshot", {
    description: "将 Windows 最新系统截图插入输入框",
    handler: async (_args, ctx: ExtensionContext) => {
      if (!isWindows() && !isWSL()) {
        ctx.ui.notify("当前环境非 Windows 或 WSL，无法查找 Windows 系统截图", "warning");
        return;
      }

      const path = findLatestScreenshot();
      if (!path) {
        ctx.ui.notify("未找到 Windows 系统截图", "warning");
        return;
      }

      ctx.ui.pasteToEditor(`${path} `);
      ctx.ui.notify(`已引用截图：${path.split(/[\\/]/).pop()}`, "info");
    },
  });
}
