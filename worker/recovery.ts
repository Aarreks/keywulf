import { activeChallengeDate, publicationTime } from '../src/lib/publication';

export const RECOVERY_CRON = '5,25,45 1,2 * * *';

// Six extra generation attempts, ending before 03:00 UTC. A delivery replay
// consumes no additional attempt; each slot is claimed in durable storage.
export function recoverySlot(date: string, scheduledTime: number, now: number): string | null {
  if (!Number.isFinite(scheduledTime)) return null;
  const scheduled = new Date(scheduledTime);
  const deadline = publicationTime(date) + 2 * 3_600_000;
  if (activeChallengeDate(scheduledTime) !== date || activeChallengeDate(now) !== date ||
      now < scheduledTime || now >= deadline || ![1, 2].includes(scheduled.getUTCHours()) ||
      ![5, 25, 45].includes(scheduled.getUTCMinutes())) return null;
  return new Date(Math.floor(scheduledTime / 60_000) * 60_000).toISOString();
}
