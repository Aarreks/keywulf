// Source enrichment for the daily generation job (server-side, once per day).
//
// Gemini's search grounding returns opaque redirect URLs with only a DOMAIN as
// the title (e.g. { title: "theguardian.com", url: "https://vertexaisearch..." }).
// For a readable Sources panel we follow each redirect to the real article and
// pull its og:title / <title>. Failures are always non-fatal: a source falls
// back to a slug-derived title, then to whatever the grounding gave us. Titles
// are display-only (never typed), so Unicode is fine here.

import { isUsableTitle } from './sourceTitles';

export interface SourceRef {
  title: string;
  url: string;
  imageUrl?: string;
  imageAlt?: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KeywulfBot/1.0 (+https://keywulf.com)';

const MAX_TITLE_CHARS = 160;
const MAX_HTML_BYTES = 262_144; // titles live in <head>; don't drain whole pages
const MAX_VIDEO_HTML_BYTES = 1_048_576; // YouTube puts metadata after large inline scripts

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '-')
    .replace(/&ndash;/g, '-')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"');
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const attr of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    out.set(attr[1].toLowerCase(), decodeEntities(attr[2] ?? attr[3] ?? attr[4]));
  }
  return out;
}

function titleValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = decodeEntities(value).replace(/\s+/g, ' ').trim();
  return isUsableTitle(clean) ? clean.slice(0, MAX_TITLE_CHARS) : null;
}

/** Read publisher titles, with quote-safe attributes and structured metadata. */
export function extractHtmlTitle(html: string): string | null {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop'))?.toLowerCase();
    if (key && attrs.has('content') && !meta.has(key)) meta.set(key, attrs.get('content')!);
  }
  for (const key of ['og:title', 'twitter:title', 'headline', 'name']) {
    const title = titleValue(meta.get(key));
    if (title) return title;
  }
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (attributes(script[1]).get('type')?.toLowerCase() !== 'application/ld+json') continue;
    try {
      const parsed = JSON.parse(script[2]);
      const entries = Array.isArray(parsed) ? parsed : [parsed, ...(Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [])];
      for (const entry of entries.slice(0, 100)) {
        const types = [entry?.['@type']].flat();
        if (!types.some(type => /^(newsarticle|article|videoobject)$/i.test(String(type)))) continue;
        const title = titleValue(entry.headline ?? entry.name);
        if (title) return title;
      }
    } catch { /* Publisher JSON-LD can be malformed. */ }
  }
  return titleValue(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]);
}

/** Read publisher preview metadata, resolving relative URLs against the article. */
export function extractHtmlImage(html: string, pageUrl: string): { imageUrl: string; imageAlt?: string } | null {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributes(tag);
    const key = (attrs.get('property') ?? attrs.get('name'))?.toLowerCase();
    if (key && attrs.has('content') && !meta.has(key)) meta.set(key, attrs.get('content')!);
  }
  for (const key of ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image']) {
    const raw = meta.get(key)?.trim();
    if (!raw) continue;
    try {
      const url = new URL(raw, pageUrl);
      if (url.protocol !== 'https:' || url.username || url.password) continue;
      if (/logo|favicon|placeholder|sprite/i.test(url.pathname)) continue;
      const alt = meta.get(key.startsWith('og:') ? 'og:image:alt' : 'twitter:image:alt')?.trim();
      return { imageUrl: url.href, ...(alt ? { imageAlt: alt.slice(0, 400) } : {}) };
    } catch { /* Optional metadata must never prevent publication. */ }
  }
  return null;
}

/** Derive a readable label from a URL slug: ".../colombia-earthquake-toll" ->
 * "Colombia earthquake toll". Scans ALL path segments and keeps the wordiest
 * one - many sites (e.g. Facebook) put the slug mid-path with a trailing
 * numeric ID. Returns null when no segment has a usable slug. */
