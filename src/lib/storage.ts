// Local, anonymous persistence for Keywulf.
//
// Everything lives in one versioned localStorage blob. There is NO account and
// NO server; this browser's storage IS the local identity. The schema is
// versioned and migrated so a future app update never casually destroys a long
// streak.
//
// Key invariants:
//  - Exactly one OFFICIAL result per challenge date. It is written once and
//    never overwritten (duplicate-completion protection).
//  - Practice runs never touch official results, streak, or lifetime stats.

import { computeStreaks, type Streaks } from './streak';

export const STORAGE_KEY = 'keywulf';
export const SCHEMA_VERSION = 1;

/** How many recent official results to retain in full (for averages/history). */
export const MAX_RETAINED_RESULTS = 60;

export type ThemePref = 'system' | 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large';

export interface Settings {
  theme: ThemePref;
  /** Reduce visual intensity of the dynamic system (still fully playable). */
  reducedIntensity: boolean;
  /** Optional haptics on supported mobile devices (completion/milestone only). */
  haptics: boolean;
  /** Show the live telemetry graph during play. */
  showGraph: boolean;
  fontSize: FontSize;
}

export interface OfficialResult {
  date: string; // YYYY-MM-DD (UTC) - the challenge day
  gameNumber: number;
  wpm: number; // display WPM (rounded)
  accuracy: number; // [0,1]
  elapsedMs: number;
  errors: number;
  /** Stories fully typed before the run ended (2-minute cap). */
  storiesCleared: number;
  /** Total stories in that day's briefing. */
  storyCount: number;
  /** Fraction (0..1) of the story-in-progress typed when the run ended. */
  storyFraction?: number;
  completedAt: string; // ISO timestamp
}

/** A lightweight snapshot for safely resuming today's in-progress attempt. */
export interface InProgress {
  date: string;
  gameNumber: number;
  /** Number of characters already typed into the corpus. */
  typedCount: number;
  correctKeystrokes: number;
  incorrectKeystrokes: number;
  /** Accumulated elapsed time in ms (persisted, not wall-clock across reload). */
  elapsedMs: number;
  updatedAt: string;
}

export interface Totals {
  /** Lifetime official attempts started (may exceed completed). */
  started: number;
  /** Lifetime official completions (may exceed retained results). */
  completed: number;
  /** Best official WPM ever recorded (global best). */
  bestWpm: number;
}

export interface KeywulfState {
  schemaVersion: number;
  /** Official results keyed by challenge date. Pruned to MAX_RETAINED_RESULTS. */
  results: Record<string, OfficialResult>;
  totals: Totals;
  settings: Settings;
  inProgress: InProgress | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  reducedIntensity: false,
  haptics: true,
  showGraph: true,
  fontSize: 'medium',
};

export function defaultState(nowIso: string = new Date().toISOString()): KeywulfState {
  return {
    schemaVersion: SCHEMA_VERSION,
    results: {},
    totals: { started: 0, completed: 0, bestWpm: 0 },
    settings: { ...DEFAULT_SETTINGS },
    inProgress: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Migration: bring any older/partial persisted shape up to the current schema
// without discarding recoverable data.
// ---------------------------------------------------------------------------
export function migrate(raw: unknown): KeywulfState {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  // Results: keep only well-formed entries.
  const results: Record<string, OfficialResult> = {};
  if (r.results && typeof r.results === 'object') {
    for (const [date, val] of Object.entries(r.results as Record<string, unknown>)) {
      const res = coerceResult(date, val);
      if (res) results[date] = res;
    }
  }

  const totals = coerceTotals(r.totals, results);
  const settings = coerceSettings(r.settings);
  const inProgress = coerceInProgress(r.inProgress);

  return {
    schemaVersion: SCHEMA_VERSION,
    results: pruneResults(results),
    totals,
    settings,
    inProgress,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : base.createdAt,
    updatedAt: base.updatedAt,
  };
}

function coerceResult(date: string, val: unknown): OfficialResult | null {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    date,
    gameNumber: num(v.gameNumber),
    wpm: num(v.wpm),
    accuracy: Math.max(0, Math.min(1, num(v.accuracy))),
    elapsedMs: num(v.elapsedMs),
    errors: num(v.errors),
    // Fields added with the 2-minute format; older blobs default to 0.
    storiesCleared: num(v.storiesCleared),
    storyCount: num(v.storyCount),
    storyFraction: Math.max(0, Math.min(1, num(v.storyFraction))),
    completedAt: typeof v.completedAt === 'string' ? v.completedAt : new Date().toISOString(),
  };
}

function coerceTotals(val: unknown, results: Record<string, OfficialResult>): Totals {
  const v = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;
  const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const resultValues = Object.values(results);
  const derivedBest = resultValues.reduce((m, r) => Math.max(m, r.wpm), 0);
  const derivedCompleted = resultValues.length;
  return {
    started: Math.max(num(v.started), derivedCompleted),
    completed: Math.max(num(v.completed), derivedCompleted),
    bestWpm: Math.max(num(v.bestWpm), derivedBest),
  };
}

function coerceSettings(val: unknown): Settings {
  const v = (val && typeof val === 'object' ? val : {}) as Record<string, unknown>;
  const theme: ThemePref =
    v.theme === 'light' || v.theme === 'dark' || v.theme === 'system' ? v.theme : 'system';
  const fontSize: FontSize =
    v.fontSize === 'small' || v.fontSize === 'large' || v.fontSize === 'medium'
      ? v.fontSize
      : 'medium';
  const bool = (x: unknown, d: boolean) => (typeof x === 'boolean' ? x : d);
  return {
    theme,
    reducedIntensity: bool(v.reducedIntensity, false),
    haptics: bool(v.haptics, true),
    showGraph: bool(v.showGraph, true),
    fontSize,
  };
}

function coerceInProgress(val: unknown): InProgress | null {
  if (!val || typeof val !== 'object') return null;
  const v = val as Record<string, unknown>;
  if (typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date)) return null;
  const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  return {
    date: v.date,
    gameNumber: num(v.gameNumber),
    typedCount: num(v.typedCount),
    correctKeystrokes: num(v.correctKeystrokes),
    incorrectKeystrokes: num(v.incorrectKeystrokes),
    elapsedMs: num(v.elapsedMs),
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : new Date().toISOString(),
  };
}

