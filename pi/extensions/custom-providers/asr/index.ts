import { DASHSCOPE_ASR_MODELS } from "./models.ts";
import { createDashscopeAsrProvider } from "./handlers/dashscope.ts";
import type { AsrModelDefinition, StreamingAsrProvider } from "./types.ts";

export * from "./types.ts";
export * from "./models.ts";
export * from "./handlers/dashscope.ts";

export interface AsrProviderConfig {
  name: string;
  models: AsrModelDefinition[];
  createProvider: (modelId: string, apiKey: string) => StreamingAsrProvider;
}

export const asrProviders: Record<string, AsrProviderConfig> = {
  dashscope: {
    name: "Aliyun DashScope",
    models: DASHSCOPE_ASR_MODELS,
    createProvider: createDashscopeAsrProvider,
  },
};

export const ALL_ASR_MODELS: AsrModelDefinition[] = [
  ...DASHSCOPE_ASR_MODELS,
];

export function createAsrProvider(
  providerId: string,
  modelId: string,
  apiKey: string,
): StreamingAsrProvider {
  const provider = asrProviders[providerId];
  if (!provider) {
    throw new Error(`Unsupported ASR provider: ${providerId}`);
  }
  return provider.createProvider(modelId, apiKey);
}
