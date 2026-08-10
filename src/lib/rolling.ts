// Rolling performance signal for Keywulf's live visual system.
//
// This produces a smoothed "energy" value in [0, 1] that the UI maps to color,
// intensity, and ambient motion. It is deliberately NOT raw WPM: a fast but
// error-heavy run should not look like an excellent one, so accuracy gates the
// signal. The value is smoothed over time so colors drift rather than flash.
//
// The tracker keeps only a small trailing window of keystroke samples, so it is
// O(window) per update and never grows unbounded. It runs inside the typing
// engine (outside React render) and is read via requestAnimationFrame.

export interface KeystrokeSample {
  t: number; // timestamp (ms, monotonic e.g. performance.now())
  correct: boolean;
}

export interface WindowStats {
  rollingWpm: number;
  rollingAccuracy: number; // [0,1]
}

/** WPM value that maps to a full "speed" contribution of 1. */
export const REFERENCE_WPM = 110;

/** Trailing window used for rolling stats. */
export const ROLLING_WINDOW_MS = 4000;

/** Half-life of the energy smoothing, in ms (smaller = more reactive). */
export const ENERGY_HALF_LIFE_MS = 340;

/** Compute rolling WPM and accuracy over the samples within `windowMs` of now. */
export function windowStats(
  samples: readonly KeystrokeSample[],
  now: number,
  windowMs: number = ROLLING_WINDOW_MS,
): WindowStats {
  const cutoff = now - windowMs;
  let correct = 0;
  let total = 0;
  let earliest = now;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.t < cutoff) break;
    total += 1;
    if (s.correct) correct += 1;
    if (s.t < earliest) earliest = s.t;
  }
  if (total === 0) return { rollingWpm: 0, rollingAccuracy: 1 };

  // Use the actual span covered by the window's samples (min 1s to avoid a tiny
  // burst producing an absurd WPM).
  const spanMs = Math.max(now - earliest, 1000);
  const minutes = spanMs / 60000;
  const rollingWpm = correct / 5 / minutes;
  const rollingAccuracy = correct / total;
  return { rollingWpm, rollingAccuracy };
}

/**
 * Map rolling stats to a target energy in [0, 1]. Speed drives it; accuracy
 * gates it, but never below a floor (we don't punish the player into a dead,
 * ugly screen). Accuracy from 80%..100% scales the accuracy factor 0..1.
 */
export function energyTarget(stats: WindowStats): number {
  const speed = clamp01(stats.rollingWpm / REFERENCE_WPM);
  const accFactor = clamp01((stats.rollingAccuracy - 0.8) / 0.2);
  const energy = speed * (0.35 + 0.65 * accFactor);
  return clamp01(energy);
}

/**
 * Exponentially approach `target` from `prev` over `dtMs`, given a half-life.
 * Frame-rate independent.
 */
export function smoothEnergy(
  prev: number,
  target: number,
  dtMs: number,
  halfLifeMs: number = ENERGY_HALF_LIFE_MS,
): number {
  if (dtMs <= 0) return prev;
  const alpha = 1 - Math.pow(2, -dtMs / halfLifeMs);
  return clamp01(prev + (target - prev) * alpha);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Stateful tracker used by the typing engine. Push a sample per character
 * keystroke; call `read(now)` each animation frame to get the smoothed signal.
 */
export class RollingTracker {
  private samples: KeystrokeSample[] = [];
  private energy = 0;
  private lastRead: number | null = null;

  push(sample: KeystrokeSample): void {
    this.samples.push(sample);
    // Trim anything well outside the window to bound memory.
    const cutoff = sample.t - ROLLING_WINDOW_MS * 2;
    if (this.samples.length > 256) {
      this.samples = this.samples.filter((s) => s.t >= cutoff);
    }
  }

  read(now: number): { energy: number; rollingWpm: number; rollingAccuracy: number } {
    const stats = windowStats(this.samples, now);
    const target = energyTarget(stats);
    const dt = this.lastRead === null ? ENERGY_HALF_LIFE_MS : now - this.lastRead;
    this.energy = smoothEnergy(this.energy, target, dt);
    this.lastRead = now;
    return { energy: this.energy, rollingWpm: stats.rollingWpm, rollingAccuracy: stats.rollingAccuracy };
  }

  reset(): void {
    this.samples = [];
    this.energy = 0;
    this.lastRead = null;
  }
}
