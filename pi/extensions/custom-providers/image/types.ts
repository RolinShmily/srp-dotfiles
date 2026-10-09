export interface ImageModelDefinition {
  id: string;
  name: string;
  provider: "openrouter" | "dashscope" | string;
  description: string;
}

export interface GenerateImageContext {
  prompt: string;
  model: string;
  aspectRatio?: string;
  image?: string; // local file path or remote image url
  cwd?: string;
}

export interface GeneratedImageOutput {
  buffer: Buffer;
  mimeType: string;
  model: string;
  provider: string;
  revisedPrompt?: string;
}
