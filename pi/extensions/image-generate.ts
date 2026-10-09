/**
 * image-generate.ts — Image generation tool and model selector.
 *
 * Provides:
 * 1. Tool `image_generate`: Tool call for generating images with local disk persistence.
 *    Delegates generation to adapters in custom-providers/image (DashScope and OpenRouter).
 * 2. Command `/image-generate model`: Interactive model picker matching Pi's native model selector UI.
 */

import { existsSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  type ExtensionAPI,
  type ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  Spacer,
  Text,
  fuzzyFilter,
  getKeybindings,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
  fetchAllAvailableImageModels,
  generateImage,
  resolveImageModel,
  type ImageModelDefinition,
} from "./custom-providers/image/index.ts";

// ============================ Constants ============================

const DEFAULT_MODEL = "google/gemini-3.1-flash-image";
const DEFAULT_OUTPUT_DIR = ".pi/generated-images";
const DEFAULT_TIMEOUT_MS = 120_000;

let currentModel = DEFAULT_MODEL;

/** Image models known to Pi: OpenRouter's built-in catalog plus our DashScope registration. */
function registryImageModels(ctx: { modelRegistry: { getModelsOfType(type: string): readonly any[] } }) {
  return ctx.modelRegistry.getModelsOfType("image") as readonly { id: string; name?: string; provider: string }[];
}

/** Resolve which provider owns a model id, preferring the Pi registry over heuristics. */
function resolveProviderId(
  ctx: { modelRegistry: { getModelsOfType(type: string): readonly any[] } },
  modelId: string,
): string {
  const lower = modelId.toLowerCase();
  const known = registryImageModels(ctx).find((m) => m.id.toLowerCase() === lower);
  if (known) return known.provider;
  return lower.startsWith("qwen-image") ? "dashscope" : "openrouter";
}

// ============================ File Operations ============================

function detectExtension(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    default:
      return ".png";
  }
}

async function saveImageAtomically(cwd: string, buffer: Buffer, mimeType: string): Promise<string> {
  const outputDir = resolve(cwd, DEFAULT_OUTPUT_DIR);
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const date = new Date().toISOString().replace(/T/, "-").replace(/:/g, "").slice(0, 15);
  const ext = detectExtension(mimeType);

  for (let i = 1; i <= 999; i++) {
    const filename = `${date}-${String(i).padStart(3, "0")}${ext}`;
    const targetPath = join(outputDir, filename);
    try {
      const handle = await open(targetPath, "wx");
      await handle.writeFile(buffer);
      await handle.close();
      return targetPath;
    } catch (err: any) {
      if (err?.code === "EEXIST") continue;
      throw err;
    }
  }

  const fallback = join(outputDir, `${date}-${Date.now()}${ext}`);
  await writeFile(fallback, buffer);
  return fallback;
}

// ============================ Searchable Model Selector TUI ============================

class SearchableImageModelSelectorComponent extends Container {
  private searchInput: Input;
  private listContainer: Container;
  private selectedIndex = 0;
  private filteredModels: ImageModelDefinition[] = [];
  private _focused = true;

