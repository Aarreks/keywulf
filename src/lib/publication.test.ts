import { describe, expect, it } from 'vitest';
import { activeChallengeDate, nextPublicationTime, preparationDate } from './publication';

const time = (value: string) => Date.parse(value);

describe('01:00 UTC publication', () => {
  it('switches at exactly 01:00, including month and year boundaries', () => {
    expect(activeChallengeDate(time('2026-10-06T00:59:59.999Z'))).toBe('2026-10-05');
    expect(activeChallengeDate(time('2026-10-06T01:00:00.000Z'))).toBe('2026-10-06');
    expect(activeChallengeDate(time('2027-01-01T00:59:59Z'))).toBe('2026-12-31');
    expect(activeChallengeDate(time('2027-01-01T01:00:00Z'))).toBe('2027-01-01');
  });

  it('targets the same upcoming date for all four attempts before release', () => {
    for (const minute of [20, 30, 40, 50]) {
      const now = time(`2026-10-06T00:${minute}:00Z`);
      expect(preparationDate(now)).toBe('2026-10-06');
      expect(activeChallengeDate(now)).toBe('2026-10-05');
    }
    expect(preparationDate(time('2027-01-01T00:20:00Z'))).toBe('2027-01-01');
  });

  it('counts down to the same release time as the server', () => {
    expect(nextPublicationTime(time('2026-10-06T00:59:59Z'))).toBe(time('2026-10-06T01:00:00Z'));
    expect(nextPublicationTime(time('2026-10-06T01:00:00Z'))).toBe(time('2026-10-07T01:00:00Z'));
  });
});
