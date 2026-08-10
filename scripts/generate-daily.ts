// Keywulf daily generation. Runs ONCE PER DAY on GitHub Actions (never in the
// browser, never per visitor).
//
// Two-step pipeline (tested against the live API; see git history):
//   Step 1  RESEARCH - a Google-Search-grounded call that produces plain-text
//           reporter's notes on the last ~24h of world news. Asking for prose
//           reliably triggers the search tool; asking directly for JSON makes
//           the model skip search (verified), which would mean ungrounded text
//           and zero sources.
//   Step 2  FORMAT - a tool-free call with responseMimeType: application/json
//           that compresses the notes into the strict briefing JSON. JSON mode
//           cannot be combined with search tools, but needs no search - and it
//           eliminates malformed-JSON parse failures.
// Then: sanitize every typeable field to ASCII (in code), attach REAL source
// URLs from step 1's grounding metadata, validate hard, and write
// public/data/today.json. On failure after limited retries: exit non-zero and
// write nothing, so a bad day never replaces the last good deployed puzzle.
//
// Requires GEMINI_API_KEY (server-side only). Never expose this key to clients.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { assembleChallenge, type RawSource, type RawStory } from './buildChallenge';
import { validateChallenge } from './challengeSchema';
import { todayUtc } from '../src/lib/gameNumber';
import { SYSTEM_INSTRUCTION, researchPrompt, formatPrompt } from './prompts';
import { enrichSources } from './enrichSources';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
// Generous but bounded. gemini-3.5-flash is a thinking model; explicit thinking
// budgets below keep reasoning from eating the output budget (untracked
// thinking was truncating JSON mid-string in testing).
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || '16000');
const DATE = process.env.KEYWULF_DATE || todayUtc();
const MAX_ATTEMPTS = 3; // per step: initial + up to 2 controlled retries

if (!API_KEY) {
  console.error('FATAL: GEMINI_API_KEY is not set. Refusing to generate.');
  console.error('This key is server-side only and must never be a VITE_ variable.');
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`FATAL: KEYWULF_DATE "${DATE}" is not YYYY-MM-DD.`);
  process.exit(1);
}

/**
 * Pause between retry attempts (20s, then 40s). Transient 503 capacity spikes
 * on the model are common enough that back-to-back retries would burn all
 * attempts inside the same spike and needlessly fail the day.
 */
function backoff(attempt: number): Promise<void> {
  const ms = attempt * 20_000;
  console.log(`  waiting ${ms / 1000}s before retrying...`);
  return new Promise((r) => setTimeout(r, ms));
}

interface ModelStories {
  title?: string;
  stories: RawStory[];
}

function extractJson(text: string): ModelStories {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{')) {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
      throw new Error('No JSON object found in model output');
    }
    t = t.slice(first, last + 1);
  }
  const parsed = JSON.parse(t);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.stories)) {
    throw new Error('Model JSON missing a "stories" array');
  }
  return parsed as ModelStories;
}

interface GroundingChunkLike {
  web?: { uri?: string; title?: string };
}
interface CandidateLike {
  groundingMetadata?: { groundingChunks?: GroundingChunkLike[] };
}

function extractGroundingSources(candidates: CandidateLike[] | undefined): RawSource[] {
  const out: RawSource[] = [];
  for (const cand of candidates ?? []) {
    for (const chunk of cand.groundingMetadata?.groundingChunks ?? []) {
      const uri = chunk.web?.uri;
      if (uri) out.push({ url: uri, title: chunk.web?.title || uri });
    }
  }
  return out;
}

async function research(ai: GoogleGenAI): Promise<{ notes: string; sources: RawSource[] }> {
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`Research attempt ${attempt}/${MAX_ATTEMPTS} (${MODEL}, grounded)...`);
    try {
      const res = await ai.models.generateContent({
        model: MODEL,
        contents: researchPrompt(DATE),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
          temperature: 0.3,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: 4096 },
        },
      });
      const notes = res.text ?? '';
      const sources = extractGroundingSources(res.candidates as CandidateLike[] | undefined);
      // A thin research pass starves the format step (observed: 5-story output
      // from ~2.5k chars of notes). Demand enough material for 12-16 stories.
      if (notes.trim().length < 2500) throw new Error('Research notes too thin to support 12-16 stories');
      if (sources.length === 0) {
        // No grounding metadata means the model answered from memory - which
        // for news would be stale or invented. Not acceptable.
        throw new Error('No grounding sources returned (search tool was not used)');
      }
      console.log(`Research OK: ${notes.length} chars of notes, ${sources.length} grounded sources.`);
      return { notes, sources };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`Research attempt ${attempt} failed: ${lastError.split('\n')[0]}`);
      if (attempt < MAX_ATTEMPTS) await backoff(attempt);
    }
  }
  throw new Error(`Research failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

async function main(): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const { notes, sources: rawSources } = await research(ai);

  // Grounding gives opaque redirect URLs titled only with a domain. Resolve
  // them (server-side, once per day) to real article URLs + real titles so the
  // Sources panel is readable. Every failure falls back gracefully.
  console.log(`Resolving ${rawSources.length} grounding sources to article titles...`);
  const sources = await enrichSources(
    rawSources.map((s) => ({ title: String(s.title ?? s.url), url: String(s.url) })),
  );
  const enrichedCount = sources.filter((s, i) => s.title !== rawSources[i]?.title).length;
  console.log(`Sources resolved: ${enrichedCount}/${sources.length} gained article titles.`);

  let feedback: string | undefined;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`Format attempt ${attempt}/${MAX_ATTEMPTS} (${MODEL}, JSON mode)...`);
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: formatPrompt(notes, DATE, feedback),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: 2048 },
        },
      });

      const text = response.text;
      if (!text) throw new Error('Empty model response');
      const model = extractJson(text);

      const challenge = assembleChallenge({
        date: DATE,
        model: MODEL,
        generatedAt: new Date().toISOString(),
        title: model.title,
        stories: model.stories,
        groundingSources: sources,
      });

      validateChallenge(challenge);

      const outPath = resolve(root, 'public/data/today.json');
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(challenge, null, 2) + '\n', 'utf8');

      console.log(
        `SUCCESS: wrote public/data/today.json - ${challenge.stories.length} stories, ` +
          `${challenge.wordCount} words, game #${challenge.gameNumber}, ` +
          `${challenge.sourcePool.length} sources.`,
      );
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`format attempt ${attempt}: ${msg}`);
      feedback = msg;
      console.warn(`Format attempt ${attempt} failed: ${msg.split('\n')[0]}`);
      if (attempt < MAX_ATTEMPTS) await backoff(attempt);
    }
  }

  console.error('FATAL: generation failed after all attempts. today.json was NOT modified.');
  console.error(errors.join('\n'));
  try {
    const existing = readFileSync(resolve(root, 'public/data/today.json'), 'utf8');
    JSON.parse(existing);
    console.error('The previous public/data/today.json is left untouched.');
  } catch {
    console.error('No valid existing today.json is present either.');
  }
  process.exit(1);
}

main().catch((err) => {
  console.error('FATAL (unexpected):', err instanceof Error ? err.message : err);
  process.exit(1);
});
