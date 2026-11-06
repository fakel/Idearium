import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReasoningEffort } from '../config/env.js';

export interface OcrConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OcrResult {
  text: string;
  model: string;
}

interface VisionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

const prompt = [
  'Transcribe literalmente todo el texto legible de la imagen.',
  'Conserva los saltos de línea, las viñetas y los números tal como aparecen.',
  'No añadas explicaciones, títulos, markdown ni texto que no esté en la imagen.',
  'Si no hay texto legible, responde exactamente: SIN_TEXTO',
].join(' ');

const mimeTypes: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** Extrae texto de una imagen usando un modelo multimodal de OpenRouter. */
export class OcrService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OcrConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async extract(imagePath: string): Promise<OcrResult> {
    if (!this.config.apiKey) throw new Error('OPENROUTER_API_KEY no está configurada; no se puede hacer OCR.');
    if (!this.config.model) throw new Error('No hay modelo de visión configurado (OPENROUTER_VISION_MODEL).');

    const extension = path.extname(imagePath).toLowerCase();
    const mime = mimeTypes[extension];
    if (!mime) throw new Error(`Formato de imagen no soportado: ${extension || 'sin extensión'}.`);

    const image = (await readFile(imagePath)).toString('base64');
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
          model: this.config.model,
          temperature: 0,
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
        `No se pudo conectar con OpenRouter Vision: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenRouter Vision respondió ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as VisionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(
        `OpenRouter Vision no devolvió texto (${data.error?.message ?? 'sin detalle'}).`,
      );
    }
    if (/^SIN_TEXTO\.?$/i.test(content)) {
      throw new Error('No se detectó texto legible en la imagen.');
    }

    return { text: content, model: this.config.model };
  }
}
