// Shared data types for Keywulf. These describe the shape of the daily
// challenge JSON and are used by both the browser app and the Node generation
// pipeline. Keep this file dependency-free so it can be imported anywhere.

/** One source citation retained from search grounding. */
export interface ChallengeSource {
  /** Human-readable title of the source (publisher or article title). */
  title: string;
  /** Absolute URL. Never invented; comes from grounding metadata. */
  url: string;
}

/** A single ranked story in the daily briefing. */
export interface Story {
  /** 1-based rank; most important first. Sequential and unique within a day. */
  rank: number;
  /** Short headline (part of the typeable corpus). ASCII-only. */
  headline: string;
  /** 1-2 sentence body prose (part of the typeable corpus). ASCII-only. */
  body: string;
  /** Topical category, e.g. "Conflict", "Economy". Metadata only, not typed. */
  category: string;
  /** One or more world regions this story concerns. Metadata only. */
  regions: string[];
  /** Model's 0-100 estimate of global significance. Metadata only. */
  importance: number;
  /** Sources specific to this story, if attribution is reliable. May be empty. */
  sources: ChallengeSource[];
}

/** The complete once-per-day shared challenge. */
export interface Challenge {
  /** Schema version for forward-compatible parsing. */
  schemaVersion: number;
  /** The Keywulf day, YYYY-MM-DD in UTC. */
  date: string;
  /** Deterministic game number derived from the epoch. */
  gameNumber: number;
  /** Short human title for the day's briefing (metadata, not typed). */
  title: string;
  /** Ranked stories, most important first. */
  stories: Story[];
  /**
   * A flat pool of all sources used to build the briefing. Shown when
   * per-story attribution is not reliable enough. Always present.
   */
  sourcePool: ChallengeSource[];
  /** Total words across all typeable text (headline + body). */
  wordCount: number;
  /** ISO-8601 timestamp of when this challenge was generated (UTC). */
  generatedAt: string;
  /** Which model produced it (for provenance / debugging). */
  model: string;
}
