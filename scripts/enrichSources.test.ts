import { afterEach, describe, it, expect, vi } from 'vitest';
import { extractHtmlTitle, extractHtmlImage, titleFromSlug, resolveSource, youtubeVideoUrl, extractYoutubePlayerTitle } from './enrichSources';

afterEach(() => vi.unstubAllGlobals());

describe('extractHtmlImage', () => {
  it('reads reversed attributes, relative images and HTML entities', () => {
    expect(extractHtmlImage(`<meta content="/photo.jpg?a=1&amp;b=2" property="og:image">
      <meta property="og:image:alt" content="A street &amp; buildings">`, 'https://example.com/article'))
      .toEqual({ imageUrl: 'https://example.com/photo.jpg?a=1&b=2', imageAlt: 'A street & buildings' });
  });
  it('prefers secure Open Graph images and supports Twitter fallback', () => {
    expect(extractHtmlImage(`<meta property="og:image" content="http://example.com/a.jpg">
      <meta property="og:image:secure_url" content="https://example.com/b.jpg">`, 'https://example.com'))
      .toEqual({ imageUrl: 'https://example.com/b.jpg' });
    expect(extractHtmlImage(`<meta name="twitter:image" content="https://example.com/c.jpg">`, 'https://example.com'))
      .toEqual({ imageUrl: 'https://example.com/c.jpg' });
  });
  it('ignores missing images, logos, unsafe schemes and credentials', () => {
    for (const image of ['http://example.com/a.jpg', 'javascript:alert(1)', 'data:image/png,abc',
      'https://user:password@example.com/a.jpg', 'https://example.com/logo.png']) {
      expect(extractHtmlImage(`<meta property="og:image" content="${image}">`, 'https://example.com')).toBeNull();
    }
    expect(extractHtmlImage('<title>No photo</title>', 'https://example.com')).toBeNull();
  });
});

describe('extractHtmlTitle', () => {
  it('keeps apostrophes and quoted words in meta content and reads Twitter titles', () => {
    expect(extractHtmlTitle(`<META content="President's ceasefire &quot;deal&quot; questioned" PROPERTY="og:title">`))
      .toBe(`President's ceasefire "deal" questioned`);
    expect(extractHtmlTitle(`<meta name=twitter:title content="Floods close the airport">`)).toBe('Floods close the airport');
  });
  it('reads video itemprop names and article JSON-LD while ignoring generic site labels', () => {
    expect(extractHtmlTitle(`<title>YouTube</title><meta itemprop="name" content="Earthquake damage disrupts flights">`))
      .toBe('Earthquake damage disrupts flights');
    expect(extractHtmlTitle(`<script type="application/ld+json">{"@graph":[{"@type":"WebSite","name":"Publisher home page"},{"@type":"NewsArticle","headline":"Talks resume after the election"}]}</script>`))
      .toBe('Talks resume after the election');
  });
  it('prefers og:title over <title>', () => {
    const html = `<html><head>
      <title>Site name here</title>
      <meta property="og:title" content="Colombia earthquake kills dozens" />
    </head><body></body></html>`;
    expect(extractHtmlTitle(html)).toBe('Colombia earthquake kills dozens');
  });

  it('handles content-before-property attribute order', () => {
    const html = `<meta content="Attribute order reversed" property="og:title" />`;
    expect(extractHtmlTitle(html)).toBe('Attribute order reversed');
  });

  it('falls back to the <title> tag', () => {
    const html = `<head><title> Typhoon forces evacuations | The Example Times </title></head>`;
    expect(extractHtmlTitle(html)).toBe('Typhoon forces evacuations | The Example Times');
  });

  it('decodes HTML entities and collapses whitespace', () => {
    const html = `<title>Q&amp;A: what&rsquo;s next \n for the &ldquo;deal&rdquo;?</title>`;
    expect(extractHtmlTitle(html)).toBe(`Q&A: what's next for the "deal"?`);
  });

  it('returns null when no usable title exists', () => {
    expect(extractHtmlTitle('<html><body>no head</body></html>')).toBeNull();
    expect(extractHtmlTitle('<title></title>')).toBeNull();
  });

  it('caps absurdly long titles', () => {
    const html = `<title>${'x'.repeat(500)}</title>`;
    const t = extractHtmlTitle(html);
    // The regex bounds capture length; whatever comes back must respect the cap.
    expect(t === null || t.length <= 160).toBe(true);
  });
});

