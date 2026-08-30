import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_DIR_NAME = ".pi";

export interface ConfiguredModel {
  provider?: string;
  id?: string;
  thinking?: ModelThinkingLevel;
}

export interface Config {
  /** Whether new sessions start with observational memory enabled. */
  defaultEnabled: boolean;
  /** Raw-history token size of one observation chunk (fixed boundary). */
  chunkTokens: number;
  /** Overlap between adjacent chunks; default 0 in v1. */
  chunkOverlapTokens: number;
  /** Target size of the active observation pool; the buffer drains back toward this after consolidation. */
  poolTargetTokens: number;
  /** Active-pool token count that triggers a consolidation (150% - 200% of target). */
  consolidateAtPoolTokens: number;
  /** Live context-window usage that triggers compaction. */
  compactAtContextTokens: number;
  /** Verbatim raw tail kept after the cutoff; snaps to a chunk boundary. */
  tailTokens: number;
  /**
   * Target size of `.memory/JOURNEY.md`, the running descriptive project history the
   * consolidator appends to and pushes into every compaction block.
   */
  journeyTargetTokens: number;
  /** Max simultaneous in-flight observer subprocesses. */
  observerConcurrency: number;
  models: {
    observer: ConfiguredModel;
    consolidator: ConfiguredModel;
  };
  /** Resume the agent automatically after a mid-run compaction. */
  resumeAfterMidRunCompaction: boolean;
  /** Power-user setting: disable all triggers (distinct from the on/off gate). */
  passive: boolean;
  /** Emit the NDJSON debug log. */
  debugLog: boolean;
}

export const DEFAULTS: Config = {
  defaultEnabled: false,
  chunkTokens: 10_000,
  chunkOverlapTokens: 0,
  poolTargetTokens: 10_000,
  consolidateAtPoolTokens: 15_000,
  compactAtContextTokens: 150_000,
  tailTokens: 20_000,
  journeyTargetTokens: 1_000,
  observerConcurrency: 4,
  resumeAfterMidRunCompaction: true,
  models: {
    observer: { thinking: "low" },
    consolidator: { thinking: "medium" },
  },
  passive: false,
  debugLog: false,
};

const THINKING_LEVEL_VALUES: readonly ModelThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

const SETTINGS_KEYS = ["srpMemory", "srp-memory", "observational-memory"] as const;
const PASSIVE_ENV = "PI_OM_PASSIVE";

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined;
}

function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
  return typeof value === "string" && (THINKING_LEVEL_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeModel(value: unknown, fallback: ConfiguredModel): ConfiguredModel {
  if (!isRecord(value)) return fallback;
  const provider = nonEmptyString(value.provider) ?? fallback.provider;
  const id = nonEmptyString(value.id) ?? fallback.id;
  const model: ConfiguredModel = {};
  if (provider) model.provider = provider;
  if (id) model.id = id;
  const thinking = isThinkingLevel(value.thinking) ? value.thinking : fallback.thinking;
  if (thinking) model.thinking = thinking;
  return model;
}

export function resolveEffectiveModel(
  configured?: ConfiguredModel,
  sessionModel?: { provider?: string; id?: string },
): { provider: string; id: string; thinking?: ModelThinkingLevel } {
  const provider = configured?.provider || sessionModel?.provider || "antigravity";
  const id = configured?.id || sessionModel?.id || "gemini-3.7-flash";
  return {
    provider,
    id,
    thinking: configured?.thinking,
  };
}

function normalizeSettingsConfig(value: Record<string, unknown>, base: Config): Partial<Config> {
  const normalized: Partial<Config> = {};
  if (typeof value.default_enabled === "boolean") {
    normalized.defaultEnabled = value.default_enabled;
  }
  const numberKeys = [
    "chunkTokens",
    "chunkOverlapTokens",
    "poolTargetTokens",
    "consolidateAtPoolTokens",
    "compactAtContextTokens",
    "tailTokens",
    "journeyTargetTokens",
    "observerConcurrency",
  ] as const;
  for (const key of numberKeys) {
    const normalizedValue = positiveIntegerOrUndefined(value[key]);
    if (normalizedValue !== undefined) normalized[key] = normalizedValue;
  }
  if (value.chunkOverlapTokens === 0) normalized.chunkOverlapTokens = 0;
  if (typeof value.resumeAfterMidRunCompaction === "boolean") {
    normalized.resumeAfterMidRunCompaction = value.resumeAfterMidRunCompaction;
  }
  if (typeof value.passive === "boolean") normalized.passive = value.passive;
  if (typeof value.debugLog === "boolean") normalized.debugLog = value.debugLog;
  if (isRecord(value.models)) {
    normalized.models = {
      observer: normalizeModel(value.models.observer, base.models.observer),
      consolidator: normalizeModel(value.models.consolidator, base.models.consolidator),
    };
  }
  return normalized;
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function findSection(settings: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const key of SETTINGS_KEYS) {
    if (isRecord(settings[key])) {
      return settings[key] as Record<string, unknown>;
    }
  }
  return undefined;
}

export function loadConfig(cwd: string = process.cwd()): Config {
  let merged: Config = {
    ...DEFAULTS,
    models: {
      observer: { ...DEFAULTS.models.observer },
      consolidator: { ...DEFAULTS.models.consolidator },
    },
  };

  const globalSettings = readJsonFile(join(getAgentDir(), "settings.json"));
  const globalSection = findSection(globalSettings);
  if (globalSection) {
    const globalNormalized = normalizeSettingsConfig(globalSection, merged);
    merged = { ...merged, ...globalNormalized };
  }

  const projectSettings = readJsonFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));
  const projectSection = findSection(projectSettings);
  if (projectSection) {
    const projectNormalized = normalizeSettingsConfig(projectSection, merged);
    merged = { ...merged, ...projectNormalized };
  }

  // Environment variable overrides
  if (process.env[PASSIVE_ENV] === "1" || process.env[PASSIVE_ENV]?.toLowerCase() === "true") {
    merged.passive = true;
  }

  if (process.env.PI_OM_OBSERVER_PROVIDER) {
    merged.models.observer.provider = process.env.PI_OM_OBSERVER_PROVIDER;
  }
  if (process.env.PI_OM_OBSERVER_MODEL) {
    merged.models.observer.id = process.env.PI_OM_OBSERVER_MODEL;
  }
  if (isThinkingLevel(process.env.PI_OM_OBSERVER_THINKING)) {
    merged.models.observer.thinking = process.env.PI_OM_OBSERVER_THINKING as ModelThinkingLevel;
  }

  if (process.env.PI_OM_CONSOLIDATOR_PROVIDER) {
    merged.models.consolidator.provider = process.env.PI_OM_CONSOLIDATOR_PROVIDER;
  }
  if (process.env.PI_OM_CONSOLIDATOR_MODEL) {
    merged.models.consolidator.id = process.env.PI_OM_CONSOLIDATOR_MODEL;
  }
  if (isThinkingLevel(process.env.PI_OM_CONSOLIDATOR_THINKING)) {
    merged.models.consolidator.thinking = process.env.PI_OM_CONSOLIDATOR_THINKING as ModelThinkingLevel;
  }

  return merged;
}
