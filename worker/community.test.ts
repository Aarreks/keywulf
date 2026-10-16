// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { DailyLeaderboard, type LeaderboardStorage } from './leaderboard';
import { SpeedVerification } from './speedVerification';
import worker, { type Env, type Storage } from './index';
import { createVerificationPassage, renderVerificationImage } from './verificationImage';
import { normalizeNickname, replayScore, type RankedRun } from '../src/lib/leaderboard';
import { scoreVerification, verificationTextHash, verificationTimeLimitMs, type VerificationStatus } from '../src/lib/verification';
import sample from '../src/data/sampleChallenge.json';

vi.mock('./verificationImage', () => ({ createVerificationPassage: vi.fn(), renderVerificationImage: vi.fn() }));
// Actual SQLite enforces the same SQL uniqueness/index/transaction semantics;
// this does not emulate Cloudflare's distributed runtime or network latency.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
const date = '2026-10-06';
const hash = 'a'.repeat(64);
const answer = 'river '.repeat(60).trim();

class Memory implements Storage {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  queue: Promise<unknown> = Promise.resolve();
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async delete(key: string) { return this.data.delete(key); }
  async setAlarm(time: number) { this.alarm = time; }
  transaction<T>(fn: (storage: Storage) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => fn(this));
    this.queue = result.catch(() => undefined);
    return result;
  }
}
const databases: { close(): void }[] = [];
function sqlStorage(): LeaderboardStorage {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  return {
    sql: { exec<T>(query: string, ...bindings: (string | number | null)[]) {
      const statement = database.prepare(query);
      const rows = /^\s*SELECT/i.test(query) ? statement.all(...bindings) : (statement.run(...bindings), []);
      return { toArray: () => rows as T[] };
    } },
    transactionSync<T>(fn: () => T): T {
      database.exec('BEGIN');
      try { const value = fn(); database.exec('COMMIT'); return value; }
      catch (err) { database.exec('ROLLBACK'); throw err; }
    },
    async setAlarm() {},
    async deleteAll() { database.exec('DELETE FROM runs; DELETE FROM game'); },
  };
}
let env: Env;
let verificationStores: Map<string, Memory>;
let verifications: Map<string, SpeedVerification>;
let boards: Map<string, DailyLeaderboard>;

const post = (actor: { fetch(request: Request): Promise<Response> }, action: string, payload: unknown) => actor.fetch(new Request(`https://object/${action}`, {
  method: 'POST', body: JSON.stringify(payload),
}));
const status = (actor: SpeedVerification) => actor.fetch(new Request('https://object/status'));
const verification = (player = 'alice') => env.VERIFICATIONS!.get(player) as SpeedVerification;
const board = () => env.LEADERBOARDS!.get(date) as DailyLeaderboard;
async function start(player = 'alice', corpus = 'a'.repeat(500)): Promise<RankedRun> {
  return (await (await post(board(), 'start', { player, date, corpus, corpusHash: hash })).json() as { run: RankedRun }).run;
}
async function passSpeedCheck(player: string, claimedWpm: number) {
  const actor = verification(player);
  const created = await (await post(actor, 'issue', { date, corpusHash: hash, claimedWpm })).json() as VerificationStatus;
  expect(created.attempt).not.toBeNull();
  await post(actor, 'start', { id: created.attempt!.id });
  vi.advanceTimersByTime(20_000);
  const passed = await (await post(actor, 'finish', { id: created.attempt!.id, text: answer })).json() as VerificationStatus;
  expect(passed.receipt).not.toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(`${date}T12:00:00Z`));
  verificationStores = new Map(); verifications = new Map(); boards = new Map();
  vi.mocked(createVerificationPassage).mockReturnValue(answer);
  const png = new Uint8Array(24); new DataView(png.buffer).setUint32(20, 300);
  vi.mocked(renderVerificationImage).mockResolvedValue(png);
  env = {
    ASSETS: { fetch: async () => new Response('assets') },
    BRIEFINGS: { idFromName: id => id, get: () => ({ fetch: async () => Response.json(sample) }) },
    SOURCES: { idFromName: id => id, get: () => ({ fetch: async () => Response.json({}) }) },
    VERIFICATIONS: { idFromName: id => id, get: id => {
      const key = String(id);
      if (!verificationStores.has(key)) verificationStores.set(key, new Memory());
      if (!verifications.has(key)) verifications.set(key, new SpeedVerification({ storage: verificationStores.get(key)! }));
      return verifications.get(key)!;
    } },
    LEADERBOARDS: { idFromName: id => id, get: id => {
      const key = String(id);
      if (!boards.has(key)) boards.set(key, new DailyLeaderboard({ storage: sqlStorage() }, env));
      return boards.get(key)!;
    } },
    GEMINI_API_KEY: 'unused-test-key', KEYWULF_ADMIN_TOKEN: 'test', KEYWULF_COMMUNITY_ENABLED: 'true',
  };
});
afterEach(() => { databases.splice(0).forEach(database => database.close()); vi.useRealTimers(); });

