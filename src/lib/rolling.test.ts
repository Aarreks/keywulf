import { describe, it, expect } from 'vitest';
import {
  windowStats,
  energyTarget,
  smoothEnergy,
  RollingTracker,
  REFERENCE_WPM,
  type KeystrokeSample,
} from './rolling';

function run(count: number, spacingMs: number, correct: boolean, start = 0): KeystrokeSample[] {
  const out: KeystrokeSample[] = [];
  for (let i = 0; i < count; i++) out.push({ t: start + i * spacingMs, correct });
  return out;
}

describe('windowStats', () => {
  it('returns neutral stats with no samples', () => {
    expect(windowStats([], 1000)).toEqual({ rollingWpm: 0, rollingAccuracy: 1 });
  });

  it('only considers samples inside the window', () => {
    const samples: KeystrokeSample[] = [
      { t: 0, correct: true }, // outside a 4s window ending at 10000
      { t: 6100, correct: true },
      { t: 6200, correct: false },
    ];
    const s = windowStats(samples, 10000, 4000);
    expect(s.rollingAccuracy).toBeCloseTo(0.5, 5);
  });

  it('computes accuracy as correct / total in the window', () => {
    const samples = [...run(9, 50, true), { t: 500, correct: false }];
    const s = windowStats(samples, 550);
    expect(s.rollingAccuracy).toBeCloseTo(9 / 10, 5);
  });

  it('does not explode WPM on a tiny burst (min 1s span)', () => {
    // 5 correct chars in 100ms would be ~600 WPM if unclamped; span floored to 1s.
    const s = windowStats(run(5, 25, true), 100);
    // 5 chars / 5 / (1/60) = 60 wpm
    expect(s.rollingWpm).toBeCloseTo(60, 0);
  });
});

describe('energyTarget', () => {
  it('is 0 with no speed', () => {
    expect(energyTarget({ rollingWpm: 0, rollingAccuracy: 1 })).toBe(0);
  });

  it('rises with speed at full accuracy', () => {
    const low = energyTarget({ rollingWpm: 40, rollingAccuracy: 1 });
    const high = energyTarget({ rollingWpm: REFERENCE_WPM, rollingAccuracy: 1 });
    expect(high).toBeGreaterThan(low);
    expect(high).toBeCloseTo(1, 5);
  });

  it('gates energy by accuracy but keeps a floor', () => {
    const clean = energyTarget({ rollingWpm: REFERENCE_WPM, rollingAccuracy: 1 });
    const sloppy = energyTarget({ rollingWpm: REFERENCE_WPM, rollingAccuracy: 0.8 });
    expect(sloppy).toBeLessThan(clean);
    // Floor: at ref speed with poor accuracy, energy is still the 0.35 floor.
    expect(sloppy).toBeCloseTo(0.35, 5);
  });

  it('never leaves [0,1]', () => {
    const e = energyTarget({ rollingWpm: 10_000, rollingAccuracy: 2 });
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(1);
  });
});

describe('smoothEnergy', () => {
  it('moves halfway toward target after one half-life', () => {
    expect(smoothEnergy(0, 1, 340, 340)).toBeCloseTo(0.5, 5);
  });

  it('returns prev when dt is non-positive', () => {
    expect(smoothEnergy(0.3, 1, 0)).toBe(0.3);
  });

  it('converges toward target over many steps', () => {
    let e = 0;
    for (let i = 0; i < 50; i++) e = smoothEnergy(e, 1, 100);
    expect(e).toBeGreaterThan(0.99);
  });
});

describe('RollingTracker', () => {
  it('produces a rising energy for fast clean typing and resets cleanly', () => {
    const tracker = new RollingTracker();
    let t = 0;
    for (let i = 0; i < 40; i++) {
      tracker.push({ t, correct: true });
      t += 60;
    }
    const read = tracker.read(t);
    expect(read.energy).toBeGreaterThan(0);
    expect(read.rollingAccuracy).toBe(1);

    tracker.reset();
    const after = tracker.read(t + 1000);
    expect(after.energy).toBe(0);
  });
});