  get focused() {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  constructor(
    private tui: any,
    private theme: any,
    private title: string,
    private models: ImageModelDefinition[],
    private currentModelId: string,
    private onSelect: (model: ImageModelDefinition) => void,
    private onCancel: () => void,
    private getLoginStatus?: (provider: string) => boolean,
  ) {
    super();
    this.filteredModels = [...models];
    const curIdx = models.findIndex((m) => m.id === currentModelId);
    this.selectedIndex = curIdx >= 0 ? curIdx : 0;

    this.searchInput = new Input();
    this.searchInput.focused = true;
    this.listContainer = new Container();

    this.updateList();
  }

  filterModels(query: string) {
    const q = query.trim().toLowerCase();
    if (q) {
      this.filteredModels = fuzzyFilter(
        this.models,
        q,
        (m) => `${m.id} ${m.name} ${m.provider} ${m.description}`,
      );
    } else {
      this.filteredModels = [...this.models];
    }
    this.selectedIndex = q ? 0 : Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
    this.updateList();
    this.tui.requestRender?.();
  }

  updateList() {
    this.listContainer.clear();
    const maxVisible = 6;
    const total = this.filteredModels.length;

    if (total === 0) {
      this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching models"), 0, 0));
      return;
    }

    const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), total - maxVisible));
    const endIndex = Math.min(startIndex + maxVisible, total);

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredModels[i];
      const isSelected = i === this.selectedIndex;
      const isCurrent = item.id === this.currentModelId;

      const cursor = isSelected ? this.theme.fg("accent", "→ ") : "  ";
      const check = isCurrent ? this.theme.fg("accent", "✓ ") : "  ";
      const modelText = isSelected
        ? this.theme.fg("accent", this.theme.bold ? this.theme.bold(item.id) : item.id)
        : this.theme.fg("text", item.id);
      const providerBadge = this.theme.fg("muted", `[${item.provider}]`);

      let authBadge = "";
      if (this.getLoginStatus) {
        const loggedIn = this.getLoginStatus(item.provider);
        authBadge = loggedIn
          ? this.theme.fg("dim", " · logged in")
          : this.theme.fg("warning", ` · not logged in: /login ${item.provider}`);
      }

      const line = `${cursor}${check}${modelText} ${providerBadge}${authBadge}`;
      this.listContainer.addChild(new Text(line, 0, 0));
    }

    if (startIndex > 0 || endIndex < total) {
      const scrollInfo = this.theme.fg("muted", `  (${this.selectedIndex + 1}/${total})`);
      this.listContainer.addChild(new Text(scrollInfo, 0, 0));
    }

    const selected = this.filteredModels[this.selectedIndex];
    if (selected) {
      this.listContainer.addChild(new Spacer(1));
      this.listContainer.addChild(
        new Text(this.theme.fg("muted", `  Model: ${selected.name} — ${selected.description}`), 0, 0),
      );
    }
  }

  render(width: number): string[] {
    this.clear();
    const border = this.theme.fg("accent", "─".repeat(Math.max(10, width)));

    this.addChild(new Text(border, 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg("accent", this.theme.bold ? this.theme.bold(`  ${this.title}`) : `  ${this.title}`), 0, 0));
    this.addChild(new Spacer(1));
    this.addChild(this.searchInput);
    this.addChild(new Spacer(1));
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg("dim", "  Enter to select · Escape to cancel"), 0, 0));
    this.addChild(new Text(border, 0, 0));

    return super.render(width);
  }

  handleInput(keyData: string) {
    const kb = getKeybindings();
    if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === 0 ? this.filteredModels.length - 1 : this.selectedIndex - 1;
      this.updateList();
      this.tui.requestRender?.();
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      if (this.filteredModels.length === 0) return;
      this.selectedIndex = this.selectedIndex === this.filteredModels.length - 1 ? 0 : this.selectedIndex + 1;
      this.updateList();
      this.tui.requestRender?.();
    } else if (kb.matches(keyData, "tui.select.confirm") || keyData === "\n" || keyData === "\r") {
      const selected = this.filteredModels[this.selectedIndex];
      if (selected) {
        this.onSelect(selected);
      }
    } else if (kb.matches(keyData, "tui.select.cancel") || keyData === "\x1b" || keyData === "\x03") {
      this.onCancel();
    } else {
      this.searchInput.handleInput(keyData);
      this.filterModels(this.searchInput.getValue());
    }
  }
}

// ============================ Extension Entrypoint ============================