describe('server scoring', () => {
  it('normalizes nicknames and rejects markup, controls, oversized and misleading input types', () => {
    expect(normalizeNickname('  Zoë   Fox_2  ')).toBe('Zoë Fox_2');
    expect(normalizeNickname(' ')).toBe('');
    for (const name of ['x', '<script>', 'hello\u202Eworld', 'a'.repeat(25), 123, { name: 'Alice' }]) {
      expect(() => normalizeNickname(name)).toThrow();
    }
  });
  it('replays corrections without erasing historical errors', () => {
    const score = replayScore('abc', 'ax\bbc', 1000);
    expect(score.wpm).toBe(36); expect(score.accuracy).toBe(0.75);
  });
  it('rejects truncated, oversized and invalid-time submissions', () => {
    expect(() => replayScore('abc', 'ab', 1000)).toThrow();
    expect(() => replayScore('abc', 'a'.repeat(12_001), 120_000)).toThrow();
    expect(() => replayScore('abc', 'abc', NaN)).toThrow();
    expect(() => replayScore('abc', 'abc', 0)).toThrow();
  });
  it('requires the complete matching text, with no separate accuracy percentage', () => {
    const result = scoreVerification('a'.repeat(100), 'a'.repeat(99), 10_000, 75);
    expect(result.passed).toBe(false); expect(result.reason).toBe('mismatch');
    expect(scoreVerification('a'.repeat(100), 'x'.repeat(100), 10_000, 75).reason).toBe('mismatch');
    expect(scoreVerification('some words', '  SOME   words ', 1000, 75).passed).toBe(true);
    expect(scoreVerification('a'.repeat(100), 'a'.repeat(100), 61_000, 75).reason).toBe('expired');
  });
  it('derives the deadline from passage length and speed, including durations over a minute', () => {
    expect(verificationTimeLimitMs(100, 75)).toBe(16_000);
    expect(scoreVerification('a'.repeat(100), 'a'.repeat(100), 16_000, 75).passed).toBe(true);
    expect(scoreVerification('a'.repeat(100), 'a'.repeat(100), 16_001, 75).reason).toBe('expired');
    expect(verificationTimeLimitMs(300, 45)).toBe(80_000);
    expect(scoreVerification('a'.repeat(300), 'a'.repeat(300), 70_000, 45).passed).toBe(true);
  });
});

