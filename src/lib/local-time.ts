const timeFormatCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let format = timeFormatCache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatCache.set(timeZone, format);
  }
  return format;
}

export interface LocalDateTime {
  date: string;
  time: string;
  minutes: number;
}

/** Wall-clock date/time in the configured IANA zone. */
export function localDateTime(date: Date, timeZone: string): LocalDateTime {
  const parts = formatter(timeZone).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year') ?? '0000';
  const month = values.get('month') ?? '00';
  const day = values.get('day') ?? '00';
  const hour = values.get('hour') ?? '00';
  const minute = values.get('minute') ?? '00';
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}:${minute}`,
    minutes: Number(hour) * 60 + Number(minute),
  };
}

export function localDateKey(date: Date, timeZone: string): string {
  return localDateTime(date, timeZone).date;
}

export function parseTimeToMinutes(value: string): number | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutes(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/**
 * True when the slot is inside its catch-up window. If the window crosses
 * midnight, the previous day's slot is still considered due after 00:00.
 */
export function isSlotDue(
  now: Date,
  timeZone: string,
  slot: string,
  graceMinutes: number,
): boolean {
  const slotMinutes = parseTimeToMinutes(slot);
  if (slotMinutes === undefined || graceMinutes < 0) return false;
  const { minutes } = localDateTime(now, timeZone);
  let elapsed = minutes - slotMinutes;
  if (elapsed < 0) elapsed += 1440;
  return elapsed <= graceMinutes;
}

/** The slot date: today, or yesterday when a post-midnight window is still open. */
export function slotDate(now: Date, timeZone: string, slot: string, graceMinutes: number): string {
  const current = localDateTime(now, timeZone);
  const slotMinutes = parseTimeToMinutes(slot);
  if (slotMinutes === undefined) return current.date;
  if (current.minutes >= slotMinutes || current.minutes > graceMinutes) return current.date;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60_000);
  return localDateKey(yesterday, timeZone);
}
