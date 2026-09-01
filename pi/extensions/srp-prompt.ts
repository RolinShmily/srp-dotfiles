/**
 * srp-prompt.ts — SRP 极简提示词切面修饰符与原生 Prompt 融合扩展
 *
 * 功能特性：
 * 1. 深度融合：与 Pi 原生 prompts 目录（~/.pi/agent/prompts/ 及 .pi/prompts/）无缝共存；
 * 2. 动态 Slash 感知：当输入框键入以 "/" 开头的指令时，Alt+S 自动切换为 Slash 模式（仅允许勾选 Append 规则）；
 * 3. 模板前置展开与防护：在 Slash 命令模式下，自动展开原生模板并向后拼接 Append 切面，且主动屏蔽 Prepend 规则防破坏；
 * 4. 多层级覆盖发现：工作区 .pi/prompts/ > 全局 ~/.pi/agent/prompts/ > 扩展内置默认切面；
 * 5. 交互式 TUI 菜单：支持 Space 多选、Tab 预览完整正文与视口滚动，Enter 确认，Esc 取消；
 * 6. 单次即焚生命周期：普通文本发送后自动重置，保持上下文干净。
 *
 * 快捷键：
 *   - Alt+S: 呼出 Prompt Snippets 切面选择菜单
 *
 * 斜杠命令：
 *   - /srp-prompt [menu|list|clear]
 *
 * settings.json 配置示例：
 * {
 *   "srpPrompt": {
 *     "enabled": true,
 *     "shortcuts": ["alt+s"]
 *   }
 * }
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  isKeyRelease,
  isKeyRepeat,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

// ============================ 接口定义 ============================

interface Snippet {
  /** 标识符（如 verify-not-assume） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述说明 */
  description: string;
  /** 注入位置：前缀 (prepend) 或 后缀 (append) */
  placement: "prepend" | "append";
  /** 排序权重 (越小越靠前) */
  order: number;
  /** 提示词正文 */
  body: string;
  /** 来源层级 */
  source: "project" | "global" | "builtin";
  /** 文件绝对路径（内置则为空） */
  filePath?: string;
}

const WIDGET_ID = "srp-prompt";

// ============================ 内置默认切面 ============================

const BUILTIN_SNIPPETS: Snippet[] = [
  {
    id: "ask-questions",
    name: "询问问题",
    description: "主动提问对齐理解，确认共识后再行动",
    placement: "append",
    order: 10,
    body: "向我提出必要的问题，直到你 100% 明确并理解需要执行的目标与细节。\n在我明确确认我们已达成共识之前，不要直接对代码或系统展开实质性修改。",
    source: "builtin",
  },
  {
    id: "verify-not-assume",
    name: "事实查证 (Verify)",
    description: "验证关键事实与源码，严禁主观臆测",
    placement: "append",
    order: 20,
    body: "严禁主观臆测，必须核查验证事实。涉及关键代码、配置或事实依据时，必须先调用工具查证，切勿凭空猜测。若遇到无法查证的不确定项，必须主动向我提问确认。只有在你 100% 确认方案无误后方可行动；一旦察觉有哪怕一丝不确定，就是必须先查证的信号。",
    source: "builtin",
  },
  {
    id: "delegate-exploration",
    name: "委派排查 (Delegate)",
    description: "保持上下文精简，委派子智能体排查代码",
    placement: "append",
    order: 30,
    body: "保持当前上下文窗口精简。将大范围的代码库排查与阅读工作委派给子智能体（向其提出具体、针对性的排查问题），避免在主智能体中直接阅读大量文件消耗上下文。仅在需要核验核心关键点时，再由主智能体直接阅读文件。",
    source: "builtin",
  },
  {
    id: "diagnose-report",
    name: "诊断报告 (Diagnose)",
    description: "只读排查根因并给出修复建议，暂不修改代码",
    placement: "append",
    order: 40,
    body: "全面排查并诊断问题根因。不要修改任何代码。整理你的排查结论、核心调用链路以及建议的修复方案并向我汇报。在得到确认前，不要执行具体的代码修复。",
    source: "builtin",
  },
  {
    id: "session-kickoff",
    name: "会话对齐 (Kickoff)",
    description: "会话启动准备：熟悉项目背景并汇报，对齐后再开工",
    placement: "prepend",
    order: 10,
    body: "在正式开始任务前，请先快速熟悉并审视当前项目与环境。建立清晰的全貌认知后向我汇报概要。在我们对后续计划达成一致前，不要盲目开始编写代码。",
    source: "builtin",
  },
  {
    id: "orchestrator-mode",
    name: "编排模式 (Orchestrator)",
    description: "纯高阶调度模式：委派具体执行，保持敏锐思考",
    placement: "prepend",
    order: 30,
    body: "本次会话为纯高阶编排模式。请将具体的机械性工作——代码检索、文件阅读、具体编码实现——全部委派给子智能体。主智能体专注于全局规划、架构设计与逻辑决策，保持主会话上下文精炼敏锐，避免因读取过多业务代码而膨胀。",
    source: "builtin",
  },
];

