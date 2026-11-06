import { describe, expect, it, vi } from 'vitest';
import { RagService, type TextCompleter } from '../src/services/rag.service.js';
import type { Embedder } from '../src/services/embedding.service.js';
import type { SearchHit, VectorStore } from '../src/services/vector.service.js';

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: '1',
    notePath: '/vault/Idearium/gato.md',
    chunkIndex: 0,
    title: 'Gato',
    tags: ['mascotas'],
    category: 'idea',
    text: 'El gato duerme en el sofá.',
    updatedAt: '2026-01-01T00:00:00Z',
    distance: 0.1,
    ...overrides,
  };
}

function setup(hits: SearchHit[]) {
  const embedder: Embedder = { embed: vi.fn(async () => [[1, 0, 0, 0]]) };
  const vector: VectorStore = {
    search: vi.fn(async () => hits),
    upsertNote: vi.fn(async () => undefined),
    deleteByPath: vi.fn(async () => undefined),
    count: vi.fn(async () => hits.length),
    clear: vi.fn(async () => undefined),
  };
  const completeText = vi.fn(async () => ({ value: 'El gato duerme [[Gato]].' }));
  const llm: TextCompleter = { completeText };
  return { rag: new RagService({ topK: 3 }, vector, embedder, llm), completeText };
}

describe('RagService', () => {
  it('responde con contexto y solo fuentes citadas', async () => {
    const { rag, completeText } = setup([
      hit(),
      hit({ id: '2', chunkIndex: 1 }),
      hit({ id: '3', notePath: '/vault/Idearium/perro.md', title: 'Perro', text: 'El perro ladra.' }),
    ]);

    const answer = await rag.query('¿Dónde duerme el gato?');

    expect(answer.answer).toContain('Gato');
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0]!.title).toBe('Gato');

    const request = completeText.mock.calls[0]![0] as { messages: { content: string }[] };
    const userMessage = request.messages.find((message) => message.content.includes('Pregunta:'));
    expect(userMessage?.content).toContain('[1] Gato (/vault/Idearium/gato.md)');
    expect(userMessage?.content).toContain('El perro ladra.');
  });

  it('descarta resultados lejanos al mejor hit', async () => {
    const { rag, completeText } = setup([
      hit({ distance: 0.2 }),
      hit({
        id: '2',
        notePath: '/vault/Idearium/perro.md',
        title: 'Perro',
        text: 'El perro ladra.',
        distance: 0.9,
      }),
    ]);

    const answer = await rag.query('¿Dónde duerme el gato?');

    const request = completeText.mock.calls[0]![0] as { messages: { content: string }[] };
    const userMessage = request.messages.find((message) => message.content.includes('Pregunta:'));
    expect(userMessage?.content).not.toContain('El perro ladra.');
    expect(answer.sources).toHaveLength(1);
  });

  it('no lista fuentes que la respuesta no cita', async () => {
    const { rag } = setup([hit()]);

    const answer = await rag.query('¿Dónde duerme el gato?');

    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0]!.path).toBe('/vault/Idearium/gato.md');
  });

  it('no inventa nada cuando no hay resultados', async () => {
    const { rag, completeText } = setup([]);
    const answer = await rag.query('tema inexistente');

    expect(answer.answer).toContain('No encontré notas');
    expect(answer.sources).toHaveLength(0);
    expect(completeText).not.toHaveBeenCalled();
  });

  it('rechaza consultas vacías', async () => {
    const { rag } = setup([]);
    await expect(rag.query('   ')).rejects.toThrow('vacía');
  });
});
