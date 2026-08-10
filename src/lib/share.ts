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

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Native share sheets are only worth invoking on real mobile devices. Desktop
 * browsers (notably Brave) may expose navigator.share but fail or hang the
 * flow - and a failed share consumes the click's user activation, which then
 * blocks the clipboard fallback until the NEXT click. Desktop users want a
 * copy anyway.
 */
function isMobileLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports itself as macOS but has a touchscreen.
  return (navigator.maxTouchPoints ?? 0) > 2 && /Mac/.test(ua);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Share via the native share sheet on mobile devices; copy to the clipboard
 * everywhere else. Returns what happened so the UI can give tactile feedback.
 */
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (!nav) return 'failed';

  if (typeof nav.share === 'function' && isMobileLike()) {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      // The user closed the share sheet on purpose: quietly do nothing.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      // Anything else: fall through to the clipboard.
    }
  }

  return (await copyToClipboard(text)) ? 'copied' : 'failed';
}
