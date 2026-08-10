// Streak math for Keywulf. Operates on the set of official completed challenge
// dates (YYYY-MM-DD, UTC). Each date maps to a unique integer game number, so
// "consecutive days" is just "consecutive integers", which is simple to reason
// about and test.

import { gameNumberForDate } from './gameNumber';

export interface Streaks {
  /**
   * Current streak: the run of consecutive daily completions ending at today.
   * It stays alive if the most recent completion is today OR yesterday (you
   * have until the end of the UTC day to keep it). If the latest completion is
   * older than yesterday, the current streak is 0.
   */
  current: number;
  /** Longest run of consecutive daily completions ever recorded. */
  longest: number;
}

/** Convert completed date strings to a de-duplicated set of game numbers. */
function toNumberSet(completedDates: string[]): Set<number> {
  const set = new Set<number>();
  for (const d of completedDates) {
    const n = gameNumberForDate(d);
    if (n > 0) set.add(n);
  }
  return set;
}

/**
 * Compute current and longest streaks from the completed challenge dates.
 * `today` is the current Keywulf day (UTC), defaulting to the real today.
 */
export function computeStreaks(completedDates: string[], todayNumber: number): Streaks {
  const nums = toNumberSet(completedDates);
  if (nums.size === 0) return { current: 0, longest: 0 };

  // Longest run of consecutive integers.
  const sorted = [...nums].sort((a, b) => a - b);
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
  }

  // Current streak: anchor at today if completed, else yesterday, else 0.
  let anchor: number | null = null;
  if (nums.has(todayNumber)) anchor = todayNumber;
  else if (nums.has(todayNumber - 1)) anchor = todayNumber - 1;

  let current = 0;
  if (anchor !== null) {
    let n = anchor;
    while (nums.has(n)) {
      current += 1;
      n -= 1;
    }
  }

  return { current, longest };
}
