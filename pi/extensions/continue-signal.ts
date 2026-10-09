/**
 * continue-signal.ts — Resume an idle agent via /continue [prompt] or Alt+C.
 * Uses the editor draft when no prompt is supplied.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Box, Key, Text } from "@earendil-works/pi-tui";

const DEFAULT_PROMPT = "Review the conversation context and resume any unfinished work from where it stopped.";
const CUSTOM_TYPE = "continue-signal";

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer(CUSTOM_TYPE, (message, { expanded, outputPad }, theme) => {
    const details = message.details as { timestamp?: number } | undefined;
    const time = new Date(details?.timestamp ?? Date.now()).toLocaleTimeString();
    const title = `${theme.bold(theme.fg("accent", "⚡ LOOP RESUME SIGNAL"))} ${theme.fg("muted", `[${time}]`)}`;

    const box = new Box(outputPad, 1, (text) => theme.bg("customMessageBg", text));
    box.addChild(new Text(title, 0, 0));
    box.addChild(new Text(theme.fg("text", "Re-linking conversation context & resuming agent loop..."), 0, 0));

    if (expanded && message.content) {
      box.addChild(new Text(theme.fg("dim", `Prompt: ${message.content}`), 0, 0));
    }

    return box;
  });

  const triggerContinue = (ctx: ExtensionContext, customPrompt = "") => {
    if (!ctx.isIdle()) {
      ctx.ui.notify("Agent is currently running; no need to wake up.", "warning");
      return;
    }

    let prompt = customPrompt.trim();
    if (!prompt) {
      const draft = ctx.ui.getEditorText?.()?.trim();
      if (draft) {
        prompt = draft;
        ctx.ui.setEditorText?.("");
      }
    }

    pi.sendMessage(
      {
        customType: CUSTOM_TYPE,
        content: prompt || DEFAULT_PROMPT,
        display: true,
        details: { timestamp: Date.now() },
      },
      { triggerTurn: true, deliverAs: "steer" },
    );
  };

  pi.registerCommand("continue", {
    description: "Send a resume signal to continue unfinished work (optional prompt)",
    handler: (args, ctx) => triggerContinue(ctx, args),
  });

  pi.registerShortcut(Key.alt("c"), {
    description: "Resume unfinished work",
    handler: (ctx) => triggerContinue(ctx),
  });
}
