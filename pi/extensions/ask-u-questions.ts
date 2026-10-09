/**
 * ask-u-questions.ts — Registers "ask_user_question" for interactive single-choice,
 * multiple-choice, and free-text answers. Dialogs share a UI lock.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  type Focusable,
  Key,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

export interface AskOption {
  label: string;
  value: string;
  description?: string;
}

interface DisplayOption extends AskOption {
  id: string;
  index?: number;
  isOther?: boolean;
  isSubmit?: boolean;
}

export interface TextAnswer {
  type: "text";
  label: string;
  value: string;
}

export interface OptionAnswer {
  type: "option";
  label: string;
  value: string;
  index: number;
}

export interface OtherAnswer {
  type: "other";
  label: string;
  value: string;
}

export type AskAnswer = TextAnswer | OptionAnswer | OtherAnswer;
export type AskUserQuestionStatus = "answered" | "cancelled" | "unavailable";
export type AskUserQuestionMode = "text" | "single-select" | "multi-select";

export interface AskUserQuestionResultDetails {
  status: AskUserQuestionStatus;
  question: string;
  context?: string;
  mode: AskUserQuestionMode;
  answers: AskAnswer[];
  message?: string;
}

const OptionSchema = Type.Object({
  label: Type.String({ description: 'Option label. Put a recommended option first and append "(Recommended)".' }),
  value: Type.Optional(Type.String({ description: "Machine-readable value; defaults to the label." })),
  description: Type.Optional(Type.String({ description: "Additional context shown below the option." })),
});

const AskUserQuestionParams = Type.Object({
  question: Type.String({ description: "The question to ask. Ask only one question per call." }),
  details: Type.Optional(Type.String({ description: "Background or instructions shown below the question." })),
  options: Type.Optional(Type.Array(OptionSchema, {
    description: "Choices for selection. Omit or pass an empty array for free-text input. An Other choice is always available.",
  })),
  multiSelect: Type.Optional(Type.Boolean({ description: "Allow selecting multiple options when true." })),
});

function normalizeOptions(
  options: Array<{ label: string; value?: string; description?: string }> | undefined,
): AskOption[] {
  return (options || [])
    .map((option) => ({
      label: option.label.trim(),
      value: option.value?.trim() || option.label.trim(),
      description: option.description?.trim() || undefined,
    }))
    .filter((option) => option.label.length > 0);
}

function isChineseContext(
  question: string,
  options?: Array<{ label?: string; description?: string }>,
  context?: string,
): boolean {
  if (/[\u4e00-\u9fa5]/.test(question)) return true;
  if (context && /[\u4e00-\u9fa5]/.test(context)) return true;
  if (options && options.some((o) => (o.label && /[\u4e00-\u9fa5]/.test(o.label)) || (o.description && /[\u4e00-\u9fa5]/.test(o.description)))) {
    return true;
  }
  return false;
}

function getOtherLabel(options: AskOption[], isZh = false): string {
  if (isZh) {
    return options.some((option) => option.label === "其他（自定义输入）")
      ? "自定义输入"
      : "其他（自定义输入）";
  }
  return options.some((option) => option.label === "Other (custom input)")
    ? "Custom input"
    : "Other (custom input)";
}

function createEditorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (s) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    },
  };
}

function addWrapped(
  lines: string[],
  text: string,
  width: number,
  firstIndent = " ",
  restIndent = firstIndent,
  styleFn?: (line: string) => string,
): void {
  if (!text) return;
  const paragraphs = text.split(/\r?\n/);
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const paragraph = paragraphs[pIdx];
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    const isFirstParagraph = pIdx === 0;
    const currentFirstIndent = isFirstParagraph ? firstIndent : restIndent;
    const firstWidth = Math.max(1, width - visibleWidth(currentFirstIndent));
    const restWidth = Math.max(1, width - visibleWidth(restIndent));

    if (firstWidth === restWidth) {
      const wrapped = wrapTextWithAnsi(paragraph, firstWidth);
      for (let i = 0; i < wrapped.length; i++) {
        const indent = isFirstParagraph && i === 0 ? firstIndent : restIndent;
        const rawLine = wrapped[i];
        const styled = styleFn ? styleFn(rawLine) : rawLine;
        lines.push(truncateToWidth(`${indent}${styled}`, width));
      }
    } else {
      const wrapped = wrapTextWithAnsi(paragraph, Math.min(firstWidth, restWidth));
      for (let i = 0; i < wrapped.length; i++) {
        const indent = isFirstParagraph && i === 0 ? firstIndent : restIndent;
        const rawLine = wrapped[i];
        const styled = styleFn ? styleFn(rawLine) : rawLine;
        lines.push(truncateToWidth(`${indent}${styled}`, width));
      }
    }
  }
}

function formatAnswerForModel(answer: AskAnswer): string {
  switch (answer.type) {
    case "text":
      return answer.label;
    case "other":
      return `Other: ${answer.label}`;
    case "option":
      return `${answer.index}. ${answer.label}`;
  }
}

function answerSortRank(answer: AskAnswer): number {
  switch (answer.type) {
    case "option":
      return answer.index;
    case "other":
      return Number.MAX_SAFE_INTEGER - 1;
    case "text":
      return Number.MAX_SAFE_INTEGER;
  }
}

function sortAnswers(answers: AskAnswer[]): AskAnswer[] {
  return [...answers].sort((a, b) => answerSortRank(a) - answerSortRank(b));
}

function buildStructuredResult(
  status: AskUserQuestionStatus,
  question: string,
  mode: AskUserQuestionMode,
  answers: AskAnswer[],
  context?: string,
  message?: string,
): AskUserQuestionResultDetails {
  return {
    status,
    question,
    context,
    mode,
    answers,
    message,
  };
}

function cancelledResult(question: string, mode: AskUserQuestionMode, context?: string) {
  const isZh = isChineseContext(question, undefined, context);
  const message = isZh ? "用户取消了本次提问" : "User cancelled the question.";
  return {
    content: [{ type: "text" as const, text: message }],
    details: buildStructuredResult("cancelled", question, mode, [], context, message),
  };
}

function unavailableResult(question: string, mode: AskUserQuestionMode, message: string, context?: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    details: buildStructuredResult("unavailable", question, mode, [], context, message),
  };
}

function buildResult(
  question: string,
  context: string | undefined,
  mode: AskUserQuestionMode,
  answers: AskAnswer[],
) {
  const isZh = isChineseContext(question, answers, context);
  let text: string;
  if (mode === "text") {
    const answer = answers[0];
    if (isZh) {
      text = answer.label.trim().length > 0
        ? `用户输入回答: ${answer.label}`
        : "用户提交了空回答";
    } else {
      text = answer.label.trim().length > 0
        ? `User answered: ${answer.label}`
        : "User submitted an empty answer";
    }
  } else if (mode === "single-select") {
    text = isZh
      ? `用户选择项: ${formatAnswerForModel(answers[0])}`
      : `User selected: ${formatAnswerForModel(answers[0])}`;
  } else {
    text = isZh
      ? `用户选择多项:\n${answers.map((answer) => `- ${formatAnswerForModel(answer)}`).join("\n")}`
      : `User selected multiple:\n${answers.map((answer) => `- ${formatAnswerForModel(answer)}`).join("\n")}`;
  }

  return {
    content: [{ type: "text" as const, text }],
    details: buildStructuredResult("answered", question, mode, answers, context),
  };
}

async function askSingleChoice(
  ctx: ExtensionContext,
  question: string,
  context: string | undefined,
  options: AskOption[],
): Promise<AskAnswer | null> {
  const isZh = isChineseContext(question, options, context);
  const otherLabel = getOtherLabel(options, isZh);
  const allOptions: DisplayOption[] = [
    ...options.map((option, index) => ({
      ...option,
      id: `option:${index}`,
      index: index + 1,
    })),
    { id: "other", label: otherLabel, value: "__other__", isOther: true },
  ];

  return ctx.ui.custom<AskAnswer | null>(
    (tui, theme, _kb, done: (result: AskAnswer | null) => void) => {
      let optionIndex = 0;
      let editMode = false;
      let cachedLines: string[] | undefined;
      let cachedWidth = -1;
      let componentFocused = false;
      const editor = new Editor(tui, createEditorTheme(theme));

      editor.onSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        done({ type: "other", label: trimmed, value: trimmed });
      };

      function refresh() {
        cachedLines = undefined;
        tui.requestRender();
      }

      function handleInput(data: string) {
        if (editMode) {
          if (matchesKey(data, Key.escape)) {
            editMode = false;
            editor.focused = false;
            editor.setText("");
            refresh();
            return;
          }
          editor.handleInput(data);
          refresh();
          return;
        }

        if (matchesKey(data, Key.up)) {
          optionIndex = Math.max(0, optionIndex - 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.down)) {
          optionIndex = Math.min(allOptions.length - 1, optionIndex + 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.enter)) {
          const selected = allOptions[optionIndex];
          if (selected.isOther) {
            editMode = true;
            editor.focused = componentFocused;
            editor.setText("");
            refresh();
            return;
          }
          done({
            type: "option",
            label: selected.label,
            value: selected.value,
            index: selected.index!,
          });
          return;
        }
        if (matchesKey(data, Key.escape)) {
          done(null);
        }
      }

      function render(width: number): string[] {
        if (cachedLines && cachedWidth === width) return cachedLines;

        const lines: string[] = [];
        const add = (text: string) => lines.push(truncateToWidth(text, width));

        add(theme.fg("accent", "─".repeat(width)));

        if (editMode) {
          addWrapped(lines, question, width, " ", " ", (l) => theme.fg("text", theme.bold(l)));
          if (context) {
            addWrapped(lines, context, width, " ", " ", (l) => theme.fg("muted", l));
          }
          lines.push("");
          const header = allOptions[optionIndex]?.label || otherLabel;
          add(theme.fg("accent", ` > ${header}:`));
          for (const line of editor.render(Math.max(1, width - 4))) {
            add(`   ${line}`);
          }
          lines.push("");
          const editHint = isZh
            ? " Enter 提交 • Esc 返回选项"
            : " Enter to submit • Esc to return";
          add(theme.fg("dim", editHint));
          add(theme.fg("accent", "─".repeat(width)));
          cachedLines = lines;
          cachedWidth = width;
          return lines;
        }

        addWrapped(lines, question, width, " ", " ", (l) => theme.fg("text", theme.bold(l)));
        if (context) {
          addWrapped(lines, context, width, " ", " ", (l) => theme.fg("muted", l));
        }
        lines.push("");

        for (let i = 0; i < allOptions.length; i++) {
          const item = allOptions[i];
          const selected = i === optionIndex;
          const prefix = selected ? theme.fg("accent", " > ") : "   ";

          if (item.isOther) {
            const styledLabel = selected
              ? theme.bold(theme.fg("accent", item.label))
              : theme.fg("text", item.label);
            lines.push(truncateToWidth(`${prefix}${styledLabel}`, width));
          } else {
            const numPrefix = `${item.index}. `;
            const firstIndent = `${prefix}${selected ? theme.fg("accent", numPrefix) : numPrefix}`;
            const restIndent = " ".repeat(visibleWidth(firstIndent));
            const styleLabel = (l: string) =>
              selected ? theme.bold(theme.fg("accent", l)) : theme.fg("text", l);

            addWrapped(lines, item.label, width, firstIndent, restIndent, styleLabel);

            if (item.description) {
              const descIndent = " ".repeat(visibleWidth(firstIndent));
              const descStyle = (l: string) => theme.fg("muted", l);
              addWrapped(lines, item.description, width, descIndent, descIndent, descStyle);
            }
          }
        }

        lines.push("");
        const navHint = isZh
          ? " ↑↓ 选择 • Enter 确定 • Esc 取消"
          : " ↑↓ to navigate • Enter to select • Esc to cancel";
        add(theme.fg("dim", navHint));
        add(theme.fg("accent", "─".repeat(width)));

        cachedLines = lines;
        cachedWidth = width;
        return lines;
      }

      return {
        render,
        invalidate: () => {
          cachedLines = undefined;
        },
        handleInput,
        get focused(): boolean {
          return componentFocused;
        },
        set focused(value: boolean) {
          componentFocused = value;
          editor.focused = editMode && componentFocused;
        },
      };
    },
  );
}

async function askMultiChoice(
  ctx: ExtensionContext,
  question: string,
  context: string | undefined,
  options: AskOption[],
): Promise<AskAnswer[] | null> {
  const isZh = isChineseContext(question, options, context);
  const otherLabel = getOtherLabel(options, isZh);
  const choiceItems: DisplayOption[] = options.map((option, index) => ({
    ...option,
    id: `option:${index}`,
    index: index + 1,
  }));
  const submitItem: DisplayOption = {
    id: "submit",
    label: isZh ? "提交确认" : "Confirm & Submit",
    value: "__submit__",
    isSubmit: true,
  };
  const allItems: DisplayOption[] = [
    ...choiceItems,
    { id: "other", label: otherLabel, value: "__other__", isOther: true },
    submitItem,
  ];

  return ctx.ui.custom<AskAnswer[] | null>(
    (tui, theme, _kb, done: (result: AskAnswer[] | null) => void) => {
      let optionIndex = 0;
      let editMode = false;
      let cachedLines: string[] | undefined;
      let cachedWidth = -1;
      let componentFocused = false;
      const selected = new Map<string, AskAnswer>();
      const editor = new Editor(tui, createEditorTheme(theme));

      editor.onSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        selected.set("other", { type: "other", label: trimmed, value: trimmed });
        editMode = false;
        editor.focused = false;
        refresh();
      };

      function refresh() {
        cachedLines = undefined;
        tui.requestRender();
      }

      function toggleOption(item: DisplayOption) {
        if (selected.has(item.id)) {
          selected.delete(item.id);
        } else {
          selected.set(item.id, {
            type: "option",
            label: item.label,
            value: item.value,
            index: item.index!,
          });
        }
        refresh();
      }

      function handleInput(data: string) {
        if (editMode) {
          if (matchesKey(data, Key.escape)) {
            editMode = false;
            editor.focused = false;
            editor.setText(selected.get("other")?.label || "");
            refresh();
            return;
          }
          editor.handleInput(data);
          refresh();
          return;
        }

        if (matchesKey(data, Key.up)) {
          optionIndex = Math.max(0, optionIndex - 1);
          refresh();
          return;
        }
        if (matchesKey(data, Key.down)) {
          optionIndex = Math.min(allItems.length - 1, optionIndex + 1);
          refresh();
          return;
        }

        const current = allItems[optionIndex];
        if (matchesKey(data, Key.space)) {
          if (current.isSubmit) return;
          if (current.isOther) {
            if (selected.has("other")) {
              selected.delete("other");
              refresh();
            } else {
              editMode = true;
              editor.focused = componentFocused;
              editor.setText("");
              refresh();
            }
            return;
          }
          toggleOption(current);
          return;
        }

        if (matchesKey(data, Key.enter)) {
          if (current.isSubmit) {
            if (selected.size > 0) {
              done(sortAnswers(Array.from(selected.values())));
            }
            return;
          }
          if (current.isOther) {
            editMode = true;
            editor.focused = componentFocused;
            editor.setText(selected.get("other")?.label || "");
            refresh();
            return;
          }
          toggleOption(current);
          return;
        }

        if (matchesKey(data, Key.escape)) {
          done(null);
        }
      }

      function render(width: number): string[] {
        if (cachedLines && cachedWidth === width) return cachedLines;

        const lines: string[] = [];
        const add = (text: string) => lines.push(truncateToWidth(text, width));

        add(theme.fg("accent", "─".repeat(width)));

        if (editMode) {
          addWrapped(lines, question, width, " ", " ", (l) => theme.fg("text", theme.bold(l)));
          if (context) {
            addWrapped(lines, context, width, " ", " ", (l) => theme.fg("muted", l));
          }
          lines.push("");
          const header = allItems[optionIndex]?.label || otherLabel;
          add(theme.fg("accent", ` > ${header}:`));
          for (const line of editor.render(Math.max(1, width - 4))) {
            add(`   ${line}`);
          }
          lines.push("");
          const editHint = isZh
            ? " Enter 保存 • Esc 返回多选"
            : " Enter to save • Esc to return";
          add(theme.fg("dim", editHint));
          add(theme.fg("accent", "─".repeat(width)));
          cachedLines = lines;
          cachedWidth = width;
          return lines;
        }

        addWrapped(lines, question, width, " ", " ", (l) => theme.fg("text", theme.bold(l)));
        if (context) {
          addWrapped(lines, context, width, " ", " ", (l) => theme.fg("muted", l));
        }
        lines.push("");

        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          const isFocused = i === optionIndex;
          const prefix = isFocused ? theme.fg("accent", " > ") : "   ";

          if (item.isSubmit) {
            const hasSelected = selected.size > 0;
            const countText = isZh
              ? `(已选 ${selected.size} 项)`
              : `(${selected.size} selected)`;
            const label = hasSelected
              ? `✓ ${item.label} ${countText}`
              : `○ ${item.label}`;
            const styled = isFocused
              ? theme.bold(theme.fg("accent", label))
              : theme.fg(hasSelected ? "success" : "dim", label);
            lines.push(truncateToWidth(`${prefix}${styled}`, width));
            continue;
          }

          if (item.isOther) {
            const other = selected.get("other");
            const marker = other ? "[x]" : "[ ]";
            const suffix = other ? ` — ${other.label}` : "";
            const label = `${marker} ${item.label}${suffix}`;
            const styled = isFocused
              ? theme.bold(theme.fg("accent", label))
              : theme.fg(other ? "success" : "text", label);
            lines.push(truncateToWidth(`${prefix}${styled}`, width));
            continue;
          }

          const checked = selected.has(item.id);
          const marker = checked ? "[x] " : "[ ] ";
          const numPrefix = `${item.index}. `;
          const firstIndent = `${prefix}${checked ? theme.fg("success", marker) : marker}${numPrefix}`;
          const restIndent = " ".repeat(visibleWidth(firstIndent));
          const styleLabel = (l: string) => {
            if (isFocused) return theme.bold(theme.fg("accent", l));
            if (checked) return theme.fg("success", l);
            return theme.fg("text", l);
          };

          addWrapped(lines, item.label, width, firstIndent, restIndent, styleLabel);

          if (item.description) {
            const descIndent = " ".repeat(visibleWidth(firstIndent));
            const descStyle = (l: string) => theme.fg("muted", l);
            addWrapped(lines, item.description, width, descIndent, descIndent, descStyle);
          }
        }

        lines.push("");
        if (selected.size === 0) {
          const warnText = isZh
            ? " 请至少选择一项回答后再提交。"
            : " Please select at least one option before submitting.";
          add(theme.fg("warning", warnText));
        }
        const navHint = isZh
          ? " ↑↓ 切换 • 空格 勾选 • Enter 编辑/提交 • Esc 取消"
          : " ↑↓ to navigate • Space to select • Enter to edit/submit • Esc to cancel";
        add(theme.fg("dim", navHint));
        add(theme.fg("accent", "─".repeat(width)));

        cachedLines = lines;
        cachedWidth = width;
        return lines;
      }

      return {
        render,
        invalidate: () => {
          cachedLines = undefined;
        },
        handleInput,
        get focused(): boolean {
          return componentFocused;
        },
        set focused(value: boolean) {
          componentFocused = value;
          editor.focused = editMode && componentFocused;
        },
      };
    },
  );
}

const SHARED_UI_LOCK_KEY = "__piSharedUiLock";
function getSharedUiLock(): { withLock<T>(fn: () => T | Promise<T>): Promise<T> } {
  const g = globalThis as any;
  if (!g[SHARED_UI_LOCK_KEY]) {
    let chain: Promise<void> = Promise.resolve();
    g[SHARED_UI_LOCK_KEY] = {
      withLock<T>(fn: () => T | Promise<T>): Promise<T> {
        const prev = chain;
        let release: () => void;
        chain = new Promise<void>((r) => {
          release = r;
        });
        return prev.then(fn).finally(() => release!());
      },
    };
  }
  return g[SHARED_UI_LOCK_KEY];
}
const sharedUiLock = getSharedUiLock();

function withUILock<T>(fn: () => Promise<T>): Promise<T> {
  return sharedUiLock.withLock(fn);
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description:
      "Ask the user a clear question and pause execution until they select an option or provide input. Useful when requirements are ambiguous, user preferences or architectural decisions are needed, or critical operations require explicit user confirmation. Always phrase the question and options in the same language as the conversation context. Ask exactly one focused question per call.",
    promptSnippet:
      "Ask the user a question to clarify requirements or gather decisions instead of making assumptions.",
    promptGuidelines: [
      "Always phrase the question and options in the same language as the conversation context (e.g. ask in Chinese if conversing in Chinese, ask in English if conversing in English).",
      "Ask exactly one specific question per tool call.",
      "If you need input across multiple distinct dimensions, make separate tool calls instead of combining them into one.",
      "When options are provided, an 'Other (custom input)' choice is automatically available in the user interface.",
      "Set multiSelect: true only when the user is expected to select multiple choices.",
      'Put the recommended option first in the list and append "(Recommended)" to its label.',
      "Prefer using this tool whenever multiple valid implementation paths exist that depend on user preference.",
    ],
    parameters: AskUserQuestionParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const options = normalizeOptions(params.options);
      const context = params.details?.trim() || undefined;
      const mode: AskUserQuestionMode =
        options.length === 0
          ? "text"
          : params.multiSelect
            ? "multi-select"
            : "single-select";

      if (signal?.aborted) {
        return cancelledResult(params.question, mode, context);
      }

      if (!ctx.hasUI) {
        return unavailableResult(
          params.question,
          mode,
          "ask_user_question requires an interactive TUI environment",
          context,
        );
      }

      return withUILock(async () => {
        if (mode === "text") {
          const editorTitle = context
            ? `${params.question}\n\n${context}`
            : params.question;
          const answer = await ctx.ui.editor(editorTitle);
          if (answer === undefined) {
            return cancelledResult(params.question, mode, context);
          }
          return buildResult(params.question, context, mode, [
            { type: "text", label: answer.trim(), value: answer.trim() },
          ]);
        }

        if (mode === "single-select") {
          const answer = await askSingleChoice(ctx, params.question, context, options);
          if (!answer) {
            return cancelledResult(params.question, mode, context);
          }
          return buildResult(params.question, context, mode, [answer]);
        }

        const answers = await askMultiChoice(ctx, params.question, context, options);
        if (!answers) {
          return cancelledResult(params.question, mode, context);
        }
        return buildResult(params.question, context, mode, answers);
      });
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const options = normalizeOptions(
        args.options as Array<{ label: string; value?: string; description?: string }> | undefined,
      );
      const isZh = isChineseContext(args.question || "", options, args.details);
      let summary =
        theme.fg("toolTitle", theme.bold("ask_user_question ")) +
        theme.fg("accent", `"${args.question || ""}"`);
      if (args.multiSelect) {
        summary += theme.fg("dim", " [multi-select]");
      }
      if (options.length > 0) {
        const otherLbl = getOtherLabel(options, isZh);
        const labels = [...options.map((option) => option.label), otherLbl].join(", ");
        const optPrefix = isZh ? "  选项: " : "  Options: ";
        summary += `\n${theme.fg("dim", `${optPrefix}${labels}`)}`;
      }
      text.setText(summary);
      return text;
    },

    renderResult(result, _options, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const details = result.details as AskUserQuestionResultDetails | undefined;
      if (!details) {
        const first = result.content?.[0];
        text.setText(first?.type === "text" ? first.text : "");
        return text;
      }

      const isZh = isChineseContext(details.question || "", details.answers, details.context);

      if (details.status === "cancelled") {
        const defaultCancelled = isZh ? "已取消" : "Cancelled";
        text.setText(theme.fg("warning", `⊘ ${details.message || defaultCancelled}`));
        return text;
      }

      if (details.status === "unavailable") {
        const defaultUnavailable = isZh ? "提问工具不可用" : "Tool unavailable";
        text.setText(theme.fg("error", `! ${details.message || defaultUnavailable}`));
        return text;
      }

      const emptyText = isZh ? "(空回答)" : "(empty)";
      const otherPrefix = isZh ? "其他：" : "Other: ";

      const lines = details.answers.map((answer) => {
        switch (answer.type) {
          case "text":
            return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.label || emptyText)}`;
          case "other":
            return `${theme.fg("success", "✓ ")}${theme.fg("muted", otherPrefix)}${theme.fg("accent", answer.label)}`;
          case "option":
            return `${theme.fg("success", "✓ ")}${theme.fg("accent", `${answer.index}. ${answer.label}`)}`;
        }
      });
      text.setText(lines.join("\n"));
      return text;
    },
  });
}
