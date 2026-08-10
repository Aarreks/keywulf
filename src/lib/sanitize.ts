// Deterministic text sanitization + ASCII whitelist enforcement for Keywulf.
//
// The single hard rule of the product: the characters a player is asked to type
// must be normal, easy-to-type ASCII. This module guarantees that in CODE, not
// merely by prompting the model. Everything typeable is run through
// `sanitizeText`, and the generation pipeline additionally asserts
// `isTypeableSafe` on every field before a challenge is allowed to deploy.
//
// The source of this file is intentionally pure ASCII: every non-ASCII code
// point is expressed numerically (String.fromCodePoint / \u escapes) so the
// module is immune to any editor or encoding normalization.

/**
 * The exact set of characters a player may be required to type. Anything not in
 * this set is normalized away or dropped by `sanitizeText`.
 *
 * Letters, digits, a single space, and a small set of common prose punctuation.
 */
export const TYPEABLE_WHITELIST: ReadonlySet<string> = new Set([
  ...'abcdefghijklmnopqrstuvwxyz',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ' ',
  ...'.,\'"-:;?!()/%$&',
]);

const c = (code: number): string => String.fromCodePoint(code);

/** Direct character replacements applied before Unicode decomposition. */
const DIRECT_MAP: Record<string, string> = {};
function addDirect(codes: number[], replacement: string): void {
  for (const code of codes) DIRECT_MAP[c(code)] = replacement;
}
// Dashes -> ASCII hyphen: hyphen, non-breaking hyphen, figure/en/em dash,
// horizontal bar, minus sign.
addDirect([0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212], '-');
// Single quotes / apostrophes -> ASCII apostrophe: curly singles, low/high
// quotes, prime, single guillemets, acute accent, backtick.
addDirect([0x2018, 0x2019, 0x201a, 0x201b, 0x2032, 0x2039, 0x203a, 0x00b4, 0x0060], "'");
// Double quotes -> ASCII quote: curly doubles, low/high doubles, double prime,
// guillemets.
addDirect([0x201c, 0x201d, 0x201e, 0x201f, 0x2033, 0x00ab, 0x00bb], '"');
// Ellipsis -> three periods.
DIRECT_MAP[c(0x2026)] = '...';
// Bullets and middle dot -> space (collapsed later).
addDirect([0x2022, 0x2023, 0x2043, 0x25e6, 0x2219, 0x00b7], ' ');
// Math symbols that appear in prose.
DIRECT_MAP[c(0x00d7)] = 'x'; // multiplication sign
addDirect([0x00f7, 0x2044], '/'); // division sign, fraction slash
// Degree sign.
DIRECT_MAP[c(0x00b0)] = ' degrees ';
// Currency -> conventional ASCII codes (safety net; the model is asked to avoid
// these and write plain words or "$").
DIRECT_MAP[c(0x00a3)] = 'GBP';
DIRECT_MAP[c(0x20ac)] = 'EUR';
DIRECT_MAP[c(0x00a5)] = 'JPY';
DIRECT_MAP[c(0x20a9)] = 'KRW';
DIRECT_MAP[c(0x20b9)] = 'INR';
DIRECT_MAP[c(0x20bd)] = 'RUB';
DIRECT_MAP[c(0x20a6)] = 'NGN';
DIRECT_MAP[c(0x00a2)] = ' cents';

/**
 * Latin letters that do NOT decompose under NFKD and therefore need explicit
 * transliteration to ASCII. Applied before decomposition.
 */
const LETTER_MAP: Record<string, string> = {};
function addLetter(code: number, replacement: string): void {
  LETTER_MAP[c(code)] = replacement;
}
addLetter(0x00df, 'ss'); // sharp s
addLetter(0x1e9e, 'SS'); // capital sharp s
addLetter(0x00e6, 'ae');
addLetter(0x00c6, 'AE');
addLetter(0x0153, 'oe');
addLetter(0x0152, 'OE');
addLetter(0x00f8, 'o'); // o with stroke
addLetter(0x00d8, 'O');
addLetter(0x00f0, 'd'); // eth
addLetter(0x00d0, 'D');
addLetter(0x00fe, 'th'); // thorn
addLetter(0x00de, 'Th');
addLetter(0x0111, 'd'); // d with stroke
addLetter(0x0110, 'D');
addLetter(0x0142, 'l'); // l with stroke
addLetter(0x0141, 'L');
addLetter(0x0127, 'h'); // h with stroke
addLetter(0x0126, 'H');
addLetter(0x0131, 'i'); // dotless i
addLetter(0x0130, 'I'); // I with dot above
addLetter(0x0138, 'k'); // kra
addLetter(0x014b, 'ng'); // eng
addLetter(0x014a, 'Ng');