describe('single-use speed verification', () => {
  it('keeps the answer private, exposes only a salted hash and lets players see the image before typing', async () => {
    const actor = verification();
    const created = await post(actor, 'issue', { date, corpusHash: hash, claimedWpm: 150 });
    const view = await created.json() as VerificationStatus;
    expect(JSON.stringify(view)).not.toContain(answer);
    expect(JSON.stringify(view)).not.toContain('submission');
    expect(view.attempt!.textHash).toBe(await verificationTextHash(view.attempt!.id, answer));
    expect(view.attempt!.textHash).not.toBe(await verificationTextHash('another-check', answer));
    expect((await actor.fetch(new Request(`https://object/image?id=${view.attempt!.id}`))).status).toBe(200);
    vi.advanceTimersByTime(30_000);
    expect((await (await status(actor)).json() as VerificationStatus).attempt!.startedAt).toBeNull();
    const running = await (await post(actor, 'start', { id: view.attempt!.id })).json() as VerificationStatus;
    vi.advanceTimersByTime(2000);
    const retry = await (await post(actor, 'start', { id: view.attempt!.id })).json() as VerificationStatus;
    expect(retry.attempt!.startedAt).toBe(running.attempt!.startedAt);
    expect((await actor.fetch(new Request(`https://object/image?id=${view.attempt!.id}`))).headers.get('Content-Type')).toBe('image/png');
  });
  it('allows correcting an incomplete submission, but never lets browser timing shorten server time', async () => {
    const actor = verification();
    const ready = await (await post(actor, 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
    const id = ready.attempt!.id;
    await post(actor, 'start', { id }); vi.advanceTimersByTime(10_000);
    expect((await post(actor, 'finish', { id, text: answer.slice(1), elapsedMs: 1 })).status).toBe(400);
    expect((await (await status(actor)).json() as VerificationStatus).attempt!.status).toBe('running');
    expect((await post(actor, 'finish', { id, text: answer, elapsedMs: -1 })).status).toBe(400);
    const passed = await (await post(actor, 'finish', { id, text: answer, elapsedMs: 20_000 })).json() as VerificationStatus;
    expect(passed.attempt!.result!.elapsedMs).toBe(20_000);
    expect(passed.receipt).not.toBeNull();
  });
  it('derives a commitment for challenges created by the previous deployment', async () => {
    const actor = verification();
    const ready = await (await post(actor, 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
    const storage = verificationStores.get('alice')!;
    const saved = await storage.get<{ attempt: { textHash?: string } }>('verification');
    delete saved!.attempt.textHash;
    await storage.put('verification', saved);
    const recovered = await (await status(actor)).json() as VerificationStatus;
    expect(recovered.attempt!.textHash).toBe(ready.attempt!.textHash);
    expect(JSON.stringify(recovered)).not.toContain(answer);
  });
  it('settles concurrent identical finishes once, survives eviction and rejects different replays', async () => {
    const actor = verification();
    const created = await (await post(actor, 'issue', { date, corpusHash: hash, claimedWpm: 200 })).json() as VerificationStatus;
    const id = created.attempt!.id;
    await post(actor, 'start', { id }); vi.advanceTimersByTime(20_000);
    const replies = await Promise.all([post(actor, 'finish', { id, text: answer }), post(actor, 'finish', { id, text: answer })]);
    expect(replies.map(reply => reply.status)).toEqual([200, 200]);
    const first = await replies[0].json() as VerificationStatus;
    expect(first.receipt?.measuredWpm).toBeGreaterThan(150);
    verifications.delete('alice');
    expect((await post(verification(), 'finish', { id, text: answer })).status).toBe(200);
    expect((await post(verification(), 'finish', { id, text: 'different' })).status).toBe(409);
    expect((await verification().fetch(new Request(`https://object/image?id=${id}`))).status).toBe(410);
  });
  it('enforces ownership, expiry, a durable three-attempt budget and cleanup', async () => {
    const actor = verification();
    for (let i = 0; i < 3; i++) {
      const created = await (await post(actor, 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
      expect((await post(verification('bob'), 'start', { id: created.attempt!.id })).status).toBe(404);
      await post(actor, 'cancel', { id: created.attempt!.id });
    }
    verifications.delete('alice');
    expect((await post(verification(), 'issue', { date, corpusHash: hash, claimedWpm: 150 })).status).toBe(429);
    vi.advanceTimersByTime(15 * 60_000);
    const next = await (await post(verification(), 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect((await post(verification(), 'start', { id: next.attempt!.id })).status).toBe(410);
    await verification().alarm();
    expect((await (await status(verification())).json() as VerificationStatus).attempt).toBeNull();
  });
  it('never trusts browser elapsed time or a claimed verification score', async () => {
    const created = await (await post(verification(), 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
    const id = created.attempt!.id;
    expect((await post(verification(), 'finish', { id, text: answer, elapsedMs: 1 })).status).toBe(409);
    await post(verification(), 'start', { id }); vi.advanceTimersByTime(verificationTimeLimitMs(answer.length, 113) + 1);
    expect((await post(verification(), 'finish', { id, text: answer, elapsedMs: 1, wpm: 200 })).status).toBe(410);
    expect((await (await status(verification())).json() as VerificationStatus).receipt).toBeNull();
  });
  it('accepts the last valid millisecond and expires older fixed-duration records at the speed deadline', async () => {
    const ready = await (await post(verification(), 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
    await post(verification(), 'start', { id: ready.attempt!.id });
    const limit = verificationTimeLimitMs(answer.length, 113);
    vi.advanceTimersByTime(limit);
    expect((await post(verification(), 'finish', { id: ready.attempt!.id, text: answer })).status).toBe(200);
    const other = verification('bob');
    const second = await (await post(other, 'issue', { date, corpusHash: hash, claimedWpm: 150 })).json() as VerificationStatus;
    await post(other, 'start', { id: second.attempt!.id });
    const storage = verificationStores.get('bob')!;
    const saved = await storage.get<{ attempt: { startedAt: number; expiresAt: number } }>('verification');
    saved!.attempt.expiresAt = saved!.attempt.startedAt + 60_000;
    await storage.put('verification', saved);
    const current = await (await status(other)).json() as VerificationStatus;
    expect(current.attempt!.expiresAt).toBe(current.attempt!.startedAt! + limit);
    vi.advanceTimersByTime(limit + 1);
    expect((await post(other, 'finish', { id: second.attempt!.id, text: answer })).status).toBe(410);
    expect((await other.fetch(new Request(`https://object/image?id=${second.attempt!.id}`))).status).toBe(410);
    await other.alarm();
    expect((await (await status(other)).json() as VerificationStatus).attempt).toBeNull();
  });
  it('permits a slow score to use its full threshold-derived time beyond sixty seconds', async () => {
    const ready = await (await post(verification(), 'issue', { date, corpusHash: hash, claimedWpm: 50 })).json() as VerificationStatus;
    const running = await (await post(verification(), 'start', { id: ready.attempt!.id })).json() as VerificationStatus;
    expect(running.attempt!.expiresAt - running.attempt!.startedAt!).toBe(verificationTimeLimitMs(answer.length, 38));
    vi.advanceTimersByTime(70_000);
    const passed = await (await post(verification(), 'finish', { id: ready.attempt!.id, text: answer, elapsedMs: 70_000 })).json() as VerificationStatus;
    expect(passed.attempt!.result!.passed).toBe(true);
  });
});

describe('daily leaderboard consistency', () => {
  it('keeps the original start time, accepts retry after lost acknowledgement and rejects replacements', async () => {
    const run = await start(); vi.advanceTimersByTime(120_000);
    expect((await start()).startedAt).toBe(run.startedAt);
    const payload = { player: 'alice', id: run.id, replay: 'a'.repeat(500), elapsedMs: 120_000 };
    const replies = await Promise.all([post(board(), 'finish', payload), post(board(), 'finish', payload)]);
    expect(replies.map(reply => reply.status)).toEqual([200, 200]);
    expect((await replies[0].json() as { run: RankedRun }).run.wpm).toBe(50);
    expect((await (await board().fetch(new Request(`https://board/top?date=${date}`))).json() as { entries: unknown[] }).entries).toHaveLength(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect((await post(board(), 'publish', { player: 'alice', id: run.id })).status).toBe(403);
    await passSpeedCheck('alice', 50);
    expect((await post(board(), 'publish', { player: 'alice', id: run.id })).status).toBe(200);
    expect((await post(board(), 'finish', { ...payload, replay: 'x'.repeat(500) })).status).toBe(409);
    expect((await post(board(), 'finish', { ...payload, player: 'bob' })).status).toBe(404);
  });
  it('withholds fast scores until a matching server receipt exists, then publishes once', async () => {
    const run = await start(); vi.advanceTimersByTime(30_000);
    const pending = await (await post(board(), 'finish', { player: 'alice', id: run.id, replay: 'a'.repeat(500), elapsedMs: 30_000 })).json() as { run: RankedRun };
    expect(pending.run.status).toBe('pending');
    const top = () => board().fetch(new Request(`https://board/top?date=${date}`));
    expect((await (await top()).json() as { entries: unknown[] }).entries).toHaveLength(0);
    expect((await post(board(), 'publish', { player: 'alice', id: run.id, verified: true })).status).toBe(403);
    const attempt = await (await post(verification(), 'issue', { date, corpusHash: hash, claimedWpm: 200 })).json() as VerificationStatus;
    await post(verification(), 'start', { id: attempt.attempt!.id }); vi.advanceTimersByTime(20_000);
    await post(verification(), 'finish', { id: attempt.attempt!.id, text: answer });
    expect((await post(board(), 'publish', { player: 'alice', id: run.id })).status).toBe(200);
    expect((await post(board(), 'publish', { player: 'alice', id: run.id })).status).toBe(200);
    const entries = (await (await top()).json() as { entries: Record<string, unknown>[] }).entries;
    expect(entries).toHaveLength(1); expect(entries[0].verified).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('alice'); expect(JSON.stringify(entries)).not.toContain('started_at');
  });
  it('allows owner-only nickname edits without replacing the score or creating another entry', async () => {
    const run = await start(); vi.advanceTimersByTime(120_000);
    await post(board(), 'finish', { player: 'alice', id: run.id, replay: 'a'.repeat(500), elapsedMs: 120_000 });
    await passSpeedCheck('alice', 50);
    expect((await post(board(), 'publish', { player: 'alice', id: run.id, nickname: '<b>Fox</b>' })).status).toBe(400);
    const published = await (await post(board(), 'publish', { player: 'alice', id: run.id, nickname: '  Zoë Fox  ' })).json() as { run: RankedRun };
    expect(published.run.name).toBe('Zoë Fox'); expect(published.run.wpm).toBe(50);
    expect((await post(board(), 'publish', { player: 'bob', id: run.id, nickname: 'Stolen' })).status).toBe(404);
    const renamed = await (await post(board(), 'publish', { player: 'alice', id: run.id, nickname: 'Fox 2' })).json() as { run: RankedRun };
    expect(renamed.run.name).toBe('Fox 2'); expect(renamed.run.id).toBe(run.id); expect(renamed.run.verified).toBe(true);
    const fallback = await (await post(board(), 'publish', { player: 'alice', id: run.id, nickname: '' })).json() as { run: RankedRun };
    expect(fallback.run.name).toBe(run.name);
  });
  it('rejects a receipt for another corpus and does not let reloads reset the timer', async () => {
    const run = await start(); vi.advanceTimersByTime(30_000);
    await post(board(), 'finish', { player: 'alice', id: run.id, replay: 'a'.repeat(500), elapsedMs: 30_000 });
    const attempt = await (await post(verification(), 'issue', { date, corpusHash: 'b'.repeat(64), claimedWpm: 200 })).json() as VerificationStatus;
    await post(verification(), 'start', { id: attempt.attempt!.id }); vi.advanceTimersByTime(20_000);
    await post(verification(), 'finish', { id: attempt.attempt!.id, text: answer });
    expect((await post(board(), 'publish', { player: 'alice', id: run.id })).status).toBe(403);
    const other = await start('bob'); vi.advanceTimersByTime(126_000);
    expect((await start('bob')).startedAt).toBe(other.startedAt);
    expect((await post(board(), 'finish', { player: 'bob', id: other.id, replay: 'a'.repeat(500), elapsedMs: 1000 })).status).toBe(410);
  });
  it('orders by full precision speed, then accuracy and stable completion order', async () => {
    const alice = await start('alice'); const bob = await start('bob');
    vi.advanceTimersByTime(120_000);
    await post(board(), 'finish', { player: 'alice', id: alice.id, replay: 'x\b' + 'a'.repeat(500), elapsedMs: 120_000 });
    await post(board(), 'finish', { player: 'bob', id: bob.id, replay: 'a'.repeat(500), elapsedMs: 120_000 });
    await passSpeedCheck('alice', 50); await passSpeedCheck('bob', 50);
    await post(board(), 'publish', { player: 'alice', id: alice.id });
    await post(board(), 'publish', { player: 'bob', id: bob.id });
    const result = await (await board().fetch(new Request(`https://board/top?date=${date}`))).json() as { entries: { id: string }[] };
    expect(result.entries.map(row => row.id)).toEqual([bob.id, alice.id]);
  });
});

describe('public community boundary', () => {
  const api = (path: string, payload?: unknown, cookie?: string, origin = 'https://keywulf.com') => worker.fetch(new Request(`https://keywulf.com/api/${path}`, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }), env);
  it('creates an HttpOnly session, rejects cross-origin writes and binds verification to a pending server score', async () => {
    expect((await api('runs/start', { date }, undefined, 'https://attacker.example')).status).toBe(403);
    const response = await api('runs/start', { date, player: 'victim' });
    const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Secure');
    expect((await api('verification/issue', { date, claimedWpm: 400 }, cookie)).status).toBe(409);
    expect((await api('verification/start', { id: 'fake' })).status).toBe(401);
  });
  it('fails closed on abuse, large bodies, wrong dates and feature disable without altering the game', async () => {
    expect((await api('runs/start', { date, padding: 'x'.repeat(70_000) })).status).toBe(400);
    expect((await api('runs/start', { date: '2026-10-07' })).status).toBe(400);
    env.VERIFICATION_LIMITER = { limit: async () => ({ success: false }) };
    expect((await api('runs/start', { date })).status).toBe(429);
    env.KEYWULF_COMMUNITY_ENABLED = 'false';
    expect(await (await api('community')).json()).toEqual({ enabled: false });
    expect((await api('leaderboard')).status).toBe(503);
    expect((await worker.fetch(new Request('https://keywulf.com/'), env)).status).toBe(200);
  });
});
