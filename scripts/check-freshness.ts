import { pathToFileURL } from 'node:url';
import { activeChallengeDate } from '../src/lib/publication';
import { validateChallenge } from './challengeSchema';
import type { Challenge } from '../src/types';

export async function checkFreshness(options: {
  url?: string; now?: number; fetcher?: typeof fetch;
} = {}): Promise<string> {
  const date = activeChallengeDate(options.now ?? Date.now());
  const response = await (options.fetcher ?? fetch)(options.url ?? 'https://keywulf.com/data/today.json', {
    cache: 'no-store', signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Expected briefing ${date}; endpoint returned HTTP ${response.status}`);
  const challenge = await response.json() as Challenge;
  validateChallenge(challenge);
  if (challenge.date !== date) throw new Error(`Expected briefing ${date}; received ${challenge.date}`);
  return date;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkFreshness({ url: process.env.KEYWULF_FRESHNESS_URL }).then(date => {
    console.log(`Fresh briefing available: ${date}`);
  }).catch(error => {
    console.error(`::error title=Keywulf daily briefing unavailable::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
