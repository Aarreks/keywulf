// Source enrichment for the daily generation job (server-side, once per day).
//
// Gemini's search grounding returns opaque redirect URLs with only a DOMAIN as
// the title (e.g. { title: "theguardian.com", url: "https://vertexaisearch..." }).
// For a readable Sources panel we follow each redirect to the real article and
// pull its og:title / <title>. Failures are always non-fatal: a source falls
// back to a slug-derived title, then to whatever the grounding gave us. Titles
// are display-only (never typed), so Unicode is fine here.

export interface SourceRef {
  title: string;
  url: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 KeywulfBot/1.0 (+https://keywulf.com)';

const MAX_TITLE_CHARS = 160;
const MAX_HTML_BYTES = 262_144; // titles live in <head>; don't drain whole pages

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

/** Pull a human title out of an HTML document: og:title first, then <title>. */
export function extractHtmlTitle(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']{3,300})["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']{3,300})["'][^>]*property=["']og:title["']/i.exec(html);
  const raw = og?.[1] ?? /<title[^>]*>([\s\S]{3,300}?)<\/title>/i.exec(html)?.[1] ?? null;
  if (!raw) return null;
  const clean = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  return clean.length >= 3 ? clean.slice(0, MAX_TITLE_CHARS) : null;
}

/** Derive a readable label from a URL slug: ".../colombia-earthquake-toll" ->
 * "Colombia earthquake toll". Scans ALL path segments and keeps the wordiest
 * one - many sites (e.g. Facebook) put the slug mid-path with a trailing
 * numeric ID. Returns null when no segment has a usable slug. */
export function titleFromSlug(url: string): string | null {
  try {
    const u = new URL(url);
    let best: string[] = [];
    for (const seg of u.pathname.split('/').filter(Boolean)) {
      const words = seg
        .replace(/\.(html?|php|aspx?|cms)$/i, '')
        .split(/[-_]+/)
        .filter((w) => w.length > 0 && !/^\d+$/.test(w));
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
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= limit) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out;
}

/**
 * Follow one grounding source's redirect to the real article and fetch a real
 * title. Never throws; on any failure returns the input (or partial progress).
 */
export async function resolveSource(src: SourceRef, timeoutMs = 8000): Promise<SourceRef> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(src.url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    });
    const finalUrl = res.url || src.url;
    let title: string | null = null;
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('html')) {
      title = extractHtmlTitle(await readCapped(res, MAX_HTML_BYTES));
    }
    title = title ?? titleFromSlug(finalUrl) ?? src.title;
    return { title, url: finalUrl };
  } catch {
    return src;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a batch of sources with bounded concurrency. Order-preserving. */
export async function enrichSources(
  sources: SourceRef[],
  concurrency = 6,
): Promise<SourceRef[]> {
  const out: SourceRef[] = new Array(sources.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= sources.length) return;
      out[i] = await resolveSource(sources[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, sources.length) }, worker));
  return out;
}
