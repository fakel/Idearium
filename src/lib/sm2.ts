export const reviewGrades = ['again', 'hard', 'good', 'easy'] as const;
export type ReviewGrade = (typeof reviewGrades)[number];

export interface SchedulingState {
  ease: number;
  intervalMinutes: number;
  repetitions: number;
  lapses: number;
}

export interface Sm2Result extends SchedulingState {
  dueAt: string;
  leech: boolean;
}

export const MIN_INTERVAL_MINUTES = 10;
export const MAX_INTERVAL_MINUTES = 365 * 24 * 60;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const INITIAL_EASE = 2.5;

const DAY = 24 * 60;
const round = (value: number): number => Math.round(value);
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** State for a freshly created card: due immediately, without a review yet. */
export function newCardSchedule(now: Date): SchedulingState & { dueAt: string } {
  return {
    ease: INITIAL_EASE,
    intervalMinutes: 0,
    repetitions: 0,
    lapses: 0,
    dueAt: now.toISOString(),
  };
}

/** Next scheduling state after one review. Pure: same input always gives same output. */
export function scheduleReview(
  state: SchedulingState,
  grade: ReviewGrade,
  now: Date,
  leechThreshold = 6,
): Sm2Result {
  const ease = Number.isFinite(state.ease) ? state.ease : INITIAL_EASE;
  const interval = Number.isFinite(state.intervalMinutes) ? state.intervalMinutes : 0;
  const repetitions = Number.isFinite(state.repetitions) ? state.repetitions : 0;
  const lapses = Number.isFinite(state.lapses) ? state.lapses : 0;

  let nextEase = ease;
  let nextInterval = interval;
  let nextRepetitions = repetitions;
  let nextLapses = lapses;

  switch (grade) {
    case 'again':
      nextInterval = MIN_INTERVAL_MINUTES;
      nextEase = ease - 0.2;
      nextRepetitions = 0;
      nextLapses = lapses + 1;
      break;
    case 'hard':
      nextInterval = repetitions === 0 ? DAY : repetitions === 1 ? 2 * DAY : interval * 1.2;
      nextEase = ease - 0.15;
      nextRepetitions = repetitions + 1;
      break;
    case 'good':
      nextInterval = repetitions === 0 ? DAY : repetitions === 1 ? 3 * DAY : interval * ease;
      nextRepetitions = repetitions + 1;
      break;
    case 'easy':
      nextInterval = repetitions === 0 ? 3 * DAY : repetitions === 1 ? 6 * DAY : interval * ease * 1.3;
      nextEase = ease + 0.1;
      nextRepetitions = repetitions + 1;
      break;
  }

  nextEase = clamp(nextEase, MIN_EASE, MAX_EASE);
  nextInterval = clamp(round(nextInterval), MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);

  return {
    ease: Math.round(nextEase * 100) / 100,
    intervalMinutes: nextInterval,
    repetitions: nextRepetitions,
    lapses: nextLapses,
    dueAt: new Date(now.getTime() + nextInterval * 60_000).toISOString(),
    leech: nextLapses >= leechThreshold,
  };
}
