import { computeScore, TIME_LIMIT_MS } from './scoring';

export const MAX_REPLAY_LENGTH = 12_000;
export interface RankedRun {
  id: string;
  date: string;
  corpusHash: string;
  name: string;
  status: 'running' | 'unpublished' | 'pending' | 'published';
  startedAt: number;
  wpm: number | null;
  accuracy: number | null;
  verified: boolean;
}
export interface LeaderboardEntry {
  id: string;
  name: string;
  wpm: number;
  accuracy: number;
  verified: boolean;
}
export interface LeaderboardPage { date: string; entries: LeaderboardEntry[] }

/** Replay characters/backspaces against the server's immutable daily corpus. */
export function replayScore(corpus: string, replay: string, elapsedMs: number) {
  if (!replay.length || replay.length > MAX_REPLAY_LENGTH || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || elapsedMs > TIME_LIMIT_MS) {
    throw new Error('Invalid run length or duration');
  }
  const positions: boolean[] = [];
  let correctKeystrokes = 0;
  let incorrectKeystrokes = 0;
  for (const char of replay) {
    if (positions.length === corpus.length) throw new Error('Input after the run finished');
    if (char === '\b') { positions.pop(); continue; }
    if (char === '\n' || char === '\r') throw new Error('Invalid replay');
    const correct = char === corpus[positions.length];
    positions.push(correct);
    if (correct) correctKeystrokes++; else incorrectKeystrokes++;
  }
  if (positions.length !== corpus.length && elapsedMs < TIME_LIMIT_MS - 1000) throw new Error('An unfinished run must reach the time limit');
  return computeScore({ correctChars: positions.filter(Boolean).length, correctKeystrokes, incorrectKeystrokes,
    totalChars: corpus.length, elapsedMs });
}
