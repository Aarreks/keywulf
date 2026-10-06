// A Keywulf day runs from 01:00 UTC to the next 01:00 UTC. Publication is a
// clock-based lookup of an already prepared briefing, not a deployment job.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function activeChallengeDate(now: number = Date.now()): string {
  return new Date(now - HOUR).toISOString().slice(0, 10);
}

export function nextPublicationTime(now: number = Date.now()): number {
  const date = new Date(now);
  date.setUTCHours(1, 0, 0, 0);
  return date.getTime() > now ? date.getTime() : date.getTime() + DAY;
}

export function preparationDate(now: number): string {
  // The four preparation attempts run after midnight, before 01:00 UTC, and
  // all target the same upcoming game date. Manual recovery uses this date too.
  return new Date(now).toISOString().slice(0, 10);
}

export function publicationTime(date: string): number {
  return Date.parse(`${date}T01:00:00Z`);
}
