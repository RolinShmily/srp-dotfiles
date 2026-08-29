/**
 * srp-ask.ts — SRP 交互式提问扩展（ask_user_question 工具）。
 *
 * 功能特性：
 * 1. 注册 `ask_user_question` 工具：向用户提出单选、多选或自由文本问题，并挂起智能体会话等待用户决策；
 * 2. 交互式 TUI 弹窗：
 *    - 键盘导航（↑/↓ 切换选项、空格多选切换、Enter 确认/提交、Esc 取消）；
 *    - 支持 "Other (自定义输入)" 选项并呼出内联输入框；
 *    - 自适应终端宽度的 ANSI 文本折行与安全截断；
 *    - 全局跨扩展 UI 互斥锁（防止多个交互弹窗并发混乱）；
 * 3. 统一主控制命令：`/srp-ask [on|off|status|test]`。
 *
 * 配置（settings.json，可选）：
 * {
 *   "srpAsk": { "enabled": true }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  Text,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ============================ 类型定义 ============================

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

export interface SrpAskConfig {
  enabled: boolean;
}

// ============================ 配置读取 ============================

function readSrpAskConfig(cwd: string): SrpAskConfig {
  const read = (path: string): Record<string, unknown> => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpAsk;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };
  const global = read(join(getAgentDir(), "settings.json"));
  const project = read(join(cwd, CONFIG_DIR_NAME, "settings.json"));
  const merged = { ...global, ...project };
  return {
    enabled: merged.enabled !== false,
  };
}

// ============================ 工具 Schema ============================

const OptionSchema = Type.Object({
  label: Type.String({
    description:
      '选项显示标签。若推荐某选项，请放在第一项并在末尾追加 "(Recommended)"。',
  }),
  value: Type.Optional(
    Type.String({
      description: "机器可读的值标识，默认等同于 label。",
    }),
  ),
  description: Type.Optional(
    Type.String({ description: "选项下方显示的补充说明或影响分析。" }),
  ),
});

const AskUserQuestionParams = Type.Object({
  question: Type.String({
    description: "向用户提出的核心问题。单次工具调用仅提问一个核心问题。",
  }),
  details: Type.Optional(
    Type.String({
      description: "问题下方的补充背景信息、上下文或操作说明。",
    }),
  ),
  options: Type.Optional(
    Type.Array(OptionSchema, {
      description:
        "单选或多选的备选选项列表。若省略或为空数组，则进入纯文本自由输入模式。提供选项时用户始终可选择 Other 并输入自定义回答。",
    }),
  ),
  multiSelect: Type.Optional(
    Type.Boolean({
      description: "设置为 true 时允许用户同时选择多个选项。",
    }),
  ),
});

// ============================ 选项与结果辅助函数 ============================

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

function getOtherLabel(options: AskOption[]): string {
  return options.some((option) => option.label.toLowerCase() === "other")
    ? "Other (自定义输入)"
    : "Other";
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

function addWrapped(lines: string[], text: string, width: number, indent = ""): void {
  const contentWidth = Math.max(1, width - indent.length);
  for (const line of wrapTextWithAnsi(text, contentWidth)) {
    lines.push(truncateToWidth(`${indent}${line}`, width));
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
  const message = "用户取消了本次提问";
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
  let text: string;
  if (mode === "text") {
    const answer = answers[0];
    text = answer.label.trim().length > 0
      ? `用户输入回答: ${answer.label}`
      : "用户提交了空回答";
  } else if (mode === "single-select") {
    text = `用户选择项: ${formatAnswerForModel(answers[0])}`;
  } else {
    text = `用户选择多项:\n${answers.map((answer) => `- ${formatAnswerForModel(answer)}`).join("\n")}`;
  }

  return {
    content: [{ type: "text" as const, text }],
    details: buildStructuredResult("answered", question, mode, answers, context),
  };
}

// ============================ UI 弹窗组件 ============================

async function askSingleChoice(
  ctx: ExtensionContext,
  question: string,
  context: string | undefined,
  options: AskOption[],
): Promise<AskAnswer | null> {
  const otherLabel = getOtherLabel(options);
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
        addWrapped(lines, theme.fg("text", ` ${question}`), width);
        if (context) {
          lines.push("");
          addWrapped(lines, theme.fg("muted", ` ${context}`), width);
        }
        lines.push("");

        for (let i = 0; i < allOptions.length; i++) {
          const option = allOptions[i];
          const selected = i === optionIndex;
          const prefix = selected ? theme.fg("accent", "> ") : "  ";
          const label = option.isOther ? option.label : `${option.index}. ${option.label}`;
          const styled = selected ? theme.fg("accent", label) : theme.fg("text", label);
          add(`${prefix}${styled}`);
          if (option.description) {
            addWrapped(lines, theme.fg("muted", option.description), width, "     ");
          }
        }

        if (editMode) {
          lines.push("");
          add(theme.fg("muted", " 请输入您的自定义回答:"));
          for (const line of editor.render(Math.max(1, width - 2))) {
            add(` ${line}`);
          }
          lines.push("");
          add(theme.fg("dim", " Enter 提交 • Esc 返回选项"));
        } else {
          lines.push("");
          add(theme.fg("dim", " ↑↓ 选择 • Enter 确定 • Esc 取消"));
        }

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
  const otherLabel = getOtherLabel(options);
  const choiceItems: DisplayOption[] = options.map((option, index) => ({
    ...option,
    id: `option:${index}`,
    index: index + 1,
  }));
  const submitItem: DisplayOption = {
    id: "submit",
    label: "提交确认 (Submit)",
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
      const selected = new Map<string, AskAnswer>();
      const editor = new Editor(tui, createEditorTheme(theme));

      editor.onSubmit = (value) => {
        const trimmed = value.trim();
        if (!trimmed) return;
        selected.set("other", { type: "other", label: trimmed, value: trimmed });
        editMode = false;
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
        addWrapped(lines, theme.fg("text", ` ${question}`), width);
        if (context) {
          lines.push("");
          addWrapped(lines, theme.fg("muted", ` ${context}`), width);
        }
        lines.push("");

        for (let i = 0; i < allItems.length; i++) {
          const item = allItems[i];
          const isFocused = i === optionIndex;
          const prefix = isFocused ? theme.fg("accent", "> ") : "  ";

          if (item.isSubmit) {
            const label =
              selected.size > 0
                ? `✓ ${item.label} (已选 ${selected.size} 项)`
                : `○ ${item.label}`;
            const styled = isFocused
              ? theme.fg("accent", label)
              : theme.fg(selected.size > 0 ? "success" : "dim", label);
            add(`${prefix}${styled}`);
            continue;
          }

          if (item.isOther) {
            const other = selected.get("other");
            const marker = other ? "[x]" : "[ ]";
            const suffix = other ? ` — ${other.label}` : "";
            const styled = isFocused
              ? theme.fg("accent", `${marker} ${item.label}${suffix}`)
              : theme.fg(other ? "success" : "text", `${marker} ${item.label}${suffix}`);
            add(`${prefix}${styled}`);
            continue;
          }

          const checked = selected.has(item.id);
          const marker = checked ? "[x]" : "[ ]";
          const label = `${marker} ${item.index}. ${item.label}`;
          const styled = isFocused
            ? theme.fg("accent", label)
            : theme.fg(checked ? "success" : "text", label);
          add(`${prefix}${styled}`);
          if (item.description) {
            addWrapped(lines, theme.fg("muted", item.description), width, "     ");
          }
        }

        if (editMode) {
          lines.push("");
          add(theme.fg("muted", " 请输入您的自定义回答:"));
          for (const line of editor.render(Math.max(1, width - 2))) {
            add(` ${line}`);
          }
          lines.push("");
          add(theme.fg("dim", " Enter 保存 • Esc 返回多选"));
        } else {
          lines.push("");
          if (selected.size === 0) {
            add(theme.fg("warning", " 请至少选择一项回答后再提交。"));
          }
          add(theme.fg("dim", " ↑↓ 切换 • 空格 勾选 • Enter 编辑/提交 • Esc 取消"));
        }

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
      };
    },
  );
}

// ============================ 全局 UI 互斥锁 ============================

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

// ============================ Pi 扩展注册 ============================

function syncAskActiveTools(pi: ExtensionAPI, enabled: boolean): void {
  let active = pi.getActiveTools();
  if (enabled) {
    if (!active.includes("ask_user_question")) active = [...active, "ask_user_question"];
  } else {
    active = active.filter((t) => t !== "ask_user_question");
  }
  pi.setActiveTools(active);
}

export default function (pi: ExtensionAPI) {
  let runtimeEnabled = readSrpAskConfig(process.cwd()).enabled;

  pi.on("session_start", (_event, ctx) => {
    runtimeEnabled = readSrpAskConfig(ctx.cwd).enabled;
    syncAskActiveTools(pi, runtimeEnabled);
  });

  // 注册主控制命令：/srp-ask
  pi.registerCommand("srp-ask", {
    description: "管理与测试交互提问工具（/srp-ask [on|off|status|test]）",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const candidates: AutocompleteItem[] = [
        { value: "status", label: "status", description: "查看 ask_user_question 工具当前状态" },
        { value: "on", label: "on", description: "开启 ask_user_question 提问工具" },
        { value: "off", label: "off", description: "关闭 ask_user_question 提问工具" },
        { value: "test", label: "test", description: "测试弹出单选/多选交互式提问窗口" },
      ];
      const trimmed = prefix.trimStart();
      const filtered = candidates.filter((item) => item.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const action = (args.trim().split(/\s+/)[0] || "status").toLowerCase();

      if (action === "status" || !args.trim()) {
        ctx.ui.notify(
          `srp-ask 状态: ${runtimeEnabled ? "已开启" : "已关闭"}\n• 注册工具: ask_user_question\n• 交互模式: 支持单选、多选与自由文本输入（带 UI 互斥锁）`,
          "info",
        );
        return;
      }

      if (action === "on") {
        runtimeEnabled = true;
        syncAskActiveTools(pi, true);
        ctx.ui.notify("srp-ask: 已开启并激活 ask_user_question 提问工具", "info");
        return;
      }

      if (action === "off") {
        runtimeEnabled = false;
        syncAskActiveTools(pi, false);
        ctx.ui.notify("srp-ask: 已关闭并取消激活 ask_user_question 提问工具", "info");
        return;
      }

      if (action === "test") {
        if (!ctx.hasUI) {
          ctx.ui.notify("srp-ask test 需要在交互式 TUI 终端中执行", "warning");
          return;
        }
        try {
          const testAnswer = await withUILock(async () => {
            return await askSingleChoice(
              ctx,
              "【测试】请选择您偏好的 UI 交互模式：",
              "这是 /srp-ask test 发起的演示弹窗，用于验证主题色彩与键盘交互。",
              [
                { label: "极简纯文本模式 (Recommended)", description: "紧凑整洁，适合快速响应" },
                { label: "丰富卡片模式", description: "展示更多元数据与装饰边框" },
              ],
            );
          });
          if (testAnswer) {
            ctx.ui.notify(`测试回答成功: ${formatAnswerForModel(testAnswer)}`, "info");
          } else {
            ctx.ui.notify("测试已取消", "info");
          }
        } catch (e) {
          ctx.ui.notify(`测试异常: ${String(e)}`, "error");
        }
        return;
      }

      ctx.ui.notify("用法: /srp-ask [on|off|status|test]", "info");
    },
  });

  // 注册 ask_user_question 工具
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    description:
      "向用户提出一个明确的问题并暂停执行，直到用户作出选择或输入。适用于需求模糊、需要用户偏好决策、影响架构方案或关键操作前需要用户确认的场景。单次工具调用仅提问一个核心问题，避免混合无关问题。",
    promptSnippet:
      "在需求不明确、需要用户偏好或决策时使用此工具提问，避免自行盲目假设。",
    promptGuidelines: [
      "单次工具调用仅提问一个具体问题。",
      "若需要回答多个不同维度的问题，分别发起多次工具调用，不要混在一个问题里。",
      "提供 options 列表时，用户界面会自动提供 Other (自定义输入) 选项。",
      "仅在需要用户勾选多个答案时设置 multiSelect: true。",
      '若有推荐选项，将其置于列表首位并在 label 末尾追加 "(Recommended)"。',
      "在存在多种有效实现路径且取决于用户偏好时，优先使用此工具确认。",
    ],
    parameters: AskUserQuestionParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!runtimeEnabled) {
        throw new Error("srp-ask 扩展当前已关闭。请在 TUI 中输入 /srp-ask on 开启后重试。");
      }

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
          "ask_user_question 需要交互式 TUI 终端环境",
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
      let summary =
        theme.fg("toolTitle", theme.bold("ask_user_question ")) +
        theme.fg("accent", `"${args.question || ""}"`);
      if (args.multiSelect) {
        summary += theme.fg("dim", " [multi-select]");
      }
      if (options.length > 0) {
        const labels = [...options.map((option) => option.label), getOtherLabel(options)].join(", ");
        summary += `\n${theme.fg("dim", `  选项: ${labels}`)}`;
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

      if (details.status === "cancelled") {
        text.setText(theme.fg("warning", `⊘ ${details.message || "已取消"}`));
        return text;
      }

      if (details.status === "unavailable") {
        text.setText(theme.fg("error", `! ${details.message || "提问工具不可用"}`));
        return text;
      }

      const lines = details.answers.map((answer) => {
        switch (answer.type) {
          case "text":
            return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.label || "(空回答)")}`;
          case "other":
            return `${theme.fg("success", "✓ ")}${theme.fg("muted", "Other: ")}${theme.fg("accent", answer.label)}`;
          case "option":
            return `${theme.fg("success", "✓ ")}${theme.fg("accent", `${answer.index}. ${answer.label}`)}`;
        }
      });
      text.setText(lines.join("\n"));
      return text;
    },
  });
}
