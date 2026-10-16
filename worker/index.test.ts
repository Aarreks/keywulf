// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { DailyBriefing, type Env, type Storage } from './index';
import { generateBriefing } from '../scripts/generateBriefing';
import { gameNumberForDate } from '../src/lib/gameNumber';
import sample from '../src/data/sampleChallenge.json';
import type { Challenge } from '../src/types';
import type { SourceRef } from '../scripts/enrichSources';
import { RECOVERY_CRON } from './recovery';
import { SOURCE_METADATA_VERSION } from '../scripts/refreshSourceTitles';

vi.mock('../scripts/generateBriefing', () => ({ generateBriefing: vi.fn() }));
vi.mock('./verificationImage', () => ({ createVerificationPassage: vi.fn(), renderVerificationImage: vi.fn() }));

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
let stores: Map<string, MemoryStorage>;
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
  stores = new Map();
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
        if (!stores.has(key)) stores.set(key, new MemoryStorage());
        if (!objects.has(key)) objects.set(key, new DailyBriefing({ storage: stores.get(key)! }, env));
        return objects.get(key)!;
      },
    },
    SOURCES: { idFromName: name => name, get: () => ({ fetch: resolveMetadata }) },
    GEMINI_API_KEY: 'test-key', KEYWULF_ADMIN_TOKEN: 'operator-token',
    KEYWULF_RECOVERY_ENABLED: 'true',
  };
});
afterEach(() => vi.useRealTimers());

