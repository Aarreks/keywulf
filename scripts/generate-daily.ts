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

const SYSTEM_INSTRUCTION = `You are the editor of Keywulf, a once-per-day global news briefing that people type as a two-minute typing game. Your register is a literate English broadsheet: terse, precise, globally minded, with a very dry wit deployed sparingly. You avoid US-centric bias, clickbait, celebrity gossip, and culture-war filler. You never invent facts or sources, and you never let a joke distort a fact.`;

// ---------------------------------------------------------------------------
// Step 1: grounded research -> plain-text notes + real grounding sources
// ---------------------------------------------------------------------------
const RESEARCH_PROMPT = `Today is ${DATE} (UTC). Using web search, research the most important world news RIGHT NOW and write concise reporter's notes.

RECENCY (critical)
- ONLY events that happened or materially developed within the last 24 hours; prefer the last 12 hours.
- Nothing older than 48 hours unless a major new development occurred today. If a story's latest development is older, drop it.
- Run MANY distinct searches: "world news today", then regional sweeps (Africa, Asia, Europe, Middle East, Latin America, Oceania), then topical sweeps (economy/markets, science, health, climate) so coverage is genuinely global.

SELECTION
- Cluster duplicate coverage of the same event into one item.
- You MUST produce AT LEAST 16 distinct candidate events, numbered, ranked by real global significance: people materially affected, geopolitical and economic consequence, public safety, wars and diplomacy, elections and government change, natural disasters, central banks and the economy, science/technology, public health, climate, major legal or policy changes.
- NOT ranked by: social-media attention, outrage, US media volume, celebrity, entertainment.
- Note geographic diversity; the world is larger than two or three countries.

FOR EACH EVENT write 2-3 plain lines:
- what happened (specific, factual, with numbers where reported)
- when it happened or broke (so freshness is checkable)
- how solid the reporting is (confirmed by officials / multiple outlets / single report / developing)

Plain text only. No JSON yet.`;

function buildFormatPrompt(notes: string, feedback?: string): string {
  return `Below are today's research notes (${DATE}, UTC). Compress them into the Keywulf daily briefing as JSON.

SELECTION (hard requirements)
- Output BETWEEN 12 AND 16 stories. If strict 24-hour recency leaves fewer than 12, include the freshest remaining items up to 48 hours old rather than returning fewer than 12.
- Order them most important first. Distinct events only.
- Do not invent anything that is not in the notes, and never ascribe motives that are not in the notes. Treat "developing" items with appropriate hedging (reportedly, officials say).

WORD BUDGET (hard target: 170 to 280 total words across all headlines+bodies)
- EVERY story: a terse headline (under 10 words) plus EXACTLY ONE short sentence (under 20 words).
- Wire-service compression. Cut every word that does not earn its place.

VOICE
- Literate, dry, understated: a good broadsheet's world-in-brief column.
- REQUIRED: between 3 and 5 stories must land a quietly wry, understated twist in the final clause - an institutional euphemism taken at face value, a precise detail that undercuts the official framing, a quiet absurdity left to speak for itself. Model the register on these examples, but NEVER reuse any of their content or phrasing:
  * "Officials hinted borrowing costs may have peaked, then spent several paragraphs refusing to promise anything."
  * "The new alliance pledged unity, effective immediately, budget negotiations permitting."
  * "Companies face large fines for misusing personal data, a practice previously known as the business model."
  * "The object poses no threat to Earth, astronomers said, sounding slightly disappointed."
- Wry twists are ONLY allowed on stories with no human cost: politics-as-process, markets, science, technology, sport, bureaucracy.
- Stories involving deaths, disasters, suffering, persecution, arrests of people, or human-rights crackdowns stay strictly straight, with no levity of any kind.
- No exclamation marks. No puns. No winking at the reader.

TEXT RULES (critical)
- ONLY simple ASCII characters. No em dashes, en dashes, curly quotes or apostrophes, ellipsis characters, accented letters, or non-Latin characters.
- Straight apostrophe ', straight quotes ", hyphen -, three periods ... if needed.
- Conventional English transliterations for foreign names (Kyiv, Sao Paulo).
- No source names, URLs, citations, or brackets inside headline or body text.
- Categories must be accurate and varied: Diplomacy, Justice, Migration, Energy, Markets, Health, Science, Climate, Conflict, Disaster, Politics, Economy.
- Proofread: no doubled words, no truncated sentences.

OUTPUT: JSON only, exactly this shape:
{
  "title": "short title for the day's briefing",
  "stories": [
    {
      "headline": "terse headline, under 10 words",
      "body": "exactly one short sentence, under 20 words",
      "category": "e.g. Conflict, Economy, Disaster, Health, Technology, Politics, Climate, Science",
      "regions": ["e.g. Europe", "Global"],
      "importance": 0-100 integer
    }
  ]
}
${feedback ? `\nYOUR PREVIOUS ATTEMPT FAILED VALIDATION. Fix these problems:\n${feedback}\n` : ''}
RESEARCH NOTES
--------------
${notes}`;
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
        contents: RESEARCH_PROMPT,
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
    }
  }
  throw new Error(`Research failed after ${MAX_ATTEMPTS} attempts: ${lastError}`);
}

async function main(): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const { notes, sources } = await research(ai);

  let feedback: string | undefined;
  const errors: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`Format attempt ${attempt}/${MAX_ATTEMPTS} (${MODEL}, JSON mode)...`);
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: buildFormatPrompt(notes, feedback),
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
