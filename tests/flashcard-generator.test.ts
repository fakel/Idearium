import { describe, expect, it } from 'vitest';
import type { NoteContext } from '../src/services/note-selector.service.js';
import {
  FlashcardGeneratorService,
  type FlashcardGeneratorLlm,
  type GeneratedCard,
} from '../src/services/flashcard-generator.service.js';

const note: NoteContext = {
  title: 'Redes',
  path: '/vault/Redes.md',
  relativePath: 'Redes.md',
  tags: ['tcp'],
  category: 'aprendizaje',
  content: 'TCP es un protocolo de transporte fiable. UDP no garantiza entrega.',
  truncated: false,
};

const card = (question: string, answer: string): GeneratedCard => ({ question, answer, tags: [] });

function fakeLlm(responses: GeneratedCard[][]): FlashcardGeneratorLlm & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    async completeJson<T>() {
      const response = responses[calls] ?? [];
      calls += 1;
      return { value: response as T };
    },
  };
}

describe('FlashcardGeneratorService', () => {
  it('parses cards and enriches tags from the note', async () => {
    const llm = fakeLlm([
      [card('¿Qué es TCP?', 'Un protocolo de transporte fiable.'), card('¿Qué no garantiza UDP?', 'La entrega.')],
      [card('¿TCP garantiza la entrega?', 'Sí.'), card('¿UDP es fiable?', 'No.'), card('¿TCP es orientado a conexión?', 'Sí.')],
    ]);
    const generator = new FlashcardGeneratorService(llm, { cardsPerNote: 5 });
    const cards = await generator.generate(note);
    expect(cards).toHaveLength(5);
    expect(cards[0]!.tags).toEqual(expect.arrayContaining(['tcp', 'aprendizaje', 'redes']));
    expect(llm.calls).toBe(2);
  });

  it('drops empty, duplicate and malformed cards and retries once', async () => {
    const llm = fakeLlm([
      [
        card('¿Qué es TCP?', 'Un protocolo de transporte fiable.'),
        card('¿Qué es TCP?', 'Duplicada.'),
        card('Respuesta dentro: un protocolo de transporte fiable.', 'Un protocolo de transporte fiable.'),
        card('', 'Sin pregunta.'),
      ],
      [card('¿Qué no garantiza UDP?', 'La entrega.'), card('¿Qué es TCP?', 'Otra vez la misma.')],
    ]);
    const generator = new FlashcardGeneratorService(llm, { cardsPerNote: 2 });
    const cards = await generator.generate(note);
    expect(cards.map((item) => item.question)).toEqual([
      '¿Qué es TCP?',
      '¿Qué no garantiza UDP?',
    ]);
  });

  it('throws when nothing valid is returned', async () => {
    const generator = new FlashcardGeneratorService(fakeLlm([[card('', '')], []]), { cardsPerNote: 1 });
    await expect(generator.generate(note)).rejects.toThrow('no devolvió tarjetas válidas');
  });
});