describe('video metadata resolution', () => {
  const canonical = 'https://www.youtube.com/watch?v=abcdefghijk';
  it('rejects empty YouTube headings and verifies the player title belongs to this video', () => {
    expect(extractHtmlTitle('<title>- YouTube</title>')).toBeNull();
    const html = '<script>var ytInitialPlayerResponse={"videoDetails":{"videoId":"abcdefghijk","title":"Reports from the coast"}}</script>';
    expect(extractYoutubePlayerTitle(html, canonical)).toBe('Reports from the coast');
    expect(extractYoutubePlayerTitle(html, 'https://www.youtube.com/watch?v=12345678901')).toBeNull();
  });
  it('recognizes watch, shorts and short URLs without accepting spoofed hosts', () => {
    for (const url of [canonical, 'https://youtu.be/abcdefghijk', 'https://www.youtube.com/shorts/abcdefghijk']) {
      expect(youtubeVideoUrl(url)).toBe(canonical);
    }
    expect(youtubeVideoUrl('https://youtube.com.attacker.test/watch?v=abcdefghijk')).toBeNull();
  });
  it('resolves grounding redirects and gets a real video title from oEmbed', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: canonical } }))
      .mockResolvedValueOnce(Response.json({ title: 'Fresh report from the coast' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await resolveSource({ title: 'youtube.com', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/token' }))
      .toEqual({ title: 'Fresh report from the coast', url: canonical });
    expect(fetchMock.mock.calls[1][0]).toContain('/oembed?');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('finds late watch-page metadata when a video does not allow embedding', async () => {
    const html = `<title>YouTube</title>${' '.repeat(600000)}<meta itemprop="name" content="Aftershocks disrupt flights and homes">`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(html, { headers: { 'Content-Type': 'text/html' } })));
    expect((await resolveSource({ title: 'youtube.com', url: canonical })).title).toBe('Aftershocks disrupt flights and homes');
  });
  it('retains a resolved article link when its page is inaccessible', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://publisher.example/report/1234' } }))
      .mockRejectedValueOnce(new Error('timeout')));
    expect((await resolveSource({ title: 'publisher.example', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/token' })).url)
      .toBe('https://publisher.example/report/1234');
  });
});

describe('titleFromSlug', () => {
  it('prettifies a headline slug', () => {
    expect(
      titleFromSlug('https://example.com/world/2026/aug/10/colombia-earthquake-death-toll-rises'),
    ).toBe('Colombia earthquake death toll rises');
  });

  it('strips file extensions and numeric-only segments', () => {
    expect(titleFromSlug('https://example.com/news/typhoon-dolphin-shanghai-floods.html')).toBe(
      'Typhoon dolphin shanghai floods',
    );
  });

  it('finds a mid-path slug when the last segment is a numeric ID', () => {
    expect(
      titleFromSlug(
        'https://www.facebook.com/firstpostin/videos/houthis-release-footage-showing-mocha-port-attack/1053761509483',
      ),
    ).toBe('Houthis release footage showing mocha port attack');
  });

  it('returns null for short or unusable paths', () => {
    expect(titleFromSlug('https://example.com/')).toBeNull();
    expect(titleFromSlug('https://example.com/news/12345')).toBeNull();
    expect(titleFromSlug('https://example.com/world/live')).toBeNull();
    expect(titleFromSlug('not a url')).toBeNull();
  });
});
