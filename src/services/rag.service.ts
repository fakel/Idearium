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
  /** Margen relativo sobre el mejor hit para descartar resultados lejanos. */
  relevanceRatio?: number;
  /** Fragmentos máximos que puede aportar una misma nota. */
  maxChunksPerNote?: number;
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
const defaultRelevanceRatio = 0.12;
const minRelevanceMargin = 0.08;
const defaultMaxChunksPerNote = 2;

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

    const hits = this.selectHits(await this.vector.search(vector, this.config.topK));
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
            'No enumeres notas que no uses; cita solo las fuentes que sustentan la respuesta.',
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

    const answer = completion.value.trim();
    return {
      answer,
      sources: citedSources(answer, hits),
    };
  }

  /**
   * LanceDB devuelve siempre topK, aunque no haya tanto contenido relevante.
   * Nos quedamos con los hits cercanos al mejor y limitamos los chunks por nota.
   */
  private selectHits(hits: SearchHit[]): SearchHit[] {
    if (hits.length === 0) return [];

    const sorted = [...hits].sort((a, b) => a.distance - b.distance);
    const best = sorted[0]!;
    const ratio = this.config.relevanceRatio ?? defaultRelevanceRatio;
    const cutoff = best.distance + Math.max(minRelevanceMargin, best.distance * ratio);
    const maxPerNote = this.config.maxChunksPerNote ?? defaultMaxChunksPerNote;
    const counts = new Map<string, number>();

    return sorted.filter((hit) => {
      if (hit.distance > cutoff) return false;
      const count = counts.get(hit.notePath) ?? 0;
      if (count >= maxPerNote) return false;
      counts.set(hit.notePath, count + 1);
      return true;
    });
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

function citedSources(answer: string, hits: SearchHit[]): RagSource[] {
  const citations = new Set(
    [...answer.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => {
      const target = (match[1] ?? '').split('|')[0]!.split('#')[0]!.trim();
      return normalizeCitation(target);
    }),
  );
  if (citations.size === 0) return [];

  const seen = new Set<string>();
  const sources: RagSource[] = [];

  for (const hit of hits) {
    if (seen.has(hit.notePath) || !isCited(hit, citations)) continue;
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

function isCited(hit: SearchHit, citations: Set<string>): boolean {
  const title = normalizeCitation(hit.title);
  const basename = normalizeCitation(hit.notePath.split('/').pop() ?? '');
  const notePath = normalizeCitation(hit.notePath);

  for (const citation of citations) {
    if (citation === title || citation === basename) return true;
    if (notePath === citation || notePath.endsWith(`/${citation}`)) return true;
  }

  return false;
}

function normalizeCitation(value: string): string {
  return value.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase();
}
