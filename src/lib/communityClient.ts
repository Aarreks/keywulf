import type { RankedRun, LeaderboardPage } from './leaderboard';
import type { VerificationStatus } from './verification';

export class CommunityError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function communityRequest<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: payload === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000),
  });
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('The leaderboard is unavailable. Your local game is saved.');
  const result = await response.json();
  if (!response.ok) throw new CommunityError(typeof result.error === 'string' ? result.error : 'The request failed. Please retry.', response.status);
  return result as T;
}

export async function startRankedRun(date: string): Promise<RankedRun> {
  return (await communityRequest<{ run: RankedRun }>('runs/start', { date })).run;
}
export async function finishRankedRun(start: Promise<RankedRun>, date: string, replay: string, elapsedMs: number): Promise<RankedRun> {
  const { id } = await start;
  const payload = { date, id, replay, elapsedMs };
  // Retry an unknown outcome with exactly the same replay, never a new score.
  try { return (await communityRequest<{ run: RankedRun }>('runs/finish', payload)).run; }
  catch (err) {
    if (err instanceof CommunityError && err.status < 500) throw err;
    return (await communityRequest<{ run: RankedRun }>('runs/finish', payload)).run;
  }
}
export const getBoard = (date: string, signal?: AbortSignal) => communityRequest<LeaderboardPage>(`leaderboard?date=${date}`, undefined, signal);
export const getRankedRun = (date: string, signal?: AbortSignal) => communityRequest<{ run: RankedRun | null }>(`leaderboard/me?date=${date}`, undefined, signal);
export const getVerification = (signal?: AbortSignal) => communityRequest<VerificationStatus>('verification', undefined, signal);
