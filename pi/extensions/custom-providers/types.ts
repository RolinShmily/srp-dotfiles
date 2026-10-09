import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import type { AsrModelDefinition } from "./asr/models.ts";

export interface ModalityProviderConfig {
  name?: string;
  baseUrl?: string;
  api?: string;
  headers?: Record<string, string>;
  models?: Record<string, unknown>[];
  images?: ProviderConfig["images"];
  classifiers?: ProviderConfig["classifiers"];
  asr?: AsrModelDefinition[];
}

export type ModalityProvidersRecord = Record<string, ModalityProviderConfig>;
