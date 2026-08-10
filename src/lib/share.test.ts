import { describe, it, expect } from 'vitest';
import { buildShareText } from './share';

describe('buildShareText', () => {
  it('matches the documented spoiler-free format', () => {
    const text = buildShareText({
      gameNumber: 221,
      wpm: 86,
      accuracy: 0.987,
      elapsedMs: 234000, // 3:54
      storyCount: 12,
      streak: 7,
    });
    expect(text).toBe(['Keywulf #221', '86 WPM | 98.7%', '3:54 | 12 stories', 'Streak 7', 'keywulf.com'].join('\n'));
  });

  it('uses singular "story" for a single story and stays stats-only', () => {
    const text = buildShareText({
      gameNumber: 1,
      wpm: 50,
      accuracy: 1,
      elapsedMs: 60000,
      storyCount: 1,
      streak: 1,
    });
    expect(text).toContain('1 story'); // singular
    // The share text is only stats + brand: no free-form prose lines.
    expect(text.split('\n')).toEqual(['Keywulf #1', '50 WPM | 100.0%', '1:00 | 1 story', 'Streak 1', 'keywulf.com']);
  });

  it('labels practice runs and omits streak', () => {
    const text = buildShareText({
      gameNumber: 221,
      wpm: 90,
      accuracy: 0.95,
      elapsedMs: 120000,
      storyCount: 12,
      streak: 7,
      practice: true,
    });
    expect(text).toContain('Keywulf #221 (practice)');
    expect(text).not.toContain('Streak');
  });

  it('rounds WPM and formats accuracy to one decimal', () => {
    const text = buildShareText({
      gameNumber: 5,
      wpm: 86.7,
      accuracy: 0.9,
      elapsedMs: 65000,
      storyCount: 10,
      streak: 2,
    });
    expect(text).toContain('87 WPM | 90.0%');
    expect(text).toContain('1:05 | 10 stories');
  });
});
