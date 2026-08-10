import { describe, it, expect, beforeEach } from 'vitest';
import {
  defaultState,
  migrate,
  loadState,
  saveState,
  hasCompleted,
  recordOfficialResult,
  markOfficialStarted,
  updateSettings,
  aggregateStats,
  pruneResults,
  saveInProgress,
  getResumable,
  clearInProgress,
  MAX_RETAINED_RESULTS,
  SCHEMA_VERSION,
  STORAGE_KEY,
  type OfficialResult,
  type KeywulfState,
} from './storage';
import { gameNumberForDate } from './gameNumber';

function result(date: string, wpm: number, accuracy = 0.98): OfficialResult {
  return {
    date,
    gameNumber: gameNumberForDate(date),
    wpm,
    accuracy,
    elapsedMs: 120000,
    errors: 3,
    storiesCleared: 9,
    storyCount: 14,
    completedAt: '2026-08-09T00:20:00.000Z',
  };
}

describe('recordOfficialResult (duplicate protection)', () => {
  it('records a first official result and updates totals', () => {
    let s = defaultState();
    s = recordOfficialResult(s, result('2026-08-09', 80));
    expect(hasCompleted(s, '2026-08-09')).toBe(true);
    expect(s.totals.completed).toBe(1);
    expect(s.totals.bestWpm).toBe(80);
  });

  it('never overwrites an existing official result for the same day', () => {
    let s = defaultState();
    s = recordOfficialResult(s, result('2026-08-09', 80));
    const before = s;
    s = recordOfficialResult(s, result('2026-08-09', 200)); // a "practice-like" better run
    expect(s).toBe(before); // unchanged reference
    expect(s.results['2026-08-09'].wpm).toBe(80);
    expect(s.totals.completed).toBe(1);
    expect(s.totals.bestWpm).toBe(80);
  });

  it('tracks best WPM across different days', () => {
    let s = defaultState();
    s = recordOfficialResult(s, result('2026-08-09', 80));
    s = recordOfficialResult(s, result('2026-08-10', 95));
    s = recordOfficialResult(s, result('2026-08-11', 70));
    expect(s.totals.bestWpm).toBe(95);
    expect(s.totals.completed).toBe(3);
  });
});

describe('markOfficialStarted', () => {
  it('increments started once per new day', () => {
    let s = defaultState();
    s = markOfficialStarted(s, '2026-08-09');
    expect(s.totals.started).toBe(1);
    // marking again after an in-progress snapshot does not double count
    s = saveInProgress(s, {
      date: '2026-08-09',
      gameNumber: gameNumberForDate('2026-08-09'),
      typedCount: 10,
      correctKeystrokes: 10,
      incorrectKeystrokes: 0,
      elapsedMs: 5000,
      updatedAt: '2026-08-09T00:01:00.000Z',
    });
    s = markOfficialStarted(s, '2026-08-09');
    expect(s.totals.started).toBe(1);
  });

  it('does not start a day that is already completed', () => {
    let s = defaultState();
    s = recordOfficialResult(s, result('2026-08-09', 80));
    const startedBefore = s.totals.started;
    s = markOfficialStarted(s, '2026-08-09');
    expect(s.totals.started).toBe(startedBefore);
  });
});

describe('in-progress resume', () => {
  it('is resumable only for today, unfinished, with progress', () => {
    let s = defaultState();
    s = saveInProgress(s, {
      date: '2026-08-09',
      gameNumber: gameNumberForDate('2026-08-09'),
      typedCount: 42,
      correctKeystrokes: 40,
      incorrectKeystrokes: 2,
      elapsedMs: 30000,
      updatedAt: '2026-08-09T00:02:00.000Z',
    });
    expect(getResumable(s, '2026-08-09')?.typedCount).toBe(42);
    expect(getResumable(s, '2026-08-10')).toBeNull();

    // Once completed, it is no longer resumable and the snapshot is cleared.
    s = recordOfficialResult(s, result('2026-08-09', 80));
    expect(getResumable(s, '2026-08-09')).toBeNull();
    expect(s.inProgress).toBeNull();
  });

  it('clearInProgress removes the snapshot', () => {
    let s = defaultState();
    s = saveInProgress(s, {
      date: '2026-08-09',
      gameNumber: 1,
      typedCount: 5,
      correctKeystrokes: 5,
      incorrectKeystrokes: 0,
      elapsedMs: 1000,
      updatedAt: 'x',
    });
    s = clearInProgress(s);
    expect(s.inProgress).toBeNull();
  });
});

