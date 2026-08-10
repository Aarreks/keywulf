// Build the checked-in sample challenge into public/data/today.json and
// src/data/sampleChallenge.json (the in-bundle fallback). Run with:
//   npx tsx scripts/build-sample.ts
//
// This guarantees the fixture is assembled and validated by the exact same
// code path as the real daily job.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleChallenge } from './buildChallenge';
import { validateChallenge } from './challengeSchema';
import { sampleStories, SAMPLE_DATE, SAMPLE_MODEL } from './sampleStories';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function writeJson(relPath: string, data: unknown): void {
  const abs = resolve(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`wrote ${relPath}`);
}

const challenge = assembleChallenge({
  date: SAMPLE_DATE,
  model: SAMPLE_MODEL,
  // Fixed timestamp so the fixture is deterministic (no diff churn).
  generatedAt: `${SAMPLE_DATE}T00:15:00.000Z`,
  title: 'World Briefing',
  stories: sampleStories,
});

validateChallenge(challenge);
console.log(
  `Sample OK: ${challenge.stories.length} stories, ${challenge.wordCount} words, game #${challenge.gameNumber}`,
);

writeJson('public/data/today.json', challenge);
writeJson('src/data/sampleChallenge.json', challenge);
