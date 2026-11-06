import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReasoningEffort } from '../config/env.js';
import type { UsageTracker } from './usage.service.js';

export interface OcrConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Modelo alternativo para reintentos y fallos del principal. */
  fallbackModel?: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  usage?: UsageTracker;
}

export interface OcrOptions {
  /** Fuerza un modelo concreto (por ejemplo, el alternativo). */
  model?: string;
  /** Usa solo el modelo alternativo. */
  useFallback?: boolean;
}

export interface OcrResult {
  text: string;
  model: string;
}

interface VisionResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string };
}

const prompt = [
  'Transcribe todo el contenido legible de la imagen en Markdown.',
  'Respeta la estructura visual: títulos, párrafos, listas, negritas, notas resaltadas y tablas.',
  'Si hay tablas, usa una tabla Markdown conservando todas las columnas, filas y celdas vacías;',
  'no omitas notas que aparezcan dentro de una celda.',
  'Conserva números, fechas, símbolos y saltos de línea tal como aparecen.',
  'No resumas, no expliques y no inventes. Si algo es ilegible, escribe [ilegible].',
  'Si no hay texto legible, responde exactamente: SIN_TEXTO',
].join(' ');

const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Extrae texto de una imagen usando modelos multimodales de OpenRouter. */
export class OcrService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OcrConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  get model(): string {
    return this.config.model;
  }

  get fallbackModel(): string | undefined {
    const fallback = this.config.fallbackModel?.trim();
    return fallback && fallback !== this.config.model ? fallback : undefined;
  }

  async extract(imagePath: string, options: OcrOptions = {}): Promise<OcrResult> {
    if (!this.config.apiKey) throw new Error('OPENROUTER_API_KEY no está configurada; no se puede hacer OCR.');
    if (!this.config.model) throw new Error('No hay modelo de visión configurado (OPENROUTER_VISION_MODEL).');

    const extension = path.extname(imagePath).toLowerCase();
    const mime = mimeTypes[extension];
    if (!mime) throw new Error(`Formato de imagen no soportado: ${extension || 'sin extensión'}.`);

    const models = options.model
      ? [options.model]
      : options.useFallback
        ? this.fallbackModel
          ? [this.fallbackModel]
          : []
        : [
            this.config.model,
            ...(this.fallbackModel ? [this.fallbackModel] : []),
          ];

    if (models.length === 0) {
      throw new Error('No hay modelo alternativo de visión configurado (OPENROUTER_VISION_FALLBACK_MODEL).');
    }

    const image = (await readFile(imagePath)).toString('base64');
    const errors: string[] = [];
    for (const model of models) {
      try {
        return await this.extractWithModel(image, mime, model);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${model}: ${message}`);
      }
    }

    if (errors.length === 1) throw new Error(errors[0]);
    throw new Error(`Todos los modelos de OCR fallaron:\n${errors.join('\n')}`);
  }

  private async extractWithModel(image: string, mime: string, model: string): Promise<OcrResult> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
          'x-title': 'Idearium',
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          usage: { include: true },
          ...(this.config.reasoningEffort ? { reasoning: { effort: this.config.reasoningEffort } } : {}),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
              ],
            },
          ],
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
      });
    } catch (error) {
      throw new Error(
        `No se pudo conectar con OpenRouter Vision (${model}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter Vision respondió ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as VisionResponse;
    await this.config.usage?.record({
      kind: 'ocr',
      provider: 'openrouter',
      model: data.model ?? model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      totalTokens: data.usage?.total_tokens,
      costUsd: data.usage?.cost,
    });
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(
        `OpenRouter Vision no devolvió texto (${data.error?.message ?? 'sin detalle'}).`,
      );
    }
    if (/^SIN_TEXTO\.?$/i.test(content)) {
      throw new Error('No se detectó texto legible en la imagen.');
    }

    return { text: content, model };
  }
}
