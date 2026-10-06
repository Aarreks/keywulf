// Local / GitHub CLI entry point. The same generator runs on Cloudflare in production.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateBriefing } from './generateBriefing';
import { todayUtc } from '../src/lib/gameNumber';

async function main(): Promise<void> {
  const challenge = await generateBriefing({
    apiKey: process.env.GEMINI_API_KEY || '',
    date: process.env.KEYWULF_DATE || todayUtc(),
    model: process.env.GEMINI_MODEL,
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || '16000'),
  });
  const outPath = resolve('public/data/today.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(challenge, null, 2) + '\n', 'utf8');
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});