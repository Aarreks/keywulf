import { describe, it, expect } from 'vitest';
import { ensureTerminalPunctuation, assembleChallenge } from './buildChallenge';
import { buildCorpus } from '../src/lib/challengeClient';
import { sampleStories, SAMPLE_DATE } from './sampleStories';

describe('ensureTerminalPunctuation', () => {
  it('appends a period to a bare headline', () => {
    expect(ensureTerminalPunctuation('North Korea to deploy troops to Russia')).toBe(
      'North Korea to deploy troops to Russia.',
    );
  });

  it('leaves existing terminal punctuation alone', () => {
    expect(ensureTerminalPunctuation('Plan rejected.')).toBe('Plan rejected.');
    expect(ensureTerminalPunctuation('A deal at last?')).toBe('A deal at last?');
    expect(ensureTerminalPunctuation('Markets: a quiet day:')).toBe('Markets: a quiet day:');
  });

  it('handles punctuation followed by a closing quote', () => {
    expect(ensureTerminalPunctuation('Officials call it "temporary."')).toBe(
      'Officials call it "temporary."',
    );
  });

  it('collapses a doubled period but preserves an ellipsis', () => {
    expect(ensureTerminalPunctuation('Plan rejected..')).toBe('Plan rejected.');
    expect(ensureTerminalPunctuation('And then...')).toBe('And then...');
  });

  it('handles empty and whitespace input', () => {
    expect(ensureTerminalPunctuation('')).toBe('');
    expect(ensureTerminalPunctuation('   ')).toBe('');
  });
});

describe('assembleChallenge headline punctuation', () => {
  it('produces a corpus with no headline-to-body capital collisions', () => {
    const challenge = assembleChallenge({
      date: SAMPLE_DATE,
      model: 'test',
      generatedAt: `${SAMPLE_DATE}T00:15:00.000Z`,
      stories: sampleStories,
    });
    for (const s of challenge.stories) {
      expect(s.headline).toMatch(/[.?!:]["']?$/);
    }
    // In the corpus, every headline is followed by its punctuation and a space,
    // so the headline never welds into the body's capitalized first word.
    const corpus = buildCorpus(challenge);
    for (const s of challenge.stories) {
      expect(corpus).toContain(`${s.headline} ${s.body}`);
      expect(s.headline.endsWith('.')).toBe(true); // sample headlines are bare
    }
  });

  it('trims lowest-importance stories to fit the word budget', () => {
    // 16 stories x ~24 words = ~384 words, well over MAX_WORDS (300).
    const fat = Array.from({ length: 16 }, (_, i) => ({
      headline: `Distinct event number ${i + 1} shakes region ${i + 1}`,
      body: 'Officials confirmed the development after multiple independent reports emerged from the area on Tuesday morning.',
      category: 'Politics',
      regions: ['Global'],
      importance: 100 - i,
      sources: [{ title: 'Reuters', url: 'https://www.reuters.com/world/' }],
    }));
    const challenge = assembleChallenge({
      date: SAMPLE_DATE,
      model: 'test',
      generatedAt: `${SAMPLE_DATE}T00:15:00.000Z`,
      stories: fat,
    });
    expect(challenge.wordCount).toBeLessThanOrEqual(300);
    expect(challenge.stories.length).toBeGreaterThanOrEqual(12);
    // Highest-importance stories survive; ranks stay sequential from 1.
    expect(challenge.stories[0].importance).toBe(100);
    expect(challenge.stories.map((s) => s.rank)).toEqual(
      challenge.stories.map((_, i) => i + 1),
    );
  });

  it('does not double a period the model already supplied', () => {
    const challenge = assembleChallenge({
      date: SAMPLE_DATE,
      model: 'test',
      generatedAt: `${SAMPLE_DATE}T00:15:00.000Z`,
      stories: [
        ...sampleStories.slice(0, 11),
        { ...sampleStories[11], headline: 'Aid convoys reach a region cut off by floods.' },
      ],
    });
    const last = challenge.stories.find((s) => s.headline.startsWith('Aid convoys'));
    expect(last?.headline).toBe('Aid convoys reach a region cut off by floods.');
  });
});