// These three patterns deliberately match combining marks, control whitespace,
// and zero-width/format characters -- that is the whole point of a sanitizer --
// so the corresponding "misleading"/"control" lint rules are disabled here.
/* eslint-disable no-control-regex, no-misleading-character-class */

// Combining diacritical mark ranges to strip after NFKD decomposition.
// (Built from escaped strings so the source stays pure ASCII.)
const COMBINING_MARKS = new RegExp(
  '[\\u0300-\\u036F\\u1AB0-\\u1AFF\\u1DC0-\\u1DFF\\u20D0-\\u20FF\\uFE20-\\uFE2F]',
  'g',
);

// Any Unicode whitespace (including exotic spaces) collapses to a plain space.
// Critical for correctness: an unconverted exotic space would be dropped by the
// whitelist filter and merge adjacent words.
const UNICODE_WHITESPACE = new RegExp(
  '[\\t\\n\\r\\u000B\\f\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]',
  'g',
);

// Zero-width, format, and other invisible characters are removed entirely.
const INVISIBLE = new RegExp(
  '[\\u00AD\\u061C\\u180E\\u200B\\u200C\\u200D\\u200E\\u200F\\u2060\\uFEFF]',
  'g',
);
/* eslint-enable no-control-regex, no-misleading-character-class */

function mapEachChar(input: string, table: Record<string, string>): string {
  let out = '';
  for (const ch of input) out += table[ch] ?? ch;
  return out;
}

/**
 * Normalize arbitrary text into the Keywulf typeable ASCII subset.
 *
 * Pipeline: direct punctuation map -> letter transliteration -> invisible
 * removal -> whitespace normalization -> NFKD decomposition -> strip combining
 * marks -> drop anything still outside the whitelist -> collapse whitespace.
 *
 * The result is guaranteed to satisfy `isTypeableSafe`.
 */
export function sanitizeText(input: unknown): string {
  if (typeof input !== 'string') return '';

  let s = input;
  s = mapEachChar(s, DIRECT_MAP);
  s = mapEachChar(s, LETTER_MAP);
  s = s.replace(INVISIBLE, '');
  s = s.replace(UNICODE_WHITESPACE, ' ');
  s = s.normalize('NFKD').replace(COMBINING_MARKS, '');

  // Drop anything still outside the whitelist. Punctuation-like leftovers are
  // simply removed; this cannot merge words because true separators have
  // already become spaces.
  let cleaned = '';
  for (const ch of s) {
    if (TYPEABLE_WHITELIST.has(ch)) cleaned += ch;
  }

  // Collapse runs of whitespace and trim.
  return cleaned.replace(/ {2,}/g, ' ').trim();
}

/** Returns true iff every character in `text` is in the typeable whitelist. */
export function isTypeableSafe(text: string): boolean {
  for (const ch of text) {
    if (!TYPEABLE_WHITELIST.has(ch)) return false;
  }
  return true;
}

/**
 * Returns a de-duplicated list of offending characters (with code points) that
 * are NOT in the whitelist. Empty array means the text is safe. Useful for
 * loud validation errors during generation.
 */
export function findUnsafeChars(text: string): Array<{ char: string; code: string }> {
  const seen = new Set<string>();
  const out: Array<{ char: string; code: string }> = [];
  for (const ch of text) {
    if (!TYPEABLE_WHITELIST.has(ch) && !seen.has(ch)) {
      seen.add(ch);
      const cp = ch.codePointAt(0) ?? 0;
      out.push({ char: ch, code: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') });
    }
  }
  return out;
}

/** Count words in a piece of typeable text (whitespace-delimited tokens). */
export function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}
