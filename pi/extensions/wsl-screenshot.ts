/**
 * wsl-screenshot.ts — WSL 截图 @ 引用扩展（Alt+V）。
 *
 * 在 WSLg（Windows Subsystem for Linux GUI）中，Windows 侧用
 * Win+Shift+S 等快捷键截的图默认保存到
 * C:\Users\<用户名>\Pictures\Screenshots。
 *
 * 本扩展拦截 pi 输入框里的 Alt+V：
 *   1. 动态枚举 /mnt/c/Users/<用户名>/Pictures/Screenshots（不写死用户名）
 *   2. 找出最近修改的一张截图
 *   3. 把绝对路径 "mnt/c/.../屏幕截图 xxxx.png "（不带 @ 前缀，因为 @ 在 pi 里会触发基于当前目录的文件补全）插入到输入框光标处
 *
 * 行为约定：
 *   - 非 WSL 环境：不拦截，按键透传给 pi 默认行为
 *   - 找不到截图：消费按键并通知用户（避免触发默认剪贴板粘贴的报错）
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import {
    CONFIG_DIR_NAME,
    getAgentDir,
    type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

// ============================ 配置区 ============================

const SCREENSHOT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);
// Windows 系统内置目录，不可能是用户目录
const SKIP_USER_DIRS = /^(Public|Default|Default User|All Users|desktop\.ini)$/i;
// Alt+V 的常见编码：传统 ESC+v（实测 WSLg 链路为此形式）、CSI-u（kitty 键盘协议）
const ALT_V_SEQUENCES = new Set(["\x1bv", "\x1b[118;3u"]);

// ============================ 核心逻辑（无 pi 依赖，可独立测试） ============================

/** 判断是否运行在 WSL（WSLg 提供 /mnt/c 挂载）。 */
export function isWSL(): boolean {
    try {
        if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
            return true;
        }
        if (existsSync("/mnt/c/Users")) {
            return true;
        }
        const version = readFileSync("/proc/version", "utf-8");
        return /microsoft/i.test(version);
    } catch {
        return false;
    }
}

/** 枚举 /mnt/c/Users 下所有含 Pictures/Screenshots 的目录（动态发现用户名）。 */
export function findScreenshotDirs(): string[] {
    const usersRoot = "/mnt/c/Users";
    if (!existsSync(usersRoot)) {
        return [];
    }
    let entries: import("node:fs").Dirent[];
    try {
        entries = readdirSync(usersRoot, { withFileTypes: true });
    } catch {
        return [];
    }
    const dirs: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }
        if (SKIP_USER_DIRS.test(entry.name)) {
            continue;
        }
        const screenshots = join(usersRoot, entry.name, "Pictures", "Screenshots");
        if (existsSync(screenshots)) {
            dirs.push(screenshots);
        }
    }
    return dirs;
}

/** 在候选截图目录中找最近修改的图片文件，返回完整路径；没有则返回 null。 */
export function findLatestScreenshot(): string | null {
    const dirs = findScreenshotDirs();
    let latestPath: string | null = null;
    let latestMtime = -1;
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
                const mtimeMs = statSync(fullPath).mtimeMs;
                if (mtimeMs > latestMtime) {
                    latestMtime = mtimeMs;
                    latestPath = fullPath;
                }
            } catch {
                // 文件可能正在写入（截图保存中），跳过
            }
        }
    }
    return latestPath;
}

// ============================ Pi 扩展注册 ============================

function extensionEnabled(cwd: string): boolean {
    const read = (path: string): Record<string, unknown> => {
        try {
            if (!existsSync(path)) return {};
            const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
            if (!value || typeof value !== "object" || Array.isArray(value)) return {};
            const section = (value as Record<string, unknown>).wslScreenshot;
            return section && typeof section === "object" && !Array.isArray(section)
                ? section as Record<string, unknown>
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
    pi.on("session_start", async (_event, ctx) => {
        if (!extensionEnabled(ctx.cwd)) return;
        if (typeof ctx.ui.onTerminalInput !== "function") {
            return; // 非交互模式（RPC 等）无终端输入监听
        }
        ctx.ui.onTerminalInput((data) => {
            if (!isWSL()) {
                return undefined; // 非 WSL：透传
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
                    ctx.ui.pasteToEditor(`${path} `);
                    ctx.ui.notify(`已引用最近截图：${path.split("/").pop()}`, "info");
                } catch (e) {
                    ctx.ui.notify(`截图检索失败：${String(e)}`, "error");
                }
            })();
            return { consume: true };
        });
    });
}
