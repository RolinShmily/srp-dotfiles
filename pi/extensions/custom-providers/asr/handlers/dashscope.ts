import { randomUUID } from "node:crypto";
import type { StreamingAsrProvider, VoiceCallbacks } from "../types.ts";

export class DashscopeAsrProvider implements StreamingAsrProvider {
  private ws: WebSocket | null = null;
  private taskId: string = "";
  private lastSentenceMap = new Map<number, string>();
  private isCancelled = false;

  constructor(
    private model: string,
    private apiKey: string,
  ) {}

  async start(callbacks: VoiceCallbacks): Promise<void> {
    this.isCancelled = false;
    if (!this.apiKey) {
      throw new Error("DashScope API Key not found. Please run /login dashscope or set DASHSCOPE_API_KEY environment variable.");
    }

    this.taskId = randomUUID().replace(/-/g, "");
    this.lastSentenceMap.clear();

    const url = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    } as any);
    this.ws = ws;

    return new Promise((resolve, reject) => {
      let taskStarted = false;

      ws.addEventListener("open", () => {
        if (this.isCancelled) return;
        const startMsg = {
          header: {
            action: "run-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: {
            task_group: "audio",
            task: "asr",
            function: "recognition",
            model: this.model,
            parameters: {
              format: "pcm",
              sample_rate: 16000,
            },
            input: {},
          },
        };
        try {
          ws.send(JSON.stringify(startMsg));
        } catch {}
      });

      ws.addEventListener("message", (ev) => {
        if (this.isCancelled) return;
        try {
          const msg = JSON.parse(ev.data as string);
          const header = msg.header;
          if (header?.event === "task-started") {
            taskStarted = true;
            resolve();
          } else if (header?.event === "result-generated") {
            const sentences = msg.payload?.output?.sentence;
            if (Array.isArray(sentences)) {
              for (let i = 0; i < sentences.length; i++) {
                const s = sentences[i];
                if (s?.text && s.end_time !== undefined) {
                  if (!this.lastSentenceMap.has(i)) {
                    this.lastSentenceMap.set(i, s.text);
                    callbacks.onFinal(s.text.trim());
                  }
                }
              }
            }
          } else if (header?.event === "task-finished") {
            const sentences = msg.payload?.output?.sentence;
            if (Array.isArray(sentences)) {
              for (let i = 0; i < sentences.length; i++) {
                const s = sentences[i];
                if (s?.text && !this.lastSentenceMap.has(i)) {
                  this.lastSentenceMap.set(i, s.text);
                  callbacks.onFinal(s.text.trim());
                }
              }
            }
            callbacks.onClose();
          } else if (header?.event === "task-failed") {
            const err = new Error(header.error_message || "DashScope ASR task failed");
            if (!taskStarted) reject(err);
            else callbacks.onError(err);
          }
        } catch {}
      });

      ws.addEventListener("error", () => {
        if (this.isCancelled) return;
        const err = new Error("DashScope WebSocket connection error");
        if (!taskStarted) reject(err);
        else callbacks.onError(err);
      });

      ws.addEventListener("close", () => {
        if (this.isCancelled) return;
        callbacks.onClose();
      });
    });
  }

  sendAudio(chunk: Buffer): void {
    if (!this.isCancelled && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  async stop(): Promise<void> {
    if (!this.isCancelled && this.ws && this.ws.readyState === WebSocket.OPEN && this.taskId) {
      try {
        const finishMsg = {
          header: {
            action: "finish-task",
            task_id: this.taskId,
            streaming: "duplex",
          },
          payload: {
            input: {},
          },
        };
        this.ws.send(JSON.stringify(finishMsg));
      } catch {}
    }
  }

  cancel(): void {
    this.isCancelled = true;
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }
  }
}

export function createDashscopeAsrProvider(modelId: string, apiKey: string): StreamingAsrProvider {
  return new DashscopeAsrProvider(modelId, apiKey);
}
