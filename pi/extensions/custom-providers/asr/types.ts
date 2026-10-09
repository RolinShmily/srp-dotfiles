export interface AsrModelDefinition {
  id: string;
  name: string;
  provider: string;
  description: string;
  sampleRate?: number;
}

export interface VoiceCallbacks {
  onFinal(text: string): void;
  onError(err: Error): void;
  onClose(): void;
}

export interface StreamingAsrProvider {
  start(callbacks: VoiceCallbacks): Promise<void>;
  sendAudio(chunk: Buffer): void;
  stop(): Promise<void>;
  cancel(): void;
}
