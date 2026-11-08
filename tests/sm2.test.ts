import { describe, expect, it } from 'vitest';
import {
  MAX_EASE,
  MAX_INTERVAL_MINUTES,
  MIN_EASE,
  MIN_INTERVAL_MINUTES,
  newCardSchedule,
  scheduleReview,
  type SchedulingState,
} from '../src/lib/sm2.js';

const now = new Date('2026-11-08T13:30:00.000Z');
const state: SchedulingState = { ease: 2.5, intervalMinutes: 0, repetitions: 0, lapses: 0 };

describe('sm2', () => {
  it('creates a new card due immediately', () => {
    expect(newCardSchedule(now)).toEqual({
      ease: 2.5,
      intervalMinutes: 0,
      repetitions: 0,
      lapses: 0,
      dueAt: now.toISOString(),
    });
  });

  it('schedules good/easy/hard from a new card', () => {
    expect(scheduleReview(state, 'good', now)).toMatchObject({
      intervalMinutes: 1440,
      repetitions: 1,
      ease: 2.5,
    });
    expect(scheduleReview(state, 'easy', now)).toMatchObject({
      intervalMinutes: 4320,
      repetitions: 1,
      ease: 2.6,
    });
    expect(scheduleReview(state, 'hard', now)).toMatchObject({
      intervalMinutes: 1440,
      repetitions: 1,
      ease: 2.35,
    });
  });

  it('uses the second-step intervals', () => {
    const oneRep = { ease: 2.5, intervalMinutes: 1440, repetitions: 1, lapses: 0 };
    expect(scheduleReview(oneRep, 'good', now).intervalMinutes).toBe(4320);
    expect(scheduleReview(oneRep, 'easy', now).intervalMinutes).toBe(8640);
    expect(scheduleReview(oneRep, 'hard', now).intervalMinutes).toBe(2880);
  });

  it('again resets repetitions, adds a lapse and schedules 10 minutes', () => {
    const matured = { ease: 2.5, intervalMinutes: 10_000, repetitions: 4, lapses: 2 };
    const result = scheduleReview(matured, 'again', now, 6);
    expect(result).toMatchObject({
      intervalMinutes: MIN_INTERVAL_MINUTES,
      repetitions: 0,
      lapses: 3,
      ease: 2.3,
      dueAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      leech: false,
    });
  });

  it('marks a leech at the threshold', () => {
    expect(scheduleReview({ ...state, lapses: 5 }, 'again', now, 6).leech).toBe(true);
  });

  it('clamps ease and intervals', () => {
    expect(scheduleReview({ ...state, ease: 1.31 }, 'again', now).ease).toBe(MIN_EASE);
    expect(scheduleReview({ ...state, ease: MAX_EASE }, 'easy', now).ease).toBe(MAX_EASE);
    expect(
      scheduleReview({ ...state, repetitions: 4, intervalMinutes: MAX_INTERVAL_MINUTES }, 'easy', now)
        .intervalMinutes,
    ).toBe(MAX_INTERVAL_MINUTES);
    expect(scheduleReview({ ...state, ease: 1.3, intervalMinutes: 1 }, 'hard', now).ease).toBe(MIN_EASE);
  });
});
