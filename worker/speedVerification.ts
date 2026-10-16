import type { Storage } from './index';
import {
  normalizeVerificationText, requiredVerificationWpm, scoreVerification, verificationTextHash, verificationTimeLimitMs,
  VERIFICATION_MAX_CLAIM_WPM, VERIFICATION_READY_MS,
  VERIFICATION_RECEIPT_MS, VERIFICATION_FEEDBACK_COOLDOWN_MS,
  VERIFICATION_PASSAGE_LIMIT, VERIFICATION_PASSAGE_WINDOW_MS, VERIFICATION_PASSAGE_ALLOWANCE,
  type VerificationAttempt, type VerificationReceipt, type VerificationStatus,
} from '../src/lib/verification';
import { createVerificationPassage, renderVerificationImage } from './verificationImage';

interface Attempt extends VerificationAttempt {
  answer: string;
  image: Uint8Array;
  submission?: string;
  checkedAt?: number; // Cooldown in records written before the separate feedback key.
}
interface RecordState {
  attempt?: Attempt;
  receipt?: VerificationReceipt;
  budget?: { until: number; used: number; windowMs?: number };
}
interface VerificationStorage extends Storage {
  setAlarm(time: number): Promise<void>;
}
const FINISHED_RETRY_WINDOW_MS = 15 * 60_000;

function attemptDeadline(attempt: Attempt): number {
  // Derive this for existing running records too, so deployment cannot leave a
  // separate fixed timeout in force. Completed results keep their retry window.
  return attempt.status === 'running' && attempt.startedAt !== null
    ? attempt.startedAt + verificationTimeLimitMs(attempt.characterCount, attempt.requiredWpm) : attempt.expiresAt;
}

export function verificationJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie',
  } });
}

function publicStatus(record: RecordState, now: number): VerificationStatus {
  const attempt = record.attempt;
  // Explicit allowlist: private answer/image/submission must never enter JSON.
  return {
    attempt: attempt ? {
      id: attempt.id, date: attempt.date, corpusHash: attempt.corpusHash,
      claimedWpm: attempt.claimedWpm, requiredWpm: attempt.requiredWpm,
      characterCount: attempt.characterCount, imageHeight: attempt.imageHeight,
      textHash: ['ready', 'running'].includes(attempt.status) ? attempt.textHash : undefined,
      status: ['ready', 'running'].includes(attempt.status) && now > attemptDeadline(attempt) ? 'expired' : attempt.status,
      expiresAt: attemptDeadline(attempt), startedAt: attempt.startedAt, result: attempt.result,
    } : null,
    receipt: record.receipt && now < record.receipt.validUntil ? record.receipt : null,
    serverNow: now,
    retryAt: record.budget?.windowMs === VERIFICATION_PASSAGE_WINDOW_MS && now < record.budget.until && record.budget.used >= VERIFICATION_PASSAGE_LIMIT ? record.budget.until : null,
  };
}

/** One object per anonymous cookie, independent of the news/publication objects. */
export class SpeedVerification {
  constructor(private state: { storage: VerificationStorage }) {}

  private async scheduleCleanup(record: RecordState): Promise<void> {
    const deadlines = [record.attempt ? attemptDeadline(record.attempt) + 1 : undefined, record.receipt?.validUntil, record.budget?.until]
      .filter((time): time is number => time !== undefined && time > Date.now());
    if (deadlines.length) await this.state.storage.setAlarm(Math.min(...deadlines));
  }

  async alarm(): Promise<void> {
    const record = await this.state.storage.transaction(async storage => {
      const record = await storage.get<RecordState>('verification') ?? {};
      const now = Date.now();
      if (record.attempt && attemptDeadline(record.attempt) < now) delete record.attempt;
      if (!record.attempt) await storage.delete('feedbackCheckedAt');
      if (record.receipt && record.receipt.validUntil <= now) delete record.receipt;
      if (record.budget && record.budget.until <= now) delete record.budget;
      if (Object.keys(record).length) await storage.put('verification', record);
      else await storage.delete('verification');
      return record;
    });
    await this.scheduleCleanup(record);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1);
    if (request.method === 'GET') {
      const record = await this.state.storage.get<RecordState>('verification') ?? {};
      // Existing in-flight challenges survive a code deployment. Derive their
      // commitment on read rather than exposing the answer or forcing a restart.
      if (record.attempt && ['ready', 'running'].includes(record.attempt.status) && !record.attempt.textHash) {
        record.attempt.textHash = await verificationTextHash(record.attempt.id, record.attempt.answer);
      }
      if (action === 'status') return verificationJson(publicStatus(record, Date.now()));
      if (action !== 'image') return verificationJson({ error: 'Not found' }, 404);
      const attempt = record.attempt;
      if (!attempt || attempt.id !== url.searchParams.get('id')) return verificationJson({ error: 'Challenge not found' }, 404);
      if (!['ready', 'running'].includes(attempt.status) || Date.now() > attemptDeadline(attempt)) return verificationJson({ error: 'Challenge expired' }, 410);
      return new Response(new Uint8Array(attempt.image), { headers: {
        'Content-Type': 'image/png', 'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', Vary: 'Cookie',
      } });
    }
    if (request.method !== 'POST') return verificationJson({ error: 'Method not allowed' }, 405);
    // The public Worker bounds/parses the body before forwarding. This object is
    // reachable only through its binding, not a public URL.
    let payload: Record<string, unknown>;
    try {
      payload = await request.json() as Record<string, unknown>;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
    } catch { return verificationJson({ error: 'Invalid request' }, 400); }

