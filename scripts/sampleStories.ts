// Checked-in SAMPLE briefing content. This is illustrative, human-written
// placeholder data so the app runs with `npm run dev` before any Gemini key is
// configured. It is NOT real reporting. Source links point to publisher home
// sections (real, valid URLs) rather than fabricated article links.
//
// The real daily job overwrites public/data/today.json with grounded output.

import type { RawStory } from './buildChallenge';

export const SAMPLE_DATE = '2026-08-09';
export const SAMPLE_MODEL = 'sample-fixture';

export const sampleStories: RawStory[] = [
  {
    headline: 'Ceasefire talks resume as border shelling continues',
    body: 'Negotiators from both governments returned to talks aimed at halting weeks of cross-border fighting. Mediators said a partial truce could take effect within days, though shelling near contested towns continued overnight. Aid agencies warned that thousands of families have been displaced and are running short of food and clean water.',
    category: 'Conflict',
    regions: ['Europe', 'Global'],
    importance: 97,
    sources: [
      { title: 'Reuters World', url: 'https://www.reuters.com/world/' },
      { title: 'AP News', url: 'https://apnews.com/hub/world-news' },
    ],
  },
  {
    headline: 'Central banks signal a pause as inflation cools',
    body: 'Several major central banks indicated they may hold interest rates steady after new data showed price growth easing toward target. Markets rallied on hopes that borrowing costs have peaked, but officials warned the path back to stable prices remains uncertain. Policymakers stressed that future decisions would depend on incoming employment and wage figures.',
    category: 'Economy',
    regions: ['United States', 'Europe'],
    importance: 92,
    sources: [
      { title: 'Reuters Markets', url: 'https://www.reuters.com/markets/' },
      { title: 'Financial Times', url: 'https://www.ft.com/' },
    ],
  },
  {
    headline: 'Powerful storm forces mass evacuations along the coast',
    body: 'Authorities ordered hundreds of thousands of residents to leave low-lying areas as a major storm approached, bringing damaging winds and the risk of severe flooding. Emergency crews pre-positioned rescue teams while airlines cancelled hundreds of flights. Forecasters said the system could stall over the coast, prolonging heavy rainfall for days.',
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
    body: 'Lawmakers approved rules that tighten how companies collect and share personal data, with large fines for violations. Industry groups warned of compliance costs while privacy advocates called it a landmark step.',
    category: 'Policy',
    regions: ['Europe'],
    importance: 80,
    sources: [{ title: 'Politico', url: 'https://www.politico.eu/' }],
  },
  {
    headline: 'Health officials track a new respiratory outbreak',
    body: 'Public health agencies reported a cluster of respiratory illnesses under investigation and urged basic precautions. Officials said there was no evidence yet of widespread transmission.',
    category: 'Health',
    regions: ['Africa', 'Global'],
    importance: 76,
    sources: [
      { title: 'World Health Organization', url: 'https://www.who.int/news' },
      { title: 'Reuters Health', url: 'https://www.reuters.com/business/healthcare-pharmaceuticals/' },
    ],
  },
  {
    headline: 'Chipmaker unveils faster, more efficient processors',
    body: 'A leading semiconductor firm announced a new generation of chips it says are significantly more power efficient. Analysts expect the technology to reshape competition in data centers and consumer devices.',
    category: 'Technology',
    regions: ['United States', 'Asia'],
    importance: 71,
    sources: [{ title: 'Reuters Technology', url: 'https://www.reuters.com/technology/' }],
  },
  {
    headline: 'Coalition government sworn in after long deadlock',
    body: 'A new coalition took office following months of political gridlock, pledging to focus on the cost of living. The fragile alliance faces early tests over the budget.',
    category: 'Politics',
    regions: ['Europe'],
    importance: 66,
    sources: [{ title: 'The Guardian', url: 'https://www.theguardian.com/world' }],
  },
  {
    headline: 'Oil prices slip as supply concerns ease',
    body: 'Crude prices fell after producers signaled steady output and demand forecasts softened. The move offered relief to importers grappling with high energy costs.',
    category: 'Markets',
    regions: ['Middle East', 'Global'],
    importance: 61,
    sources: [{ title: 'Bloomberg', url: 'https://www.bloomberg.com/markets' }],
  },
  {
    headline: 'Court upholds landmark climate ruling',
    body: 'An appeals court affirmed a decision requiring the government to strengthen emissions targets. Campaigners hailed the outcome as a precedent for climate litigation.',
    category: 'Climate',
    regions: ['Global'],
    importance: 57,
    sources: [{ title: 'Reuters Legal', url: 'https://www.reuters.com/legal/' }],
  },
  {
    headline: 'Scientists report progress on a promising vaccine',
    body: 'Researchers published encouraging early results from a trial of a new vaccine candidate. Larger studies are needed before any approval.',
    category: 'Science',
    regions: ['Global'],
    importance: 52,
    sources: [{ title: 'Nature', url: 'https://www.nature.com/news' }],
  },
  {
    headline: 'Regulators approve a major cross-border merger',
    body: 'Antitrust authorities cleared a large corporate merger with conditions intended to protect competition. The deal reshapes one of the largest players in the industry.',
    category: 'Business',
    regions: ['United States', 'Europe'],
    importance: 47,
    sources: [{ title: 'Wall Street Journal', url: 'https://www.wsj.com/' }],
  },
  {
    headline: 'Aid convoys reach a region cut off by floods',
    body: 'Relief teams delivered the first supplies to communities isolated by recent flooding. Officials warned that access remains difficult.',
    category: 'Humanitarian',
    regions: ['Asia'],
    importance: 42,
    sources: [{ title: 'UN News', url: 'https://news.un.org/en/' }],
  },
];
