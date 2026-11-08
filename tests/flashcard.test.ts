import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlashcardError, FlashcardService } from '../src/services/flashcard.service.js';

let dir: string;
let file: string;
let now: Date;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-cards-'));
  file = path.join(dir, 'flashcards.json');
  now = new Date('2026-11-08T13:30:00.000Z');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const makeService = (options: { maxReviewsPerDay?: number; leechThreshold?: number } = {}) =>
  new FlashcardService(file, {
    now: () => now,
    timeZone: 'America/Lima',
    maxReviewsPerDay: options.maxReviewsPerDay ?? 40,
    leechThreshold: options.leechThreshold ?? 6,
  });

const input = (question = '¿Qué es TCP?', answer = 'Un protocolo de transporte.') => ({
  question,
  answer,
  tags: ['redes', '#Redes'],
  sourceNote: 'Aprendizaje/Idearium/0001-redes.md',
  sourceTitle: 'Redes',
});

describe('FlashcardService', () => {
  it('adds cards, deduplicates and persists across reloads', async () => {
    const service = makeService();
    const created = await service.addMany(7, [input(), input('Otra', 'Respuesta')]);
    expect(created).toHaveLength(2);
    expect(created[0].tags).toEqual(['redes']);
    await expect(service.addMany(7, [input()])).rejects.toMatchObject({ code: 'duplicate' });

    const reloaded = makeService();
    expect(await reloaded.list(7)).toHaveLength(2);
  });

  it('returns due cards ordered by dueAt and filters by tag', async () => {
    const service = makeService();
    const [first] = await service.addMany(7, [input()]);
    now = new Date(now.getTime() + 60_000);
    const due = await service.due(7, { now });
    expect(due.map((card) => card.id)).toEqual([first.id]);
    expect(await service.due(7, { tag: 'redes', now })).toHaveLength(1);
    expect(await service.due(7, { tag: 'otra', now })).toHaveLength(0);
  });

  it('rates, schedules and undoes the last review', async () => {
    const service = makeService();
    const [card] = await service.addMany(7, [input()]);
    const result = await service.rate(7, card.id, 'good');
    expect(result.card.repetitions).toBe(1);
    expect(result.card.intervalMinutes).toBe(1440);
    expect(result.reviewsToday).toBe(1);
    const after = await service.undo(7, card.id);
    expect(after?.intervalMinutes).toBe(0);
    expect(after?.lastReview).toBeUndefined();
    expect((await service.stats(7)).todayReviews).toBe(0);
  });

  it('enforces the daily review limit', async () => {
    const service = makeService({ maxReviewsPerDay: 1 });
    const [card] = await service.addMany(7, [input()]);
    await service.rate(7, card.id, 'again');
    await expect(service.rate(7, card.id, 'good')).rejects.toBeInstanceOf(FlashcardError);
    await expect(service.rate(7, card.id, 'good')).rejects.toMatchObject({ code: 'daily_limit' });
  });

  it('suspends, resumes and removes cards', async () => {
    const service = makeService();
    const [card] = await service.addMany(7, [input()]);
    expect((await service.due(7)).length).toBe(1);
    await service.setSuspended(7, card.id, true);
    expect(await service.due(7)).toHaveLength(0);
    await service.setSuspended(7, card.id, false);
    expect(await service.remove(7, card.id)).toBe(true);
    expect(await service.list(7)).toHaveLength(0);
  });

  it('marks leeches and reports stats', async () => {
    const service = makeService({ leechThreshold: 2 });
    const [card] = await service.addMany(7, [input()]);
    await service.rate(7, card.id, 'again');
    await service.rate(7, card.id, 'again');
    const stats = await service.stats(7);
    expect(stats.leeches).toBe(1);
    expect(stats.byTag).toEqual({ redes: 1 });
  });

  it('backs up a corrupt file and starts empty', async () => {
    await writeFile(file, '{broken', 'utf8');
    const service = makeService();
    expect(await service.list(1)).toEqual([]);
    const files = await readdir(dir);
    expect(files.some((name) => name.startsWith('flashcards.json.corrupt-'))).toBe(true);
  });
});
