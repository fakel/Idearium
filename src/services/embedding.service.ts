import { ProviderError } from './llm.service.js';

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingConfig {
  baseUrl: string;
  model: string;
  dimension: number;
  timeoutMs: number;
}

export interface RemoteEmbeddingConfig extends EmbeddingConfig {
  apiKey: string;
  /** Human-readable provider name for errors. */
  providerName?: string;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

/**
 * Batch embeddings through Ollama `/api/embed`.
 * Kept independent from the LLM router: vectors always stay local.
 */
export class OllamaEmbeddingService implements Embedder {
  constructor(private readonly config: EmbeddingConfig) {}

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/api/embed`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, input: texts, truncate: true }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(
        `No se pudo conectar con Ollama para embeddings: ${error instanceof Error ? error.message : String(error)}`,
        'ollama-embed',
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        `Ollama embeddings respondió ${response.status}: ${body.slice(0, 500)}`,
        'ollama-embed',
        response.status,
      );
    }

    const data = (await response.json()) as OllamaEmbedResponse;
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new ProviderError(
        `Ollama embeddings devolvió ${data.embeddings?.length ?? 0} vectores para ${texts.length} textos (${data.error ?? 'sin detalle'}).`,
        'ollama-embed',
      );
    }

    for (const vector of data.embeddings) {
      if (vector.length !== this.config.dimension) {
        throw new ProviderError(
          `Dimensión de embedding inesperada: ${vector.length} (esperada ${this.config.dimension}). Ajusta EMBEDDING_DIM o el modelo.`,
          'ollama-embed',
        );
      }
    }

    return data.embeddings;
  }
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  error?: { message?: string };
}

/**
 * Batch embeddings through an OpenAI-compatible `/embeddings` endpoint.
 * OpenRouter exposes `baai/bge-m3` (1024 dims), so the local schema does not change.
 */
export class OpenAICompatibleEmbeddingService implements Embedder {
  private readonly label: string;

  constructor(private readonly config: RemoteEmbeddingConfig) {
    this.label = config.providerName ?? 'OpenAI-compatible';
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const url = `${this.config.baseUrl.replace(/\/+$/, '')}/embeddings`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({ model: this.config.model, input: texts }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new ProviderError(
        `No se pudo conectar con ${this.label} para embeddings: ${error instanceof Error ? error.message : String(error)}`,
        'remote-embed',
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        `${this.label} embeddings respondió ${response.status}: ${body.slice(0, 500)}`,
        'remote-embed',
        response.status,
      );
    }

    const data = (await response.json()) as OpenAIEmbeddingResponse;
    const vectors = data.data?.map((item) => item.embedding);
    if (!vectors || vectors.length !== texts.length || vectors.some((vector) => !Array.isArray(vector))) {
      throw new ProviderError(
        `${this.label} embeddings devolvió ${vectors?.length ?? 0} vectores para ${texts.length} textos (${data.error?.message ?? 'sin detalle'}).`,
        'remote-embed',
      );
    }
    const validated = vectors as number[][];

    for (const vector of validated) {
      if (vector.length !== this.config.dimension) {
        throw new ProviderError(
          `Dimensión de embedding inesperada: ${vector.length} (esperada ${this.config.dimension}). Ajusta EMBEDDING_DIM o el modelo.`,
          'remote-embed',
        );
      }
    }

    return validated;
  }
}
