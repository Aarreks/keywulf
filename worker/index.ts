import type { Challenge } from '../src/types';
import { validateChallenge } from '../scripts/challengeSchema';
import { generateBriefing } from '../scripts/generateBriefing';
import { activeChallengeDate, preparationDate } from '../src/lib/publication';
import type { SourceRef } from '../scripts/enrichSources';
import { refreshSourceTitles, sourceRepairIdentity, SOURCE_METADATA_VERSION } from '../scripts/refreshSourceTitles';
import { RECOVERY_CRON, recoverySlot } from './recovery';
export { SourceMetadata } from './sourceMetadata';

// Structural types for the small subset of Cloudflare bindings used here.
export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  transaction<T>(fn: (storage: Storage) => Promise<T>): Promise<T>;
}
const GENERATION_LEASE_MS = 15 * 60_000;

interface Fetcher { fetch(request: Request): Promise<Response> }
export interface Env {
  ASSETS: Fetcher;
  BRIEFINGS: { idFromName(name: string): unknown; get(id: unknown): Fetcher };
  SOURCES: { idFromName(name: string): unknown; get(id: unknown): Fetcher };
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  KEYWULF_ADMIN_TOKEN: string;
  KEYWULF_RECOVERY_ENABLED?: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function briefingForDate(env: Env, date: string): Fetcher {
  return env.BRIEFINGS.get(env.BRIEFINGS.idFromName(date));
}

function isValidChallengeDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

// One strongly consistent object per date. Once a text is ready it is immutable
// across retries and app deploys, so every player receives the same corpus.
export class DailyBriefing {
  constructor(private state: { storage: Storage }, private env: Env) {}

