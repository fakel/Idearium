import { describe, expect, it } from 'vitest';
import { PendingCardStore } from '../src/services/pending-card.service.js';

const cards = [
  { question: '¿Pregunta 1?', answer: 'Respuesta 1', tags: ['a'] },
  { question: '¿Pregunta 2?', answer: 'Respuesta 2', tags: ['b'] },
];

describe('PendingCardStore', () => {
  it('stores a batch and expires it', () => {
    let now = 1_000;
    const store = new PendingCardStore({ ttlMs: 100, now: () => now });
    store.create(7, cards, { note: 'Nota.md', title: 'Nota' });
    expect(store.has(7)).toBe(true);
    now = 1_200;
    expect(store.get(7)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('edits a card in two steps', () => {
    const store = new PendingCardStore();
    store.create(7, cards, { note: 'Nota.md', title: 'Nota' });
    expect(store.beginEdit(7, 1)?.stage).toBe('question');
    expect(store.submitQuestion(7, '¿Nueva?')).toMatchObject({ stage: 'answer', question: '¿Nueva?' });
    const batch = store.submitAnswer(7, 'Nueva respuesta');
    expect(batch?.cards[1]).toMatchObject({ question: '¿Nueva?', answer: 'Nueva respuesta' });
    expect(batch?.edit).toBeUndefined();
  });

  it('keeps a source per card for mixed-note batches', () => {
    const store = new PendingCardStore();
    store.create(
      7,
      [
        { ...cards[0]!, sourceNote: 'Alfa.md', sourceTitle: 'Alfa' },
        { ...cards[1]!, sourceNote: 'Beta.md', sourceTitle: 'Beta' },
      ],
      { note: '', title: 'Quiz' },
    );
    expect(store.get(7)?.cards.map((card) => [card.sourceNote, card.sourceTitle])).toEqual([
      ['Alfa.md', 'Alfa'],
      ['Beta.md', 'Beta'],
    ]);
  });

  it('rejects empty edits and allows cancelling', () => {
    const store = new PendingCardStore();
    store.create(7, cards, { note: 'Nota.md', title: 'Nota' });
    store.beginEdit(7, 0);
    expect(store.submitQuestion(7, '   ')).toBeUndefined();
    expect(store.cancelEdit(7)).toBe(true);
    expect(store.get(7)?.edit).toBeUndefined();
  });
});