export function titleFromSlug(url: string): string | null {
  try {
    const u = new URL(url);
    // An unresolved grounding redirect is a wrapper, not an article URL - its
    // path ("grounding-api-redirect/<token>") must never become a title.
    if (u.hostname.endsWith('vertexaisearch.cloud.google.com')) return null;
    let best: string[] = [];
    for (const seg of u.pathname.split('/').filter(Boolean)) {
      const cleaned = seg.replace(/\.(html?|php|aspx?|cms)$/i, '');
      // Real headline slugs are lowercase alphanumerics joined by - or _.
      // Anything else (Base64ish redirect tokens, mixed-case IDs) is noise.
      if (!/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(cleaned)) continue;
      const words = cleaned
        .split(/[-_]+/)
        .filter((w) => w.length > 0 && w.length <= 24 && !/^\d+$/.test(w));
      if (words.length > best.length) best = words;
    }
    if (best.length < 3) return null; // too short to be a headline slug
    const s = best.join(' ').slice(0, MAX_TITLE_CHARS);
    return s.charAt(0).toUpperCase() + s.slice(1);
  } catch {
    return null;
  }
}

/** Read at most `limit` bytes of a response body as text. */
async function readCapped(res: Response, limit: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const decoder = new TextDecoder();
  let out = '';
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const part = value.subarray(0, limit - bytes);
    bytes += part.byteLength;
    out += decoder.decode(part, { stream: true });
    if (bytes >= limit) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out + decoder.decode();
}

/** Canonicalize supported video URLs without trusting lookalike hostnames. */
export function youtubeVideoUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube-nocookie.com'].includes(host)) {
      id = url.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null;
    }
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  } catch { return null; }
}

/**
 * Follow one grounding source's redirect to the real article and fetch a real
 * title. Never throws; on any failure returns the input (or partial progress).
 */
export async function resolveSource(src: SourceRef, timeoutMs = 8000): Promise<SourceRef> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let finalUrl = src.url;
  try {
    let checkedVideo = false;
    for (let hop = 0; hop < 8; hop++) {
      const video = youtubeVideoUrl(finalUrl);
      if (video && !checkedVideo) {
        checkedVideo = true;
        finalUrl = video;
        try {
          const metadata = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(video)}`, {
            signal: ctrl.signal, headers: { accept: 'application/json' },
          });
          if (metadata.ok) {
            const info = JSON.parse(await readCapped(metadata, 32_768)) as { title?: string; thumbnail_url?: string };
            const title = titleValue(info.title);
            if (title) return { ...src, title, url: video };
          } else await metadata.body?.cancel();
        } catch { /* Some non-embeddable videos still expose watch-page metadata. */ }
      }
      const res = await fetch(finalUrl, {
        redirect: 'manual', signal: ctrl.signal,
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        const nextUrl = new URL(location, finalUrl);
        if (!['http:', 'https:'].includes(nextUrl.protocol) || nextUrl.username || nextUrl.password) break;
        await res.body?.cancel();
        finalUrl = nextUrl.href;
        continue;
      }
      finalUrl = res.url || finalUrl;
      if (res.ok && (res.headers.get('content-type') ?? '').includes('html')) {
        const html = await readCapped(res, video ? MAX_VIDEO_HTML_BYTES : MAX_HTML_BYTES);
        const title = extractHtmlTitle(html) ?? titleFromSlug(finalUrl) ?? src.title;
        return { ...src, title, url: finalUrl, ...extractHtmlImage(html, finalUrl) };
      }
      await res.body?.cancel();
      break;
    }
  } catch {
    // Keep a resolved article URL even when its metadata request times out.
  } finally {
    clearTimeout(timer);
  }
  return { ...src, title: titleFromSlug(finalUrl) ?? src.title, url: finalUrl };
}

/** Resolve a batch of sources with bounded concurrency. Order-preserving. */
export async function enrichSources(
  sources: SourceRef[],
  concurrency = 6,
  resolver: (source: SourceRef) => Promise<SourceRef> = resolveSource,
): Promise<SourceRef[]> {
  const out: SourceRef[] = new Array(sources.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= sources.length) return;
      out[i] = await resolver(sources[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return out;
}
