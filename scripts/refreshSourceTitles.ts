import type { Challenge, ChallengeSource } from '../src/types';
import { enrichSources, type SourceRef } from './enrichSources';
import { fallbackTitle, isUsableTitle } from './refineTitles';

export const SOURCE_METADATA_VERSION = 3;

/** Refresh display-only labels/links. No generation, no edits to the corpus. */
export async function refreshSourceTitles(
  challenge: Challenge,
  resolver: (source: SourceRef) => Promise<SourceRef>,
): Promise<Challenge> {
  const originals = new Map<string, ChallengeSource>();
  for (const source of [...challenge.sourcePool, ...challenge.stories.flatMap(s => s.sources)]) {
    if (!originals.has(source.url) || isUsableTitle(source.title)) originals.set(source.url, source);
  }
  const unresolved = [...originals.values()].filter(s =>
    !isUsableTitle(s.title) || new URL(s.url).hostname === 'vertexaisearch.cloud.google.com');
  const enriched = await enrichSources(unresolved, 6, resolver);
  const repaired = new Map<string, SourceRef>(enriched.map((s, i) => [unresolved[i].url, s]));
  const replace = (source: ChallengeSource): ChallengeSource => {
    const replacement = repaired.get(source.url);
    if (!replacement) return source;
    const title = fallbackTitle(replacement);
    return { ...source, title: isUsableTitle(title) ? title : source.title, url: replacement.url };
  };
  return {
    ...challenge,
    sourcePool: challenge.sourcePool.map(replace),
    stories: challenge.stories.map(story => ({ ...story, sources: story.sources.map(replace) })),
  };
}

/** Compare everything except the two fields a title repair may change. */
export function sourceRepairIdentity(challenge: Challenge): string {
  const strip = ({ title: _title, url: _url, ...source }: ChallengeSource) => source;
  return JSON.stringify({
    ...challenge,
    sourcePool: challenge.sourcePool.map(strip),
    stories: challenge.stories.map(s => ({ ...s, sources: s.sources.map(strip) })),
  });
}
