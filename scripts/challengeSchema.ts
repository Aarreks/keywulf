// Zod schema + deep validation for the daily challenge. Used ONLY by the
// generation pipeline and tests (never shipped to the browser). The browser has
// its own lightweight guard in src/lib/challengeClient.ts.

import { z } from 'zod';
import type { Challenge } from '../src/types';
import { isTypeableSafe, findUnsafeChars, countWords } from '../src/lib/sanitize';
import { gameNumberForDate } from '../src/lib/gameNumber';

// Tunable bounds. The game is capped at 2 minutes, so the briefing is broad and
// terse: 12-16 headlines, each with ONE short sentence, ~150-300 total words.
// Fast typists can just about clear it; everyone else gets as far as they get.
export const MIN_STORIES = 12;
export const MAX_STORIES = 16;
export const MIN_WORDS = 150;
export const MAX_WORDS = 300;
export const MAX_HEADLINE_CHARS = 90;
export const MAX_BODY_CHARS = 160;

const sourceSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url(),
});

const storySchema = z.object({
  rank: z.number().int().positive(),
  headline: z.string().min(3).max(MAX_HEADLINE_CHARS),
  body: z.string().min(3).max(MAX_BODY_CHARS),
  category: z.string().min(1).max(40),
  regions: z.array(z.string().min(1).max(40)).min(1),
  importance: z.number().min(0).max(100),
  sources: z.array(sourceSchema),
});

export const challengeSchema = z.object({
  schemaVersion: z.number().int(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gameNumber: z.number().int(),
  title: z.string().min(1).max(120),
  stories: z.array(storySchema).min(MIN_STORIES).max(MAX_STORIES),
  sourcePool: z.array(sourceSchema),
  wordCount: z.number().int(),
  generatedAt: z.string(),
  model: z.string(),
});

/** Normalized headline used for duplicate detection. */
function normalizeHeadline(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/** Jaccard token overlap for near-duplicate detection. */
function tokenOverlap(a: string, b: string): number {
  const sa = new Set(normalizeHeadline(a).split(' ').filter(Boolean));
  const sb = new Set(normalizeHeadline(b).split(' ').filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Deep-validate a fully-built Challenge. Throws an Error whose message lists
 * every problem found. Passing this is the gate for deployment.
 */
export function validateChallenge(challenge: Challenge): void {
  const problems: string[] = [];

  // 1. Structural shape.
  const parsed = challengeSchema.safeParse(challenge);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`shape: ${issue.path.join('.')} - ${issue.message}`);
    }
    // If the shape is broken, further checks are unreliable; report and stop.
    throw new Error('Challenge validation failed:\n' + problems.join('\n'));
  }

  const stories = challenge.stories;

  // 2. Sequential, unique ranks 1..N.
  const ranks = stories.map((s) => s.rank).sort((a, b) => a - b);
  ranks.forEach((r, i) => {
    if (r !== i + 1) problems.push(`ranks: expected ${i + 1} at position ${i}, got ${r}`);
  });

  // 3. ASCII safety of every typeable field.
  for (const s of stories) {
    for (const [field, value] of [
      ['headline', s.headline],
      ['body', s.body],
    ] as const) {
      if (!isTypeableSafe(value)) {
        const bad = findUnsafeChars(value)
          .map((u) => `${u.code}`)
          .join(', ');
        problems.push(`ascii: story #${s.rank} ${field} has non-typeable chars: ${bad}`);
      }
    }
  }

  // 4. Total typeable word count within range.
  const words = stories.reduce((sum, s) => sum + countWords(s.headline) + countWords(s.body), 0);
  if (words < MIN_WORDS || words > MAX_WORDS) {
    problems.push(`words: total typeable words ${words} outside [${MIN_WORDS}, ${MAX_WORDS}]`);
  }
  if (challenge.wordCount !== words) {
    problems.push(`words: wordCount field ${challenge.wordCount} != actual ${words}`);
  }

  // 5. Duplicate / near-duplicate headline detection.
  for (let i = 0; i < stories.length; i++) {
    for (let j = i + 1; j < stories.length; j++) {
      if (normalizeHeadline(stories[i].headline) === normalizeHeadline(stories[j].headline)) {
        problems.push(`dupe: stories #${stories[i].rank} and #${stories[j].rank} share a headline`);
      } else if (tokenOverlap(stories[i].headline, stories[j].headline) >= 0.7) {
        problems.push(
          `dupe: stories #${stories[i].rank} and #${stories[j].rank} look like duplicate coverage`,
        );
      }
    }
  }

  // 6. Source URLs must be http(s) and well-formed.
  const allSources = [...challenge.sourcePool, ...stories.flatMap((s) => s.sources)];
  for (const src of allSources) {
    try {
      const u = new URL(src.url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        problems.push(`source: non-http(s) URL ${src.url}`);
      }
    } catch {
      problems.push(`source: invalid URL ${src.url}`);
    }
  }
  if (challenge.sourcePool.length === 0) {
    problems.push('source: sourcePool is empty (need provenance for the briefing)');
  }

  // 7. Game number must match the date deterministically.
  const expected = gameNumberForDate(challenge.date);
  if (challenge.gameNumber !== expected) {
    problems.push(`gameNumber: ${challenge.gameNumber} != expected ${expected} for ${challenge.date}`);
  }

  if (problems.length > 0) {
    throw new Error('Challenge validation failed:\n' + problems.map((p) => '  - ' + p).join('\n'));
  }
}