// ============================ 工具函数 ============================

/** 解析 Frontmatter 与正文 */
function parseSnippetFile(
  filePath: string,
  raw: string,
  source: "project" | "global",
): Snippet | null {
  const filename = basename(filePath);
  const id = filename.replace(/\.md$/i, "");

  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  let meta: Record<string, string> = {};
  let body = raw.trim();

  if (match) {
    body = match[2].trim();
    for (const line of match[1].split(/\r?\n/)) {
      const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (kv) {
        meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  if (!body) return null;
  if (meta.snippet === "false") return null;

  // 描述缺省取第一行非空文本
  let description = meta.description || "";
  if (!description) {
    const firstLine = body.split("\n").find((l) => l.trim());
    if (firstLine) {
      description = firstLine.slice(0, 60);
      if (firstLine.length > 60) description += "...";
    }
  }

  const parsedOrder = Number.parseInt(meta.order ?? "", 10);
  const placement: "prepend" | "append" =
    meta.placement === "append" ? "append" : "prepend";

  return {
    id,
    name: meta.name || id,
    description,
    placement,
    order: Number.isFinite(parsedOrder) ? parsedOrder : 9999,
    body,
    source,
    filePath,
  };
}

/** 递归扫描多层级 Prompts/Snippets 目录并去重合并 */
function loadAllSnippets(cwd?: string): Snippet[] {
  const map = new Map<string, Snippet>();

  // 1. 注入内置预设
  for (const item of BUILTIN_SNIPPETS) {
    map.set(item.id, item);
  }

  // 2. 全局目录 ~/.pi/agent/prompts/
  try {
    const globalDir = join(getAgentDir(), "prompts");
    if (existsSync(globalDir)) {
      for (const file of readdirSync(globalDir)) {
        if (!file.toLowerCase().endsWith(".md")) continue;
        const fullPath = join(globalDir, file);
        try {
          const raw = readFileSync(fullPath, "utf-8");
          const parsed = parseSnippetFile(fullPath, raw, "global");
          if (parsed) map.set(parsed.id, parsed);
        } catch {}
      }
    }
  } catch {}

  // 3. 项目级目录 .pi/prompts/
  if (cwd) {
    try {
      const projectDir = join(cwd, CONFIG_DIR_NAME, "prompts");
      if (existsSync(projectDir)) {
        for (const file of readdirSync(projectDir)) {
          if (!file.toLowerCase().endsWith(".md")) continue;
          const fullPath = join(projectDir, file);
          try {
            const raw = readFileSync(fullPath, "utf-8");
            const parsed = parseSnippetFile(fullPath, raw, "project");
            if (parsed) map.set(parsed.id, parsed);
          } catch {}
        }
      }
    } catch {}
  }

  const all = Array.from(map.values());
  const byOrder = (a: Snippet, b: Snippet) =>
    a.order - b.order || a.name.localeCompare(b.name);

  return [
    ...all.filter((s) => s.placement === "prepend").sort(byOrder),
    ...all.filter((s) => s.placement === "append").sort(byOrder),
  ];
}

/** 解析 Bash 风格的 Slash 命令参数 */
function parseCommandArgs(argsString: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    if (inQuote) {
      if (char === inQuote) inQuote = null;
      else current += char;
    } else if (char === '"' || char === "'") {
      inQuote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) args.push(current);
  return args;
}

/** 替换模板参数 ($1, $@, ${1:-default}) */
function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ");
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (_match, defaultTarget, defaultValue, sliceStart, sliceLength, simple) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[parseInt(defaultTarget, 10) - 1];
        return value ? value : defaultValue;
      }
      if (sliceStart) {
        let start = parseInt(sliceStart, 10) - 1;
        if (start < 0) start = 0;
        if (sliceLength) {
          const length = parseInt(sliceLength, 10);
          return args.slice(start, start + length).join(" ");
        }
        return args.slice(start).join(" ");
      }
      if (simple === "ARGUMENTS" || simple === "@") {
        return allArgs;
      }
      const index = parseInt(simple, 10) - 1;
      return args[index] ?? "";
    },
  );
}