describe('pruneResults', () => {
  it('keeps only the most recent MAX_RETAINED_RESULTS by date', () => {
    const results: Record<string, OfficialResult> = {};
    for (let i = 0; i < MAX_RETAINED_RESULTS + 10; i++) {
      // spread across months to make valid dates
      const date = `2026-${(Math.floor(i / 28) + 1).toString().padStart(2, '0')}-${((i % 28) + 1)
        .toString()
        .padStart(2, '0')}`;
      results[date] = result(date, 50 + i);
    }
    const pruned = pruneResults(results);
    expect(Object.keys(pruned).length).toBe(MAX_RETAINED_RESULTS);
  });
});

describe('migrate', () => {
  it('returns a clean default for junk input', () => {
    expect(migrate(null).schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrate('nope').results).toEqual({});
    expect(migrate(42).totals.completed).toBe(0);
  });

  it('recovers results and derives totals from a partial older blob', () => {
    const old = {
      results: {
        '2026-08-09': { gameNumber: 221, wpm: 88, accuracy: 0.97, elapsedMs: 1, errors: 0, completedAt: 'x' },
        'bad-date': { wpm: 999 },
      },
      settings: { theme: 'dark' },
    };
    const s = migrate(old);
    expect(Object.keys(s.results)).toEqual(['2026-08-09']);
    expect(s.settings.theme).toBe('dark');
    // Totals derived from retained results when missing.
    expect(s.totals.completed).toBe(1);
    expect(s.totals.bestWpm).toBe(88);
  });

  it('preserves a long streak through migration (does not wipe results)', () => {
    const dates: Record<string, OfficialResult> = {};
    for (let i = 1; i <= 10; i++) {
      const date = `2026-08-${i.toString().padStart(2, '0')}`;
      dates[date] = result(date, 70);
    }
    const s = migrate({ results: dates });
    const agg = aggregateStats(s, gameNumberForDate('2026-08-10'));
    expect(agg.longest).toBe(10);
  });
});

describe('settings', () => {
  it('merges partial settings', () => {
    let s = defaultState();
    expect(s.settings.theme).toBe('system');
    s = updateSettings(s, { theme: 'dark', haptics: false });
    expect(s.settings.theme).toBe('dark');
    expect(s.settings.haptics).toBe(false);
    expect(s.settings.showGraph).toBe(true);
  });
});

describe('aggregateStats', () => {
  it('computes averages, streaks, and recent order', () => {
    let s = defaultState();
    s = recordOfficialResult(s, result('2026-08-07', 60, 0.9));
    s = recordOfficialResult(s, result('2026-08-08', 80, 1.0));
    s = recordOfficialResult(s, result('2026-08-09', 100, 0.95));
    const agg = aggregateStats(s, gameNumberForDate('2026-08-09'));
    expect(agg.current).toBe(3);
    expect(agg.longest).toBe(3);
    expect(agg.bestWpm).toBe(100);
    expect(agg.averageWpm).toBeCloseTo(80, 5);
    expect(agg.averageAccuracy).toBeCloseTo((0.9 + 1.0 + 0.95) / 3, 5);
    expect(agg.recent[0].date).toBe('2026-08-09'); // most recent first
  });
});

describe('loadState / saveState round-trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns default when nothing stored', () => {
    expect(loadState().totals.completed).toBe(0);
  });

  it('persists and reloads official results', () => {
    let s = defaultState();
    s = recordOfficialResult(s, result('2026-08-09', 88));
    saveState(s);
    const reloaded = loadState();
    expect(hasCompleted(reloaded, '2026-08-09')).toBe(true);
    expect(reloaded.results['2026-08-09'].wpm).toBe(88);
  });

  it('falls back to default on corrupt stored JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const s: KeywulfState = loadState();
    expect(s.schemaVersion).toBe(SCHEMA_VERSION);
    expect(s.results).toEqual({});
  });
});
