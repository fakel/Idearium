import { openAsBlob } from 'node:fs';
import path from 'node:path';
import { withRetry } from '../lib/retry.js';

export interface SttConfig {
  baseUrl: string;
  /** Token Bearer para proveedores externos (OpenAI, Groq, etc.). */
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
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
        isRetryable: (error) => !(error instanceof Error && /respondió 4\d\d/.test(error.message)),
      },
    );
  }
}
