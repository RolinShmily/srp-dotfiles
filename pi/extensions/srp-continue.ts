/**
 * srp-continue.ts — SRP 极简 TUI Signal 风格 Agent Loop 唤醒扩展
 *
 * 功能特性：
 * 1. 发送 ⚡ LOOP RESUME SIGNAL 视觉徽章，重新拉起 Agent 循环；
 * 2. 支持快捷键（默认 Alt+C）一键唤醒继续，行为完全等同于 /srp-continue；
 * 3. 支持 settings.json (srpContinue 字段) 动态配置开关、快捷键及默认 Prompt；
 * 4. WSL + Zellij 兼容：通过底层全局按键监听与 registerShortcut 双重保障快捷键稳定触发；
 * 5. 智能输入感知：支持若编辑器有草稿文本则优先作为 Continue 提示词并清空输入框，无输入时使用默认 Prompt。
 *
 * 快捷键：
 *   - Alt+C: 唤醒 Agent 继续工作
 *
 * 斜杠命令：
 *   - /srp-continue [prompt]: 发送唤醒信号继续执行未完成工作
 *
 * settings.json 配置示例 (在 ~/.pi/agent/settings.json 或 .pi/settings.json 中)：
 * {
 *   "srpContinue": {
 *     "enabled": true,
 *     "shortcuts": ["alt+c"],
 *     "prompt": "请继承并检查历史上下文，从中断处继续完成未完成的工作。"
 *   }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Box,
  Key,
  Text,
  matchesKey,
  isKeyRelease,
  isKeyRepeat,
} from "@earendil-works/pi-tui";

// ============================ 接口与配置 ============================

export interface SrpContinueConfig {
  enabled: boolean;
  shortcuts: string[];
  prompt: string;
}

const DEFAULT_PROMPT = "请继承并检查历史上下文，从中断处继续完成未完成的工作。";
const DEFAULT_SHORTCUTS = ["alt+c"];
const CUSTOM_TYPE = "srp-continue-signal";

function loadContinueConfig(cwd?: string): SrpContinueConfig {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpContinue;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  let global: Record<string, unknown> = {};
  try {
    global = read(join(getAgentDir(), "settings.json"));
  } catch {}
  const project = cwd ? read(join(cwd, CONFIG_DIR_NAME, "settings.json")) : {};
  const merged = { ...global, ...project };

  const enabled = merged.enabled !== false;
  const shortcuts =
    Array.isArray(merged.shortcuts) && merged.shortcuts.length > 0
      ? (merged.shortcuts as string[])
      : DEFAULT_SHORTCUTS;
  const prompt =
    typeof merged.prompt === "string" && merged.prompt.trim()
      ? merged.prompt.trim()
      : DEFAULT_PROMPT;

  return { enabled, shortcuts, prompt };
}

// ============================ 扩展主体 ============================

export default function (pi: ExtensionAPI) {
  let lastCtx: ExtensionContext | null = null;
  let tuiHandle: any = null;
  let removeInputListener: (() => void) | null = null;

  // 1. 注册 TUI 视觉渲染组件 (优雅的 Signal 消息框)
  pi.registerMessageRenderer(CUSTOM_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details as { timestamp?: number } | undefined;
    const time = details?.timestamp
      ? new Date(details.timestamp).toLocaleTimeString()
      : new Date().toLocaleTimeString();

    const title = `${theme.bold(theme.fg("accent", "⚡ LOOP RESUME SIGNAL"))} ${theme.fg("muted", `[${time}]`)}`;
    const subtitle = theme.fg("text", "Re-linking conversation context & resuming agent loop...");

    const box = new Box(outputPad, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(title, 0, 0));
    box.addChild(new Text(subtitle, 0, 0));

    if (expanded && message.content) {
      box.addChild(new Text(theme.fg("dim", `Prompt: ${message.content}`), 0, 0));
    }

    return box;
  });

  // 2. 唤醒执行逻辑 (统一由斜杠命令与快捷键调用)
  const triggerContinue = async (ctx: ExtensionContext, customPrompt?: string) => {
    lastCtx = ctx;

    if (!ctx.isIdle()) {
      ctx.ui.notify("Agent 正在运行中，无需重新唤醒", "warning");
      return;
    }

    const config = loadContinueConfig(ctx.cwd);
    if (!config.enabled) {
      ctx.ui.notify("srp-continue 扩展已在 settings.json 中禁用 (srpContinue.enabled = false)", "warning");
      return;
    }

    // 智能提取提示词：显式入参 > 编辑器已有输入 > 默认 Prompt
    let promptText = customPrompt?.trim();
    if (!promptText) {
      const editorText = ctx.ui.getEditorText?.()?.trim();
      if (editorText) {
        promptText = editorText;
        ctx.ui.setEditorText?.("");
      }
    }
    if (!promptText) {
      promptText = config.prompt;
    }

    pi.sendMessage(
      {
        customType: CUSTOM_TYPE,
        content: promptText,
        display: true,
        details: { timestamp: Date.now() },
      },
      {
        triggerTurn: true,
        deliverAs: "steer",
      },
    );
  };

  // 3. WSL + Zellij 兼容性按键匹配
  function isShortcutKey(data: string, cwd?: string): boolean {
    const config = loadContinueConfig(cwd);
    if (!config.enabled) return false;
    for (const sc of config.shortcuts) {
      try {
        if (matchesKey(data, sc as any)) return true;
      } catch {}
      const norm = sc.toLowerCase().trim();
      if (
        norm === "alt+c" &&
        (data === "\x1bc" ||
          data === "\x1bC" ||
          data === "ç" ||
          data === "©" ||
          matchesKey(data, Key.alt("c")) ||
          matchesKey(data, Key.alt("C")))
      ) {
        return true;
      }
    }
    return false;
  }

  // 4. 全局前置输入监听器 (避免被编辑器捕获或由于终端转义丢失)
  const onGlobalInput = (data: string) => {
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;

    if (isShortcutKey(data, lastCtx?.cwd)) {
      if (lastCtx) {
        void triggerContinue(lastCtx);
      }
      return { consume: true };
    }

    return undefined;
  };

  // 5. 动态安装 TUI Handle 与输入监听器
  const ensureTuiAttached = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (ctx.mode !== "tui" || tuiHandle) return;
    try {
      ctx.ui.setWidget("srp-continue-tui-handle", (tui: any) => {
        tuiHandle = tui;
        if (!removeInputListener && tui?.addInputListener) {
          removeInputListener = tui.addInputListener(onGlobalInput);
        }
        return { render: () => [], invalidate: () => {} };
      });
    } catch {}
  };

  // 6. 生命周期钩子绑定
  pi.on("session_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("session_resume", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("turn_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("session_shutdown", () => {
    removeInputListener?.();
    removeInputListener = null;
    tuiHandle = null;
  });

  // 7. 注册斜杠命令 /srp-continue
  pi.registerCommand("srp-continue", {
    description: "发送 ⚡ RESUME SIGNAL 重新拉起 Agent Loop 链接上下文工作",
    handler: async (args, ctx) => {
      ensureTuiAttached(ctx);
      await triggerContinue(ctx, args);
    },
  });

  // 8. 注册原生快捷键 (保障非全屏/全局快捷键列表可见)
  const initialConfig = loadContinueConfig();
  if (initialConfig.enabled) {
    for (const sc of initialConfig.shortcuts) {
      const norm = sc.toLowerCase().trim();
      const keyId = norm === "alt+c" ? Key.alt("c") : (sc as any);
      pi.registerShortcut(keyId, {
        description: "发送 ⚡ RESUME SIGNAL 重新拉起 Agent Loop 链接上下文工作",
        handler: async (ctx) => {
          ensureTuiAttached(ctx);
          await triggerContinue(ctx);
        },
      });
    }
  }
}
