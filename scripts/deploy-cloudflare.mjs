// Runs only in Actions with existing repository secrets. Credentials are sent
// to Wrangler on stdin and are never written to a file or printed.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const operatorToken = randomBytes(32).toString('hex');
console.log(`::add-mask::${operatorToken}`);
const secrets = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  KEYWULF_ADMIN_TOKEN: operatorToken,
};
if (!secrets.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for daily publication');

function wrangler(args, input) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    input, stdio: ['pipe', 'inherit', 'inherit'], env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Wrangler ${args[0]} failed`);
}

wrangler(['secret', 'bulk'], JSON.stringify(secrets));
wrangler(['deploy']);

async function admin(action, date, payload) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const response = await fetch(`https://keywulf.com/_internal/${action}?date=${date}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${operatorToken}`, 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(12 * 60_000),
    });
    // Allow a short interval for the new script/secret to propagate. All
    // preparation and seed operations are idempotent, including after retry.
    if ([401, 404].includes(response.status) || !response.headers.get('Content-Type')?.includes('application/json')) {
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }
    if (!response.ok) throw new Error(`Publication ${action} failed: HTTP ${response.status}`);
    return response.json();
  }
  throw new Error('Publication endpoints did not become available after deployment');
}

// Migrate the exact previously live corpus, never the checked-in fixture.
if (process.env.KEYWULF_MIGRATE_LIVE === 'true') {
  const live = JSON.parse(readFileSync('public/data/today.json', 'utf8'));
  await admin('seed', live.date, live);
}
const activeDate = new Date(Date.now() - 3_600_000).toISOString().slice(0, 10);
const ready = await admin('status', activeDate);
if (!ready.ready) {
  console.log(`Preparing the missing fresh briefing for ${activeDate}...`);
  const prepared = await admin('prepare', activeDate);
  if (!prepared.ready) throw new Error('Another generation is running; publication is not ready yet');
}
const published = await fetch(`https://keywulf.com/data/today.json?v=${Date.now()}`, { cache: 'no-store' });
if (!published.ok || (await published.json()).date !== activeDate) throw new Error('Live publication verification failed');
console.log(`Verified live briefing for ${activeDate}. Future releases switch at 01:00 UTC without a deployment.`);
