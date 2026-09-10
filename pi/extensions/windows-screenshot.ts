/**
 * windows-screenshot.ts — Windows & WSL 截图快速引用扩展（/srp-screenshot 或 Alt+V）。
 *
 * 在 Windows 或 WSLg 环境中，系统截屏（如 Win+Shift+S 或 PrintScreen）
 * 默认会自动保存到系统图片目录下的 Screenshots（屏幕截图）文件夹。
 *
 * 功能特性：
 *   1. 斜杠命令：/srp-screenshot [list|latest]
 *      - 默认直接将最新一张截图的绝对路径填入输入框
 *      - /srp-screenshot list 可弹出交互式列表从最近截图中挑选
 *   2. 快捷键：Alt+V（支持常规 ANSI 转义 \x1bv 与 Kitty 键盘协议）
 *   3. 跨平台适配：无缝支持 Windows 原生与 WSL（WSLg 挂载路径）
 *   4. 终端复用器友好：在 Zellij / WezTerm 等环境快捷键被吞时，可用斜杠命令作为 100% 可靠兜底
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

// ============================ 配置区 ============================

const SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);
// Windows 系统内置目录，不可能是用户目录
const SKIP_USER_DIRS = /^(Public|Default|Default User|All Users|desktop\.ini)$/i;
// Alt+V 的常见编码：传统 ESC+v（实测 WSLg/WezTerm 为此形式）、CSI-u（kitty 键盘协议）
const ALT_V_SEQUENCES = new Set(["\x1bv", "\x1b[118;3u"]);

// ============================ 核心逻辑（跨环境目录检索） ============================

/** 判断是否运行在 Windows 原生环境。 */
export function isWindows(): boolean {
  return process.platform === "win32";
}

/** 判断是否运行在 WSL（Linux 环境下访问 Windows 挂载路径）。 */
export function isWSL(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
      return true;
    }
    if (existsSync("/mnt/c/Users")) {
      return true;
    }
    const version = readFileSync("/proc/version", "utf-8");
    return /microsoft|wsl/i.test(version);
  } catch {
    return false;
  }
}

/** 判断当前环境是否受支持（Windows 或 WSL）。 */
export function isSupported(): boolean {
  return isWindows() || isWSL();
}

/** 枚举当前系统下所有有效的截图目录。 */
export function findScreenshotDirs(): string[] {
  const dirs = new Set<string>();

  const addIfExists = (dirPath: string) => {
    try {
      if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
        dirs.add(dirPath);
      }
    } catch {}
  };

  // 1. Windows 原生环境探测
  if (isWindows()) {
    const userProfile = process.env.USERPROFILE || process.env.HOME || "";
    if (userProfile) {
      addIfExists(join(userProfile, "Pictures", "Screenshots"));
      addIfExists(join(userProfile, "Pictures", "屏幕截图"));
      addIfExists(join(userProfile, "OneDrive", "Pictures", "Screenshots"));
      addIfExists(join(userProfile, "OneDrive", "图片", "屏幕截图"));
      addIfExists(join(userProfile, "OneDrive", "Pictures", "屏幕截图"));
    }
  }

  // 2. WSL 环境探测（挂载在 /mnt/c/Users）
  if (isWSL()) {
    const usersRoot = "/mnt/c/Users";
    if (existsSync(usersRoot)) {
      try {
        const entries = readdirSync(usersRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || SKIP_USER_DIRS.test(entry.name)) {
            continue;
          }
          addIfExists(join(usersRoot, entry.name, "Pictures", "Screenshots"));
          addIfExists(join(usersRoot, entry.name, "Pictures", "屏幕截图"));
          addIfExists(join(usersRoot, entry.name, "OneDrive", "Pictures", "Screenshots"));
          addIfExists(join(usersRoot, entry.name, "OneDrive", "图片", "屏幕截图"));
        }
      } catch {}
    }
  }

  return Array.from(dirs);
}

export interface ScreenshotItem {
  path: string;
  name: string;
  mtimeMs: number;
  size: number;
}

/** 获取最近的系统截图文件列表，按修改时间倒序排序。 */
export function findRecentScreenshots(limit = 10): ScreenshotItem[] {
  const dirs = findScreenshotDirs();
  const items: ScreenshotItem[] = [];

  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!SCREENSHOT_EXTENSIONS.has(extname(file).toLowerCase())) {
        continue;
      }
      const fullPath = join(dir, file);
      try {
        const stat = statSync(fullPath);
        items.push({
          path: fullPath,
          name: file,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      } catch {
        // 文件可能正在被写入，跳过
      }
    }
  }

  items.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return items.slice(0, limit);
}

