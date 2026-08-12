// Dry-run generation preview: runs the EXACT production pipeline (same prompts,
// same assembly, same validation) but writes NOTHING to disk - it only prints
// the assembled briefing so prompt/quality changes can be judged before a real
// deploy. Costs real API calls (1 grounded research + 1 format per sample).
//
//   GEMINI_API_KEY=... npx tsx scripts/preview-generation.ts [samples]

import { GoogleGenAI } from '@google/genai';
import { assembleChallenge, type RawSource, type RawStory } from './buildChallenge';
import { validateChallenge } from './challengeSchema';
import { todayUtc } from '../src/lib/gameNumber';
import { SYSTEM_INSTRUCTION, researchPrompt, formatPrompt } from './prompts';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const DATE = process.env.KEYWULF_DATE || todayUtc();
const SAMPLES = Math.min(4, Math.max(1, Number(process.argv[2] || '2')));

if (!API_KEY) {
  console.error('GEMINI_API_KEY is required.');
  process.exit(1);
}

interface ChunkLike {
  web?: { uri?: string; title?: string };
}

/** Same continuity input production uses (guarded against same-day fetch). */
async function fetchPreviousHeadlines(): Promise<string[]> {
  try {
    const res = await fetch(`https://keywulf.com/data/today.json?v=${Date.now()}`, {
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await res.json()) as { date?: string; stories?: Array<{ headline?: string }> };
    if (!j?.date || j.date >= DATE || !Array.isArray(j.stories)) return [];
    return j.stories.map((s) => String(s.headline ?? '')).filter(Boolean).slice(0, 16);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const previousHeadlines = await fetchPreviousHeadlines();
  console.log(`continuity: ${previousHeadlines.length} previous headlines\n`);

  console.log(`Research (${MODEL}, grounded) for ${DATE}...`);
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: researchPrompt(DATE),
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ googleSearch: {} }],
      temperature: 0.3,
      maxOutputTokens: 16000,
      thinkingConfig: { thinkingBudget: 4096 },
    },
  });
  const notes = res.text ?? '';
  const sources: RawSource[] = [];
  for (const c of res.candidates ?? []) {
    for (const chunk of (c.groundingMetadata?.groundingChunks ?? []) as ChunkLike[]) {
      if (chunk.web?.uri) sources.push({ url: chunk.web.uri, title: chunk.web.title || chunk.web.uri });
    }
  }
  console.log(`notes: ${notes.length} chars, ${sources.length} grounded sources\n`);
  if (notes.length < 2500 || sources.length === 0) {
    console.error('Research too thin/ungrounded - production would retry here.');
    process.exit(1);
  }

  for (let i = 1; i <= SAMPLES; i++) {
    console.log(`================ SAMPLE ${i}/${SAMPLES} ================`);
    try {
      const r = await ai.models.generateContent({
        model: MODEL,
        contents: formatPrompt(notes, DATE, previousHeadlines),
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: 16000,
          thinkingConfig: { thinkingBudget: 2048 },
        },
      });
      const model = JSON.parse(r.text ?? '{}') as { title?: string; stories: RawStory[] };
      const challenge = assembleChallenge({
        date: DATE,
        model: MODEL,
        generatedAt: new Date().toISOString(),
        title: model.title,
        stories: model.stories,
        groundingSources: sources,
      });
      validateChallenge(challenge);

      console.log(`"${challenge.title}" - ${challenge.stories.length} stories, ${challenge.wordCount} words - VALID`);
      for (const s of challenge.stories) {
        console.log(`  ${s.rank}. ${s.headline} ${s.body}`);
      }
      // Quality spot-checks beyond hard validation.
      const warnings: string[] = [];
      for (const s of challenge.stories) {
        if (!/[.?!:]["']?$/.test(s.headline)) warnings.push(`#${s.rank} headline lacks terminal punctuation`);
        if (/\.\.(?!\.)/.test(s.headline + ' ' + s.body)) warnings.push(`#${s.rank} has a doubled period`);
        if (/permitting[.?!]?$/i.test(s.body.trim())) warnings.push(`#${s.rank} ends with "permitting" (exemplar echo)`);
      }
      console.log(warnings.length ? `WARNINGS:\n  - ${warnings.join('\n  - ')}` : 'no quality warnings');
    } catch (err) {
      console.log(`SAMPLE ${i} FAILED: ${err instanceof Error ? err.message.split('\n').slice(0, 4).join('\n') : err}`);
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