    if (action === 'issue') return this.issue(payload);
    if (!['start', 'finish', 'cancel', 'check'].includes(action)) return verificationJson({ error: 'Not found' }, 404);
    if (typeof payload.id !== 'string') return verificationJson({ error: 'Challenge ID required' }, 400);
    if (['finish', 'check'].includes(action) && (typeof payload.text !== 'string' || payload.text.length > 1_000 || !/^[a-zA-Z\s]*$/.test(payload.text))) {
      return verificationJson({ error: 'Enter only the words shown in the passage' }, 400);
    }
    if (action === 'finish' && payload.elapsedMs !== undefined &&
        (typeof payload.elapsedMs !== 'number' || !Number.isFinite(payload.elapsedMs) || payload.elapsedMs <= 0)) {
      return verificationJson({ error: 'Invalid typing duration' }, 400);
    }
    const submission = action === 'finish' ? normalizeVerificationText(payload.text as string) : undefined;
    const outcome = await this.state.storage.transaction(async storage => {
      const record = await storage.get<RecordState>('verification') ?? {};
      const attempt = record.attempt;
      const now = Date.now();
      if (!attempt || attempt.id !== payload.id) return { record, status: 404, error: 'Challenge not found' };
      // A lost response can be retried with the SAME answer. A different replay
      // must not replace an already settled outcome, even after a restart.
      if (action === 'finish' && attempt.submission !== undefined) {
        return attempt.submission === submission ? { record, status: 200 }
          : { record, status: 409, error: 'This challenge already has a different submission' };
      }
      if (now > attemptDeadline(attempt)) return { record, status: 410, error: 'Challenge expired. Request a new passage.' };
      if (action === 'check') {
        if (attempt.status !== 'running') return { record, status: 409, error: 'Start typing first' };
        const checked = await storage.get<{ id: string; at: number }>('feedbackCheckedAt');
        const checkedAt = checked?.id === attempt.id ? checked.at : attempt.checkedAt;
        if (checkedAt !== undefined && now - checkedAt < VERIFICATION_FEEDBACK_COOLDOWN_MS) {
          return { record, status: 429, error: 'Wait before checking again' };
        }
        const text = normalizeVerificationText(payload.text as string);
        let index = 0;
        while (index < text.length && text[index] === attempt.answer[index]) index++;
        // Persist just the cooldown, not the image and entire challenge, on the
        // high-frequency path. The transaction still serializes concurrent checks.
        await storage.put('feedbackCheckedAt', { id: attempt.id, at: now });
        // Return only the first wrong position, never expected letters or a
        // per-position mask that would allow parallel guesses of the whole text.
        return { record, status: 200, feedback: { id: attempt.id, mismatchIndex: index < text.length ? index : null } };
      }
      if (action === 'start') {
        if (attempt.status === 'ready') {
          attempt.textHash ??= await verificationTextHash(attempt.id, attempt.answer);
          attempt.startedAt = now;
          attempt.expiresAt = now + verificationTimeLimitMs(attempt.characterCount, attempt.requiredWpm);
          attempt.status = 'running';
        } else if (attempt.status !== 'running') return { record, status: 409, error: 'Challenge already finished' };
      } else if (action === 'cancel') {
        if (attempt.status !== 'ready' && attempt.status !== 'running') return { record, status: 409, error: 'Challenge already finished' };
        attempt.status = 'cancelled';
        attempt.answer = '';
        attempt.image = new Uint8Array();
      } else {
        if (attempt.status !== 'running' || attempt.startedAt === null) return { record, status: 409, error: 'Start the challenge first' };
        if (normalizeVerificationText(attempt.answer) !== submission) return { record, status: 400, error: 'Finish the exact passage before submitting' };
        // Browser time can include the first-character request's latency. It may
        // lengthen, but never shorten, the duration observed by the server.
        const duration = Math.max(now - attempt.startedAt, (payload.elapsedMs as number | undefined) ?? 0);
        const result = scoreVerification(attempt.answer, submission!, duration, attempt.requiredWpm);
        attempt.result = result;
        attempt.status = result.passed ? 'passed' : 'failed';
        attempt.expiresAt = now + FINISHED_RETRY_WINDOW_MS;
        attempt.submission = submission;
        attempt.answer = '';
        attempt.image = new Uint8Array();
        // This certifies the separate challenge's measured speed, never the
        // provenance of a client-reported daily score or human identity.
        if (result.passed) record.receipt = {
          id: attempt.id, date: attempt.date, corpusHash: attempt.corpusHash,
          claimedWpm: attempt.claimedWpm, requiredWpm: attempt.requiredWpm,
          measuredWpm: result.measuredWpm, accuracy: result.accuracy,
          verifiedAt: now, validUntil: now + VERIFICATION_RECEIPT_MS,
        };
      }
      await storage.put('verification', record);
      return { record, status: 200 };
    });
    if ('feedback' in outcome && outcome.feedback) return verificationJson(outcome.feedback);
    await this.scheduleCleanup(outcome.record);
    return outcome.error ? verificationJson({ error: outcome.error }, outcome.status)
      : verificationJson(publicStatus(outcome.record, Date.now()), outcome.status);
  }

  private async issue(payload: Record<string, unknown>): Promise<Response> {
    const { date, claimedWpm, corpusHash } = payload;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || typeof corpusHash !== 'string' || !/^[a-f0-9]{64}$/.test(corpusHash) ||
        typeof claimedWpm !== 'number' || !Number.isFinite(claimedWpm) || claimedWpm < 0 || claimedWpm > VERIFICATION_MAX_CLAIM_WPM) {
      return verificationJson({ error: 'Invalid speed verification request' }, 400);
    }
    // Avoid rendering another image for known retries/rate limits. The same
    // checks run again in the transaction because requests can overlap here.
    const current = await this.state.storage.get<RecordState>('verification') ?? {};
    const existing = current.attempt;
    if (existing && ['ready', 'running'].includes(existing.status) && Date.now() <= attemptDeadline(existing)) {
      const same = existing.date === date && existing.claimedWpm === claimedWpm && existing.corpusHash === corpusHash;
      return same ? verificationJson(publicStatus(current, Date.now()))
        : verificationJson({ error: 'Finish or cancel your current speed check first' }, 409);
    }
    if (current.budget?.windowMs === VERIFICATION_PASSAGE_WINDOW_MS && Date.now() < current.budget.until && current.budget.used >= VERIFICATION_PASSAGE_LIMIT) {
      return verificationJson({ error: `${VERIFICATION_PASSAGE_ALLOWANCE}. Please try again later.`, retryAt: current.budget.until }, 429);
    }
    const requiredWpm = requiredVerificationWpm(claimedWpm);
    const answer = createVerificationPassage(requiredWpm);
    const image = await renderVerificationImage(answer);
    const id = crypto.randomUUID();
    const textHash = await verificationTextHash(id, answer);
    const outcome = await this.state.storage.transaction(async storage => {
      const record = await storage.get<RecordState>('verification') ?? {};
      const now = Date.now();
      const existing = record.attempt;
      if (existing && ['ready', 'running'].includes(existing.status) && now <= attemptDeadline(existing)) {
        const same = existing.date === date && existing.claimedWpm === claimedWpm && existing.corpusHash === corpusHash;
        return { record, status: same ? 200 : 409, error: same ? undefined : 'Finish or cancel your current speed check first' };
      }
      // Reset old-policy budgets atomically so a pre-deployment lockout cannot
      // keep a browser on the former three-per-fifteen-minute allowance.
      if (!record.budget || record.budget.windowMs !== VERIFICATION_PASSAGE_WINDOW_MS || now >= record.budget.until) {
        record.budget = { used: 0, until: now + VERIFICATION_PASSAGE_WINDOW_MS, windowMs: VERIFICATION_PASSAGE_WINDOW_MS };
      }
      if (record.budget.used >= VERIFICATION_PASSAGE_LIMIT) return { record, status: 429, error: `${VERIFICATION_PASSAGE_ALLOWANCE}. Please try again later.` };
      record.budget.used++;
      record.attempt = {
        id, date, corpusHash, claimedWpm, requiredWpm, answer, image, textHash,
        characterCount: answer.length, imageHeight: new DataView(image.buffer, image.byteOffset).getUint32(20),
        status: 'ready', expiresAt: now + VERIFICATION_READY_MS,
        startedAt: null, result: null,
      };
      await storage.put('verification', record);
      return { record, status: 200 };
    });
    await this.scheduleCleanup(outcome.record);
    return outcome.error ? verificationJson({ error: outcome.error, retryAt: outcome.record.budget?.until }, outcome.status)
      : verificationJson(publicStatus(outcome.record, Date.now()), outcome.status);
  }
}