export default function imageGenerate(pi: ExtensionAPI): void {
  // 1. Slash command: /image-generate model [name]
  pi.registerCommand("image-generate", {
    description: "Switch default image generation model (/image-generate model [name])",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const trimmed = prefix.trimStart();
      if (!trimmed || "model".startsWith(trimmed)) {
        return [{ value: "model", label: "model", description: "Select image generation model in TUI" }];
      }
      return null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || "").toLowerCase();

      const models = await fetchAllAvailableImageModels(registryImageModels(ctx), ctx.signal);

      // Case: direct model slug provided
      if (sub === "model" && parts[1]) {
        const resolved = resolveImageModel(parts.slice(1).join(" "), models);
        currentModel = resolved;
        ctx.ui.notify(`Default image model set to: ${resolved}`, "info");
        return;
      }

      // Case: bare command or /image-generate model -> open interactive selector
      if (sub === "model" || parts.length === 0) {
        // Detect login status for each provider
        const loginStatusMap = new Map<string, boolean>();
        for (const m of models) {
          if (!loginStatusMap.has(m.provider)) {
            const key = await ctx.modelRegistry.getApiKeyForProvider(m.provider);
            loginStatusMap.set(
              m.provider,
              Boolean(key) || Boolean(process.env[`${m.provider.toUpperCase()}_API_KEY`]),
            );
          }
        }

        const chosenModel = await ctx.ui.custom<ImageModelDefinition | undefined>((tui, theme, _kb, done) => {
          return new SearchableImageModelSelectorComponent(
            tui,
            theme,
            "Select Image Generation Model",
            models,
            currentModel,
            (model) => done(model),
            () => done(undefined),
            (provider) => loginStatusMap.get(provider) ?? false,
          );
        });

        if (!chosenModel) return;

        currentModel = chosenModel.id;
        const isLogged = loginStatusMap.get(chosenModel.provider);
        const extra = isLogged ? "" : ` (No key detected: please run /login ${chosenModel.provider})`;
        ctx.ui.notify(`Default image model set to: ${chosenModel.name} (${chosenModel.id})${extra}`, "info");
        return;
      }

      // Unknown arguments: report usage instead of silently doing nothing
      ctx.ui.notify(
        `Unknown argument: ${parts.join(" ")}. Usage: /image-generate [model] [name]`,
        "warning",
      );
    },
  });

  // 2. Tool: image_generate (English Schema)
  pi.registerTool({
    name: "image_generate",
    description:
      "Generate an image from a text prompt using OpenRouter or DashScope. Saves the generated image to local disk and returns the file path.",
    parameters: Type.Object({
      prompt: Type.String({
        description: "The text prompt describing the image to generate.",
      }),
      model: Type.Optional(
        Type.String({
          description:
            "Optional model slug (e.g. 'google/gemini-3.1-flash-image', 'qwen-image-3.0-pro', 'black-forest-labs/flux.2-pro'). Defaults to current default model.",
        }),
      ),
      aspectRatio: Type.Optional(
        Type.String({
          description: "Optional aspect ratio for the image (e.g., '1:1', '16:9', '9:16', '4:3', '3:4').",
        }),
      ),
      image: Type.Optional(
        Type.String({
          description: "Optional local file path or remote image URL for image-to-image reference.",
        }),
      ),
    }),
    execute: async (_toolCallId, params, signal, ctx) => {
      const targetModel = params.model
        ? resolveImageModel(params.model, registryImageModels(ctx))
        : currentModel;
      const timeoutSig = AbortSignal.any([AbortSignal.timeout(DEFAULT_TIMEOUT_MS), ...(signal ? [signal] : [])]);

      const providerId = resolveProviderId(ctx, targetModel);
      const apiKey =
        (await ctx.modelRegistry.getApiKeyForProvider(providerId)) ||
        process.env[`${providerId.toUpperCase()}_API_KEY`];

      if (!apiKey) {
        return {
          content: [
            {
              type: "text",
              text: `Error: No ${providerId} API key found. Please run '/login ${providerId}' or set ${providerId.toUpperCase()}_API_KEY environment variable.`,
            },
          ],
          isError: true,
        };
      }

      try {
        const res = await generateImage(
          {
            prompt: params.prompt,
            model: targetModel,
            aspectRatio: params.aspectRatio,
            image: params.image,
            cwd: ctx.cwd,
          },
          { apiKey, provider: providerId, signal: timeoutSig, cwd: ctx.cwd },
        );

        const savedPath = await saveImageAtomically(ctx.cwd, res.buffer, res.mimeType);

        return {
          content: [
            {
              type: "text",
              text: `Image successfully generated using '${res.model}'.\nSaved to: ${savedPath}`,
            },
          ],
          details: {
            model: res.model,
            provider: res.provider,
            savedPath,
            prompt: params.prompt,
            revisedPrompt: res.revisedPrompt,
          },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Image generation failed: ${err?.message ?? String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
    renderCall(args, theme) {
      const { prompt, model } = args as { prompt?: string; model?: string };
      const displayModel = model || currentModel;
      const preview = prompt ? (prompt.length > 50 ? prompt.slice(0, 47) + "..." : prompt) : "";
      return new Text(
        theme.fg("toolTitle", theme.bold("generate_image ")) +
          theme.fg("dim", `[${displayModel}] `) +
          theme.fg("accent", `"${preview}"`),
      );
    },
  });
}
