import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleEmbeddingService } from '../src/services/embedding.service.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAICompatibleEmbeddingService', () => {
  it('llama a /embeddings con Bearer y devuelve los vectores', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ authorization: 'Bearer or-key' });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'baai/bge-m3',
        input: ['uno', 'dos'],
      });
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchImpl);

    const embedder = new OpenAICompatibleEmbeddingService({
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'or-key',
      model: 'baai/bge-m3',
      dimension: 2,
      timeoutMs: 5_000,
      providerName: 'OpenRouter',
    });

    await expect(embedder.embed(['uno', 'dos'])).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/embeddings',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falla si la dimensión no coincide con EMBEDDING_DIM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const embedder = new OpenAICompatibleEmbeddingService({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
      model: 'baai/bge-m3',
      dimension: 2,
      timeoutMs: 5_000,
    });

    await expect(embedder.embed(['uno'])).rejects.toThrow('Dimensión de embedding inesperada');
  });
});
