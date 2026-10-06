import type { Challenge } from '../src/types';
import { validateChallenge } from '../scripts/challengeSchema';
import { generateBriefing } from '../scripts/generateBriefing';
import { activeChallengeDate, preparationDate } from '../src/lib/publication';

// Structural types for the small subset of Cloudflare bindings used here.
export interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  transaction<T>(fn: (storage: Storage) => Promise<T>): Promise<T>;
}
interface Fetcher { fetch(request: Request): Promise<Response> }
export interface Env {
  ASSETS: Fetcher;
  BRIEFINGS: { idFromName(name: string): unknown; get(id: unknown): Fetcher };
  GEMINI_API_KEY: string;
  GEMINI_MODEL?: string;
  KEYWULF_ADMIN_TOKEN: string;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

function briefing(env: Env, date: string): Fetcher {
  return env.BRIEFINGS.get(env.BRIEFINGS.idFromName(date));
}

function validDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

// One strongly consistent object per date. Once a text is ready it is immutable
// across retries and app deploys, so every player receives the same corpus.
export class DailyBriefing {
  constructor(private state: { storage: Storage }, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const date = url.pathname.split('/').pop() || '';
    if (!validDate(date)) return json({ error: 'Invalid challenge date' }, 400);

    if (request.method === 'GET') {
      const challenge = await this.state.storage.get<Challenge>('challenge');
      if (url.pathname.startsWith('/status/')) return json({ date, ready: Boolean(challenge) });
      return challenge ? json(challenge) : json({
        error: 'The fresh news briefing is still being prepared. Please try again shortly.',
      }, 503);
    }

    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (url.pathname.startsWith('/seed/')) {
      const challenge = await request.json() as Challenge;
      try { validateChallenge(challenge); } catch { return json({ error: 'Invalid briefing' }, 400); }
      if (challenge.date !== date) return json({ error: 'Date mismatch' }, 400);
      await this.state.storage.transaction(async (storage) => {
        if (!await storage.get('challenge')) await storage.put('challenge', challenge);
      });
      return json({ date, ready: true });
    }
    if (!url.pathname.startsWith('/prepare/')) return json({ error: 'Not found' }, 404);

    const lease = crypto.randomUUID();
    const decision = await this.state.storage.transaction(async (storage) => {
      if (await storage.get('challenge')) return 'ready';
      const existing = await storage.get<{ until: number }>('lease');
      if (existing && existing.until > Date.now()) return 'busy';
      await storage.put('lease', { id: lease, until: Date.now() + 15 * 60_000 });
      return 'generate';
    });
    if (decision !== 'generate') return json({ date, ready: decision === 'ready' }, decision === 'busy' ? 202 : 200);

    try {
      const challenge = await generateBriefing({
        apiKey: this.env.GEMINI_API_KEY, date, model: this.env.GEMINI_MODEL,
      });
      validateChallenge(challenge);
      if (challenge.date !== date) throw new Error('Generated briefing has the wrong date');
      // Never count the same text as a new day's game.
      const previousDate = new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const previous = await briefing(this.env, previousDate).fetch(new Request(`https://briefing/get/${previousDate}`));
      if (previous.ok) {
        const old = await previous.json() as Challenge;
        if (old.stories.map(s => `${s.headline} ${s.body}`).join(' ') ===
          challenge.stories.map(s => `${s.headline} ${s.body}`).join(' ')) {
          throw new Error('Generated text repeats the previous briefing');
        }
      }
      await this.state.storage.transaction(async (storage) => {
        const owner = await storage.get<{ id: string }>('lease');
        if (owner?.id !== lease) throw new Error('Generation lease expired');
        if (!await storage.get('challenge')) await storage.put('challenge', challenge);
        await storage.delete('lease');
      });
      console.log(`Briefing ready for ${date}`);
      return json({ date, ready: true });
    } catch (err) {
      await this.state.storage.transaction(async storage => {
        if ((await storage.get<{ id: string }>('lease'))?.id === lease) await storage.delete('lease');
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
      const date = activeChallengeDate();
      const response = await briefing(env, date).fetch(new Request(`https://briefing/get/${date}`));
      return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }
    if (url.pathname.startsWith('/_internal/')) {
      if (!env.KEYWULF_ADMIN_TOKEN || request.headers.get('Authorization') !== `Bearer ${env.KEYWULF_ADMIN_TOKEN}`) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const date = url.searchParams.get('date') || preparationDate(Date.now());
      if (!validDate(date)) return json({ error: 'Invalid challenge date' }, 400);
      const action = url.pathname.slice('/_internal/'.length);
      if (!['prepare', 'seed', 'status'].includes(action)) return json({ error: 'Not found' }, 404);
      if (request.method !== (action === 'status' ? 'GET' : 'POST')) return json({ error: 'Method not allowed' }, 405);
      return briefing(env, date).fetch(new Request(`https://briefing/${action}/${date}`, {
        method: action === 'status' ? 'GET' : 'POST',
        body: action === 'seed' ? await request.text() : undefined,
      }));
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: { scheduledTime: number }, env: Env): Promise<void> {
    const date = preparationDate(controller.scheduledTime);
    const result = await briefing(env, date).fetch(new Request(`https://briefing/prepare/${date}`, { method: 'POST' }));
    if (!result.ok) throw new Error(`News preparation failed for ${date}: HTTP ${result.status}`);
  },
};
