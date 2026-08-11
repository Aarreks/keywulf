// Model-assisted source-title cleanup for the daily job (one cheap non-grounded
// call per day). Fetched pages sometimes yield junk titles: bot-check
// interstitials ("One moment, please..."), section indexes ("Europe"), or
// titles with the site name welded on. The model is good at RECOGNIZING these,
// so it picks the repair; but every output is verified in code with EXACT
// structural checks (verbatim keep, prefix trim, or slug recase - see
// isVerifiedEdit) so it cannot introduce a single word of its own. Any
// rejection falls back to deterministic heuristics, then the domain.

import type { GoogleGenAI } from '@google/genai';
import { titleFromSlug, type SourceRef } from './enrichSources';

/** Interstitial/bot-check/utility page titles that must never be shown. */
const JUNK_TITLES =
  /^(one moment|just a moment|attention required|access denied|are you (a )?(human|robot)|please verify|verifying you|checking your browser|loading|redirecting|error|forbidden|not found|page not found|40[34]\b|503\b|captcha|security check|robot check|please wait|please enable (js|javascript|cookies))/i;

/** A displayable article title: 3+ words and not an interstitial phrase. */
export function isUsableTitle(t: string | null | undefined): t is string {
  if (!t) return false;
  const s = t.trim();
  if (s.split(/\s+/).length < 3) return false; // "Europe", "World News"
  return !JUNK_TITLES.test(s);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * EXACT verification - no fuzzy thresholds. A model-proposed title is accepted
 * only if, case- and whitespace-insensitively, it is:
 *   (a) the raw title verbatim, or
 *   (b) a prefix of the raw title (trimming a welded-on site name), or
 *   (c) a prefix of the slug reconstruction (recasing/shortening it).
 * Under these rules the model chooses between edits of given text; it cannot
 * introduce a single word of its own. Anything else falls back to heuristics.
 */
export function isVerifiedEdit(candidate: string, rawTitle: string, url: string): boolean {
  const c = norm(candidate);
  if (c.length === 0) return false;
  const raw = norm(rawTitle);
  if (raw === c || raw.startsWith(c)) return true;
  const slug = titleFromSlug(url);
  if (slug) {
    const s = norm(slug);
    if (s === c || s.startsWith(c)) return true;
  }
  return false;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/** Deterministic fallback for one source: gated title -> slug -> domain. */
export function fallbackTitle(src: SourceRef): string {
  if (isUsableTitle(src.title)) return src.title;
  const slug = titleFromSlug(src.url);
  if (isUsableTitle(slug)) return slug;
  const dom = domainOf(src.url);
  // An unresolved grounding redirect keeps its original label (usually the
  // publisher's domain) - never Google's redirect hostname.
  if (!dom || dom.endsWith('vertexaisearch.cloud.google.com')) return src.title || dom;
  return dom;
}

const PROMPT_HEAD = `You are cleaning link titles for a news briefing's Sources list. For each item you receive {"i", "rawTitle", "slug", "domain"}.

Return ONLY a JSON array: [{"i": number, "title": string | null}, ...]

Rules - your output for each item MUST be exactly one of these four moves (anything else is discarded by a validator):
1. rawTitle unchanged - when it is already a good article headline.
2. A PREFIX of rawTitle - cut a trailing site name or suffix (e.g. drop "The Jerusalem Post" from "... east China The Jerusalem Post" for jpost.com). You may only cut from the end, never from the start or middle.
3. The slug's words, in their original order, recased as a headline (you may stop early) - use this when rawTitle is a bot-check placeholder ("One moment, please...", "Access Denied") or a bare section name ("Europe", "World News").
4. null - when neither rawTitle nor slug yields a readable headline.
Never reorder words. Never add words. Never translate. Keep under 120 characters.

ITEMS:
`;

/**
 * Batch-clean source titles with the model. Never throws; on any failure the
 * deterministic fallback chain is used for every item.
 */
export async function refineTitles(
  ai: GoogleGenAI,
  model: string,
  sources: SourceRef[],
): Promise<SourceRef[]> {
  const items = sources.map((s, i) => ({
    i,
    rawTitle: s.title,
    slug: slugOf(s.url),
    domain: domainOf(s.url),
  }));

  let byIndex = new Map<number, string | null>();
  try {
    const res = await ai.models.generateContent({
      model,
      contents: PROMPT_HEAD + JSON.stringify(items, null, 1),
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 6000,
        thinkingConfig: { thinkingBudget: 512 },
      },
    });
    const parsed = JSON.parse(res.text ?? '[]') as Array<{ i: number; title: string | null }>;
    if (Array.isArray(parsed)) {
      byIndex = new Map(parsed.map((p) => [p.i, p.title]));
    }
  } catch (err) {
    console.warn(
      `Title refinement call failed (${err instanceof Error ? err.message.split('\n')[0] : err}); using heuristic titles.`,
    );
  }

  return sources.map((src, i) => {
    const proposed = byIndex.get(i);
    if (
      typeof proposed === 'string' &&
      isUsableTitle(proposed) &&
      proposed.length <= 160 &&
      // Exact structural check: keep / prefix-trim / slug recase only.
      isVerifiedEdit(proposed, src.title, src.url)
    ) {
      return { title: proposed.trim(), url: src.url };
    }
    return { title: fallbackTitle(src), url: src.url };
  });
}
