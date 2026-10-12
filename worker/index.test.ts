// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { DailyBriefing, type Env, type Storage } from './index';
import { generateBriefing } from '../scripts/generateBriefing';
import { gameNumberForDate } from '../src/lib/gameNumber';
import sample from '../src/data/sampleChallenge.json';
import type { Challenge } from '../src/types';
import type { SourceRef } from '../scripts/enrichSources';

vi.mock('../scripts/generateBriefing', () => ({ generateBriefing: vi.fn() }));

class MemoryStorage implements Storage {
  data = new Map<string, unknown>();
  private queue: Promise<unknown> = Promise.resolve();
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async delete(key: string) { return this.data.delete(key); }
  transaction<T>(fn: (storage: Storage) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => fn(this));
    this.queue = result.catch(() => undefined);
    return result;
  }
}

function challenge(date: string, word = 'Fresh'): Challenge {
  const c = structuredClone(sample) as Challenge;
  c.date = date;
  c.gameNumber = gameNumberForDate(date);
  c.stories[0].body = c.stories[0].body.replace(/\w+/, word);
  return c;
}

let env: Env;
let objects: Map<string, DailyBriefing>;
let resolveMetadata: ReturnType<typeof vi.fn>;
const admin = (action: string, date: string, body?: unknown) => worker.fetch(new Request(
  `https://keywulf.com/_internal/${action}?date=${date}`, {
    method: action === 'status' ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer operator-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  },
), env);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T00:20:00Z'));
  vi.mocked(generateBriefing).mockReset();
  objects = new Map();
  resolveMetadata = vi.fn(async (request: Request) => {
    const source = await request.json() as SourceRef;
    return Response.json({ ...source, title: 'Real publisher article title', url: 'https://publisher.example/article' });
  });
  env = {
    ASSETS: { fetch: vi.fn(async () => new Response('static asset')) },
    BRIEFINGS: {
      idFromName: name => name,
      get: id => {
        const key = String(id);
        if (!objects.has(key)) objects.set(key, new DailyBriefing({ storage: new MemoryStorage() }, env));
        return objects.get(key)!;
      },
    },
    SOURCES: { idFromName: name => name, get: () => ({ fetch: resolveMetadata }) },
    GEMINI_API_KEY: 'test-key', KEYWULF_ADMIN_TOKEN: 'operator-token',
  };
});
afterEach(() => vi.useRealTimers());

