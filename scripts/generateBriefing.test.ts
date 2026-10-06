// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { generateBriefing } from './generateBriefing';
import sample from '../src/data/sampleChallenge.json';
import { validateChallenge } from './challengeSchema';

const { generate, options } = vi.hoisted(() => ({ generate: vi.fn(), options: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {
  models = { generateContent: generate };
  constructor(config: unknown) { options(config); }
} }));
vi.mock('./enrichSources', () => ({ enrichSources: vi.fn(async sources => sources) }));
vi.mock('./refineTitles', () => ({ refineTitles: vi.fn(async (_ai, _model, sources) => sources) }));

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('researches the actual date while preparing a distinct future game date, with bounded API calls', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T23:05:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ date: sample.date, stories: sample.stories }))));
  generate.mockResolvedValueOnce({
    text: 'Recent grounded research notes with confirmed details. '.repeat(60),
    candidates: [{ groundingMetadata: { groundingChunks: [{ web: {
      uri: 'https://publisher.example/news', title: 'A confirmed news story',
    } }] } }],
  }).mockResolvedValueOnce({ text: JSON.stringify({ stories: sample.stories }) });
  const result = await generateBriefing({ apiKey: 'test-key', date: '2026-10-06' });
  validateChallenge(result);
  expect(result.date).toBe('2026-10-06');
  expect(result.generatedAt).toBe('2026-10-05T23:05:00.000Z');
  expect(generate.mock.calls[0][0].contents).toContain('Today is 2026-10-05');
  expect(generate.mock.calls[1][0].contents).toContain("today's research notes (2026-10-05, UTC)");
  expect(options).toHaveBeenCalledWith(expect.objectContaining({ httpOptions: { timeout: 90000 } }));
});
