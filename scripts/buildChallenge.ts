// Shared assembly logic: turn raw (possibly messy) story objects into a fully
// sanitized, ranked, ASCII-safe Challenge. Used by both the Gemini generator
// and the checked-in sample builder so they behave identically.

import type { Challenge, ChallengeSource, Story } from '../src/types';
import { sanitizeText, countWords } from '../src/lib/sanitize';
import { gameNumberForDate } from '../src/lib/gameNumber';
import { MIN_STORIES, MAX_WORDS } from './challengeSchema';

export interface RawSource {
  title?: unknown;
  url?: unknown;
}

export interface RawStory {
  headline?: unknown;
  body?: unknown;
  category?: unknown;
  regions?: unknown;
  importance?: unknown;
  sources?: unknown;
}

export interface AssembleInput {
  date: string; // YYYY-MM-DD (UTC)
  model: string;
  generatedAt: string; // ISO
  title?: string;
  stories: RawStory[];
  /**
   * Real source URLs retained from search grounding. When provided these seed
   * the challenge's global source pool (preferred over any model-authored URLs,
   * which we do not trust for provenance).
   */
  groundingSources?: RawSource[];
}

function cleanSources(raw: unknown): ChallengeSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ChallengeSource[] = [];
  for (const s of raw) {
    const rs = (s ?? {}) as RawSource;
    const url = typeof rs.url === 'string' ? rs.url.trim() : '';
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    } catch {
      continue;
    }
    const title = sanitizeText(typeof rs.title === 'string' ? rs.title : url) || url;
    out.push({ title, url });
  }
  return out;
}

function cleanRegions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ['Global'];
  const regions = raw
    .map((r) => sanitizeText(typeof r === 'string' ? r : ''))
    .filter((r) => r.length > 0);
  return regions.length > 0 ? regions : ['Global'];
}

/**
 * Give a headline terminal punctuation so the typed corpus never welds a
 * headline into the following sentence ("...troops to Russia Ukraine warned...").
 * Appends a period unless the headline already ends with . ? ! or : (optionally
 * followed by a closing quote), and collapses an accidental doubled period.
 */
export function ensureTerminalPunctuation(headline: string): string {
  let h = headline.trim();
  if (h === '') return h;
  // Model typo "plan.." -> "plan." -- but leave a deliberate "..." alone.
  h = h.replace(/(^|[^.])\.\.$/, '$1.');
  return /[.?!:]["']?$/.test(h) ? h : h + '.';
}

function dedupeSources(sources: ChallengeSource[]): ChallengeSource[] {
  const seen = new Set<string>();
  const out: ChallengeSource[] = [];
  for (const s of sources) {
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    out.push(s);
  }
  return out;
}

/**
 * Assemble a Challenge from raw stories: sanitize all text to ASCII, rank by
 * importance (descending, sequential from 1), compute word count and game
 * number, and build a deduped source pool. Does NOT validate; run
 * validateChallenge() on the result before deploying.
 */
export function assembleChallenge(input: AssembleInput): Challenge {
  const cleaned = input.stories.map((s) => {
    const headline = ensureTerminalPunctuation(sanitizeText(s.headline));
    const body = sanitizeText(s.body);
    const category = sanitizeText(s.category) || 'World';
    const regions = cleanRegions(s.regions);
    const importance =
      typeof s.importance === 'number' && Number.isFinite(s.importance)
        ? Math.max(0, Math.min(100, s.importance))
        : 50;
    const sources = cleanSources(s.sources);
    return { headline, body, category, regions, importance, sources };
  });

  // Rank by importance, descending. Stable for equal importance.
  const ranked = cleaned
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.importance - a.s.importance || a.i - b.i)
    .map(({ s }, idx): Story => ({ rank: idx + 1, ...s }));

  // Enforce the word budget deterministically: the model overshoots ~half the
  // time, so drop whole lowest-importance stories from the bottom (never
  // mangling sentences) while we stay at or above the minimum story count.
  // If it still cannot fit, validation fails and the retry loop takes over.
  const storyWords = (s: Story) => countWords(s.headline) + countWords(s.body);
  while (
    ranked.length > MIN_STORIES &&
    ranked.reduce((sum, s) => sum + storyWords(s), 0) > MAX_WORDS
  ) {
    ranked.pop();
  }

  const wordCount = ranked.reduce((sum, s) => sum + storyWords(s), 0);
  const grounding = cleanSources(input.groundingSources);
  const sourcePool = dedupeSources([...grounding, ...ranked.flatMap((s) => s.sources)]);

  return {
    schemaVersion: 1,
    date: input.date,
    gameNumber: gameNumberForDate(input.date),
    title: input.title ? sanitizeText(input.title) : 'World Briefing',
    stories: ranked,
    sourcePool,
    wordCount,
    generatedAt: input.generatedAt,
    model: input.model,
  };
}
