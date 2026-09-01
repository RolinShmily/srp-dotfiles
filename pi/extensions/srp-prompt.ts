/**
 * srp-prompt.ts — SRP 极简提示词切面修饰符与原生 Prompt 融合扩展
 *
 * 功能特性：
 * 1. 唯一真实数据源：直接读取 Pi 的 prompts 目录（~/.pi/agent/prompts/ 与 .pi/prompts/）；
 * 2. 源码无硬编码：完全由外部 Markdown 文件的 Frontmatter 与正文动态驱动；
 * 3. 独立非侵入式 UI 卡片：前置/后置 Prompt 渲染为独立透明底边框卡片（无灰底），用户原输入居中保持原生独立展示与灰底；
 * 4. 纯净模型上下文：LLM 仅接收纯 Prompt 正文与用户指令，绝不包含任何 UI 标题（如 ↑ PREPEND PROMPT）；
 * 5. WSL + Zellij 兼容：通过底层全局按键监听与 registerShortcut 双重保障快捷键稳定唤出；
 * 6. 支持 settings.json 配置：可通过 srpPrompt.enabled 控制是否启用扩展/快捷键；
 * 7. 交互式 TUI 菜单：Space 多选、Tab 预览与视口滚动、Enter 确认、Esc 取消；
 * 8. 单次即焚生命周期：发送消息后自动重置，按 Prepend / Append 组装消息。
 *
 * settings.json 配置示例：
 * {
 *   "srpPrompt": {
 *     "enabled": true,
 *     "shortcuts": ["alt+s"]
 *   }
 * }
 *
 * 斜杠命令：
 *   - /srp-prompt
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
	visibleWidth,
} from "@earendil-works/pi-tui";

// ============================ 接口与配置 ============================

interface Snippet {
	/** 文件名，例如 "ask-questions.md" */
	id: string;
	/** 显示名称 */
	name: string;
	/** 描述说明 */
	description: string;
	/** 插入位置：前缀 (prepend) 或 后缀 (append) */
	placement: "prepend" | "append";
	/** 排序权重 */
	order: number;
	/** 提示词正文 */
	body: string;
}

interface SrpPromptConfig {
	enabled: boolean;
	shortcuts: string[];
}

const WIDGET_ID = "srp-prompt";

function loadPromptConfig(cwd?: string): SrpPromptConfig {
	const read = (path: string): Record<string, unknown> => {
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
			: ["alt+s"];

	return { enabled, shortcuts };
}

// ============================ 数据解析与加载 ============================

function parseSnippet(filename: string, raw: string): Snippet | null {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return null;

	const meta: Record<string, string> = {};
	for (const line of match[1].split(/\r?\n/)) {
		const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
		if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["']|["']$/g, "");
	}

	const name = meta.name || filename.replace(/\.md$/, "");
	const description = meta.description || "";
	const placement = meta.placement === "prepend" ? "prepend" : "append";
	const order = Number.parseInt(meta.order ?? "100", 10);
	const body = match[2].trim();

	return {
		id: filename,
		name,
		description,
		placement,
		order: Number.isNaN(order) ? 100 : order,
		body,
	};
}

function loadSnippets(cwd?: string): Snippet[] {
	const dirs: string[] = [];

	try {
		const globalPrompts = join(getAgentDir(), "prompts");
		if (existsSync(globalPrompts)) dirs.push(globalPrompts);
	} catch {}

	if (cwd) {
		const projectPrompts = join(cwd, CONFIG_DIR_NAME, "prompts");
		if (existsSync(projectPrompts)) dirs.push(projectPrompts);
	}

	const seen = new Map<string, Snippet>();

	for (const dir of dirs) {
		try {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".md")) continue;
				try {
					const raw = readFileSync(join(dir, file), "utf-8");
					const snippet = parseSnippet(file, raw);
					if (snippet) seen.set(file, snippet);
				} catch {}
			}
		} catch {}
	}

	return Array.from(seen.values()).sort((a, b) => {
		if (a.placement !== b.placement) return a.placement === "prepend" ? -1 : 1;
		if (a.order !== b.order) return a.order - b.order;
		return a.name.localeCompare(b.name);
	});
}

// ============================ UI 卡片组件 ============================

