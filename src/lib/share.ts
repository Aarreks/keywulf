// Spoiler-free shareable result text, generated locally. No headlines are ever
// included so sharing never leaks the day's stories.

import { formatWpm, formatAccuracyPct, formatDuration } from './scoring';

export interface ShareData {
  gameNumber: number;
  wpm: number;
  accuracy: number; // [0,1]
  elapsedMs: number;
  /** Stories fully typed before the run ended. */
  storiesCleared: number;
  /** Total stories in the day's briefing. */
  storyCount: number;
  streak: number;
  practice?: boolean;
}

/**
 * Build the share text, e.g.:
 *
 *   Keywulf #221
 *   86 WPM | 98.7%
 *   9/14 stories in 2:00
 *   Streak 7
 *   keywulf.com
 */
export function buildShareText(data: ShareData): string {
  const lines = [
    `Keywulf #${data.gameNumber}${data.practice ? ' (practice)' : ''}`,
    `${formatWpm(data.wpm)} WPM | ${formatAccuracyPct(data.accuracy)}%`,
    `${data.storiesCleared}/${data.storyCount} stories in ${formatDuration(data.elapsedMs)}`,
  ];
  if (!data.practice) lines.push(`Streak ${data.streak}`);
  lines.push('keywulf.com');
  return lines.join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/**
 * Share via the Web Share API where available, otherwise copy to clipboard.
 * Returns what happened so the UI can give tactile feedback.
 */
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav && typeof nav.share === 'function') {
      await nav.share({ text });
      return 'shared';
    }
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return 'copied';
    }
  } catch (err) {
    // User cancelled the share sheet, or permission denied. Treat cancel as a
    // non-failure by trying clipboard as a fallback where possible.
    if (err instanceof DOMException && err.name === 'AbortError') return 'failed';
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return 'copied';
      }
    } catch {
      /* fall through */
    }
  }
  return 'failed';
}