// ============================ 配置读取 ============================

interface SrpPromptConfig {
  enabled: boolean;
  shortcuts: string[];
}

function getSrpPromptConfig(cwd?: string): SrpPromptConfig {
  const read = (path: string) => {
    try {
      if (!existsSync(path)) return {};
      const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      const section = (value as Record<string, unknown>).srpPrompt;
      return section && typeof section === "object" && !Array.isArray(section)
        ? (section as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  };

  const global = read(join(getAgentDir(), "settings.json"));
  const project = cwd ? read(join(cwd, CONFIG_DIR_NAME, "settings.json")) : {};
  const merged = { ...global, ...project };

  const enabled = merged.enabled !== false;
  const shortcuts =
    Array.isArray(merged.shortcuts) && merged.shortcuts.length > 0
      ? (merged.shortcuts as string[])
      : ["alt+s"];

  return { enabled, shortcuts };
}

// ============================ 扩展入口 ============================

export default function (pi: ExtensionAPI) {
  let snippets: Snippet[] = [];
  let enabled = new Set<string>();
  let lastCtx: ExtensionContext | null = null;
  let removeInputListener: (() => void) | null = null;

  // 匹配热键（兼容 KeyId 与 WSL/Zellij 下未转义的 Raw ANSI 序列）
  const isShortcutKey = (data: string): boolean => {
    const config = getSrpPromptConfig(lastCtx?.cwd);
    if (!config.enabled) return false;
    for (const sc of config.shortcuts) {
      try {
        if (matchesKey(data, sc as any)) return true;
      } catch {}
      const norm = sc.toLowerCase().trim();
      if (norm === "alt+s" && (data === "\x1bs" || data === "\x1bS")) {
        return true;
      }
    }
    return false;
  };

  // 全局底层 TUI 按键拦截器
  const onGlobalInput = (data: string) => {
    if (isKeyRelease(data) || isKeyRepeat(data)) return undefined;

    if (isShortcutKey(data)) {
      if (lastCtx) {
        void openMenu(lastCtx);
      }
      return { consume: true };
    }
    return undefined;
  };

  // 动态挂载 TUI 底层按键监听器
  const ensureTuiAttached = (ctx: ExtensionContext) => {
    lastCtx = ctx;
    if (ctx.mode !== "tui") return;
    try {
      ctx.ui.setWidget("srp-prompt-tui-handle", (tui: any) => {
        if (!removeInputListener && tui?.addInputListener) {
          removeInputListener = tui.addInputListener(onGlobalInput);
        }
        return { render: () => [], invalidate: () => {} };
      });
    } catch {}
  };

  function updateWidget(ctx: ExtensionContext) {
    if (!ctx.hasUI || ctx.mode !== "tui") return;
    const active = snippets.filter((s) => enabled.has(s.id));
    const prepends = active.filter((s) => s.placement === "prepend");
    const appends = active.filter((s) => s.placement === "append");

    if (prepends.length === 0 && appends.length === 0) {
      ctx.ui.setWidget(WIDGET_ID, undefined);
      return;
    }

    const theme = ctx.ui.theme;
    const lines: string[] = [];
    if (prepends.length > 0) {
      lines.push(
        theme.fg("accent", `↑ prepend: ${prepends.map((s) => s.name).join(" · ")}`),
      );
    }
    if (appends.length > 0) {
      lines.push(
        theme.fg("warning", `↓ append: ${appends.map((s) => s.name).join(" · ")}`),
      );
    }
    ctx.ui.setWidget(WIDGET_ID, lines);
  }

  async function openMenu(ctx: ExtensionContext) {
    ensureTuiAttached(ctx);
    if (ctx.mode !== "tui") {
      ctx.ui.notify("Prompt snippets 菜单仅在交互式 TUI 模式下可用", "warning");
      return;
    }

    snippets = loadAllSnippets(ctx.cwd);
    // 清理磁盘上已被删除的 snippet 激活项
    enabled = new Set([...enabled].filter((id) => snippets.some((s) => s.id === id)));

    // 感知当前编辑器文本：若为 Slash 指令，自动切换为 Slash Append-Only 模式
    const editorText = ctx.ui.getEditorText() || "";
    const isSlashMode = editorText.trim().startsWith("/");

    const visibleSnippets = isSlashMode
      ? snippets.filter((s) => s.placement === "append")
      : snippets;

    if (visibleSnippets.length === 0) {
      ctx.ui.notify(
        isSlashMode
          ? "未找到适用的 Append 切面规则（Slash 模式下 Prepend 已自动过滤）"
          : "未找到任何可用提示词切面",
        "warning",
      );
      updateWidget(ctx);
      return;
    }

    const working = new Set(enabled);

    const confirmed = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
      const prepends = visibleSnippets.filter((s) => s.placement === "prepend");
      const appends = visibleSnippets.filter((s) => s.placement === "append");
      const items = [...prepends, ...appends];

      let mode: "list" | "preview" = "list";
      let cursor = 0;
      let listScroll = 0;
      let previewScroll = 0;

      const itemRow = (snippet: Snippet, idx: number, width: number): string => {
        const pointer = idx === cursor ? theme.fg("accent", "> ") : "  ";
        const checkbox = working.has(snippet.id)
          ? theme.fg("success", "[x]")
          : theme.fg("dim", "[ ]");
        const desc = snippet.description ? theme.fg("dim", ` — ${snippet.description}`) : "";
        const tag =
          snippet.source === "project"
            ? theme.fg("warning", " [proj]")
            : snippet.source === "builtin"
              ? theme.fg("dim", " [core]")
              : "";
        return truncateToWidth(
          `${pointer}${checkbox} ${theme.bold(snippet.name)}${tag}${desc}`,
          width,
        );
      };

      const buildListRows = (width: number): { text: string; itemIndex: number | null }[] => {
        const rows: { text: string; itemIndex: number | null }[] = [];
        if (!isSlashMode && prepends.length > 0) {
          rows.push({
            text: theme.fg("accent", "↑ PREPEND — 前置注入 (添加到消息开头)"),
            itemIndex: null,
          });
          prepends.forEach((s, i) => rows.push({ text: itemRow(s, i, width), itemIndex: i }));
          rows.push({ text: "", itemIndex: null });
        }
        if (appends.length > 0) {
          rows.push({
            text: theme.fg(
              "warning",
              isSlashMode
                ? "↓ APPEND — 后置切面注入 (Slash 指令模式已激活)"
                : "↓ APPEND — 后置注入 (添加到消息末尾)",
            ),
            itemIndex: null,
          });
          appends.forEach((s, i) =>
            rows.push({
              text: itemRow(s, prepends.length + i, width),
              itemIndex: prepends.length + i,
            }),
          );
        }
        return rows;
      };

      const buildPreviewRows = (snippet: Snippet, width: number): string[] => {
        const rows: string[] = [];
        rows.push(truncateToWidth(theme.bold(snippet.name), width));
        rows.push(
          truncateToWidth(
            theme.fg(
              "dim",
              `位置: ${snippet.placement} · 权重: ${snippet.order} · 来源: ${snippet.source} · ID: ${snippet.id}`,
            ),
            width,
          ),
        );
        rows.push(theme.fg("dim", "─".repeat(Math.min(width, 50))));
        for (const line of snippet.body.split("\n")) {
          for (const wrapped of wrapTextWithAnsi(line, width)) {
            rows.push(truncateToWidth(wrapped, width));
          }
        }
        return rows;
      };

      const viewport = (
        lines: string[],
        scroll: number,
        maxView: number,
        focusRow?: number,
      ): { out: string[]; scroll: number } => {
        const clipped = lines.length > maxView;
        const view = clipped ? Math.max(1, maxView - 2) : maxView;

        let s = Math.min(Math.max(0, scroll), Math.max(0, lines.length - view));
        if (focusRow !== undefined) {
          if (focusRow < s) s = focusRow;
          else if (focusRow >= s + view) s = focusRow - view + 1;
        }

        const visible = lines.slice(s, s + view);
        if (!clipped) return { out: visible, scroll: s };

        const above = s;
        const below = lines.length - (s + view);
        return {
          out: [
            above > 0 ? theme.fg("dim", `  ↑ ${above} 更多...`) : "",
            ...visible,
            below > 0 ? theme.fg("dim", `  ↓ ${below} 更多...`) : "",
          ],
          scroll: s,
        };
      };

      return {
        render(width: number): string[] {
          const maxView = Math.max(5, tui.terminal.rows - 10);

          let content: string[];
          let title: string;
          let hints: string;
          if (mode === "list") {
            const rows = buildListRows(width);
            const cursorRow = rows.findIndex((r) => r.itemIndex === cursor);
            const v = viewport(rows.map((r) => r.text), listScroll, maxView, cursorRow);
            content = v.out;
            listScroll = v.scroll;
            title = isSlashMode
              ? "Prompt Snippets (Slash 模式 · 仅限 Append 规则)"
              : "Prompt Snippets (提示词切面修饰符)";
            hints = "↑↓ 导航 • Space 切换勾选 • Tab 预览正文 • Enter 确认 • Esc 取消";
          } else {
            const snippet = items[cursor];
            const rows = buildPreviewRows(snippet, width);
            const v = viewport(rows, previewScroll, maxView);
            content = v.out;
            previewScroll = v.scroll;
            title = `预览: ${snippet.name}`;
            hints = "↑↓ 滚动预览 • Tab/Esc 返回列表";
          }

          return [
            theme.fg("accent", "─".repeat(width)),
            truncateToWidth(` ${theme.fg("accent", theme.bold(title))}`, width),
            "",
            ...content,
            "",
            truncateToWidth(theme.fg("dim", ` ${hints}`), width),
            theme.fg("accent", "─".repeat(width)),
          ];
        },
        invalidate() {},
        handleInput(data: string) {
          if (mode === "list") {
            if (matchesKey(data, Key.up)) {
              cursor = (cursor - 1 + items.length) % items.length;
              tui.requestRender();
            } else if (matchesKey(data, Key.down)) {
              cursor = (cursor + 1) % items.length;
              tui.requestRender();
            } else if (matchesKey(data, Key.space)) {
              const id = items[cursor].id;
              if (working.has(id)) working.delete(id);
              else working.add(id);
              tui.requestRender();
            } else if (matchesKey(data, Key.tab)) {
              mode = "preview";
              previewScroll = 0;
              tui.requestRender();
            } else if (matchesKey(data, Key.enter)) {
              done(true);
            } else if (matchesKey(data, Key.escape)) {
              done(false);
            }
          } else {
            if (matchesKey(data, Key.up)) {
              previewScroll--;
              tui.requestRender();
            } else if (matchesKey(data, Key.down)) {
              previewScroll++;
              tui.requestRender();
            } else if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
              mode = "list";
              tui.requestRender();
            }
          }
        },
      };
    });

    if (confirmed) {
      enabled = working;
    }
    updateWidget(ctx);
  }

  // ============================ 生命周期监听 ============================

  pi.on("session_start", (_event, ctx) => {
    enabled = new Set();
    snippets = loadAllSnippets(ctx.cwd);
    ensureTuiAttached(ctx);
    updateWidget(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    ensureTuiAttached(ctx);
  });

  pi.on("session_shutdown", () => {
    removeInputListener?.();
    removeInputListener = null;
  });

  pi.on("input", async (event, ctx) => {
    const config = getSrpPromptConfig(ctx.cwd);
    if (!config.enabled || enabled.size === 0) return;

    snippets = loadAllSnippets(ctx.cwd);
    const active = snippets.filter((s) => enabled.has(s.id));
    if (active.length === 0) {
      enabled = new Set();
      updateWidget(ctx);
      return;
    }

    const trimmedText = event.text.trim();

    // 1. 处理以 "/" 开头的 Slash 指令
    if (trimmedText.startsWith("/")) {
      const match = trimmedText.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
      if (!match) return;

      const templateName = match[1];
      const argsString = match[2] ?? "";

      // 仅保留 Append 规则，强制剔除 Prepend 规则
      const appends = active.filter((s) => s.placement === "append");
      if (appends.length === 0) {
        // 无 Append 规则时，保留状态供下一次普通消息消费
        return;
      }

      // 检查是否匹配已知 Prompt 模板并尝试展开
      const targetTemplate = snippets.find((s) => s.id === templateName);
      if (targetTemplate) {
        const args = parseCommandArgs(argsString);
        const expandedBody = substituteArgs(targetTemplate.body, args);

        const appendBodies = appends.map((s) => s.body);
        const finalText = [expandedBody, ...appendBodies].join("\n\n");

        enabled = new Set();
        updateWidget(ctx);
        return {
          action: "transform",
          text: finalText,
        };
      }

      // 若非已知 Prompt 模板（如 /clear, /model 等系统命令），不执行变换并保留勾选状态
      return;
    }

    // 2. 处理普通文本消息（合成 Prepend -> 用户文本 -> Append）
    const prependBodies = active.filter((s) => s.placement === "prepend").map((s) => s.body);
    const appendBodies = active.filter((s) => s.placement === "append").map((s) => s.body);

    enabled = new Set();
    updateWidget(ctx);

    return {
      action: "transform",
      text: [...prependBodies, event.text, ...appendBodies].join("\n\n"),
    };
  });

  // ============================ 命令与快捷键 ============================

  pi.registerCommand("srp-prompt", {
    description: "管理与勾选提示词切面修饰符 (Prompt Snippets)",
    handler: async (args, ctx) => {
      const config = getSrpPromptConfig(ctx.cwd);
      if (!config.enabled) {
        ctx.ui.notify("srp-prompt 扩展已在配置中禁用", "info");
        return;
      }

      const sub = (args || "").trim().toLowerCase();
      if (sub === "clear") {
        enabled = new Set();
        updateWidget(ctx);
        ctx.ui.notify("已清空所有已激活的提示词切面", "info");
      } else if (sub === "list") {
        snippets = loadAllSnippets(ctx.cwd);
        const activeIds = enabled;
        const msg = snippets
          .map(
            (s) =>
              `${activeIds.has(s.id) ? "[x]" : "[ ]"} ${s.name} (${s.placement}, order:${s.order}) - ${s.description}`,
          )
          .join("\n");
        ctx.ui.notify(msg || "无可用提示词", "info");
      } else {
        await openMenu(ctx);
      }
    },
  });

  // 注册快捷键 (默认 Alt+S)
  const config = getSrpPromptConfig();
  if (config.enabled && config.shortcuts.length > 0) {
    for (const sc of config.shortcuts) {
      pi.registerShortcut(sc, {
        description: "打开 Prompt Snippets 提示词切面菜单",
        handler: async (ctx) => {
          const cfg = getSrpPromptConfig(ctx.cwd);
          if (cfg.enabled) {
            await openMenu(ctx);
          }
        },
      });
    }
  }
}
