import { describe, expect, it } from 'vitest';
import { attachStoryPhotos } from './storyPhotos';
import { assembleChallenge } from './buildChallenge';
import { validateChallenge } from './challengeSchema';
import type { Challenge } from '../src/types';
import sample from '../src/data/sampleChallenge.json';

function fixture(): Challenge {
  const challenge: Challenge = structuredClone(sample);
  challenge.stories[0].headline = 'Ethiopia federal forces retake Tigray capital.';
  challenge.stories[0].body = 'Troops entered Mekelle after rebels withdrew.';
  challenge.sourcePool = [{
    title: 'Ethiopia federal forces retake Mekelle amid Tigray fighting',
    url: 'https://publisher.example/ethiopia',
    imageUrl: 'https://images.example/mekelle.jpg', imageAlt: 'A street in Mekelle',
  }];
  return challenge;
}

describe('optional story photos', () => {
  it('retains fetched image metadata through assembly and challenge validation', () => {
    const input = fixture();
    const challenge = attachStoryPhotos(assembleChallenge({
      date: input.date, model: input.model, generatedAt: input.generatedAt,
      stories: input.stories, groundingSources: input.sourcePool,
    }));
    expect(challenge.stories[0].photo?.url).toBe('https://images.example/mekelle.jpg');
    expect(() => validateChallenge(challenge)).not.toThrow();
  });
  it('uses closely matching metadata without changing the briefing text', () => {
    const challenge = fixture();
    const enriched = attachStoryPhotos(challenge);
    expect(enriched.stories[0].photo).toEqual({
      url: 'https://images.example/mekelle.jpg', alt: 'A street in Mekelle',
      sourceUrl: 'https://publisher.example/ethiopia', sourceTitle: challenge.sourcePool[0].title,
    });
    expect(enriched.stories.map(({ headline, body }) => ({ headline, body })))
      .toEqual(challenge.stories.map(({ headline, body }) => ({ headline, body })));
    expect(challenge.stories[0].photo).toBeUndefined();
  });
  it('omits unrelated, vague, missing or insecure images', () => {
    for (const source of [
      { title: 'Markets rally after central bank announcement', imageUrl: 'https://images.example/bank.jpg' },
      { title: 'Federal forces fighting', imageUrl: 'https://images.example/army.jpg' },
      { title: fixture().sourcePool[0].title },
      { title: fixture().sourcePool[0].title, imageUrl: 'http://images.example/mekelle.jpg' },
    ]) {
      const challenge = fixture();
      challenge.sourcePool = [{ url: 'https://publisher.example/article', ...source }];
      expect(attachStoryPhotos(challenge).stories[0].photo).toBeUndefined();
    }
  });
});