/** 在候选截图目录中找最近修改的单张图片，返回完整路径；没有则返回 null。 */
export function findLatestScreenshot(): string | null {
  const recent = findRecentScreenshots(1);
  return recent.length > 0 ? recent[0].path : null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(mtimeMs: number): string {
  const d = new Date(mtimeMs);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function insertScreenshot(path: string, ctx: ExtensionContext): void {
  ctx.ui.pasteToEditor(`${path} `);
  const fileName = basename(path);
  ctx.ui.notify(`已引用截图：${fileName}`, "info");
}

// ============================ Pi 扩展配置与注册 ============================

function extensionEnabled(cwd: string): boolean {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const sec = value as Record<string, unknown>;
      const section = sec.windowsScreenshot ?? sec.wslScreenshot;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  return {
    ...read(join(getAgentDir(), "settings.json")),
    ...read(join(cwd, CONFIG_DIR_NAME, "settings.json")),
  }.enabled !== false;
}

export default function (pi: ExtensionAPI) {
  // 1. 注册斜杠命令 /srp-screenshot
  pi.registerCommand("srp-screenshot", {
    description: "引用系统截图到输入框（/srp-screenshot [list|latest]）",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "latest", label: "latest", description: "引用最近的一张截图（默认行为）" },
        { value: "list", label: "list", description: "从最近截图中交互式选择" },
      ];
      const trimmed = prefix.trimStart();
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      if (!isSupported()) {
        ctx.ui.notify("当前环境非 Windows 或 WSL，不支持系统截图快速引用", "warning");
        return;
      }

      const action = args.trim().toLowerCase();

      if (action === "list" || action === "select") {
        const recent = findRecentScreenshots(15);
        if (recent.length === 0) {
          ctx.ui.notify("未在系统截图目录中找到任何截图", "warning");
          return;
        }

        const options = recent.map((item) => {
          const time = formatTime(item.mtimeMs);
          const size = formatBytes(item.size);
          return `[${time}] ${item.name} (${size})`;
        });

        const selected = await ctx.ui.select("请选择要引用的截图：", options);
        if (!selected) return;

        const selectedIdx = options.indexOf(selected);
        if (selectedIdx >= 0) {
          insertScreenshot(recent[selectedIdx].path, ctx);
        }
        return;
      }

      // 默认操作：引用最新一张截图
      const path = findLatestScreenshot();
      if (!path) {
        ctx.ui.notify("未找到最近的截图（Screenshots 目录为空？）", "warning");
        return;
      }
      insertScreenshot(path, ctx);
    },
  });

  // 2. 注册 Alt+V 快捷键（如果宿主终端能够透传按键事件）
  try {
    pi.registerShortcut("alt+v", {
      description: "引用最新系统截图",
      handler: (ctx) => {
        if (!extensionEnabled(ctx.cwd)) return;
        if (!isSupported()) return;
        const path = findLatestScreenshot();
        if (!path) {
          ctx.ui.notify("未找到最近的截图（Screenshots 目录为空？）", "warning");
          return;
        }
        insertScreenshot(path, ctx);
      },
    });
  } catch {
    // 快捷键若在只读模式或未支持环境被静默忽略
  }

  // 3. 注册终端底层原始输入监听（作为传统 ANSI 与 Kitty 协议的兼容兜底）
  pi.on("session_start", async (_event, ctx) => {
    if (!extensionEnabled(ctx.cwd)) return;
    if (typeof ctx.ui.onTerminalInput !== "function") {
      return; // 非交互模式（RPC 等）无终端输入监听
    }
    ctx.ui.onTerminalInput((data) => {
      if (!isSupported()) {
        return undefined; // 不受支持环境：透传
      }
      if (!ALT_V_SEQUENCES.has(data)) {
        return undefined; // 不是 Alt+V：透传
      }
      // 消费 Alt+V，异步检索最近截图并插入输入框
      void (async () => {
        try {
          const path = findLatestScreenshot();
          if (!path) {
            ctx.ui.notify("未找到最近的截图（Screenshots 目录为空？）", "warning");
            return;
          }
          insertScreenshot(path, ctx);
        } catch (e) {
          ctx.ui.notify(`截图检索失败：${String(e)}`, "error");
        }
      })();
      return { consume: true };
    });
  });
}
