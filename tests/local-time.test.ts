import { describe, expect, it } from 'vitest';
import {
  formatMinutes,
  isSlotDue,
  localDateKey,
  localDateTime,
  parseTimeToMinutes,
  slotDate,
} from '../src/lib/local-time.js';

const zone = 'America/Lima';

describe('local-time', () => {
  it('formats wall clock time in the configured zone', () => {
    const date = new Date('2026-11-08T13:30:00.000Z');
    expect(localDateKey(date, zone)).toBe('2026-11-08');
    expect(localDateTime(date, zone)).toEqual({ date: '2026-11-08', time: '08:30', minutes: 510 });
  });

  it('handles the local day across UTC midnight', () => {
    expect(localDateKey(new Date('2026-11-09T02:00:00.000Z'), zone)).toBe('2026-11-08');
  });

  it('parses and formats HH:MM', () => {
    expect(parseTimeToMinutes('08:30')).toBe(510);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
    expect(parseTimeToMinutes('24:00')).toBeUndefined();
    expect(parseTimeToMinutes('8:30')).toBeUndefined();
    expect(formatMinutes(510)).toBe('08:30');
    expect(formatMinutes(1440)).toBe('00:00');
  });

  it('checks the notification window', () => {
    const at = (time: string): Date => new Date(`2026-11-08T${time}:00.000Z`);
    // Lima is UTC-5.
    expect(isSlotDue(at('13:29'), zone, '08:30', 60)).toBe(false);
    expect(isSlotDue(at('13:30'), zone, '08:30', 60)).toBe(true);
    expect(isSlotDue(at('14:29'), zone, '08:30', 60)).toBe(true);
    expect(isSlotDue(at('14:31'), zone, '08:30', 60)).toBe(false);
  });

  it('assigns the previous slot date when the grace crosses midnight', () => {
    const afterMidnight = new Date('2026-11-09T05:10:00.000Z'); // 00:10 Lima
    expect(isSlotDue(afterMidnight, zone, '23:30', 60)).toBe(true);
    expect(slotDate(afterMidnight, zone, '23:30', 60)).toBe('2026-11-08');
    expect(slotDate(new Date('2026-11-09T13:30:00.000Z'), zone, '08:30', 60)).toBe('2026-11-09');
  });
});
