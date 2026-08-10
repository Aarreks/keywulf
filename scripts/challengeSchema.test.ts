import { describe, it, expect } from 'vitest';
import { assembleChallenge } from './buildChallenge';
import { validateChallenge } from './challengeSchema';
import { sampleStories, SAMPLE_DATE } from './sampleStories';
import type { Challenge } from '../src/types';

function buildValid(): Challenge {
  return assembleChallenge({
    date: SAMPLE_DATE,
    model: 'test',
    generatedAt: `${SAMPLE_DATE}T00:15:00.000Z`,
    stories: sampleStories,
  });
}

describe('validateChallenge', () => {
  it('accepts the assembled sample challenge', () => {
    expect(() => validateChallenge(buildValid())).not.toThrow();
  });

  it('rejects too few stories', () => {
    const c = buildValid();
    c.stories = c.stories.slice(0, 5).map((s, i) => ({ ...s, rank: i + 1 }));
    expect(() => validateChallenge(c)).toThrow(/at least|shape/i);
  });

  it('rejects non-sequential ranks', () => {
    const c = buildValid();
    c.stories[0].rank = 99;
    expect(() => validateChallenge(c)).toThrow(/ranks|shape/i);
  });

  it('rejects non-ASCII typeable text', () => {
    const c = buildValid();
    c.stories[0].headline = 'Bad ' + String.fromCodePoint(0x2014) + ' dash';
    expect(() => validateChallenge(c)).toThrow(/ascii/i);
  });

  it('rejects a wordCount that disagrees with the actual text', () => {
    const c = buildValid();
    c.wordCount = c.wordCount + 100;
    expect(() => validateChallenge(c)).toThrow(/wordCount|words/i);
  });

  it('rejects duplicate headlines', () => {
    const c = buildValid();
    c.stories[1].headline = c.stories[0].headline;
    expect(() => validateChallenge(c)).toThrow(/dupe|duplicate/i);
  });

  it('rejects invalid source URLs', () => {
    const c = buildValid();
    c.sourcePool.push({ title: 'Bad', url: 'not-a-url' });
    expect(() => validateChallenge(c)).toThrow(/source|url/i);
  });

  it('rejects a gameNumber that does not match the date', () => {
    const c = buildValid();
    c.gameNumber = c.gameNumber + 5;
    expect(() => validateChallenge(c)).toThrow(/gameNumber/i);
  });

  it('rejects an empty source pool', () => {
    const c = buildValid();
    c.sourcePool = [];
    expect(() => validateChallenge(c)).toThrow(/sourcePool|source/i);
  });
});
