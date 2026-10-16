// Public protocol only. The passage and challenge image are server-owned.
export const VERIFICATION_THRESHOLD_WPM = 100;
export const VERIFICATION_MAX_CLAIM_WPM = 400;
export const VERIFICATION_DURATION_MS = 60_000;
export const VERIFICATION_READY_MS = 5 * 60_000;
export const VERIFICATION_RECEIPT_MS = 30 * 86_400_000;
export const VERIFICATION_MIN_ACCURACY = 0.95;

export interface VerificationResult {
  passed: boolean;
  measuredWpm: number;
  accuracy: number;
  elapsedMs: number;
  reason: 'passed' | 'accuracy' | 'speed' | 'expired';
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
  return Math.ceil(claimedWpm * 0.75);
}

export function normalizeVerificationText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Edit distance avoids treating one missing letter as a mistake at every later
// position. Inputs are capped by the server, bounding this O(n*m) calculation.
export function scoreVerification(expected: string, typed: string, elapsedMs: number, requiredWpm: number): VerificationResult {
  const actual = normalizeVerificationText(typed);
  let row = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const next = [i];
    for (let j = 1; j <= actual.length; j++) {
      next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(expected[i - 1] !== actual[j - 1]));
    }
    row = next;
  }
  const correct = Math.max(0, expected.length - row[actual.length]);
  const accuracy = correct / Math.max(expected.length, actual.length, 1);
  const measuredWpm = elapsedMs > 0 ? correct * 12_000 / elapsedMs : 0;
  const reason = elapsedMs <= 0 || elapsedMs > VERIFICATION_DURATION_MS ? 'expired'
    : accuracy < VERIFICATION_MIN_ACCURACY ? 'accuracy'
      : measuredWpm < requiredWpm ? 'speed' : 'passed';
  return { passed: reason === 'passed', measuredWpm, accuracy, elapsedMs, reason };
}
