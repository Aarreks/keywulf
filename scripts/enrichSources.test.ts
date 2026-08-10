import { describe, it, expect } from 'vitest';
import { extractHtmlTitle, titleFromSlug } from './enrichSources';

describe('extractHtmlTitle', () => {
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
