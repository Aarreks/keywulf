// Scoring math for Keywulf. Pure functions, no rounding of intermediate values
// (callers round only for display). All formulas are documented and tested.

export interface ScoreInput {
  /**
   * Number of corpus characters correctly filled at the moment scoring runs.
   * For a completed run this equals the corpus length.
   */
  correctChars: number;
  /** Cumulative count of character keystrokes that matched the expected char. */
  correctKeystrokes: number;
  /** Cumulative count of character keystrokes that did NOT match (errors). */
  incorrectKeystrokes: number;
  /** Total characters in the corpus (denominator for completion %). */
  totalChars: number;
  /** Elapsed time from the first keystroke to the last, in milliseconds. */
  elapsedMs: number;
}

export interface Score {
  /** Net words per minute: (correctChars / 5) / minutes. */
  wpm: number;
  /**
   * Raw words per minute including error keystrokes:
   * ((correctKeystrokes + incorrectKeystrokes) / 5) / minutes.
   */
  rawWpm: number;
  /**
   * Accuracy in [0, 1]: correctKeystrokes / (correctKeystrokes + incorrectKeystrokes).
   * Keystroke-based, so every mistake counts even if later corrected. This is
   * why fast-but-sloppy typing does not read as excellent performance. With no
   * keystrokes yet, accuracy is defined as 1.
   */
  accuracy: number;
  /** Total error keystrokes over the run. */
  errors: number;
  /** Completion fraction in [0, 1]: correctChars / totalChars. */
  completion: number;
  /** Elapsed time in milliseconds (passthrough). */
  elapsedMs: number;
}

/** A word is defined as 5 characters for WPM purposes (the standard). */
export const CHARS_PER_WORD = 5;

/**
 * Hard cap on a daily run. The game ends when the briefing is fully typed OR
 * this much time elapses, whichever comes first. Keeps the daily ritual tight:
 * the score is WPM/accuracy/how-far-you-got, not endurance.
 */
export const TIME_LIMIT_MS = 120_000;

/**
 * Compute the canonical score for a run. Uses double-precision throughout with
 * no intermediate rounding; formatting/rounding is a display concern.
 */
export function computeScore(input: ScoreInput): Score {
  const { correctChars, correctKeystrokes, incorrectKeystrokes, totalChars, elapsedMs } = input;

  const minutes = elapsedMs / 60000;
  const wpm = minutes > 0 ? correctChars / CHARS_PER_WORD / minutes : 0;
  const rawWpm =
    minutes > 0 ? (correctKeystrokes + incorrectKeystrokes) / CHARS_PER_WORD / minutes : 0;

  const totalKeystrokes = correctKeystrokes + incorrectKeystrokes;
  const accuracy = totalKeystrokes > 0 ? correctKeystrokes / totalKeystrokes : 1;

  const completion = totalChars > 0 ? correctChars / totalChars : 0;

  return {
    wpm,
    rawWpm,
    accuracy,
    errors: incorrectKeystrokes,
    completion,
    elapsedMs,
  };
}

/** Format WPM for display: whole number, never negative. */
export function formatWpm(wpm: number): number {
  return Math.max(0, Math.round(wpm));
}

/** Format accuracy [0,1] as a percentage with one decimal place, e.g. 98.7. */
export function formatAccuracyPct(accuracy: number): string {
  const pct = Math.max(0, Math.min(1, accuracy)) * 100;
  return pct.toFixed(1);
}

/** Format an elapsed duration in ms as M:SS. */
export function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