  private async resolveSource(source: SourceRef): Promise<SourceRef> {
    try {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source.url))))
        .map(byte => byte.toString(16).padStart(2, '0')).join('');
      const response = await this.env.SOURCES.get(this.env.SOURCES.idFromName(hash)).fetch(new Request('https://metadata/resolve', {
        method: 'POST', body: JSON.stringify(source),
      }));
      return response.ok ? await response.json() as SourceRef : source;
    } catch { return source; }
  }

  // Network lookups happen outside transactions. Only commit if the snapshot
  // we repaired is still current; otherwise a slower repair could undo a newer one.
  private async commitSourceRepair(original: Challenge, repaired: Challenge): Promise<boolean> {
    return this.state.storage.transaction(async storage => {
      if (JSON.stringify(await storage.get('challenge')) !== JSON.stringify(original)) return false;
      await storage.put('challenge', repaired);
      await storage.put('sourceMetadataVersion', SOURCE_METADATA_VERSION);
      return true;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const date = url.pathname.split('/').pop() || '';
    if (!isValidChallengeDate(date)) return json({ error: 'Invalid challenge date' }, 400);

    if (request.method === 'GET') {
      const challenge = await this.state.storage.get<Challenge>('challenge');
      if (url.pathname.startsWith('/status/')) return json({ date, ready: Boolean(challenge) });
      return challenge ? json(challenge) : json({
        error: 'The fresh news briefing is still being prepared. Please try again shortly.',
      }, 503);
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (url.pathname.startsWith('/repair-sources/')) {
      const original = await this.state.storage.get<Challenge>('challenge');
      if (!original) return json({ error: 'Briefing not ready' }, 503);
      // The runner supplies the snapshot it actually read before resolving titles.
      // Without it, a delayed POST could overwrite newer metadata with stale labels.
      let payload: { expected: Challenge; repaired: Challenge };
      try {
        payload = await request.json() as { expected: Challenge; repaired: Challenge };
        validateChallenge(payload.expected);
        validateChallenge(payload.repaired);
      } catch { return json({ error: 'Expected and repaired briefings are required and must be valid' }, 400); }
      const { expected, repaired } = payload;
      if (expected.date !== date || repaired.date !== date) return json({ error: 'Repair date mismatch' }, 400);
      if (sourceRepairIdentity(expected) !== sourceRepairIdentity(repaired)) return json({ error: 'Repair changed protected briefing fields' }, 409);
      if (!await this.commitSourceRepair(expected, repaired)) return json({ error: 'Concurrent metadata repair; retry with a fresh snapshot' }, 409);
      return json({ date, repaired: true });
    }
    if (url.pathname.startsWith('/refresh-sources/')) {
      try {
        if (await this.state.storage.get('sourceMetadataVersion') === SOURCE_METADATA_VERSION) return json({ date, refreshed: false });
        const original = await this.state.storage.get<Challenge>('challenge');
        if (!original) return json({ error: 'Briefing not ready' }, 503);
        const repaired = await refreshSourceTitles(original, source => this.resolveSource(source));
        validateChallenge(repaired);
        if (sourceRepairIdentity(original) !== sourceRepairIdentity(repaired)) return json({ error: 'Repair changed protected briefing fields' }, 409);
        if (!await this.commitSourceRepair(original, repaired)) return json({ error: 'Concurrent metadata repair; retry' }, 409);
        return json({ date, refreshed: true, titles: repaired.sourcePool.map(s => s.title) });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error('Source metadata refresh failed:', detail);
        return json({ error: 'Source metadata refresh failed', detail }, 500);
      }
    }
    if (url.pathname.startsWith('/seed/')) {
      const challenge = await request.json() as Challenge;
      try { validateChallenge(challenge); } catch { return json({ error: 'Invalid briefing' }, 400); }
      if (challenge.date !== date) return json({ error: 'Date mismatch' }, 400);
      await this.state.storage.transaction(async (storage) => {
        if (!await storage.get('challenge')) await storage.put('challenge', challenge);
      });
      return json({ date, ready: true });
    }
    const recovering = url.pathname.startsWith('/recover/');
    if (!recovering && !url.pathname.startsWith('/prepare/')) return json({ error: 'Not found' }, 404);
    const slot = recovering ? recoverySlot(date, Number(url.searchParams.get('scheduledTime')), Date.now()) : null;
    if (recovering && (this.env.KEYWULF_RECOVERY_ENABLED !== 'true' || !slot)) {
      return json({ date, skipped: 'Recovery disabled or outside its window' });
    }
    return this.prepare(date, slot);
  }

  private async prepare(date: string, slot: string | null): Promise<Response> {
    const leaseId = crypto.randomUUID();
    // Claim ownership atomically, but never hold a transaction across model calls.
    // The callback may be retried by storage, so keep external side effects out.
    const decision = await this.state.storage.transaction(async (storage) => {
      if (await storage.get('challenge')) return 'ready';
      if (slot && await storage.get(`recovery:${slot}`)) return 'used';
      const existing = await storage.get<{ until: number }>('lease');
      if (existing && existing.until > Date.now()) return 'busy';
      if (slot) await storage.put(`recovery:${slot}`, true);
      await storage.put('lease', { id: leaseId, until: Date.now() + GENERATION_LEASE_MS });
      return 'generate';
    });
    if (decision !== 'generate') return json({ date, ready: decision === 'ready' }, decision === 'busy' ? 202 : 200);

    try {
      const challenge = await generateBriefing({
        apiKey: this.env.GEMINI_API_KEY, date, model: this.env.GEMINI_MODEL,
        resolveSource: source => this.resolveSource(source),
      });
      validateChallenge(challenge);
      if (challenge.date !== date) throw new Error('Generated briefing has the wrong date');
      // Never count the same text as a new day's game.
      const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const previous = await briefingForDate(this.env, previousDate).fetch(new Request(`https://briefing/get/${previousDate}`));
      if (previous.ok) {
        const old = await previous.json() as Challenge;
        if (old.stories.map(s => `${s.headline} ${s.body}`).join(' ') ===
          challenge.stories.map(s => `${s.headline} ${s.body}`).join(' ')) {
          throw new Error('Generated text repeats the previous briefing');
        }
      }
      await this.state.storage.transaction(async (storage) => {
        const owner = await storage.get<{ id: string }>('lease');
        // Expiry permits takeover; it does not cancel the old HTTP/model work.
        // This owner ID fences that old work out if another attempt took over.
        if (owner?.id !== leaseId) throw new Error('Generation lease was replaced');
        if (!await storage.get('challenge')) {
          await storage.put('challenge', challenge);
          // A migration seed may have won while generation was awaiting I/O.
          // Never mark that different stored briefing's metadata as refreshed.
          await storage.put('sourceMetadataVersion', SOURCE_METADATA_VERSION);
        }
        await storage.delete('lease');
      });
      console.log(`Briefing ready for ${date}`);
      return json({ date, ready: true });
    } catch (err) {
      // A failed/stale attempt must not delete its successor's lease.
      await this.state.storage.transaction(async storage => {
        if ((await storage.get<{ id: string }>('lease'))?.id === leaseId) await storage.delete('lease');
      });
      console.error('Fresh briefing generation failed:', err instanceof Error ? err.message : String(err));
      return json({ error: 'Fresh briefing generation failed; the next preparation attempt will retry.' }, 503);
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/data/today.json' && (request.method === 'GET' || request.method === 'HEAD')) {
      // Choose once at request entry: an in-flight response may finish after
      // 01:00, but must not mix two dates' data or generate on a visitor's request.
      const date = activeChallengeDate();
      const response = await briefingForDate(env, date).fetch(new Request(`https://briefing/get/${date}`));
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (url.pathname.startsWith('/_internal/')) {
      if (!env.KEYWULF_ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.KEYWULF_ADMIN_TOKEN}`) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const date = url.searchParams.get('date') || preparationDate(Date.now());
      if (!isValidChallengeDate(date)) return json({ error: 'Invalid challenge date' }, 400);
      const action = url.pathname.slice('/_internal/'.length);
      if (!['prepare', 'seed', 'status', 'refresh-sources', 'repair-sources'].includes(action)) return json({ error: 'Not found' }, 404);
      if (request.method !== (action === 'status' ? 'GET' : 'POST')) return json({ error: 'Method not allowed' }, 405);
      return briefingForDate(env, date).fetch(new Request(`https://briefing/${action}/${date}`, {
        method: action === 'status' ? 'GET' : 'POST',
        body: ['seed', 'repair-sources'].includes(action) ? await request.text() : undefined,
      }));
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: { scheduledTime: number; cron?: string }, env: Env): Promise<void> {
    const recovering = controller.cron === RECOVERY_CRON;
    const date = recovering ? activeChallengeDate(controller.scheduledTime) : preparationDate(controller.scheduledTime);
    if (recovering && (env.KEYWULF_RECOVERY_ENABLED !== 'true' || !recoverySlot(date, controller.scheduledTime, Date.now()))) return;
    const path = recovering ? `recover/${date}?scheduledTime=${controller.scheduledTime}` : `prepare/${date}`;
    const result = await briefingForDate(env, date).fetch(new Request(`https://briefing/${path}`, { method: 'POST' }));
    if (!result.ok) throw new Error(`News preparation failed for ${date}: HTTP ${result.status}`);
  },
};
