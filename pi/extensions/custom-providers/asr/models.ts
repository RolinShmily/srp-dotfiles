import type { AsrModelDefinition } from "./types.ts";

export const DASHSCOPE_ASR_MODELS: AsrModelDefinition[] = [
  {
    id: "paraformer-realtime-v2",
    name: "Paraformer Realtime v2",
    provider: "dashscope",
    description: "Real-time speech recognition with high-accuracy punctuation and sentence segmentation (recommended).",
    sampleRate: 16000,
  },
  {
    id: "paraformer-8k-realtime-v1",
    name: "Paraformer 8k Realtime v1",
    provider: "dashscope",
    description: "8k narrowband telephony real-time speech recognition.",
    sampleRate: 8000,
  },
];
