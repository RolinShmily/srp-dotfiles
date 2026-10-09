/**
 * prompt-snipaste.ts — Select prompt snippets for the next user message.
 * Open with /snipaste or Alt+S; snippets come from Pi's prompts directories.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
	visibleWidth,
} from "@earendil-works/pi-tui";

interface Snippet {
	id: string;
	name: string;
	description: string;
	placement: "prepend" | "append";
	order: number;
	body: string;
}

const WIDGET_ID = "prompt-snipaste";

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

function loadSnippets(cwd: string): Snippet[] {
	const dirs = [join(getAgentDir(), "prompts"), join(cwd, CONFIG_DIR_NAME, "prompts")];
	const seen = new Map<string, Snippet>();

	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		let files: string[];
		try {
			files = readdirSync(dir);
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error)) throw error;
			console.error(`Failed to read prompt directory ${dir}: ${error.message}`);
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".md")) continue;
			try {
				const snippet = parseSnippet(file, readFileSync(join(dir, file), "utf-8"));
				if (snippet) seen.set(file, snippet);
			} catch (error) {
				if (!(error instanceof Error) || !("code" in error)) throw error;
				console.error(`Failed to read prompt ${join(dir, file)}: ${error.message}`);
			}
		}
	}

	return Array.from(seen.values()).sort((a, b) => {
		if (a.placement !== b.placement) return a.placement === "prepend" ? -1 : 1;
		if (a.order !== b.order) return a.order - b.order;
		return a.name.localeCompare(b.name);
	});
}

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
	theme: Theme,
) {
	const borderCol = (s: string) => theme.fg("borderAccent", s);
	const dim = (s: string) => theme.fg("dim", s);
	const bold = (s: string) => theme.bold(s);

	const titleText = ` Prompt Snippets (${snippets.length}) `;

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

export default function promptSnipaste(pi: ExtensionAPI) {
	let enabled = new Set<string>();
	let snippets: Snippet[] = [];

	function updateWidget(ctx: ExtensionContext) {
		if (enabled.size === 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => ({
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

				const text = `[Prompts: ${parts.join(" · ")}]`;
				return [truncateToWidth(text, width)];
			},
			invalidate() {},
		}));
	}

	async function openMenu(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Prompt snippets menu is only available in interactive terminals", "warning");
			return;
		}

		snippets = loadSnippets(ctx.cwd);
		enabled = new Set([...enabled].filter((id) => snippets.some((s) => s.id === id)));

		if (snippets.length === 0) {
			ctx.ui.notify("No Markdown files found in prompt directories", "warning");
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
				rows.push({ text: theme.fg("dim", "↑ Prepend Prompts"), itemIndex: null });
				prepends.forEach((s, i) => rows.push({ text: itemRow(s, i, width), itemIndex: i }));
				rows.push({ text: "", itemIndex: null });
				rows.push({ text: theme.fg("dim", "↓ Append Prompts"), itemIndex: null });
				appends.forEach((s, i) => rows.push({ text: itemRow(s, prepends.length + i, width), itemIndex: prepends.length + i }));
				return rows;
			};

			const buildPreviewRows = (snippet: Snippet, width: number): string[] => {
				const rows: string[] = [];
				rows.push(truncateToWidth(theme.bold(snippet.name), width));
				rows.push(truncateToWidth(theme.fg("dim", `${snippet.placement === "prepend" ? "Prepend" : "Append"} · Order ${snippet.order} · ${snippet.id}`), width));
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
						above > 0 ? theme.fg("dim", `  ↑ ${above} more`) : "",
						...visible,
						below > 0 ? theme.fg("dim", `  ↓ ${below} more`) : "",
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
						hints = "↑↓ Navigate • Space Select • Tab Preview • Enter Confirm • Esc Cancel";
					} else {
						const snippet = items[cursor];
						const rows = buildPreviewRows(snippet, width);
						const v = viewport(rows, previewScroll, maxView);
						content = v.out;
						previewScroll = v.scroll;
						title = `Preview: ${snippet.name}`;
						hints = "↑↓ Scroll • Tab/Esc Back to list";
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

	pi.registerEntryRenderer<PromptCardData>("prompt-snipaste-card", (entry, _options, theme) => {
		const data = entry.data;
		if (!data?.snippets || data.snippets.length === 0) return undefined;
		return buildPromptCardComponent(data.snippets, theme);
	});

	pi.on("session_start", (_event, ctx) => {
		enabled = new Set();
		pendingTurnSnippets = null;
		snippets = loadSnippets(ctx.cwd);
		updateWidget(ctx);
	});

	pi.on("input", async (_event, ctx) => {
		if (enabled.size === 0) return undefined;

		snippets = loadSnippets(ctx.cwd);
		const active = snippets.filter((s) => enabled.has(s.id));
		enabled = new Set();
		updateWidget(ctx);

		if (active.length === 0) return undefined;

		pendingTurnSnippets = active;

		pi.appendEntry<PromptCardData>("prompt-snipaste-card", {
			snippets: active.map((s) => ({
				id: s.id,
				name: s.name,
				placement: s.placement,
				order: s.order,
				body: s.body,
			})),
		});

		return undefined;
	});

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

	pi.registerCommand("snipaste", {
		description: "Select prepended or appended prompt snippets to inject into the next message",
		handler: (_args, ctx) => openMenu(ctx),
	});

	pi.registerShortcut(Key.alt("s"), {
		description: "Open prompt snippets menu",
		handler: (ctx) => openMenu(ctx),
	});
}
