import type { Env } from './index';
import type { Challenge } from '../src/types';
import { buildCorpus } from '../src/lib/challengeClient';
import { activeChallengeDate } from '../src/lib/publication';
import type { RankedRun } from '../src/lib/leaderboard';
import { sha256 } from './leaderboard';
import { verificationJson } from './speedVerification';

const COOKIE = 'keywulf_verification';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Error();
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new Error(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
  return payload as Record<string, unknown>;
}

function recentDate(value: unknown): value is string {
  const today = activeChallengeDate();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return value === today || value === yesterday;
}

export async function handleCommunity(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const enabled = env.KEYWULF_COMMUNITY_ENABLED === 'true' && Boolean(env.VERIFICATIONS && env.LEADERBOARDS);
  if (url.pathname === '/api/community' && request.method === 'GET') return verificationJson({ enabled });
  const action = ({ '/api/leaderboard': 'top', '/api/leaderboard/me': 'me', '/api/runs/start': 'run-start',
    '/api/runs/finish': 'run-finish', '/api/runs/publish': 'run-publish', '/api/verification': 'status',
    '/api/verification/issue': 'issue', '/api/verification/start': 'start',
    '/api/verification/finish': 'finish', '/api/verification/cancel': 'cancel', '/api/verification/image': 'image', '/api/verification/check': 'check',
  } as Record<string, string>)[url.pathname];
  if (!action) return verificationJson({ error: 'Not found' }, 404);
  if (request.method !== (['top', 'me', 'status', 'image'].includes(action) ? 'GET' : 'POST')) return verificationJson({ error: 'Method not allowed' }, 405);
  if (!enabled) return verificationJson({ error: 'The leaderboard is temporarily unavailable' }, 503);
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.method === 'POST' && request.headers.get('Origin') !== url.origin)) return verificationJson({ error: 'Same-origin request required' }, 403);
  const cookie = request.headers.get('Cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  let player = cookie && UUID.test(cookie) ? cookie : undefined;
  if (env.VERIFICATION_LIMITER) {
    const key = request.headers.get('CF-Connecting-IP') || player || 'local';
    if (!(await env.VERIFICATION_LIMITER.limit({ key: `keywulf-community:${key}` })).success) {
      const response = verificationJson({ error: 'Too many requests. Please wait a minute.' }, 429);
      response.headers.set('Retry-After', '60');
      return response;
    }
  }
  if (!player && action === 'status') return verificationJson({ attempt: null, receipt: null, serverNow: Date.now(), retryAt: null });
  if (!player && action === 'me') return verificationJson({ run: null });
  if (!player && !['run-start', 'top'].includes(action)) return verificationJson({ error: 'Start an official run in this browser first' }, 401);
  let payload: Record<string, unknown> | undefined;
  if (request.method === 'POST') {
    try { payload = await boundedJson(request); }
    catch { return verificationJson({ error: 'A JSON request of at most 64 KB is required' }, 400); }
  }
  const date = request.method === 'GET' ? url.searchParams.get('date') || activeChallengeDate() : payload?.date;
  const newPlayer = !player && action === 'run-start';
  if (newPlayer) player = crypto.randomUUID();
  let response: Response;
  if (['top', 'me'].includes(action) || action.startsWith('run-') || action === 'issue') {
    if (!recentDate(date)) return verificationJson({ error: 'Choose today or yesterday\'s briefing' }, 400);
    const board = env.LEADERBOARDS!.get(env.LEADERBOARDS!.idFromName(date));
    if (action === 'top' || action === 'me') {
      response = await board.fetch(new Request(`https://board/${action}?date=${date}&player=${player || ''}`));
    } else if (action === 'issue') {
      const current = await board.fetch(new Request(`https://board/me?player=${player}`));
      const { run } = await current.json() as { run: RankedRun | null };
      if (!run || run.status !== 'pending' || run.wpm === null) return verificationJson({ error: 'Submit your official result before requesting a speed check' }, 409);
      response = await env.VERIFICATIONS!.get(env.VERIFICATIONS!.idFromName(player!)).fetch(new Request('https://verification/issue', {
        method: 'POST', body: JSON.stringify({ date, claimedWpm: run.wpm, corpusHash: run.corpusHash }),
      }));
    } else {
      if (action === 'run-start') {
        const briefing = await env.BRIEFINGS.get(env.BRIEFINGS.idFromName(date)).fetch(new Request(`https://briefing/get/${date}`));
        if (!briefing.ok) return verificationJson({ error: 'The briefing for this result is unavailable' }, 503);
        const corpus = buildCorpus(await briefing.json() as Challenge);
        payload = { date, corpus, corpusHash: await sha256(corpus) };
      } else if (typeof payload?.id !== 'string' || !UUID.test(payload.id)) return verificationJson({ error: 'Invalid run ID' }, 400);
      response = await board.fetch(new Request(`https://board/${action.slice(4)}`, {
        method: 'POST', body: JSON.stringify({ ...payload, player }),
      }));
    }
  } else {
    response = await env.VERIFICATIONS!.get(env.VERIFICATIONS!.idFromName(player!)).fetch(new Request(`https://verification/${action}${url.search}`, {
      method: request.method, body: payload ? JSON.stringify(payload) : undefined,
    }));
  }
  const result = new Response(response.body, response);
  if (newPlayer) result.headers.set('Set-Cookie', `${COOKIE}=${player}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`);
  return result;
}