describe('daily publication', () => {
  it('repairs today\'s source titles and links without changing the published text or scores', async () => {
    const original = challenge('2026-10-06');
    const source = { title: 'youtube.com', url: 'https://www.youtube.com/watch?v=abcdefghijk' };
    original.sourcePool = [source];
    original.stories[0].sources = [source];
    await admin('seed', original.date, original);
    expect((await admin('refresh-sources', original.date)).status).toBe(200);
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'));
    const published = await (await worker.fetch(new Request('https://keywulf.com/data/today.json'), env)).json() as Challenge;
    expect(published.sourcePool[0]).toEqual({ title: 'Real publisher article title', url: 'https://publisher.example/article' });
    expect(published.stories[0].sources[0]).toEqual(published.sourcePool[0]);
    expect(published.stories.map(({ sources: _sources, ...s }) => s)).toEqual(original.stories.map(({ sources: _sources, ...s }) => s));
    expect([published.date, published.generatedAt, published.wordCount, published.gameNumber]).toEqual(
      [original.date, original.generatedAt, original.wordCount, original.gameNumber]);
    expect(resolveMetadata).toHaveBeenCalledTimes(1);
    expect(await (await admin('refresh-sources', original.date)).json()).toEqual({ date: original.date, refreshed: false });
    expect(resolveMetadata).toHaveBeenCalledTimes(1);
    expect(generateBriefing).not.toHaveBeenCalled();
    expect((await worker.fetch(new Request('https://keywulf.com/_internal/refresh-sources', { method: 'POST' }), env)).status).toBe(401);
  });

  it('accepts metadata retrieved by the runner but rejects any attempt to replace typed text', async () => {
    const original = challenge('2026-10-06');
    await admin('seed', original.date, original);
    const repaired = structuredClone(original);
    repaired.sourcePool[0].title = 'Verified video title from the publisher';
    expect((await admin('repair-sources', original.date, repaired)).status).toBe(200);
    repaired.stories[0].body = repaired.stories[0].body.replace(/\w+/, 'Altered');
    expect((await admin('repair-sources', original.date, repaired)).status).toBe(409);
    expect((await worker.fetch(new Request('https://keywulf.com/_internal/repair-sources', { method: 'POST' }), env)).status).toBe(401);
  });

  it('serves a different prepared text at 01:00 without a cron or deployment', async () => {
    await admin('seed', '2026-10-05', challenge('2026-10-05', 'Previous'));
    await admin('seed', '2026-10-06', challenge('2026-10-06'));
    const get = () => worker.fetch(new Request('https://keywulf.com/data/today.json?v=123'), env);
    vi.setSystemTime(new Date('2026-10-06T00:59:59.999Z'));
    const before = await (await get()).json() as Challenge;
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'));
    const after = await (await get()).json() as Challenge;
    expect(before.date).toBe('2026-10-05');
    expect(after.date).toBe('2026-10-06');
    expect(before.stories).not.toEqual(after.stories);
    expect(generateBriefing).not.toHaveBeenCalled();
    expect((await get()).headers.get('Cache-Control')).toBe('no-store');
  });

  it('prepares ahead once, then makes retries and redeploys idempotent', async () => {
    vi.mocked(generateBriefing).mockResolvedValue(challenge('2026-10-06'));
    await worker.scheduled({ scheduledTime: Date.now() }, env);
    vi.setSystemTime(new Date('2026-10-06T00:30:00Z'));
    await worker.scheduled({ scheduledTime: Date.now() }, env);
    await admin('seed', '2026-10-06', challenge('2026-10-06', 'Replacement'));
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'));
    const published = await (await worker.fetch(new Request('https://keywulf.com/data/today.json'), env)).json() as Challenge;
    expect(published.stories[0].body).toBe(challenge('2026-10-06').stories[0].body);
    expect(generateBriefing).toHaveBeenCalledTimes(1);
  });

  it('retries a failed generation and never serves a renamed old text or sample', async () => {
    await admin('seed', '2026-10-05', challenge('2026-10-05'));
    vi.mocked(generateBriefing).mockRejectedValueOnce(new Error('Google unavailable')).mockResolvedValueOnce(challenge('2026-10-06', 'Updated'));
    expect((await admin('prepare', '2026-10-06')).status).toBe(503);
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'));
    expect((await worker.fetch(new Request('https://keywulf.com/data/today.json'), env)).status).toBe(503);
    expect((await admin('prepare', '2026-10-06')).status).toBe(200);
    expect(generateBriefing).toHaveBeenCalledTimes(2);
  });

  it('rejects repeating yesterday\'s exact text', async () => {
    await admin('seed', '2026-10-05', challenge('2026-10-05'));
    vi.mocked(generateBriefing).mockResolvedValue(challenge('2026-10-06'));
    expect((await admin('prepare', '2026-10-06')).status).toBe(503);
    expect(await (await admin('status', '2026-10-06')).json()).toEqual({ date: '2026-10-06', ready: false });
  });

  it('allows only one concurrent generation and prevents public preparation', async () => {
    let release!: (challenge: Challenge) => void;
    vi.mocked(generateBriefing).mockReturnValue(new Promise(resolve => { release = resolve; }));
    const first = admin('prepare', '2026-10-06');
    while (!vi.mocked(generateBriefing).mock.calls.length) await Promise.resolve();
    expect((await admin('prepare', '2026-10-06')).status).toBe(202);
    expect(generateBriefing).toHaveBeenCalledTimes(1);
    release(challenge('2026-10-06'));
    expect((await first).status).toBe(200);
    expect((await worker.fetch(new Request('https://keywulf.com/_internal/prepare'), env)).status).toBe(401);
    expect((await admin('status', '2026-13-44')).status).toBe(400);
  });

  it('serves the app assets without invoking generation', async () => {
    expect(await (await worker.fetch(new Request('https://keywulf.com/'), env)).text()).toBe('static asset');
    expect(generateBriefing).not.toHaveBeenCalled();
  });
});
