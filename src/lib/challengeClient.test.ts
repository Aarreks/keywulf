import { describe, it, expect } from 'vitest';
import { parseChallenge, buildCorpus, buildStorySpans, ChallengeError } from './challengeClient';
import type { Challenge } from '../types';

function makeChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    schemaVersion: 1,
    date: '2026-08-09',
    gameNumber: 221,
    title: 'Test Briefing',
    stories: [
      {
        rank: 1,
        headline: 'First headline here.',
        body: 'A short body sentence.',
        category: 'World',
        regions: ['Global'],
        importance: 90,
        sources: [{ title: 'Reuters', url: 'https://example.com/a' }],
      },
      {
        rank: 2,
        headline: 'Second headline.',
        body: 'Another body.',
        category: 'Economy',
        regions: ['US'],
        importance: 70,
        sources: [],
      },
    ],
    sourcePool: [{ title: 'Reuters', url: 'https://example.com/a' }],
    wordCount: 12,
    generatedAt: '2026-08-09T00:15:00.000Z',
    model: 'test',
    ...overrides,
  };
}

describe('parseChallenge', () => {
  it('accepts a well-formed challenge and sorts by rank', () => {
    const c = makeChallenge();
    const parsed = parseChallenge(JSON.parse(JSON.stringify(c)));
    expect(parsed.stories.map((s) => s.rank)).toEqual([1, 2]);
    expect(parsed.gameNumber).toBe(221);
  });

  it('throws on non-object input', () => {
    expect(() => parseChallenge(null)).toThrow(ChallengeError);
    expect(() => parseChallenge(42)).toThrow(ChallengeError);
  });

  it('throws on malformed date', () => {
    expect(() => parseChallenge(makeChallenge({ date: 'Aug 9' as unknown as string }))).toThrow(
      /date/i,
    );
  });

  it('throws when there are no stories', () => {
    expect(() => parseChallenge(makeChallenge({ stories: [] }))).toThrow(/no stories/i);
  });

  it('throws on non-sequential ranks', () => {
    const c = makeChallenge();
    c.stories[1].rank = 3; // gap: 1,3
    expect(() => parseChallenge(c)).toThrow(/sequential/i);
  });

  it('throws when typeable text is not ASCII-safe', () => {
    const c = makeChallenge();
    c.stories[0].headline = 'Bad ' + String.fromCodePoint(0x2014) + ' dash';
    expect(() => parseChallenge(c)).toThrow(/non-typeable/i);
  });
});

describe('buildCorpus / buildStorySpans', () => {
  it('concatenates only headline and body prose in rank order', () => {
    const c = makeChallenge();
    const corpus = buildCorpus(c);
    expect(corpus).toBe('First headline here. A short body sentence. Second headline. Another body.');
    // metadata must not appear
    expect(corpus).not.toContain('Economy');
    expect(corpus).not.toContain('Global');
  });

  it('produces spans whose offsets align exactly with the corpus', () => {
    const c = makeChallenge();
    const corpus = buildCorpus(c);
    const spans = buildStorySpans(c);
    expect(spans).toHaveLength(2);
    // Story 1 slice
    expect(corpus.slice(spans[0].start, spans[0].end)).toBe('First headline here. A short body sentence.');
    // Story 2 slice
    expect(corpus.slice(spans[1].start, spans[1].end)).toBe('Second headline. Another body.');
  });
});
