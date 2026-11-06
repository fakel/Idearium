import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { withRetry } from '../lib/retry.js';
import type { UsageTracker } from './usage.service.js';

export interface SttConfig {
  baseUrl: string;
  /** Token Bearer para proveedores externos (OpenAI, Groq, etc.). */
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  usage?: UsageTracker;
}

export interface Transcription {
  text: string;
  language?: string;
  duration?: number;
}

interface SttResponse {
  text?: string;
  language?: string;
  duration?: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    seconds?: number;
  };
  detail?: string;
}

export class SttService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: SttConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async transcribe(filePath: string): Promise<Transcription> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/v1/audio/transcriptions`;
    const extension = path.extname(filePath).replace('.', '') || 'ogg';
    const blob = await openAsBlob(filePath, { type: 'application/octet-stream' });

    return withRetry(
      async () => {
        const form = new FormData();
        form.append('file', blob, path.basename(filePath));
        if (this.config.model) form.append('model', this.config.model);

        const response = await this.fetchImpl(url, {
          method: 'POST',
          body: form,
          headers: this.config.apiKey
            ? { Authorization: `Bearer ${this.config.apiKey}` }
            : undefined,
          signal: AbortSignal.timeout(this.config.timeoutMs),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`STT respondió ${response.status}: ${body.slice(0, 500)}`);
        }

        const data = (await response.json()) as SttResponse;
        await this.config.usage?.record({
          kind: 'stt',
          provider: this.config.baseUrl.includes('openrouter.ai') ? 'openrouter' : 'stt',
          model: this.config.model ?? 'default',
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
          costUsd: data.usage?.cost,
        });
        if (typeof data.text !== 'string' || data.text.trim() === '') {
          throw new Error(`STT no devolvió texto (${data.detail ?? 'respuesta vacía'}); archivo ${extension}.`);
        }

        return {
          text: data.text.trim(),
          language: data.language,
          duration: data.duration,
        };
      },
      {
        attempts: 2,
        baseDelayMs: 800,
        isRetryable: (error) => {
          if (!(error instanceof Error)) return true;
          const status = /respondió (\d{3})/.exec(error.message)?.[1];
          if (!status) return true;
          // 429/408 son transitorios; el resto de 4xx no se reintenta.
          return !status.startsWith('4') || status === '429' || status === '408';
        },
      },
    );
  }
}