interface PromptCardData {
	snippets: {
		id: string;
		name: string;
		placement: "prepend" | "append";
		order: number;
		body: string;
	}[];
}

function buildPromptCardComponent(
	snippets: PromptCardData["snippets"],
	theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
) {
	const borderCol = (s: string) => theme.fg("borderAccent", s);
	const dim = (s: string) => theme.fg("dim", s);
	const bold = (s: string) => theme.bold(s);

	const titleText = ` PROMPT SNIPPETS (${snippets.length}) `;

	return {
		render(width: number): string[] {
			const effectiveWidth = Math.max(20, Math.min(width, 100));
			const innerW = effectiveWidth - 4;

			const titleVisW = visibleWidth(titleText);
			const topDashLen = Math.max(1, innerW - titleVisW);
			const topLine = borderCol("╭─") + bold(titleText) + borderCol("─".repeat(topDashLen) + "╮");
			const botLine = borderCol("╰" + "─".repeat(innerW + 2) + "╯");

			const lines: string[] = [];
			lines.push(topLine);

			snippets.forEach((item, idx) => {
				if (idx > 0) {
					lines.push(borderCol("├" + "─".repeat(innerW + 2) + "┤"));
				}
				const header = `● ${item.name}`;
				const headerVisW = visibleWidth(header);
				const headerPad = Math.max(0, innerW - headerVisW);
				lines.push(borderCol("│ ") + bold(header) + " ".repeat(headerPad) + borderCol(" │"));

				const bodyLines = item.body.split(/\r?\n/);
				for (const line of bodyLines) {
					if (!line.trim()) continue;
					for (const wrapped of wrapTextWithAnsi(line, innerW)) {
						const pad = Math.max(0, innerW - visibleWidth(wrapped));
						lines.push(borderCol("│ ") + dim(wrapped) + " ".repeat(pad) + borderCol(" │"));
					}
				}
			});

			lines.push(botLine);
			return lines.map((l) => truncateToWidth(l, width));
		},
		invalidate() {},
	};
}

// ============================ 扩展主体 ============================

