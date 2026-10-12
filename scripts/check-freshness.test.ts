// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkFreshness } from './check-freshness';
import sample from '../src/data/sampleChallenge.json';
import { gameNumberForDate } from '../src/lib/gameNumber';

describe('public freshness alert probe', () => {
  const now = Date.parse('2026-10-06T01:10:00Z');
  const fixture = (date: string) => ({ ...sample, date, gameNumber: gameNumberForDate(date) });
  const run = (response: Response, time = now) => checkFreshness({ now: time, fetcher: vi.fn(async () => response) });
  it('accepts only the active game, including before the 01:00 boundary', async () => {
    expect(await run(Response.json(fixture('2026-10-06')))).toBe('2026-10-06');
    expect(await run(Response.json(fixture('2026-10-05')), now - 20 * 60_000)).toBe('2026-10-05');
  });
  it('fails for missing, stale and malformed briefings and network outages', async () => {
    await expect(run(new Response('', { status: 503 }))).rejects.toThrow('HTTP 503');
    await expect(run(Response.json(fixture('2026-10-05')))).rejects.toThrow('received 2026-10-05');
    await expect(run(Response.json({ date: '2026-10-06' }))).rejects.toThrow();
    await expect(checkFreshness({ now, fetcher: vi.fn(async () => { throw new Error('network outage'); }) })).rejects.toThrow('network outage');
  });
});
