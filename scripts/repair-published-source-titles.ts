// Deployment-only fallback for publishers that serve different metadata to
// Cloudflare than to the runner. The server rejects every non-source edit.
import { refreshSourceTitles, sourceRepairIdentity } from './refreshSourceTitles';
import { resolveSource } from './enrichSources';
import type { Challenge } from '../src/types';

async function main(): Promise<void> {
  const response = await fetch(`https://keywulf.com/data/today.json?v=${Date.now()}`);
  if (!response.ok) throw new Error(`Could not read the live briefing: ${response.status}`);
  const original = await response.json() as Challenge;
  const repaired = await refreshSourceTitles(original, resolveSource);
  if (sourceRepairIdentity(original) !== sourceRepairIdentity(repaired)) throw new Error('Repair altered the game');
  if (JSON.stringify(original) === JSON.stringify(repaired)) {
    console.log('Runner metadata check: no additional readable titles.');
    return;
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await fetch(`https://keywulf.com/_internal/repair-sources?date=${original.date}`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.KEYWULF_ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(repaired),
    });
    // A newly deployed Worker may briefly call an older Durable Object version.
    // Retrying this metadata-only operation is safe and never regenerates text.
    if ([401, 404].includes(result.status)) {
      await result.body?.cancel();
      console.log(`Waiting for the metadata repair endpoint: HTTP ${result.status}`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      continue;
    }
    if (!result.ok) throw new Error(`Metadata-only repair rejected: HTTP ${result.status}: ${await result.text()}`);
    console.log('Runner metadata check: additional source titles repaired; typed text unchanged.');
    return;
  }
  throw new Error('The metadata repair endpoint did not finish rolling out');
}
main().catch(err => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; });
