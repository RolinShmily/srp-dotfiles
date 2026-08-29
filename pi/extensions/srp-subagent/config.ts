/**
 * srp-subagent/config.ts — SRP Subagent 配置加载与管理模块。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const CONFIG_DIR_NAME = ".pi";

export type MuxType = "auto" | "zellij" | "tmux";

export interface SrpSubagentConfig {
  enabled: boolean;
  mux: MuxType;
  statusWidget: boolean;
  shellReadyDelayMs: number;
  zellijMinColumns: number;
  zellijMinRows: number;
}

export type SrpAgentConfig = SrpSubagentConfig;

const DEFAULT_CONFIG: SrpSubagentConfig = {
  enabled: true,
  mux: "auto",
  statusWidget: true,
  shellReadyDelayMs: 500,
  zellijMinColumns: 45,
  zellijMinRows: 10,
};

function readSettingsFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    const parsed = JSON.parse(readFileSync(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function readConfig(cwd: string = process.cwd()): SrpSubagentConfig {
  const global = readSettingsFile(join(getAgentDir(), "settings.json"));
  const project = readSettingsFile(join(cwd, CONFIG_DIR_NAME, "settings.json"));

  const globalSection =
    ((global.srpSubagent || global.srpAgent) as Record<string, unknown>) || {};
  const projectSection =
    ((project.srpSubagent || project.srpAgent) as Record<string, unknown>) || {};
  const merged = { ...globalSection, ...projectSection };

  const enabled = merged.enabled !== false;
  
  let mux: MuxType = "auto";
  const rawMux = String(merged.mux || process.env.PI_SUBAGENT_MUX || "").trim().toLowerCase();
  if (rawMux === "zellij" || rawMux === "tmux" || rawMux === "auto") {
    mux = rawMux as MuxType;
  }

  const statusWidget = merged.statusWidget !== false;

  let shellReadyDelayMs = DEFAULT_CONFIG.shellReadyDelayMs;
  if (typeof merged.shellReadyDelayMs === "number" && merged.shellReadyDelayMs >= 0) {
    shellReadyDelayMs = merged.shellReadyDelayMs;
  } else if (process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS) {
    const envVal = Number(process.env.PI_SUBAGENT_SHELL_READY_DELAY_MS);
    if (!Number.isNaN(envVal) && envVal >= 0) {
      shellReadyDelayMs = envVal;
    }
  }

  let zellijMinColumns = DEFAULT_CONFIG.zellijMinColumns;
  if (typeof merged.zellijMinColumns === "number" && merged.zellijMinColumns > 0) {
    zellijMinColumns = merged.zellijMinColumns;
  } else if (process.env.PI_SUBAGENT_ZELLIJ_MIN_COLUMNS) {
    const envVal = Number(process.env.PI_SUBAGENT_ZELLIJ_MIN_COLUMNS);
    if (!Number.isNaN(envVal) && envVal > 0) {
      zellijMinColumns = envVal;
    }
  }

  let zellijMinRows = DEFAULT_CONFIG.zellijMinRows;
  if (typeof merged.zellijMinRows === "number" && merged.zellijMinRows > 0) {
    zellijMinRows = merged.zellijMinRows;
  } else if (process.env.PI_SUBAGENT_ZELLIJ_MIN_ROWS) {
    const envVal = Number(process.env.PI_SUBAGENT_ZELLIJ_MIN_ROWS);
    if (!Number.isNaN(envVal) && envVal > 0) {
      zellijMinRows = envVal;
    }
  }

  return {
    enabled,
    mux,
    statusWidget,
    shellReadyDelayMs,
    zellijMinColumns,
    zellijMinRows,
  };
}
