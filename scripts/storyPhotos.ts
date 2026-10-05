import type { Challenge, ChallengeSource, Story } from '../src/types';

const STOP_WORDS = new Set(('a an and are as at be been by for from has have in is it its of on or ' +
  'that the their this to was were will with after amid over into says said new news latest live ' +
  'today update updates world report reports more than').split(' '));

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter(
    (word) => word.length >= 3 && !STOP_WORDS.has(word),
  ));
}

/** Require multiple shared headline terms plus supporting body/title overlap.
 * If attribution is uncertain, omit the photo instead of illustrating another event. */
function matchScore(story: Story, source: ChallengeSource): number {
  if (!source.imageUrl?.startsWith('https://')) return 0;
  const title = tokens(source.title);
  const headlineHits = [...tokens(story.headline)].filter((word) => title.has(word)).length;
  const all = tokens(`${story.headline} ${story.body}`);
  const hits = [...all].filter((word) => title.has(word)).length;
  if (headlineHits < 2 || hits < 3 || hits / Math.max(1, title.size) < 0.35) return 0;
  return headlineHits * 2 + hits / Math.max(1, title.size);
}

/** No additional network or AI call; only uses metadata already fetched by the daily job. */
export function attachStoryPhotos(challenge: Challenge): Challenge {
  const stories = challenge.stories.map((story) => {
    const candidates = [...story.sources, ...challenge.sourcePool]
      .map((source) => ({ source, score: matchScore(story, source) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    const source = candidates[0]?.source;
    if (!source?.imageUrl) return story;
    return { ...story, photo: {
      url: source.imageUrl,
      alt: source.imageAlt || `Article preview: ${source.title}`,
      sourceUrl: source.url,
      sourceTitle: source.title,
    } };
  });
  return { ...challenge, stories };
}
