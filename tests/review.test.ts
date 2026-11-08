import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlashcardService } from '../src/services/flashcard.service.js';
import { ReviewService } from '../src/services/review.service.js';

let dir: string;
let service: FlashcardService;
let review: ReviewService;
let now: Date;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-review-'));
  now = new Date('2026-11-08T13:30:00.000Z');
  service = new FlashcardService(path.join(dir, 'cards.json'), {
    now: () => now,
    timeZone: 'America/Lima',
    maxReviewsPerDay: 40,
  });
  review = new ReviewService(service, { maxDuePerSession: 10 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const cards = [
  { question: '¿TCP?', answer: 'Transporte fiable.', tags: ['redes'], sourceNote: 'a.md', sourceTitle: 'A' },
  { question: '¿UDP?', answer: 'Sin entrega garantizada.', tags: ['redes'], sourceNote: 'b.md', sourceTitle: 'B' },
];

describe('ReviewService', () => {
  it('starts a session, reveals and rates cards', async () => {
    await service.addMany(7, cards);
    const started = await review.start(7);
    expect(started.total).toBe(2);
    expect(started.card.question).toBe('¿TCP?');
    expect(review.reveal(7)?.answer).toBe('Transporte fiable.');

    const first = await review.rate(7, 'good');
    expect(first).toMatchObject({ finished: false, reviewed: 1, total: 2, remaining: 1 });
    expect(first?.next?.question).toBe('¿UDP?');

    const second = await review.rate(7, 'easy');
    expect(second?.finished).toBe(true);
    expect(second?.summary).toContain('2/2');
    expect(review.has(7)).toBe(true);
  });

  it('undoes the last rating and reopens the card', async () => {
    await service.addMany(7, cards.slice(0, 1));
    await review.start(7);
    await review.rate(7, 'again');
    expect((await service.stats(7)).todayReviews).toBe(1);
    const undone = await review.undo(7);
    expect(undone?.card.question).toBe('¿TCP?');
    expect(undone?.reviewed).toBe(0);
    expect((await service.stats(7)).todayReviews).toBe(0);
    expect(review.reveal(7)?.card.question).toBe('¿TCP?');
  });

  it('filters by tag and stops', async () => {
    await service.addMany(7, cards);
    await expect(review.start(7, { tag: 'otra' })).rejects.toThrow('No hay tarjetas vencidas');
    expect(review.has(7)).toBe(false);
    await review.start(7, { tag: '#redes' });
    expect(review.has(7)).toBe(true);
    expect(review.stop(7)).toBe(true);
    expect(review.has(7)).toBe(false);
  });

  it('keeps sessions per chat', async () => {
    await service.addMany(7, cards);
    await service.addMany(8, [cards[0]!]);
    await review.start(7);
    await review.start(8);
    expect(review.reveal(7)?.card.question).toBe('¿TCP?');
    expect(review.reveal(8)?.card.question).toBe('¿TCP?');
    review.stop(7);
    expect(review.has(7)).toBe(false);
    expect(review.has(8)).toBe(true);
  });
});
