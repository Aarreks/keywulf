import { describe, it, expect } from 'vitest';
import { buildShareText } from './share';

describe('buildShareText', () => {
  it('matches the documented spoiler-free format', () => {
    const text = buildShareText({
      gameNumber: 221,
      wpm: 86,
      accuracy: 0.987,
      elapsedMs: 120000, // 2:00
      storiesCleared: 9,
      storyCount: 14,
      streak: 7,
    });
    expect(text).toBe(
      ['Keywulf #221', '86 WPM | 98.7%', '9/14 stories in 2:00', 'Streak 7', 'keywulf.com'].join('\n'),
    );
  });

  it('is stats-only: no free-form prose lines', () => {
    const text = buildShareText({
      gameNumber: 1,
      wpm: 50,
      accuracy: 1,
      elapsedMs: 60000,
      storiesCleared: 14,
      storyCount: 14,
      streak: 1,
    });
    expect(text.split('\n')).toEqual([
      'Keywulf #1',
      '50 WPM | 100.0%',
      '14/14 stories in 1:00',
      'Streak 1',
      'keywulf.com',
    ]);
  });

  it('labels practice runs and omits streak', () => {
    const text = buildShareText({
      gameNumber: 221,
      wpm: 90,
      accuracy: 0.95,
      elapsedMs: 120000,
      storiesCleared: 8,
      storyCount: 14,
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
      storiesCleared: 10,
      storyCount: 13,
      streak: 2,
    });
    expect(text).toContain('87 WPM | 90.0%');
    expect(text).toContain('10/13 stories in 1:05');
  });
});
