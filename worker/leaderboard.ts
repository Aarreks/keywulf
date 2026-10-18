import type { Env } from './index';
import { normalizeNickname, replayScore, type RankedRun } from '../src/lib/leaderboard';
import { requiredVerificationWpm, type VerificationStatus, VERIFICATION_MAX_CLAIM_WPM } from '../src/lib/verification';
import { verificationJson } from './speedVerification';

export interface LeaderboardStorage {
  sql: { exec<T = Record<string, unknown>>(query: string, ...bindings: (string | number | null)[]): { toArray(): T[] } };
  transactionSync<T>(fn: () => T): T;
  setAlarm(time: number): Promise<void>;
  deleteAll(): Promise<void>;
}
interface Row extends Record<string, unknown> {
  player: string; id: string; name: string; date: string; corpus_hash: string;
  status: RankedRun['status'] | 'unpublished'; started_at: number; replay_hash: string | null;
  wpm: number | null; accuracy: number | null; verified: number; completed_at: number | null;
}
const view = (row: Row): RankedRun => ({ id: row.id, name: row.name, date: row.date, corpusHash: row.corpus_hash,
  // Older low-speed rows may have bypassed the check. Treat them as private
  // pending results until they satisfy the same rule as every new entry.
  status: row.status === 'unpublished' || (row.status === 'published' && !row.verified) ? 'pending' : row.status,
  startedAt: row.started_at, wpm: row.wpm, accuracy: row.accuracy, verified: Boolean(row.verified) });

