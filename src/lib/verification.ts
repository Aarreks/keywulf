// Public protocol only. The passage and challenge image are server-owned.
export const VERIFICATION_MAX_CLAIM_WPM = 400;
export const VERIFICATION_READY_MS = 5 * 60_000;
export const VERIFICATION_RECEIPT_MS = 30 * 86_400_000;
export const VERIFICATION_FEEDBACK_INTERVAL_MS = 800;

export interface VerificationFeedback { id: string; mismatchIndex: number | null }

/** Map a normalized comparison position back to the actual text being edited. */
export function verificationCharacterOffset(text: string, normalizedIndex: number): number {
  const offsets: number[] = [];
  for (const match of text.matchAll(/\S|\s+/g)) {
    if (/\s/.test(match[0]) && (!offsets.length || match.index! + match[0].length === text.length)) continue;
    offsets.push(match.index!);
  }
  return offsets[normalizedIndex] ?? text.length;
}

export interface VerificationResult {
  passed: boolean;
  measuredWpm: number;
  accuracy: number;
  elapsedMs: number;
  reason: 'passed' | 'mismatch' | 'accuracy' | 'speed' | 'expired'; // accuracy is retained for older saved outcomes.
}

export interface VerificationReceipt {
  id: string;
  date: string;
  corpusHash: string;
  claimedWpm: number;
  requiredWpm: number;
  measuredWpm: number;
  accuracy: number;
  verifiedAt: number;
  validUntil: number;
}

export interface VerificationAttempt {
  id: string;
  date: string;
  corpusHash: string;
  claimedWpm: number;
  requiredWpm: number;
  characterCount: number;
  imageHeight: number;
  /** Salted commitment for local completion detection, never the plaintext. */
  textHash?: string;
  status: 'ready' | 'running' | 'passed' | 'failed' | 'expired' | 'cancelled';
  expiresAt: number;
  startedAt: number | null;
  result: VerificationResult | null;
}

export interface VerificationStatus {
  attempt: VerificationAttempt | null;
  receipt: VerificationReceipt | null;
  serverNow: number;
  retryAt: number | null;
}

export function requiredVerificationWpm(claimedWpm: number): number {
  return Math.max(1, Math.ceil(claimedWpm * 0.75));
}

/** Five characters count as one word, matching the game's WPM calculation. */
export function verificationTimeLimitMs(characterCount: number, requiredWpm: number): number {
  // Whole milliseconds avoid promising time beyond the actual speed threshold.
  return Math.floor(characterCount * 12_000 / requiredWpm);
}

export function normalizeVerificationText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function verificationTextHash(id: string, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${id}:${normalizeVerificationText(text)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Corrections are allowed before completion. Only the final, complete text
// counts; there is no separate percentage-accuracy threshold.
export function scoreVerification(expected: string, typed: string, elapsedMs: number, requiredWpm: number): VerificationResult {
  const actual = normalizeVerificationText(typed);
  const matches = normalizeVerificationText(expected) === actual;
  const accuracy = Number(matches);
  const measuredWpm = elapsedMs > 0 ? normalizeVerificationText(expected).length * 12_000 / elapsedMs : 0;
  const reason = elapsedMs <= 0 || elapsedMs > verificationTimeLimitMs(normalizeVerificationText(expected).length, requiredWpm) ? 'expired'
    : !matches ? 'mismatch'
      : measuredWpm < requiredWpm ? 'speed' : 'passed';
  return { passed: reason === 'passed', measuredWpm, accuracy, elapsedMs, reason };
}
