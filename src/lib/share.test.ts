import { describe, it, expect } from 'vitest';
import { buildShareText } from './share';

// Emoji are constructed from code points so this file stays pure ASCII.
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const WOLF = cp(0x1f43a);
const KEYS = cp(0x2328, 0xfe0f);
const TARGET = cp(0x1f3af);
const TIMER = cp(0x23f1, 0xfe0f);
const FULL = cp(0x1f315);
const GIBBOUS = cp(0x1f316);
const HALF = cp(0x1f317);
const CRESCENT = cp(0x1f318);
const NEW = cp(0x1f311);
const FIRE = cp(0x1f525);
const PHONE = cp(0x1f4f1);

describe('buildShareText', () => {
  it('matches the emoji daily-game format (desktop)', () => {
    const text = buildShareText({
      gameNumber: 222,
      wpm: 86,
      accuracy: 0.987,
      elapsedMs: 120000, // 2:00
      storiesCleared: 5,
      storyCount: 12,
      streak: 7,
      device: 'desktop',
    });
    expect(text).toBe(
      [
        `${WOLF} Keywulf #222`,
        `${KEYS} 86 WPM (desktop) | ${TARGET} 98.7% | ${TIMER} 2:00`,
        `${FULL.repeat(5)}${NEW.repeat(7)} 5/12`,
        `${FIRE} Streak 7`,
        'keywulf.com',
      ].join('\n'),
    );
  });

  it('tags mobile runs with the phone emoji and word', () => {
    const text = buildShareText({
      gameNumber: 222,
      wpm: 45,
      accuracy: 0.944,
      elapsedMs: 120000,
      storiesCleared: 5,
      storyCount: 12,
      streak: 1,
      device: 'mobile',
    });
    expect(text).toContain(`${PHONE} 45 WPM (mobile) |`);
    expect(text).not.toContain(KEYS);
    // Mobile gets a full URL (apps auto-link it) with a per-game query so
    // messaging apps scrape a fresh link preview instead of a cached one.
    expect(text.endsWith('https://keywulf.com/?g=222')).toBe(true);
  });

  it('omits the device tag when unknown', () => {
    const text = buildShareText({
      gameNumber: 222,
      wpm: 86,
      accuracy: 0.987,
      elapsedMs: 120000,
      storiesCleared: 5,
      storyCount: 12,
      streak: 7,
    });
    expect(text).toContain(`${KEYS} 86 WPM | ${TARGET}`);
    expect(text).not.toContain('(desktop)');
    expect(text).not.toContain('(mobile)');
  });

  it('shows a full green bar for a cleared briefing', () => {
    const text = buildShareText({
      gameNumber: 300,
      wpm: 104,
      accuracy: 1,
      elapsedMs: 101000, // 1:41
      storiesCleared: 12,
      storyCount: 12,
      streak: 30,
    });
    expect(text).toContain(`${FULL.repeat(12)} 12/12`);
    expect(text).not.toContain(NEW);
  });

  it('shows a partial moon for the story-in-progress by fraction', () => {
    const base = {
      gameNumber: 222,
      wpm: 76,
      accuracy: 0.982,
      elapsedMs: 120000,
      storiesCleared: 5,
      storyCount: 12,
      streak: 4,
    };
    const at = (f: number) =>
      buildShareText({ ...base, currentStoryFraction: f }).split('\n')[2];
    expect(at(0.8)).toBe(`${FULL.repeat(5)}${GIBBOUS}${NEW.repeat(6)} 5/12`);
    expect(at(0.5)).toBe(`${FULL.repeat(5)}${HALF}${NEW.repeat(6)} 5/12`);
    expect(at(0.2)).toBe(`${FULL.repeat(5)}${CRESCENT}${NEW.repeat(6)} 5/12`);
    expect(at(0.05)).toBe(`${FULL.repeat(5)}${NEW.repeat(7)} 5/12`);
    // Even 99% through, an uncleared story never earns a full moon.
    expect(at(0.99)).toBe(`${FULL.repeat(5)}${GIBBOUS}${NEW.repeat(6)} 5/12`);
  });

  it('labels practice runs and omits the streak line', () => {
    const text = buildShareText({
      gameNumber: 222,
      wpm: 90,
      accuracy: 0.95,
      elapsedMs: 120000,
      storiesCleared: 6,
      storyCount: 12,
      streak: 7,
      practice: true,
    });
    expect(text).toContain(`${WOLF} Keywulf #222 (practice)`);
    expect(text).not.toContain(FIRE);
    expect(text).not.toContain('Streak');
  });

  it('omits the story bar when storyCount is unknown (legacy results)', () => {
    const text = buildShareText({
      gameNumber: 5,
      wpm: 50,
      accuracy: 1,
      elapsedMs: 60000,
      storiesCleared: 0,
      storyCount: 0,
      streak: 2,
    });
    expect(text).not.toContain(FULL);
    expect(text).not.toContain(NEW);
    expect(text).toContain('keywulf.com');
  });

  it('clamps an out-of-range cleared count', () => {
    const text = buildShareText({
      gameNumber: 5,
      wpm: 50,
      accuracy: 1,
      elapsedMs: 60000,
      storiesCleared: 99,
      storyCount: 12,
      streak: 2,
    });
    expect(text).toContain(`${FULL.repeat(12)} 12/12`);
  });

  it('rounds WPM and formats accuracy to one decimal', () => {
    const text = buildShareText({
      gameNumber: 5,
      wpm: 86.7,
      accuracy: 0.9,
      elapsedMs: 65000,
      storiesCleared: 3,
      storyCount: 12,
      streak: 2,
    });
    expect(text).toContain('87 WPM');
    expect(text).toContain('90.0%');
    expect(text).toContain('1:05');
  });
});
