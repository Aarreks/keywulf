// Keywulf daily generation. Runs ONCE PER DAY on GitHub Actions (never in the
// browser, never per visitor). It:
//   1. asks Gemini, grounded with Google Search, to research the last ~24-30h
//      of world news, deduplicate coverage, rank by global significance, and
//      write a compact briefing as JSON;
//   2. sanitizes every typeable field to easy ASCII (in code, not just prompt);
//   3. retains real source URLs from grounding metadata;
//   4. validates the whole thing hard; and
//   5. writes public/data/today.json.
//
// If anything fails after limited retries it exits non-zero and writes nothing,
// so a bad day never replaces the last good deployed puzzle.
//
// Requires GEMINI_API_KEY (server-side only). Never expose this key to clients.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { assembleChallenge, type RawSource, type RawStory } from './buildChallenge';
import { validateChallenge } from './challengeSchema';
import { todayUtc } from '../src/lib/gameNumber';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || '8000');
const DATE = process.env.KEYWULF_DATE || todayUtc();
const MAX_ATTEMPTS = 3; // initial + up to 2 regenerations

if (!API_KEY) {
  console.error('FATAL: GEMINI_API_KEY is not set. Refusing to generate.');
  console.error('This key is server-side only and must never be a VITE_ variable.');
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error(`FATAL: KEYWULF_DATE "${DATE}" is not YYYY-MM-DD.`);
  process.exit(1);
}

const SYSTEM_INSTRUCTION = `You are the editor of Keywulf, a once-per-day global news briefing that people type as a game. You are careful, sober, and globally minded. You avoid US-centric bias, clickbait, celebrity gossip, and culture-war filler. You never invent facts or sources.`;

function buildPrompt(feedback?: string): string {
  return `Research the most important world news from roughly the last 24 to 30 hours using web search. Then produce a compact daily world briefing.

SELECTION AND RANKING
- Cluster different articles that cover the SAME event; that is one story.
- Deduplicate aggressively. If 20 outlets cover one event, it is one story.
- Select 10 to 14 genuinely distinct stories.
- Rank by real global significance: people materially affected, geopolitical and economic consequence, public safety, wars and diplomacy, elections and major government change, natural disasters, central-bank and major economic developments, major science/technology, public-health, climate, and major legal or policy changes.
- Do NOT rank by social-media attention, outrage, US media volume, or entertainment value.
- Value geographic diversity, but never let a trivial story displace a clearly consequential one.
- For major stories, prefer facts corroborated by multiple credible independent sources. Distinguish established facts from developing/uncertain claims (e.g. "reportedly", "officials say").

WORD BUDGET (aim for 450 to 650 total words of headline+body text)
- Stories 1-3: headline + about 2 concise sentences.
- Stories 4-8: headline + about 1-2 concise sentences.
- Remaining stories: headline + one concise sentence.

TEXT RULES (critical)
- Write in plain, natural English prose.
- Use ONLY simple ASCII characters. No em dashes, en dashes, curly quotes, curly apostrophes, ellipsis characters, accented letters, or non-Latin characters.
- Use a straight apostrophe ' and straight quotes ". Use a hyphen - . Use three periods ... for an ellipsis.
- For foreign names, use the conventional English transliteration (for example, Kyiv, Beijing, Sao Paulo written as Sao Paulo without accents).
- Do not include source URLs, citations, or brackets inside the headline or body text.

OUTPUT FORMAT
Return ONLY a JSON object, no markdown fences, of the form:
{
  "title": "short title for the day's briefing",
  "stories": [
    {
      "headline": "concise headline",
      "body": "one to three concise sentences",
      "category": "e.g. Conflict, Economy, Disaster, Health, Technology, Politics, Climate, Science",
      "regions": ["e.g. Europe", "Global"],
      "importance": 0-100 integer estimate of global significance
    }
  ]
}
Order the stories from most important to least important.${feedback ? `\n\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION. Fix these problems and try again:\n${feedback}` : ''}`;
}

interface ModelStories {
  title?: string;
  stories: RawStory[];
}

function extractJson(text: string): ModelStories {
  let t = text.trim();
  // Strip a ```json ... ``` or ``` ... ``` fence if present.
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(t);
  if (fence) t = fence[1].trim();
  // Otherwise take the outermost braces.
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

async function main(): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  let feedback: string | undefined;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`Attempt ${attempt}/${MAX_ATTEMPTS} for ${DATE} using ${MODEL}...`);
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(feedback),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          tools: [{ googleSearch: {} }],
          temperature: 0.5,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });

      const text = response.text;
      if (!text) throw new Error('Empty model response');

      const model = extractJson(text);
      const grounding = extractGroundingSources(response.candidates as CandidateLike[] | undefined);

      const challenge = assembleChallenge({
        date: DATE,
        model: MODEL,
        generatedAt: new Date().toISOString(),
        title: model.title,
        stories: model.stories,
        groundingSources: grounding,
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
      errors.push(`attempt ${attempt}: ${msg}`);
      feedback = msg;
      console.warn(`Attempt ${attempt} failed: ${msg.split('\n')[0]}`);
    }
  }

  console.error('FATAL: generation failed after all attempts. today.json was NOT modified.');
  console.error(errors.join('\n'));
  // Confirm the previous good file still parses so the deploy step can proceed
  // with the last valid puzzle (or fail loudly if there is none).
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
  console.error('FATAL (unexpected):', err);
  process.exit(1);
});
