// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SourceMetadata } from './sourceMetadata';
import { resolveSource } from '../scripts/enrichSources';
import type { Storage } from './index';

vi.mock('../scripts/enrichSources', () => ({ resolveSource: vi.fn() }));

let metadata: SourceMetadata;
const source = { title: 'publisher.example', url: 'https://publisher.example/123' };
const read = (title = source.title) => metadata.fetch(new Request('https://metadata/resolve', {
  method: 'POST', body: JSON.stringify({ ...source, title }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-06T00:20:00Z'));
  vi.mocked(resolveSource).mockReset();
  const data = new Map<string, unknown>();
  // SourceMetadata only needs get/put, not the transaction API used by DailyBriefing.
  const storage = {
    get: async (key: string) => structuredClone(data.get(key)),
    put: async (key: string, value: unknown) => { data.set(key, structuredClone(value)); },
  } as Storage;
  metadata = new SourceMetadata({ storage });
});
afterEach(() => vi.useRealTimers());

it('backs off failed title resolution for a minute without degrading a better caller title', async () => {
  vi.mocked(resolveSource).mockResolvedValue(source);
  await read();
  expect(await (await read('A verified article title')).json()).toMatchObject({ title: 'A verified article title' });
  expect(resolveSource).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(60_000);
  await read();
  expect(resolveSource).toHaveBeenCalledTimes(2);
});

it('reuses a usable title for six hours and then resolves it again', async () => {
  vi.mocked(resolveSource).mockResolvedValue({ ...source, title: 'A verified article title' });
  await read();
  vi.advanceTimersByTime(6 * 3_600_000 - 1);
  expect(await (await read()).json()).toMatchObject({ title: 'A verified article title' });
  expect(resolveSource).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  await read();
  expect(resolveSource).toHaveBeenCalledTimes(2);
});
