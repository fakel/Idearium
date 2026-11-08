import { truncate } from '../lib/text.js';
import type { NoteContext } from './note-selector.service.js';

export interface GeneratedCard {
  question: string;
  answer: string;
  tags: string[];
  sourceNote?: string;
  sourceTitle?: string;
}

export interface FlashcardGeneratorLlm {
  completeJson<T>(request: {
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    parse: (value: unknown) => T;
    inputChars?: number;
    temperature?: number;
  }): Promise<{ value: T }>;
}

export interface FlashcardGeneratorOptions {
  cardsPerNote?: number;
}

const MAX_QUESTION = 500;
const MAX_ANSWER = 2_000;
const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 40;

const normalize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function cleanTags(raw: unknown, note: NoteContext): string[] {
  const candidates: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const tag = value.trim().replace(/^#/, '').toLowerCase();
    if (tag && tag.length <= MAX_TAG_LENGTH) candidates.push(tag);
  };
  if (Array.isArray(raw)) raw.forEach(add);
  note.tags.forEach(add);
  add(note.category);
  add(note.title);
  return [...new Set(candidates)].slice(0, MAX_TAGS);
}

function parseCards(value: unknown): GeneratedCard[] {
  const record = (typeof value === 'string' ? JSON.parse(value) : value) as { cards?: unknown };
  if (!Array.isArray(record?.cards)) throw new Error('La respuesta no contiene tarjetas.');
  return record.cards.map((item) => {
    const entry = item as { question?: unknown; answer?: unknown; tags?: unknown };
    return {
      question: typeof entry.question === 'string' ? entry.question.trim() : '',
      answer: typeof entry.answer === 'string' ? entry.answer.trim() : '',
      tags: Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  });
}

function validateCards(parsed: GeneratedCard[], note: NoteContext): GeneratedCard[] {
  const seen = new Set<string>();
  const cards: GeneratedCard[] = [];
  for (const card of parsed) {
    const question = card.question.trim();
    const answer = card.answer.trim();
    if (!question || !answer) continue;
    if (question.length > MAX_QUESTION || answer.length > MAX_ANSWER) continue;
    const q = normalize(question);
    if (seen.has(q)) continue;
    // La respuesta completa dentro de la pregunta delata una tarjeta mal planteada.
    if (answer.length > 10 && q.includes(normalize(answer))) continue;
    seen.add(q);
    cards.push({ question, answer, tags: cleanTags(card.tags, note) });
  }
  return cards;
}

/**
 * Generates atomic question/answer cards from one note.
 * One retry fills missing slots without repeating the accepted questions.
 */
export class FlashcardGeneratorService {
  private readonly cardsPerNote: number;

  constructor(
    private readonly llm: FlashcardGeneratorLlm,
    options: FlashcardGeneratorOptions = {},
  ) {
    this.cardsPerNote = Math.max(1, Math.min(10, options.cardsPerNote ?? 5));
  }

  async generate(note: NoteContext): Promise<GeneratedCard[]> {
    const first = validateCards(await this.ask(note, this.cardsPerNote), note);
    if (first.length >= this.cardsPerNote) return first.slice(0, this.cardsPerNote);

    const missing = this.cardsPerNote - first.length;
    const extra = validateCards(await this.ask(note, missing, first), note);
    const merged = [...first];
    const seen = new Set(first.map((card) => normalize(card.question)));
    for (const card of extra) {
      const key = normalize(card.question);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(card);
      if (merged.length >= this.cardsPerNote) break;
    }
    if (merged.length === 0) throw new Error('El LLM no devolvió tarjetas válidas para esta nota.');
    return merged;
  }

  private ask(note: NoteContext, count: number, existing: GeneratedCard[] = []): Promise<GeneratedCard[]> {
    return this.llm
      .completeJson({
        messages: [
          {
            role: 'system',
            content: [
              'Generas tarjetas de estudio (flashcards) a partir de notas personales.',
              'Devuelve SOLO JSON válido con la forma:',
              '{"cards":[{"question":"...","answer":"...","tags":["..."]}]}',
              `Genera exactamente ${count} tarjetas atómicas, una sola idea por tarjeta.`,
              'La pregunta debe poder responderse con la nota y NO debe contener la respuesta.',
              'No inventes datos que no estén en el contexto. Mantén el idioma de la nota.',
              'Las respuestas deben ser breves pero completas; las preguntas, claras y sin numeración.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `Nota: [[${note.title}]] (${note.relativePath})`,
              note.truncated ? '(contexto recortado)' : '',
              '',
              truncate(note.content, 12_000),
              existing.length > 0
                ? `\nYa existen estas preguntas, no las repitas:\n${existing.map((card) => `- ${card.question}`).join('\n')}`
                : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        parse: parseCards,
        inputChars: note.content.length,
        temperature: 0.4,
      })
      .then((result) => result.value);
  }
}

export { parseCards };
