// Checked-in SAMPLE briefing content. This is illustrative, human-written
// placeholder data so the app runs with `npm run dev` before any Gemini key is
// configured. It is NOT real reporting. Source links point to publisher home
// sections (real, valid URLs) rather than fabricated article links.
//
// Voice: terse wire-service headlines, one short sentence each, with a dry
// aside only where one arises naturally. The real daily job overwrites
// public/data/today.json with grounded output in the same voice.

import type { RawStory } from './buildChallenge';

export const SAMPLE_DATE = '2026-08-09';
export const SAMPLE_MODEL = 'sample-fixture';

export const sampleStories: RawStory[] = [
  {
    headline: 'Ceasefire talks resume as shelling continues',
    body: 'Negotiators returned to the table while artillery kept making its own statement along the border.',
    category: 'Conflict',
    regions: ['Europe'],
    importance: 97,
    sources: [
      { title: 'Reuters World', url: 'https://www.reuters.com/world/' },
      { title: 'AP News', url: 'https://apnews.com/hub/world-news' },
    ],
  },
  {
    headline: 'Major central banks signal a pause on rates',
    body: 'Officials hinted borrowing costs may have peaked, then spent several paragraphs refusing to promise anything.',
    category: 'Economy',
    regions: ['Global'],
    importance: 92,
    sources: [
      { title: 'Reuters Markets', url: 'https://www.reuters.com/markets/' },
      { title: 'Financial Times', url: 'https://www.ft.com/' },
    ],
  },
  {
    headline: 'Coastal storm forces mass evacuations',
    body: 'Hundreds of thousands were ordered inland as forecasters warned the system could stall over the coast for days.',
    category: 'Disaster',
    regions: ['Asia'],
    importance: 88,
    sources: [
      { title: 'BBC News', url: 'https://www.bbc.com/news' },
      { title: 'Al Jazeera', url: 'https://www.aljazeera.com/' },
    ],
  },
  {
    headline: 'Parliament passes sweeping data privacy law',
    body: 'Companies face large fines for misusing personal data, a practice previously known as the business model.',
    category: 'Policy',
    regions: ['Europe'],
    importance: 80,
    sources: [{ title: 'Politico Europe', url: 'https://www.politico.eu/' }],
  },
  {
    headline: 'Health agencies track new respiratory outbreak',
    body: 'Officials urged basic precautions and said there is no evidence yet of wide transmission.',
    category: 'Health',
    regions: ['Africa'],
    importance: 76,
    sources: [
      { title: 'World Health Organization', url: 'https://www.who.int/news' },
    ],
  },
  {
    headline: 'Chipmaker unveils faster, cooler processors',
    body: 'The new chips promise more power for less electricity, which data centers currently consume like a midsize country.',
    category: 'Technology',
    regions: ['Asia', 'United States'],
    importance: 71,
    sources: [{ title: 'Reuters Technology', url: 'https://www.reuters.com/technology/' }],
  },
  {
    headline: 'Coalition government sworn in after long deadlock',
    body: 'The new alliance pledged unity, effective immediately, budget negotiations permitting.',
    category: 'Politics',
    regions: ['Europe'],
    importance: 66,
    sources: [{ title: 'The Guardian', url: 'https://www.theguardian.com/world' }],
  },
  {
    headline: 'Oil prices slip as supply fears ease',
    body: 'Producers signaled steady output, giving importers a rare quiet week.',
    category: 'Markets',
    regions: ['Middle East'],
    importance: 61,
    sources: [{ title: 'Bloomberg Markets', url: 'https://www.bloomberg.com/markets' }],
  },
  {
    headline: 'Appeals court upholds landmark climate ruling',
    body: 'The government must strengthen emissions targets after arguing, unsuccessfully, that it was trying.',
    category: 'Climate',
    regions: ['Global'],
    importance: 57,
    sources: [{ title: 'Reuters Legal', url: 'https://www.reuters.com/legal/' }],
  },
  {
    headline: 'Early trial results promising for new vaccine',
    body: 'Researchers reported encouraging data and the customary reminder that larger studies are needed.',
    category: 'Science',
    regions: ['Global'],
    importance: 52,
    sources: [{ title: 'Nature News', url: 'https://www.nature.com/news' }],
  },
  {
    headline: 'Regulators clear major cross-border merger',
    body: 'The deal was approved with conditions meant to protect competition from the people buying it.',
    category: 'Business',
    regions: ['United States', 'Europe'],
    importance: 47,
    sources: [{ title: 'Wall Street Journal', url: 'https://www.wsj.com/' }],
  },
  {
    headline: 'Aid convoys reach flood-isolated region',
    body: 'The first relief supplies arrived after a week of impassable roads.',
    category: 'Humanitarian',
    regions: ['Asia'],
    importance: 42,
    sources: [{ title: 'UN News', url: 'https://news.un.org/en/' }],
  },
  {
    headline: 'Drought pushes grain prices to seasonal high',
    body: 'A dry planting season has traders and bakers watching the same forecasts.',
    category: 'Food',
    regions: ['Africa', 'Global'],
    importance: 38,
    sources: [{ title: 'Reuters Commodities', url: 'https://www.reuters.com/markets/commodities/' }],
  },
  {
    headline: 'Astronomers spot largest known comet fragment',
    body: 'The object poses no threat to Earth, astronomers said, sounding slightly disappointed.',
    category: 'Science',
    regions: ['Global'],
    importance: 33,
    sources: [{ title: 'Nature News', url: 'https://www.nature.com/news' }],
  },
];
