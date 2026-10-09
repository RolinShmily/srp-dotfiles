/**
 * Register custom providers through Pi's native model and /login APIs.
 * Organizes models and providers by Pi's core model types: chat, image, classifier, and asr.
 * Credentials belong in Pi's auth.json, not here.
 */

import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { chatProviders } from "./chat/index.ts";
import { imageProviders } from "./image/index.ts";
import { classifierProviders } from "./classifier/index.ts";
import { asrProviders } from "./asr/index.ts";

export { asrProviders, ALL_ASR_MODELS } from "./asr/index.ts";

export default function customProviders(pi: ExtensionAPI): void {
  const providerIds = new Set<string>([
    ...Object.keys(chatProviders),
    ...Object.keys(imageProviders),
    ...Object.keys(classifierProviders),
    ...Object.keys(asrProviders),
  ]);

  for (const id of providerIds) {
    const chat = chatProviders[id];
    const image = imageProviders[id];
    const classifier = classifierProviders[id];
    const asr = asrProviders[id];

    const config: ProviderConfig = {
      name: chat?.name ?? image?.name ?? classifier?.name ?? asr?.name ?? id,
      baseUrl: chat?.baseUrl ?? image?.baseUrl ?? classifier?.baseUrl,
      api: (chat?.api ?? "openai-completions") as any,
      models: [
        ...(chat?.models ?? []),
        ...(image?.models ?? []),
        ...(classifier?.models ?? []),
      ],
      ...(image?.images || chat?.images || classifier?.images
        ? { images: { ...chat?.images, ...image?.images, ...classifier?.images } }
        : {}),
      ...(classifier?.classifiers || chat?.classifiers || image?.classifiers
        ? { classifiers: { ...chat?.classifiers, ...image?.classifiers, ...classifier?.classifiers } }
        : {}),
    };

    pi.registerProvider(id, config);
  }
}