export async function sha256(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Each date has its own indexed SQLite board, isolated from news generation. */
export class DailyLeaderboard {
  constructor(private state: { storage: LeaderboardStorage }, private env: Env) {
    const sql = state.storage.sql;
    sql.exec('CREATE TABLE IF NOT EXISTS game (date TEXT PRIMARY KEY, corpus TEXT NOT NULL, hash TEXT NOT NULL)');
    sql.exec(`CREATE TABLE IF NOT EXISTS runs (player TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, date TEXT NOT NULL, corpus_hash TEXT NOT NULL, status TEXT NOT NULL,
      started_at INTEGER NOT NULL, replay_hash TEXT, wpm REAL, accuracy REAL,
      verified INTEGER NOT NULL DEFAULT 0, completed_at INTEGER)`);
    sql.exec('CREATE INDEX IF NOT EXISTS ranking ON runs(status, wpm DESC, accuracy DESC, completed_at ASC, id ASC)');
  }

  async alarm(): Promise<void> { await this.state.storage.deleteAll(); }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sql = this.state.storage.sql;
    const rowFor = (player: string) => sql.exec<Row>('SELECT * FROM runs WHERE player = ?', player).toArray()[0];
    if (request.method === 'GET') {
      if (url.pathname === '/me') {
        const row = rowFor(url.searchParams.get('player') || '');
        return verificationJson({ run: row ? view(row) : null });
      }
      if (url.pathname !== '/top') return verificationJson({ error: 'Not found' }, 404);
      const entries = sql.exec<Row>(`SELECT id, name, wpm, accuracy, verified FROM runs WHERE status = 'published' AND verified = 1
        ORDER BY wpm DESC, accuracy DESC, completed_at ASC, id ASC LIMIT 50`).toArray()
        .map(row => ({ id: row.id, name: row.name, wpm: row.wpm, accuracy: row.accuracy, verified: Boolean(row.verified) }));
      return Response.json({ date: url.searchParams.get('date'), entries }, { headers: {
        // A just-published score must be visible on the next board read, even if
        // this browser or an intermediary previously saw an empty leaderboard.
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (request.method !== 'POST') return verificationJson({ error: 'Method not allowed' }, 405);
    const payload = await request.json() as Record<string, unknown>;
    const player = payload.player as string;
    if (typeof player !== 'string' || !player.length) return verificationJson({ error: 'Session required' }, 401);
    if (url.pathname === '/start') {
      const { date, corpus, corpusHash } = payload as { date: string; corpus: string; corpusHash: string };
      const name = `Typist ${(await sha256(player)).slice(0, 8).toUpperCase()}`;
      const run = this.state.storage.transactionSync(() => {
        sql.exec('INSERT OR IGNORE INTO game VALUES (?, ?, ?)', date, corpus, corpusHash);
        const game = sql.exec<{ hash: string }>('SELECT hash FROM game').toArray()[0];
        if (game.hash !== corpusHash) return null;
        sql.exec(`INSERT OR IGNORE INTO runs (player,id,name,date,corpus_hash,status,started_at)
          VALUES (?, ?, ?, ?, ?, 'running', ?)`, player, crypto.randomUUID(), name, date, corpusHash, Date.now());
        return rowFor(player);
      });
      if (!run) return verificationJson({ error: 'The published text changed' }, 409);
      // A whole date's anonymous records expire together, including abandoned runs.
      await this.state.storage.setAlarm(Date.parse(`${date}T01:00:00Z`) + 35 * 86_400_000);
      return verificationJson({ run: view(run) });
    }
    const row = rowFor(player);
    if (!row || row.id !== payload.id) return verificationJson({ error: 'This run does not belong to your browser' }, 404);
    if (url.pathname === '/finish') {
      if (typeof payload.replay !== 'string' || typeof payload.elapsedMs !== 'number') return verificationJson({ error: 'A complete input replay is required' }, 400);
      const replayHash = await sha256(JSON.stringify([payload.replay, payload.elapsedMs]));
      const outcome = this.state.storage.transactionSync(() => {
        const current = rowFor(player)!;
        if (current.status !== 'running') return current.replay_hash === replayHash
          ? { row: current } : { error: 'Your first submitted result is already saved', status: 409 };
        const wallTime = Date.now() - current.started_at;
        if (wallTime > 125_000 || wallTime < 1000) return { error: 'The continuous leaderboard timer expired or the run was too short. Your local result is unchanged.', status: 410 };
        const game = sql.exec<{ corpus: string }>('SELECT corpus FROM game').toArray()[0];
        try {
          // Client time cannot shorten server-observed time. The two-minute cap
          // matches gameplay; the 5-second arrival grace is not extra typing time.
          const score = replayScore(game.corpus, payload.replay as string, Math.min(120_000, Math.max(wallTime, payload.elapsedMs as number)));
          if (score.wpm > VERIFICATION_MAX_CLAIM_WPM) throw new Error('Score exceeds the supported range');
          sql.exec(`UPDATE runs SET status = ?, replay_hash = ?, wpm = ?, accuracy = ?, completed_at = ? WHERE player = ? AND status = 'running'`,
            'pending', replayHash, score.wpm, score.accuracy, Date.now(), player);
          return { row: rowFor(player)! };
        } catch (err) { return { error: err instanceof Error ? err.message : 'Invalid replay', status: 400 }; }
      });
      return outcome.row ? verificationJson({ run: view(outcome.row) }) : verificationJson({ error: outcome.error }, outcome.status);
    }
    if (url.pathname === '/publish') {
      let nickname: string | null = null;
      if (payload.nickname !== undefined) {
        try { nickname = normalizeNickname(payload.nickname) || `Typist ${(await sha256(player)).slice(0, 8).toUpperCase()}`; }
        catch (err) { return verificationJson({ error: (err as Error).message }, 400); }
      }
      if (row.status === 'published' && row.verified) {
        sql.exec('UPDATE runs SET name = COALESCE(?, name) WHERE player = ?', nickname, player);
        return verificationJson({ run: view(rowFor(player)!) });
      }
      if (row.status === 'running' || !this.env.VERIFICATIONS) return verificationJson({ error: 'No pending score' }, 409);
      const response = await this.env.VERIFICATIONS.get(this.env.VERIFICATIONS.idFromName(player)).fetch(new Request('https://verification/status'));
      if (!response.ok) return verificationJson({ error: 'Speed verification is unavailable' }, 503);
      const { receipt } = await response.json() as VerificationStatus;
      if (!receipt || receipt.date !== row.date || receipt.corpusHash !== row.corpus_hash || receipt.validUntil <= Date.now() ||
          receipt.requiredWpm < requiredVerificationWpm(row.wpm!) || receipt.measuredWpm < requiredVerificationWpm(row.wpm!)) {
        return verificationJson({ error: 'Pass the speed check before publishing this score' }, 403);
      }
      // The receipt comes from our private binding, never a browser-provided badge.
      sql.exec("UPDATE runs SET status = 'published', verified = 1, name = COALESCE(?, name) WHERE player = ? AND id = ? AND status != 'running'", nickname, player, row.id);
      return verificationJson({ run: view(rowFor(player)!) });
    }
    return verificationJson({ error: 'Not found' }, 404);
  }
}
