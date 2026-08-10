import { describe, it, expect } from 'vitest';
import {
  sanitizeText,
  isTypeableSafe,
  findUnsafeChars,
  countWords,
  TYPEABLE_WHITELIST,
} from './sanitize';

// Every exotic value is built from numeric code points so this file is pure
// ASCII and each case truly exercises the sanitizer on the intended character.
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

const EM_DASH = cp(0x2014);
const EN_DASH = cp(0x2013);
const LDQUO = cp(0x201c);
const RDQUO = cp(0x201d);
const RSQUO = cp(0x2019); // curly apostrophe
const ELLIPSIS = cp(0x2026);
const NBSP = cp(0x00a0);
const IDEO_SPACE = cp(0x3000);
const ZWSP = cp(0x200b);
const BOM = cp(0xfeff);
const SOFT_HYPHEN = cp(0x00ad);
const EURO = cp(0x20ac);
const ACUTE = cp(0x0301); // combining acute accent

describe('sanitizeText', () => {
  it('converts an em dash to an ASCII hyphen', () => {
    expect(sanitizeText('war' + EM_DASH + 'peace')).toBe('war-peace');
  });

  it('converts an en dash to an ASCII hyphen', () => {
    expect(sanitizeText('2020' + EN_DASH + '2024')).toBe('2020-2024');
  });

  it('converts curly double quotes to ASCII quotes', () => {
    expect(sanitizeText(LDQUO + 'Hello' + RDQUO)).toBe('"Hello"');
  });

  it('converts a curly apostrophe to an ASCII apostrophe', () => {
    expect(sanitizeText('don' + RSQUO + 't')).toBe("don't");
  });

  it('converts a Unicode ellipsis to three periods', () => {
    expect(sanitizeText('wait' + ELLIPSIS)).toBe('wait...');
  });

  it('folds accented Latin characters to ASCII (composed form)', () => {
    expect(sanitizeText('caf' + cp(0x00e9))).toBe('cafe');
    expect(sanitizeText('San Jos' + cp(0x00e9))).toBe('San Jose');
    expect(sanitizeText('Z' + cp(0x00fc) + 'rich')).toBe('Zurich');
    expect(sanitizeText('Bogot' + cp(0x00e1))).toBe('Bogota');
    expect(sanitizeText(cp(0x00d1) + 'and' + cp(0x00fa))).toBe('Nandu');
  });

  it('folds accented Latin characters to ASCII (combining form)', () => {
    // 'e' + combining acute accent should also fold to 'e'.
    expect(sanitizeText('cafe' + ACUTE)).toBe('cafe');
  });

  it('transliterates non-decomposing Latin letters', () => {
    expect(sanitizeText('Stra' + cp(0x00df) + 'e')).toBe('Strasse'); // sharp s
    expect(sanitizeText(cp(0x00c6) + 'gir')).toBe('AEgir'); // AE ligature
    expect(sanitizeText(cp(0x00f8) + 're')).toBe('ore'); // o with stroke
    expect(sanitizeText(cp(0x0141) + cp(0x00f3) + 'd' + cp(0x017a))).toBe('Lodz');
  });

  it('converts a non-breaking space to a normal space without merging words', () => {
    expect(sanitizeText('New' + NBSP + 'York')).toBe('New York');
  });

  it('converts assorted exotic spaces to a single normal space', () => {
    expect(sanitizeText('a b c' + IDEO_SPACE + 'd')).toBe('a b c d');
  });

  it('collapses repeated spaces and trims', () => {
    expect(sanitizeText('  too    many   spaces  ')).toBe('too many spaces');
  });

  it('converts newlines and tabs to spaces', () => {
    expect(sanitizeText('line one\nline two\ttabbed')).toBe('line one line two tabbed');
  });

  it('removes zero-width and invisible characters', () => {
    expect(sanitizeText('in' + ZWSP + 'vis' + BOM + 'ible')).toBe('invisible');
    expect(sanitizeText('soft' + SOFT_HYPHEN + 'hyphen')).toBe('softhyphen');
  });

  it('drops non-Latin scripts rather than emitting garbage', () => {
    const cyrillic = cp(0x041c, 0x043e, 0x0441, 0x043a, 0x0432, 0x0430); // Moskva
    expect(isTypeableSafe(sanitizeText(cyrillic + ' Kyiv'))).toBe(true);
    const cjk = cp(0x4f60, 0x597d); // ni hao
    expect(sanitizeText('Kyiv ' + cjk + ' city')).toBe('Kyiv city');
  });

  it('strips emoji', () => {
    const party = cp(0x1f389);
    expect(sanitizeText('victory ' + party + ' today')).toBe('victory today');
  });

  it('maps a euro sign to an ASCII currency code', () => {
    expect(isTypeableSafe(sanitizeText(EURO + '5 billion'))).toBe(true);
    expect(sanitizeText(EURO + '5 billion')).toBe('EUR5 billion');
  });

  it('keeps allowed prose punctuation intact', () => {
    const s = 'The S&P 500 rose 2.3%; oil fell (again), per sources: "no comment."';
    expect(sanitizeText(s)).toBe(s);
    expect(isTypeableSafe(s)).toBe(true);
  });

  it('returns empty string for non-string input', () => {
    expect(sanitizeText(undefined)).toBe('');
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(42)).toBe('');
  });

  it('always produces typeable-safe output on a nasty mixed string', () => {
    const rocket = cp(0x1f680);
    const cjk = cp(0x4f60, 0x597d);
    const nasty =
      LDQUO + 'Caf' + cp(0x00e9) + RDQUO + ' ' + EM_DASH + ' na' + cp(0x00ef) +
      've r' + cp(0x00e9) + 'sum' + cp(0x00e9) + ELLIPSIS + ' ' + cjk + ' ' +
      rocket + ' ' + EURO + '5';
    const out = sanitizeText(nasty);
    expect(isTypeableSafe(out)).toBe(true);
    expect(findUnsafeChars(out)).toEqual([]);
  });
});

describe('isTypeableSafe / findUnsafeChars', () => {
  it('accepts a clean ASCII string', () => {
    expect(isTypeableSafe('Hello, world! 123')).toBe(true);
    expect(findUnsafeChars('Hello, world! 123')).toEqual([]);
  });

  it('rejects a string with a curly quote and reports the code point', () => {
    expect(isTypeableSafe('be' + LDQUO + 'st')).toBe(false);
    const unsafe = findUnsafeChars('be' + LDQUO + 'st');
    expect(unsafe).toHaveLength(1);
    expect(unsafe[0].code).toBe('U+201C');
  });

  it('does not include newline or tab in the whitelist', () => {
    expect(TYPEABLE_WHITELIST.has('\n')).toBe(false);
    expect(TYPEABLE_WHITELIST.has('\t')).toBe(false);
  });
});

describe('countWords', () => {
  it('counts whitespace-delimited tokens', () => {
    expect(countWords('one two three')).toBe(3);
    expect(countWords('  padded   words  ')).toBe(2);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('single')).toBe(1);
  });
});
