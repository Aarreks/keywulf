// Standalone validator CLI. Reads a challenge JSON file and runs the full
// validateChallenge() gate. Exits non-zero (loudly) on any problem so CI and
// the daily job never deploy broken data.
//
//   npx tsx scripts/validate-challenge.ts public/data/today.json

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateChallenge } from './challengeSchema';
import type { Challenge } from '../src/types';

const target = process.argv[2] ?? 'public/data/today.json';
const abs = resolve(process.cwd(), target);

let challenge: Challenge;
try {
  challenge = JSON.parse(readFileSync(abs, 'utf8')) as Challenge;
} catch (err) {
  console.error(`FATAL: could not read/parse ${target}`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

try {
  validateChallenge(challenge);
} catch (err) {
  console.error(`FATAL: ${target} failed validation.`);
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

console.log(
  `OK: ${target} is valid - ${challenge.stories.length} stories, ${challenge.wordCount} words, ` +
    `game #${challenge.gameNumber} (${challenge.date}).`,
);
