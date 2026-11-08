import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FlashcardService } from '../src/services/flashcard.service.js';
import { ReviewSchedulerService } from '../src/services/review-scheduler.service.js';

let dir: string;
let service: FlashcardService;
let now: Date;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'idearium-scheduler-'));
  now = new Date('2026-11-08T13:30:00.000Z'); // 08:30 Lima
  service = new FlashcardService(path.join(dir, 'cards.json'), {
    now: () => now,
    timeZone: 'America/Lima',
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const config = {
  enabled: true,
  timeZone: 'America/Lima',
  notifyTimes: ['08:30'],
  graceMinutes: 60,
  maxReviewsPerDay: 40,
};

const addCard = () =>
  service.addMany(7, [
    { question: '¿P?', answer: 'R', tags: ['x'], sourceNote: 'a.md', sourceTitle: 'A' },
  ]);

describe('ReviewSchedulerService', () => {
  it('notifies once per slot and day', async () => {
    await addCard();
    const messages: string[] = [];
    const scheduler = new ReviewSchedulerService(service, async (_chatId, text) => {
      messages.push(text);
    }, config, { now: () => now });

    expect(await scheduler.tick()).toBe(1);
    expect(messages[0]).toContain('1 tarjeta');
    expect(await scheduler.tick()).toBe(0);

    now = new Date('2026-11-08T14:31:00.000Z'); // past grace
    expect(await scheduler.tick()).toBe(0);

    now = new Date('2026-11-09T13:30:00.000Z');
    expect(await scheduler.tick()).toBe(1);
    expect(messages).toHaveLength(2);
  });

  it('does not notify when nothing is due', async () => {
    const messages: string[] = [];
    const scheduler = new ReviewSchedulerService(service, async (_chatId, text) => {
      messages.push(text);
    }, config, { now: () => now });
    expect(await scheduler.tick()).toBe(0);
    expect(messages).toHaveLength(0);
  });

  it('is disabled by config', async () => {
    await addCard();
    const messages: string[] = [];
    const scheduler = new ReviewSchedulerService(
      service,
      async (_chatId, text) => {
        messages.push(text);
      },
      { ...config, enabled: false },
      { now: () => now },
    );
    expect(await scheduler.tick()).toBe(0);
    expect(messages).toHaveLength(0);
    scheduler.start();
    scheduler.stop();
  });
});
