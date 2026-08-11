import { describe, it, expect } from 'vitest';
import { isUsableTitle, isVerifiedEdit, fallbackTitle } from './refineTitles';

describe('isUsableTitle', () => {
  it('rejects bot-check and interstitial titles', () => {
    expect(isUsableTitle('One moment, please...')).toBe(false);
    expect(isUsableTitle('Just a moment...')).toBe(false);
    expect(isUsableTitle('Attention Required! | Cloudflare')).toBe(false);
    expect(isUsableTitle('Access Denied on this server')).toBe(false);
    expect(isUsableTitle('Please verify you are a human')).toBe(false);
    expect(isUsableTitle('Checking your browser before accessing')).toBe(false);
  });

  it('rejects section-only or too-short titles', () => {
    expect(isUsableTitle('Europe')).toBe(false);
    expect(isUsableTitle('World News')).toBe(false);
    expect(isUsableTitle('')).toBe(false);
    expect(isUsableTitle(null)).toBe(false);
  });

  it('accepts real article titles', () => {
    expect(isUsableTitle('Typhoon Dolphin hits eastern China, more than one million evacuated')).toBe(true);
    expect(isUsableTitle('Morning Briefing: Aug. 10, 2026')).toBe(true);
  });
});

describe('isVerifiedEdit (exact anti-invention gate)', () => {
  const junkUrl = 'https://other-news.info/2026/aug/iran-hormuz-strait-reopening-conditions';

  it('accepts the raw title verbatim (case/whitespace-insensitive)', () => {
    expect(isVerifiedEdit('Real headline about a  thing', 'real headline about a thing', junkUrl)).toBe(true);
  });

  it('accepts a prefix trim of a welded-on site name', () => {
    const raw = 'Typhoon Dolphin floods Shanghai and grounds nearly 1,000 flights in east China The Jerusalem Post';
    expect(
      isVerifiedEdit(
        'Typhoon Dolphin floods Shanghai and grounds nearly 1,000 flights in east China',
        raw,
        'https://www.jpost.com/breaking-news/article-812345',
      ),
    ).toBe(true);
  });

  it('accepts a recased slug reconstruction', () => {
    expect(
      isVerifiedEdit('Iran Hormuz Strait Reopening Conditions', 'One moment, please...', junkUrl),
    ).toBe(true);
  });

  it('rejects a single invented word inside an otherwise-real title', () => {
    // The dangerous case a fuzzy overlap check would wave through.
    expect(
      isVerifiedEdit('Iran Hormuz strait reopening conditions rejected', 'One moment, please...', junkUrl),
    ).toBe(false);
    expect(isVerifiedEdit('President dies in hospital', 'President in hospital', 'https://x.com/a-b-c')).toBe(false);
  });

  it('rejects reordered or rewritten titles', () => {
    expect(
      isVerifiedEdit('Reopening conditions for Hormuz strait set by Iran', 'One moment, please...', junkUrl),
    ).toBe(false);
  });

  it('rejects empty candidates', () => {
    expect(isVerifiedEdit('', 'Some title', junkUrl)).toBe(false);
  });
});

describe('fallbackTitle', () => {
  it('keeps a usable title', () => {
    const t = fallbackTitle({
      title: 'WHO says Congo Ebola outbreak started months before declared',
      url: 'https://example.com/x',
    });
    expect(t).toBe('WHO says Congo Ebola outbreak started months before declared');
  });

  it('falls back to the slug for junk titles', () => {
    const t = fallbackTitle({
      title: 'One moment, please...',
      url: 'https://other-news.info/2026/08/iran-ties-hormuz-reopening-to-us-concessions',
    });
    expect(t).toBe('Iran ties hormuz reopening to us concessions');
  });

  it('falls back to the domain when slug is unusable too', () => {
    const t = fallbackTitle({
      title: 'Europe',
      url: 'https://www.bignewsnetwork.com/category/europe',
    });
    expect(t).toBe('bignewsnetwork.com');
  });

  it('never surfaces a redirect token or the redirect hostname', () => {
    const t = fallbackTitle({
      title: 'washingtonpost.com',
      url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGkEdF365RD0bQ_cfYMWqKTx5Xabc',
    });
    expect(t).toBe('washingtonpost.com');
  });
});
