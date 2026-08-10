import { describe, it, expect } from 'vitest';
import { computeStreaks } from './streak';
import { gameNumberForDate } from './gameNumber';

const G = gameNumberForDate;

describe('computeStreaks', () => {
  it('returns zeros for no completions', () => {
    expect(computeStreaks([], G('2026-08-09'))).toEqual({ current: 0, longest: 0 });
  });

  it('counts a single completion today as streak 1', () => {
    const today = G('2026-08-09');
    expect(computeStreaks(['2026-08-09'], today)).toEqual({ current: 1, longest: 1 });
  });

  it('counts consecutive days ending today', () => {
    const today = G('2026-08-09');
    const dates = ['2026-08-07', '2026-08-08', '2026-08-09'];
    expect(computeStreaks(dates, today)).toEqual({ current: 3, longest: 3 });
  });

  it('keeps the current streak alive if the last completion was yesterday', () => {
    const today = G('2026-08-10');
    const dates = ['2026-08-08', '2026-08-09'];
    expect(computeStreaks(dates, today)).toEqual({ current: 2, longest: 2 });
  });

  it('resets the current streak if the last completion is older than yesterday', () => {
    const today = G('2026-08-12');
    const dates = ['2026-08-08', '2026-08-09'];
    expect(computeStreaks(dates, today)).toEqual({ current: 0, longest: 2 });
  });

  it('computes longest across a gap while current reflects only the recent run', () => {
    const today = G('2026-08-20');
    const dates = [
      // a 4-day run
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
      // gap, then a 2-day run ending today
      '2026-08-19', '2026-08-20',
    ];
    expect(computeStreaks(dates, today)).toEqual({ current: 2, longest: 4 });
  });

  it('is order-independent and de-duplicates', () => {
    const today = G('2026-08-09');
    const dates = ['2026-08-09', '2026-08-08', '2026-08-09', '2026-08-07'];
    expect(computeStreaks(dates, today)).toEqual({ current: 3, longest: 3 });
  });

  it('ignores unparseable dates', () => {
    const today = G('2026-08-09');
    const dates = ['garbage', '2026-08-09'];
    expect(computeStreaks(dates, today)).toEqual({ current: 1, longest: 1 });
  });
});
