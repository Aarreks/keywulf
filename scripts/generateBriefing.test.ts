// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { generateBriefing } from './generateBriefing';
import sample from '../src/data/sampleChallenge.json';
import { validateChallenge } from './challengeSchema';
import { enrichSources } from './enrichSources';

const { generate, options } = vi.hoisted(() => ({ generate: vi.fn(), options: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  models = { generateContent: generate };
  constructor(config: unknown) { options(config); }
} }));
vi.mock('./enrichSources', () => ({ enrichSources: vi.fn(async sources => sources) }));
vi.mock('./refineTitles', () => ({ refineTitles: vi.fn(async (_ai, _model, sources) => sources) }));

beforeEach(() => { generate.mockReset(); options.mockClear(); vi.mocked(enrichSources).mockClear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('researches the actual date while preparing a distinct future game date, with bounded API calls', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T23:05:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ date: sample.date, stories: sample.stories }))));
  generate.mockResolvedValueOnce({
    text: 'Recent grounded research notes with confirmed details. '.repeat(60),
    candidates: [{ groundingMetadata: { groundingChunks: Array.from({ length: 30 }, (_, i) => ({ web: {
      uri: `https://publisher.example/news/${i}`, title: 'A confirmed news story',
    } })) } }],
  }).mockResolvedValueOnce({ text: JSON.stringify({ stories: sample.stories }) });
  const result = await generateBriefing({ apiKey: 'test-key', date: '2026-10-06' });
  validateChallenge(result);
  expect(result.date).toBe('2026-10-06');
  expect(result.generatedAt).toBe('2026-10-05T23:05:00.000Z');
  expect(generate.mock.calls[0][0].contents).toContain('Today is 2026-10-05');
  expect(generate.mock.calls[1][0].contents).toContain("today's research notes (2026-10-05, UTC)");
  expect(options).toHaveBeenCalledWith(expect.objectContaining({ httpOptions: { timeout: 90000 } }));
  expect(vi.mocked(enrichSources).mock.calls[0][0]).toHaveLength(30);
});

it('bounds unsuccessful research to three attempts and never starts formatting', async () => {
  vi.useFakeTimers();
  generate.mockResolvedValue({ text: 'Plausible but ungrounded notes. '.repeat(100), candidates: [] });
  const failed = expect(generateBriefing({ apiKey: 'test-key', date: '2026-10-06' }))
    .rejects.toThrow('Research failed after 3 attempts');
  await vi.runAllTimersAsync();
  await failed;
  expect(generate).toHaveBeenCalledTimes(3);
  expect(enrichSources).not.toHaveBeenCalled();
});

it('reuses grounded research while retrying malformed and invalid formatted output', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  generate.mockResolvedValueOnce({
    text: 'Confirmed current reporting with source evidence. '.repeat(100),
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: {
      uri: 'https://publisher.example/report', title: 'Confirmed current reporting',
    } }] } }],
  }).mockResolvedValueOnce({ text: 'not JSON' })
    .mockResolvedValueOnce({ text: JSON.stringify({ stories: [] }) })
    .mockResolvedValueOnce({ text: JSON.stringify({ stories: sample.stories }) });
  const pending = generateBriefing({ apiKey: 'test-key', date: '2026-10-06' });
  await vi.runAllTimersAsync();
  validateChallenge(await pending);
  expect(generate).toHaveBeenCalledTimes(4); // one research + three formatting calls
  expect(enrichSources).toHaveBeenCalledTimes(1);
  expect(generate.mock.calls[2][0].contents).toContain('No JSON object found');
  expect(generate.mock.calls[3][0].contents).toContain('YOUR PREVIOUS ATTEMPT FAILED VALIDATION');
});