export default function srpPromptExtension(pi: ExtensionAPI) {
	let enabled = new Set<string>();
	let snippets: Snippet[] = [];
	let lastCtx: ExtensionContext | null = null;
	let removeInputListener: (() => void) | null = null;
	let tuiHandle: any = null;

	function updateWidget(ctx: ExtensionContext) {
		const config = loadPromptConfig(ctx.cwd);
		if (!config.enabled || enabled.size === 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		ctx.ui.setWidget(WIDGET_ID, (tui, theme) => ({
			render(width: number): string[] {
				const active = snippets.filter((s) => enabled.has(s.id));
				if (active.length === 0) return [];

				const prepends = active.filter((s) => s.placement === "prepend");
				const appends = active.filter((s) => s.placement === "append");

				const parts: string[] = [];
				if (prepends.length > 0) {
					parts.push(theme.fg("accent", `↑ ${prepends.map((s) => s.name).join(", ")}`));
				}
				if (appends.length > 0) {
					parts.push(theme.fg("warning", `↓ ${appends.map((s) => s.name).join(", ")}`));
				}

				const text = `[Prompt: ${parts.join(" · ")}]`;
				return [truncateToWidth(text, width)];
			},
			invalidate() {},
		}));
	}

	function isShortcutKey(data: string): boolean {
		const config = loadPromptConfig(lastCtx?.cwd);
		if (!config.enabled) return false;
		for (const sc of config.shortcuts) {
			try {
				if (matchesKey(data, sc as any)) return true;
			} catch {}
			const norm = sc.toLowerCase().trim();
			if (
				norm === "alt+s" &&
				(data === "\x1bs" ||
					data === "\x1bS" ||
					data === "ß" ||
					matchesKey(data, Key.alt("s")) ||
					matchesKey(data, Key.alt("S")))
			) {
				return true;
			}
		}
		return false;
	}

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

	function ensureTuiAttached(ctx: ExtensionContext) {
		lastCtx = ctx;
		if (ctx.mode !== "tui" || tuiHandle) return;
		try {
			ctx.ui.setWidget("srp-prompt-tui-handle", (tui: any) => {
				tuiHandle = tui;
				if (!removeInputListener && tui?.addInputListener) {
					removeInputListener = tui.addInputListener(onGlobalInput);
				}
				return { render: () => [], invalidate: () => {} };
			});
		} catch {}
	}

	async function openMenu(ctx: ExtensionContext) {
		ensureTuiAttached(ctx);
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Prompt snippets 菜单仅在交互式 TUI 模式下可用", "warning");
			return;
		}

		const config = loadPromptConfig(ctx.cwd);
		if (!config.enabled) {
			ctx.ui.notify("srp-prompt 扩展已在 settings.json 中禁用 (srpPrompt.enabled = false)", "warning");
			return;
		}

		snippets = loadSnippets(ctx.cwd);
		enabled = new Set([...enabled].filter((id) => snippets.some((s) => s.id === id)));

		if (snippets.length === 0) {
			ctx.ui.notify("未在 prompts 目录中找到任何 prompt 文件", "warning");
			updateWidget(ctx);
			return;
		}

		const working = new Set(enabled);

		const confirmed = await ctx.ui.custom<boolean>((tui, theme, _keybindings, done) => {
			const prepends = snippets.filter((s) => s.placement === "prepend");
			const appends = snippets.filter((s) => s.placement === "append");
			const items = [...prepends, ...appends];

			let mode: "list" | "preview" = "list";
			let cursor = 0;
			let listScroll = 0;
			let previewScroll = 0;

			const itemRow = (snippet: Snippet, idx: number, width: number): string => {
				const pointer = idx === cursor ? theme.fg("accent", "> ") : "  ";
				const checkbox = working.has(snippet.id) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
				const desc = snippet.description ? theme.fg("dim", ` — ${snippet.description}`) : "";
				return truncateToWidth(`${pointer}${checkbox} ${theme.bold(snippet.name)}${desc}`, width);
			};

			const buildListRows = (width: number): { text: string; itemIndex: number | null }[] => {
				const rows: { text: string; itemIndex: number | null }[] = [];
				rows.push({ text: theme.fg("dim", "↑ PREPEND — 在消息前注入"), itemIndex: null });
				prepends.forEach((s, i) => rows.push({ text: itemRow(s, i, width), itemIndex: i }));
				rows.push({ text: "", itemIndex: null });
				rows.push({ text: theme.fg("dim", "↓ APPEND — 在消息后注入"), itemIndex: null });
				appends.forEach((s, i) => rows.push({ text: itemRow(s, prepends.length + i, width), itemIndex: prepends.length + i }));
				return rows;
			};

			const buildPreviewRows = (snippet: Snippet, width: number): string[] => {
				const rows: string[] = [];
				rows.push(truncateToWidth(theme.bold(snippet.name), width));
				rows.push(truncateToWidth(theme.fg("dim", `${snippet.placement} · order ${snippet.order} · ${snippet.id}`), width));
				rows.push(theme.fg("dim", "─".repeat(Math.min(width, 40))));
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
						above > 0 ? theme.fg("dim", `  ↑ ${above} 更多`) : "",
						...visible,
						below > 0 ? theme.fg("dim", `  ↓ ${below} 更多`) : "",
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
						title = "Prompt Snippets";
						hints = "↑↓ 导航 • Space 勾选 • Tab 预览正文 • Enter 确认 • Esc 取消";
					} else {
						const snippet = items[cursor];
						const rows = buildPreviewRows(snippet, width);
						const v = viewport(rows, previewScroll, maxView);
						content = v.out;
						previewScroll = v.scroll;
						title = `预览: ${snippet.name}`;
						hints = "↑↓ 滚动 • Tab/Esc 返回列表";
					}

					const innerW = width - 4;
					const titleVisW = visibleWidth(title);
					const hintsVisW = visibleWidth(hints);
					const titlePad = Math.max(0, innerW - titleVisW);
					const hintsPad = Math.max(0, innerW - hintsVisW);

					const rawLines = [
						theme.fg("border", `╭─ ${theme.bold(title)} ${"─".repeat(titlePad)}╮`),
						...content.map((l) => {
							const pad = Math.max(0, innerW - visibleWidth(l));
							return theme.fg("border", "│ ") + l + " ".repeat(pad) + theme.fg("border", " │");
						}),
						theme.fg("border", `├${"─".repeat(innerW + 2)}┤`),
						theme.fg("border", "│ ") + theme.fg("dim", hints) + " ".repeat(hintsPad) + theme.fg("border", " │"),
						theme.fg("border", `╰${"─".repeat(innerW + 2)}╯`),
					];

					return rawLines.map((line) => truncateToWidth(line, width));
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

	let pendingTurnSnippets: Snippet[] | null = null;

	// ============================ 注册独立卡片条目渲染器 ============================

	pi.registerEntryRenderer<PromptCardData>("srp-prompt-card", (entry, _options, theme) => {
		const data = entry.data;
		if (!data?.snippets || data.snippets.length === 0) return undefined;
		return buildPromptCardComponent(data.snippets, theme as any);
	});

	// ============================ 生命周期与事件 ============================

	pi.on("session_start", (_event, ctx) => {
		enabled = new Set();
		pendingTurnSnippets = null;
		snippets = loadSnippets(ctx.cwd);
		ensureTuiAttached(ctx);
		updateWidget(ctx);
	});

	pi.on("session_resume", (_event, ctx) => {
		ensureTuiAttached(ctx);
	});

	pi.on("agent_start", (_event, ctx) => {
		ensureTuiAttached(ctx);
	});

	pi.on("turn_start", (_event, ctx) => {
		ensureTuiAttached(ctx);
	});

	pi.on("session_shutdown", () => {
		removeInputListener?.();
		removeInputListener = null;
		tuiHandle = null;
	});

	// 用户发送消息时捕获切面并追加独立卡片条目
	pi.on("input", async (_event, ctx) => {
		const config = loadPromptConfig(ctx.cwd);
		if (!config.enabled || enabled.size === 0) return undefined;

		snippets = loadSnippets(ctx.cwd);
		const active = snippets.filter((s) => enabled.has(s.id));
		enabled = new Set();
		updateWidget(ctx);

		if (active.length === 0) return undefined;

		// 缓存当前 turn 给 LLM 注入的切面
		pendingTurnSnippets = active;

		// 向 Session 追加独立卡片 Entry（在用户消息之前写入，无任何 userMessageBg 灰底污染）
		pi.appendEntry<PromptCardData>("srp-prompt-card", {
			snippets: active.map((s) => ({
				id: s.id,
				name: s.name,
				placement: s.placement,
				order: s.order,
				body: s.body,
			})),
		});

		// 用户消息自身保持纯净
		return undefined;
	});

	// 在每次大模型调用前组装切面正文与用户原始输入
	pi.on("context", async (event, _ctx) => {
		if (!pendingTurnSnippets || pendingTurnSnippets.length === 0) return undefined;

		const active = pendingTurnSnippets;
		pendingTurnSnippets = null;

		const prepends = active.filter((s) => s.placement === "prepend");
		const appends = active.filter((s) => s.placement === "append");

		const messages = [...event.messages];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "user") {
				const originalText = typeof msg.content === "string" ? msg.content : "";
				const parts: string[] = [];

				if (prepends.length > 0) {
					parts.push(prepends.map((s) => s.body.trim()).join("\n\n"));
				}
				if (originalText.trim()) {
					parts.push(originalText.trim());
				}
				if (appends.length > 0) {
					parts.push(appends.map((s) => s.body.trim()).join("\n\n"));
				}

				messages[i] = {
					...msg,
					content: parts.join("\n\n"),
				};
				return { messages };
			}
		}

		return undefined;
	});

	// ============================ 命令与快捷键注册 ============================

	pi.registerCommand("srp-prompt", {
		description: "选择要注入到下一条消息的前置/后置 prompt 切面",
		handler: async (_args, ctx) => {
			await openMenu(ctx);
		},
	});

	const initialConfig = loadPromptConfig();
	if (initialConfig.enabled) {
		for (const sc of initialConfig.shortcuts) {
			const norm = sc.toLowerCase().trim();
			const keyId = norm === "alt+s" ? Key.alt("s") : (sc as any);
			pi.registerShortcut(keyId, {
				description: "打开 prompt 切面修饰符菜单",
				handler: async (ctx) => {
					await openMenu(ctx);
				},
			});
		}
	}
}
