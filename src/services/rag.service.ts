import type { ChatMessage } from './llm.service.js';
import type { Embedder } from './embedding.service.js';
import type { SearchHit, VectorStore } from './vector.service.js';

export interface TextCompleter {
  completeText(request: {
    messages: ChatMessage[];
    inputChars?: number;
    explicitRemote?: boolean;
    temperature?: number;
  }): Promise<{ value: string }>;
}

export interface RagConfig {
  topK: number;
  maxContextChars?: number;
}

export interface RagSource {
  title: string;
  path: string;
  tags: string[];
  category: string;
  distance: number;
}

export interface RagAnswer {
  answer: string;
  sources: RagSource[];
}

const fallbackAnswer = 'No encontré notas relacionadas con esa consulta en tu vault.';

export class RagService {
  constructor(
    private readonly config: RagConfig,
    private readonly vector: VectorStore,
    private readonly embedder: Embedder,
    private readonly llm: TextCompleter,
  ) {}

  async query(question: string): Promise<RagAnswer> {
    const trimmed = question.trim();
    if (!trimmed) throw new Error('La consulta está vacía.');

    const [vector] = await this.embedder.embed([trimmed]);
    if (!vector) throw new Error('No se pudo generar el embedding de la consulta.');

    const hits = await this.vector.search(vector, this.config.topK);
    if (hits.length === 0) {
      return { answer: fallbackAnswer, sources: [] };
    }

    const context = this.buildContext(hits);
    const completion = await this.llm.completeText({
      messages: [
        {
          role: 'system',
          content: [
            'Eres el asistente de Idearium, una base de conocimiento personal en Obsidian.',
            'Responde en español, de forma concisa y útil.',
            'Usa exclusivamente la información del CONTEXTO entregado; no inventes datos.',
            'Cita las notas que uses con wikilinks de Obsidian: [[Título de la nota]].',
            'Si el contexto no alcanza para responder, dilo explícitamente y sugiere qué nota falta.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Pregunta: ${trimmed}\n\nCONTEXTO:\n${context}`,
        },
      ],
      inputChars: trimmed.length,
      temperature: 0.2,
    });

    return {
      answer: completion.value.trim(),
      sources: dedupeSources(hits),
    };
  }

  private buildContext(hits: SearchHit[]): string {
    const maxChars = this.config.maxContextChars ?? 14_000;
    const parts: string[] = [];
    let total = 0;

    hits.forEach((hit, index) => {
      const header = `[${index + 1}] ${hit.title} (${hit.notePath})`;
      const remaining = maxChars - total;
      if (remaining <= 0) return;
      const body = hit.text.slice(0, Math.max(0, remaining - header.length - 2));
      const block = `${header}\n${body}`;
      parts.push(block);
      total += block.length + 2;
    });

    return parts.join('\n\n');
  }
}

function dedupeSources(hits: SearchHit[]): RagSource[] {
  const seen = new Set<string>();
  const sources: RagSource[] = [];

  for (const hit of hits) {
    if (seen.has(hit.notePath)) continue;
    seen.add(hit.notePath);
    sources.push({
      title: hit.title,
      path: hit.notePath,
      tags: hit.tags,
      category: hit.category,
      distance: hit.distance,
    });
  }

  return sources;
}
