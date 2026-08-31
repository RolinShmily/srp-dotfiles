/**
 * srp-continue.ts — SRP 极简 TUI Signal 风格 Agent Loop 唤醒扩展
 *
 * 命令: /srp-continue
 *
 * 特性：零配置、零按键冲突。提供 /srp-continue 斜杠命令，调用时在 TUI 中
 *       渲染 [⚡ LOOP RESUME SIGNAL] 视觉徽章，重新拉起 Agent 循环。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

export default function (pi: ExtensionAPI) {
  const CUSTOM_TYPE = "srp-continue-signal";

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

  // 2. 注册唯一斜杠命令 /srp-continue (零配置、无按键冲突)
  pi.registerCommand("srp-continue", {
    description: "发送 ⚡ RESUME SIGNAL 重新拉起 Agent Loop 链接上下文工作",
    handler: async (args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("Agent 正在运行中，无需重新唤醒", "warning");
        return;
      }

      const promptText = args.trim() || "请继承并检查历史上下文，从中断处继续完成未完成的工作。";

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
        }
      );
    },
  });
}
