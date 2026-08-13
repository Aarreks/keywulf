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
  /** Where the run was typed; a phone WPM is a different feat. */
  device?: 'mobile' | 'desktop';
}

// Emojis are built from code points so this source file stays pure ASCII.
// (Share text is never typed by the player, so emoji are fine here.)
const E = {
  wolf: String.fromCodePoint(0x1f43a), // wolf face
  keys: String.fromCodePoint(0x2328, 0xfe0f), // keyboard (desktop runs)
  phone: String.fromCodePoint(0x1f4f1), // mobile phone (mobile runs)
  target: String.fromCodePoint(0x1f3af), // direct hit (accuracy)
  timer: String.fromCodePoint(0x23f1, 0xfe0f), // stopwatch
  cleared: String.fromCodePoint(0x1f7e9), // green square (story cleared)
  missed: String.fromCodePoint(0x2b1c), // white square (story remaining)
  fire: String.fromCodePoint(0x1f525), // streak
};

/** Which kind of device this browser is, for the share text's device tag. */
export function detectDevice(): 'mobile' | 'desktop' {
  return isMobileLike() ? 'mobile' : 'desktop';
}

/**
 * Build the spoiler-free share text, Wordle-style, e.g.:
 *
 *   [wolf] Keywulf #222
 *   [keyboard] 86 WPM | [target] 98.7% | [timer] 2:00
 *   [green x5][white x7] 5/12
 *   [fire] Streak 7
 *   keywulf.com
 */
export function buildShareText(data: ShareData): string {
  const deviceEmoji = data.device === 'mobile' ? E.phone : E.keys;
  const deviceTag = data.device ? ` (${data.device})` : '';
  const lines = [
    `${E.wolf} Keywulf #${data.gameNumber}${data.practice ? ' (practice)' : ''}`,
    `${deviceEmoji} ${formatWpm(data.wpm)} WPM${deviceTag} | ${E.target} ${formatAccuracyPct(data.accuracy)}% | ${E.timer} ${formatDuration(data.elapsedMs)}`,
  ];
  if (data.storyCount > 0) {
    const done = Math.max(0, Math.min(data.storiesCleared, data.storyCount));
    const bar = E.cleared.repeat(done) + E.missed.repeat(data.storyCount - done);
    lines.push(`${bar} ${done}/${data.storyCount}`);
  }
  if (!data.practice) lines.push(`${E.fire} Streak ${data.streak}`);
  // Mobile share sheets / messaging apps only reliably auto-link a full URL.
  lines.push(data.device === 'mobile' ? 'https://keywulf.com' : 'keywulf.com');
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

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function copyToClipboard(text: string): Promise<boolean> {
  // Clipboard writes require a focused document. When the tab was only just
  // re-activated, the click can land a frame before focus is restored and
  // writeText rejects with "Document is not focused" - so nudge focus and
  // retry once before falling back.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (typeof document !== 'undefined' && !document.hasFocus()) {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      await wait(120);
    }
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      await wait(120);
    }
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
