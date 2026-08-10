// Deterministic Keywulf day + game-number math. Everything is UTC so every
// player on Earth shares one "Keywulf day" and one challenge per game number.
// No server-side counter is stored; the number is derived from a documented
// epoch.

/**
 * The Keywulf epoch. The challenge dated on this UTC day is game #1. Changing
 * this renumbers every game, so it is fixed for the life of the product.
 */
export const EPOCH_DATE = '2026-01-01';

const MS_PER_DAY = 86_400_000;

/** Parse a YYYY-MM-DD string as UTC midnight. Returns NaN-time Date if invalid. */
export function parseUtcDate(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return new Date(NaN);
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
}

/** Format a Date as YYYY-MM-DD using its UTC components. */
export function toUtcDateString(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const mo = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** The current Keywulf day (UTC) as YYYY-MM-DD. */
export function todayUtc(now: Date = new Date()): string {
  return toUtcDateString(now);
}

/**
 * The game number for a given UTC date. Game #1 is EPOCH_DATE; each subsequent
 * UTC day increments by one. Dates before the epoch yield numbers <= 0.
 */
export function gameNumberForDate(dateStr: string): number {
  const target = parseUtcDate(dateStr);
  const epoch = parseUtcDate(EPOCH_DATE);
  if (Number.isNaN(target.getTime())) return 0;
  const diffDays = Math.round((target.getTime() - epoch.getTime()) / MS_PER_DAY);
  return diffDays + 1;
}

/** Convenience: the game number for today (UTC). */
export function todaysGameNumber(now: Date = new Date()): number {
  return gameNumberForDate(todayUtc(now));
}

/** The UTC date string for a given game number (inverse of gameNumberForDate). */
export function dateForGameNumber(gameNumber: number): string {
  const epoch = parseUtcDate(EPOCH_DATE);
  const t = epoch.getTime() + (gameNumber - 1) * MS_PER_DAY;
  return toUtcDateString(new Date(t));
}

/** Human-friendly long date, e.g. "Sunday, August 9, 2026" (UTC). */
export function formatLongDate(dateStr: string): string {
  const d = parseUtcDate(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Whether two YYYY-MM-DD strings are exactly one UTC day apart (a before b). */
export function isConsecutiveDay(earlier: string, later: string): boolean {
  const a = parseUtcDate(earlier).getTime();
  const b = parseUtcDate(later).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return b - a === MS_PER_DAY;
}
