// Client-side loading + lightweight validation of the daily challenge JSON.
//
// The heavy Zod schema lives in the generation pipeline (dev/CI only). The
// browser uses this hand-written guard so no validation library ships in the
// bundle. If anything looks wrong we throw and the UI shows a proper error
// screen rather than a blank page.

import type { Challenge, Story, ChallengeSource } from '../types';
import { isTypeableSafe } from './sanitize';

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChallengeError';
  }
}

function isSource(v: unknown): v is ChallengeSource {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.title === 'string' && typeof s.url === 'string';
}

function isStory(v: unknown): v is Story {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.rank === 'number' &&
    typeof s.headline === 'string' &&
    s.headline.length > 0 &&
    typeof s.body === 'string' &&
    s.body.length > 0 &&
    typeof s.category === 'string' &&
    Array.isArray(s.regions) &&
    typeof s.importance === 'number' &&
    Array.isArray(s.sources) &&
    (s.sources as unknown[]).every(isSource)
  );
}

/** Parse and validate an unknown value into a Challenge, or throw. */
export function parseChallenge(raw: unknown): Challenge {
  if (!raw || typeof raw !== 'object') throw new ChallengeError('Challenge is not an object');
  const c = raw as Record<string, unknown>;

  if (typeof c.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
    throw new ChallengeError('Missing or malformed date');
  }
  if (typeof c.gameNumber !== 'number') throw new ChallengeError('Missing gameNumber');
  if (!Array.isArray(c.stories) || c.stories.length === 0) {
    throw new ChallengeError('Challenge has no stories');
  }
  if (!c.stories.every(isStory)) throw new ChallengeError('A story is malformed');

  const stories = c.stories as Story[];

  // Ranks must be sequential and unique starting at 1.
  const ranks = stories.map((s) => s.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) throw new ChallengeError('Story ranks are not sequential from 1');
  }

  // Typeable text must be ASCII-safe (defense in depth; the generator already
  // guarantees this, but never trust the payload).
  for (const s of stories) {
    if (!isTypeableSafe(s.headline) || !isTypeableSafe(s.body)) {
      throw new ChallengeError(`Story #${s.rank} contains non-typeable characters`);
    }
  }

  const sourcePool = Array.isArray(c.sourcePool) ? (c.sourcePool as unknown[]).filter(isSource) : [];

  return {
    schemaVersion: typeof c.schemaVersion === 'number' ? c.schemaVersion : 1,
    date: c.date,
    gameNumber: c.gameNumber,
    title: typeof c.title === 'string' ? c.title : 'Daily Briefing',
    stories: [...stories].sort((a, b) => a.rank - b.rank),
    sourcePool,
    wordCount: typeof c.wordCount === 'number' ? c.wordCount : 0,
    generatedAt: typeof c.generatedAt === 'string' ? c.generatedAt : '',
    model: typeof c.model === 'string' ? c.model : 'unknown',
  };
}

/**
 * The typeable corpus is the concatenation of each story's headline and body,
 * in rank order, joined by a single space. Only prose is typed -- never rank,
 * category, region, or source metadata.
 */
export function buildCorpus(challenge: Challenge): string {
  const parts: string[] = [];
  for (const s of challenge.stories) {
    parts.push(s.headline.trim());
    parts.push(s.body.trim());
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Build an index of where each story begins within the corpus, so the UI can
 * show story boundaries and "current story" as the caret advances.
 */
export interface StorySpan {
  rank: number;
  start: number; // inclusive char offset in corpus
  end: number; // exclusive
}

export function buildStorySpans(challenge: Challenge): StorySpan[] {
  const spans: StorySpan[] = [];
  let cursor = 0;
  const total = challenge.stories.length;
  challenge.stories.forEach((s, i) => {
    const piece = `${s.headline.trim()} ${s.body.trim()}`.replace(/\s+/g, ' ').trim();
    const start = cursor;
    const end = start + piece.length;
    spans.push({ rank: s.rank, start, end });
    // account for the joining space between stories
    cursor = end + (i < total - 1 ? 1 : 0);
  });
  return spans;
}

/** Fetch today's challenge with cache-busting so players never get stuck on
 * yesterday's puzzle. */
export async function fetchTodayChallenge(gameHint?: number): Promise<Challenge> {
  const bust = gameHint ?? Date.now();
  const res = await fetch(`/data/today.json?v=${bust}`, { cache: 'no-store' });
  if (!res.ok) throw new ChallengeError(`Failed to load challenge (HTTP ${res.status})`);
  const json = await res.json();
  return parseChallenge(json);
}