describe('daily publication', () => {
  it.each(['wrong date', 'invalid stories'])('does not partially publish %s output and releases its lease', async (failure) => {
    const invalid = challenge(failure === 'wrong date' ? '2026-10-07' : '2026-10-06');
    if (failure === 'invalid stories') invalid.stories = [];
    vi.mocked(generateBriefing).mockResolvedValueOnce(invalid).mockResolvedValueOnce(challenge('2026-10-06'));
    expect((await admin('prepare', '2026-10-06')).status).toBe(503);
    expect(await stores.get('2026-10-06')!.get('challenge')).toBeUndefined();
    expect(await stores.get('2026-10-06')!.get('lease')).toBeUndefined();
    expect((await admin('prepare', '2026-10-06')).status).toBe(200);
  });

  it('keeps a request\'s selected date when its storage read crosses 01:00', async () => {
    await admin('seed', '2026-10-05', challenge('2026-10-05', 'Previous'));
    await admin('seed', '2026-10-06', challenge('2026-10-06'));
    const getObject = env.BRIEFINGS.get;
    let finishRead!: () => void;
    env.BRIEFINGS.get = id => ({ fetch: async request => {
      if (id === '2026-10-05') await new Promise<void>(resolve => { finishRead = resolve; });
      return getObject(id).fetch(request);
    } });
    vi.setSystemTime(new Date('2026-10-06T00:59:59.999Z'));
    const before = worker.fetch(new Request('https://keywulf.com/data/today.json'), env);
    vi.setSystemTime(new Date('2026-10-06T01:00:00Z'));
    const after = await worker.fetch(new Request('https://keywulf.com/data/today.json'), env);
    expect((await after.json() as Challenge).date).toBe('2026-10-06');
    finishRead();
    expect((await (await before).json() as Challenge).date).toBe('2026-10-05');
    expect(generateBriefing).not.toHaveBeenCalled();
  });

  it('rejects a replaced generator without clearing the new owner\'s lease', async () => {
    let finishOld!: (value: Challenge) => void;
    let finishNew!: (value: Challenge) => void;
    vi.mocked(generateBriefing)
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const oldAttempt = admin('prepare', '2026-10-06');
    await vi.waitFor(() => expect(generateBriefing).toHaveBeenCalledTimes(1));
    vi.setSystemTime(new Date('2026-10-06T00:36:00Z'));
    const newAttempt = admin('prepare', '2026-10-06');
    await vi.waitFor(() => expect(generateBriefing).toHaveBeenCalledTimes(2));
    const newLease = await stores.get('2026-10-06')!.get('lease');
    finishOld(challenge('2026-10-06', 'Discarded'));
    expect((await oldAttempt).status).toBe(503);
    expect(await stores.get('2026-10-06')!.get('lease')).toEqual(newLease);
    expect(await stores.get('2026-10-06')!.get('challenge')).toBeUndefined();
    finishNew(challenge('2026-10-06', 'Winner'));
    expect((await newAttempt).status).toBe(200);
    expect(await stores.get('2026-10-06')!.get('challenge')).toEqual(challenge('2026-10-06', 'Winner'));
  });

  it('does not mark a concurrently seeded briefing as metadata-refreshed', async () => {
    let finishGeneration!: (value: Challenge) => void;
    vi.mocked(generateBriefing).mockImplementation(() => new Promise(resolve => { finishGeneration = resolve; }));
    const pending = admin('prepare', '2026-10-06');
    await vi.waitFor(() => expect(generateBriefing).toHaveBeenCalledTimes(1));
    const seeded = challenge('2026-10-06', 'Seeded');
    await admin('seed', seeded.date, seeded);
    finishGeneration(challenge('2026-10-06', 'Generated'));
    expect((await pending).status).toBe(200);
    expect(await stores.get(seeded.date)!.get('challenge')).toEqual(seeded);
    expect(await stores.get(seeded.date)!.get('sourceMetadataVersion')).not.toBe(SOURCE_METADATA_VERSION);
  });

  it('returns a conflict when a refresh races a newer metadata repair', async () => {
    const original = challenge('2026-10-06');
    original.sourcePool = [{ title: 'youtube.com', url: 'https://youtube.com/watch?v=abcdefghijk' }];
    await admin('seed', original.date, original);
    let finishLookup!: () => void;
    resolveMetadata.mockImplementation(async () => {
      await new Promise<void>(resolve => { finishLookup = resolve; });
      return Response.json({ title: 'Older lookup result', url: 'https://publisher.example/older' });
    });
    const pending = admin('refresh-sources', original.date);
    await vi.waitFor(() => expect(resolveMetadata).toHaveBeenCalledTimes(1));
    const newer = structuredClone(original);
    newer.sourcePool[0].title = 'Newer verified article title';
    expect((await admin('repair-sources', original.date, { expected: original, repaired: newer })).status).toBe(200);
    finishLookup();
    expect((await pending).status).toBe(409);
    expect(await stores.get(original.date)!.get('challenge')).toEqual(newer);
  });

  const recovery = async (time: string) => {
    const scheduledTime = Date.parse(`2026-10-06T${time}:00Z`);
    vi.setSystemTime(scheduledTime);
    return worker.scheduled({ scheduledTime, cron: RECOVERY_CRON }, env);
  };

  it('recovers automatically after all four preparation slots fail, then keeps the recovered corpus immutable', async () => {
    await admin('seed', '2026-10-05', challenge('2026-10-05', 'Previous'));
    vi.mocked(generateBriefing).mockRejectedValue(new Error('upstream outage'));
    for (const minute of [20, 30, 40, 50]) {
      vi.setSystemTime(Date.parse(`2026-10-06T00:${minute}:00Z`));
      await expect(worker.scheduled({ scheduledTime: Date.now() }, env)).rejects.toThrow('HTTP 503');
    }
    vi.setSystemTime(Date.parse('2026-10-06T01:00:00Z'));
    expect((await worker.fetch(new Request('https://keywulf.com/data/today.json'), env)).status).toBe(503);
    vi.mocked(generateBriefing).mockResolvedValue(challenge('2026-10-06', 'Recovered'));
    await recovery('01:05');
    // Eviction/restart keeps the durable slot and challenge, not process state.
    objects.delete('2026-10-06');
    await recovery('01:05');
    await recovery('01:25');
    const published = await (await worker.fetch(new Request('https://keywulf.com/data/today.json'), env)).json() as Challenge;
    expect(published).toEqual(challenge('2026-10-06', 'Recovered'));
    expect(generateBriefing).toHaveBeenCalledTimes(5);
  });

  it('bounds recovery to six durable slots, even when failed deliveries replay after eviction', async () => {
    vi.mocked(generateBriefing).mockRejectedValue(new Error('persistent outage'));
    for (const time of ['01:05', '01:25', '01:45', '02:05', '02:25', '02:45']) {
      await expect(recovery(time)).rejects.toThrow('HTTP 503');
      objects.delete('2026-10-06');
      await recovery(time);
    }
    expect(generateBriefing).toHaveBeenCalledTimes(6);
    vi.setSystemTime(Date.parse('2026-10-06T03:00:00Z'));
    await worker.scheduled({ cron: RECOVERY_CRON, scheduledTime: Date.parse('2026-10-06T02:45:00Z') }, env);
    expect(generateBriefing).toHaveBeenCalledTimes(6);
    expect((await worker.fetch(new Request('https://keywulf.com/data/today.json'), env)).status).toBe(503);
    // Operators can still recover manually after the automatic budget ends.
    vi.mocked(generateBriefing).mockResolvedValue(challenge('2026-10-06'));
    expect((await admin('prepare', '2026-10-06')).status).toBe(200);
  });

  it('skips an unexpired abandoned lease and recovers after its expiry', async () => {
    await admin('status', '2026-10-06');
    await stores.get('2026-10-06')!.put('lease', { id: 'crashed', until: Date.parse('2026-10-06T01:15:00Z') });
    await recovery('01:05');
    expect(generateBriefing).not.toHaveBeenCalled();
    vi.mocked(generateBriefing).mockResolvedValue(challenge('2026-10-06'));
    await recovery('01:25');
    expect(generateBriefing).toHaveBeenCalledTimes(1);
  });

  it('can disable recovery without disabling the original preparation schedule', async () => {
    env.KEYWULF_RECOVERY_ENABLED = 'false';
    await recovery('01:05');
    expect(generateBriefing).not.toHaveBeenCalled();
    vi.mocked(generateBriefing).mockResolvedValue(challenge('2026-10-06'));
    vi.setSystemTime(Date.parse('2026-10-06T00:20:00Z'));
    await worker.scheduled({ scheduledTime: Date.now(), cron: '20,30,40,50 0 * * *' }, env);
    expect(generateBriefing).toHaveBeenCalledTimes(1);
  });

  it('ignores invalid slots and late deliveries from another game day', async () => {
    await recovery('01:10');
    vi.setSystemTime(Date.parse('2026-10-07T01:05:00Z'));
    await worker.scheduled({ cron: RECOVERY_CRON, scheduledTime: Date.parse('2026-10-06T01:05:00Z') }, env);
    expect(generateBriefing).not.toHaveBeenCalled();
  });
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
    expect((await admin('repair-sources', original.date, { expected: original, repaired })).status).toBe(200);
    const latest = structuredClone(repaired);
    repaired.stories[0].body = repaired.stories[0].body.replace(/\w+/, 'Altered');
    expect((await admin('repair-sources', original.date, { expected: latest, repaired })).status).toBe(409);
    expect((await worker.fetch(new Request('https://keywulf.com/_internal/repair-sources', { method: 'POST' }), env)).status).toBe(401);
  });

  it('rejects stale runner repairs after a newer repair completes, even if typed text is unchanged', async () => {
    const original = challenge('2026-10-06');
    await admin('seed', original.date, original);

    const newer = structuredClone(original);
    newer.sourcePool[0].title = 'Newly verified source title';
    expect((await admin('repair-sources', original.date, { expected: original, repaired: newer })).status).toBe(200);

    // A runner that resolved titles against the old snapshot submits later.
    // The protected briefing text matches, but its stale metadata must not win.
    const stale = structuredClone(original);
    stale.sourcePool[0].title = 'Stale runner title';
    expect((await admin('repair-sources', original.date, { expected: original, repaired: stale })).status).toBe(409);
    expect(await stores.get(original.date)!.get('challenge')).toEqual(newer);

    // Clients must supply an expected snapshot, and a fresh one may update it.
    expect((await admin('repair-sources', original.date, stale)).status).toBe(400);
    const latest = structuredClone(newer);
    latest.sourcePool[0].title = 'Another verified source title';
    expect((await admin('repair-sources', original.date, { expected: newer, repaired: latest })).status).toBe(200);
    expect(await stores.get(original.date)!.get('challenge')).toEqual(latest);
    expect(generateBriefing).not.toHaveBeenCalled();
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

  it('allows only one generation under an unexpired lease and prevents public preparation', async () => {
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