/** Keep only the most recent MAX_RETAINED_RESULTS official results by date. */
export function pruneResults(results: Record<string, OfficialResult>): Record<string, OfficialResult> {
  const dates = Object.keys(results).sort(); // ascending
  if (dates.length <= MAX_RETAINED_RESULTS) return results;
  const keep = dates.slice(dates.length - MAX_RETAINED_RESULTS);
  const out: Record<string, OfficialResult> = {};
  for (const d of keep) out[d] = results[d];
  return out;
}

// ---------------------------------------------------------------------------
// Load / save
// ---------------------------------------------------------------------------
function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null; // e.g. storage disabled
  }
}

export function loadState(): KeywulfState {
  const store = getStorage();
  if (!store) return defaultState();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw));
  } catch {
    // Corrupt data: fall back to a clean state rather than crashing.
    return defaultState();
  }
}

export function saveState(state: KeywulfState): void {
  const store = getStorage();
  if (!store) return;
  try {
    const next = { ...state, updatedAt: new Date().toISOString() };
    store.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or disabled storage: silently ignore; the app still works this session.
  }
}

// ---------------------------------------------------------------------------
// Official results (pure state transitions; caller persists the result)
// ---------------------------------------------------------------------------
export function hasCompleted(state: KeywulfState, date: string): boolean {
  return Boolean(state.results[date]);
}

export function getResult(state: KeywulfState, date: string): OfficialResult | undefined {
  return state.results[date];
}

/** Record the start of an official attempt for `date` (idempotent per day). */
export function markOfficialStarted(state: KeywulfState, date: string): KeywulfState {
  if (state.results[date]) return state; // already completed; nothing to start
  if (state.inProgress && state.inProgress.date === date) return state; // already started
  return {
    ...state,
    totals: { ...state.totals, started: state.totals.started + 1 },
  };
}

/**
 * Record an OFFICIAL completion. Duplicate-completion protection: if a result
 * already exists for that date, the state is returned UNCHANGED (the original
 * official result is preserved). Returns the (possibly unchanged) state.
 */
export function recordOfficialResult(
  state: KeywulfState,
  result: OfficialResult,
): KeywulfState {
  if (state.results[result.date]) {
    // Already have an official result for this day. Never overwrite.
    return state;
  }
  const results = pruneResults({ ...state.results, [result.date]: result });
  return {
    ...state,
    results,
    totals: {
      started: Math.max(state.totals.started, state.totals.completed + 1),
      completed: state.totals.completed + 1,
      bestWpm: Math.max(state.totals.bestWpm, result.wpm),
    },
    inProgress: state.inProgress && state.inProgress.date === result.date ? null : state.inProgress,
  };
}

// ---------------------------------------------------------------------------
// In-progress snapshot (safe resume)
// ---------------------------------------------------------------------------
export function saveInProgress(state: KeywulfState, snapshot: InProgress): KeywulfState {
  return { ...state, inProgress: snapshot };
}

export function clearInProgress(state: KeywulfState): KeywulfState {
  if (!state.inProgress) return state;
  return { ...state, inProgress: null };
}

export function getResumable(state: KeywulfState, date: string): InProgress | null {
  const ip = state.inProgress;
  if (ip && ip.date === date && !state.results[date] && ip.typedCount > 0) return ip;
  return null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export function updateSettings(state: KeywulfState, partial: Partial<Settings>): KeywulfState {
  return { ...state, settings: { ...state.settings, ...partial } };
}

// ---------------------------------------------------------------------------
// Derived stats for the Stats view
// ---------------------------------------------------------------------------
export interface AggregateStats extends Streaks {
  gamesStarted: number;
  gamesCompleted: number;
  bestWpm: number;
  averageWpm: number;
  averageAccuracy: number; // [0,1]
  /** Retained official results, most recent first. */
  recent: OfficialResult[];
}

export function aggregateStats(state: KeywulfState, todayNumber: number): AggregateStats {
  const results = Object.values(state.results);
  const recent = [...results].sort((a, b) => b.gameNumber - a.gameNumber);
  const streaks = computeStreaks(Object.keys(state.results), todayNumber);
  const n = results.length;
  const avgWpm = n > 0 ? results.reduce((s, r) => s + r.wpm, 0) / n : 0;
  const avgAcc = n > 0 ? results.reduce((s, r) => s + r.accuracy, 0) / n : 0;
  return {
    ...streaks,
    gamesStarted: state.totals.started,
    gamesCompleted: state.totals.completed,
    bestWpm: state.totals.bestWpm,
    averageWpm: avgWpm,
    averageAccuracy: avgAcc,
    recent,
  };
}
