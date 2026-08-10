import { describe, it, expect } from 'vitest';
import {
  EPOCH_DATE,
  gameNumberForDate,
  dateForGameNumber,
  toUtcDateString,
  todayUtc,
  todaysGameNumber,
  isConsecutiveDay,
  parseUtcDate,
} from './gameNumber';

describe('gameNumberForDate', () => {
  it('numbers the epoch day as game 1', () => {
    expect(gameNumberForDate(EPOCH_DATE)).toBe(1);
  });

  it('increments by one per UTC day', () => {
    expect(gameNumberForDate('2026-01-02')).toBe(2);
    expect(gameNumberForDate('2026-01-31')).toBe(31);
    expect(gameNumberForDate('2026-02-01')).toBe(32);
  });

  it('handles a date well past the epoch', () => {
    // 2026-08-09 is 220 days after 2026-01-01 -> game 221.
    expect(gameNumberForDate('2026-08-09')).toBe(221);
  });

  it('returns 0 for malformed input', () => {
    expect(gameNumberForDate('not-a-date')).toBe(0);
    expect(gameNumberForDate('2026-13-40')).not.toBeNaN();
  });
});

describe('dateForGameNumber (inverse)', () => {
  it('round-trips with gameNumberForDate', () => {
    for (const n of [1, 2, 50, 221, 999]) {
      expect(gameNumberForDate(dateForGameNumber(n))).toBe(n);
    }
  });

  it('maps game 1 to the epoch', () => {
    expect(dateForGameNumber(1)).toBe(EPOCH_DATE);
  });
});

describe('UTC date handling', () => {
  it('formats a Date by its UTC components', () => {
    // A time late on Aug 9 UTC stays Aug 9.
    expect(toUtcDateString(new Date('2026-08-09T23:59:59Z'))).toBe('2026-08-09');
    // Just after midnight UTC rolls to the next day.
    expect(toUtcDateString(new Date('2026-08-10T00:00:01Z'))).toBe('2026-08-10');
  });

  it('todayUtc uses the injected clock', () => {
    expect(todayUtc(new Date('2026-03-15T12:00:00Z'))).toBe('2026-03-15');
  });

  it('todaysGameNumber is consistent with gameNumberForDate', () => {
    const now = new Date('2026-08-09T06:00:00Z');
    expect(todaysGameNumber(now)).toBe(gameNumberForDate('2026-08-09'));
  });

  it('parseUtcDate rejects malformed strings', () => {
    expect(Number.isNaN(parseUtcDate('2026-1-1').getTime())).toBe(true);
    expect(Number.isNaN(parseUtcDate('garbage').getTime())).toBe(true);
    expect(Number.isNaN(parseUtcDate('2026-01-01').getTime())).toBe(false);
  });
});

describe('isConsecutiveDay', () => {
  it('is true for exactly one day apart', () => {
    expect(isConsecutiveDay('2026-08-09', '2026-08-10')).toBe(true);
  });

  it('is false for same day or gaps', () => {
    expect(isConsecutiveDay('2026-08-09', '2026-08-09')).toBe(false);
    expect(isConsecutiveDay('2026-08-09', '2026-08-11')).toBe(false);
    expect(isConsecutiveDay('2026-08-10', '2026-08-09')).toBe(false);
  });

  it('handles month boundaries', () => {
    expect(isConsecutiveDay('2026-01-31', '2026-02-01')).toBe(true);
    expect(isConsecutiveDay('2026-02-28', '2026-03-01')).toBe(true); // 2026 not a leap year
  });
});
