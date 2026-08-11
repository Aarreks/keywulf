import { useEffect, useState } from 'react';
import type { Challenge } from '../types';
import type { OfficialResult } from '../lib/storage';
import { formatAccuracyPct, formatDuration } from '../lib/scoring';
import { formatLongDate } from '../lib/gameNumber';
import { CheckIcon } from './icons';

interface Props {
  challenge: Challenge;
  result: OfficialResult;
  streak: number;
  onViewResult: () => void;
  onPractice: () => void;
  onViewStats: () => void;
}

/**
 * The publish cutoff is 01:00 UTC (the daily job runs at 00:05 with a 00:30
 * safety retry). Returns the cutoff formatted in the player's local time, plus
 * a countdown that re-renders every 30s while the card is on screen.
 */
function useNextBriefing() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const cutoff = new Date(now);
  cutoff.setUTCHours(1, 0, 0, 0);
  if (cutoff.getTime() <= now) cutoff.setUTCDate(cutoff.getUTCDate() + 1);
  const diffMs = cutoff.getTime() - now;
  let hours = Math.floor(diffMs / 3_600_000);
  let minutes = Math.ceil((diffMs % 3_600_000) / 60_000);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  const localTime = cutoff.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // For players already on UTC the local rendering would just repeat "1:00 AM".
  const showLocal = new Date().getTimezoneOffset() !== 0;
  const countdown = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  return { localTime, showLocal, countdown };
}

// Shown when this browser has already completed today's official challenge.
export function CompletedCard({ challenge, result, streak, onViewResult, onPractice, onViewStats }: Props) {
  const next = useNextBriefing();
  return (
    <div className="done-card enter">
      <div className="done-card__badge">
        <CheckIcon /> Today's Keywulf complete
      </div>
      <h1 className="start__title" style={{ fontSize: 'clamp(32px, 6vw, 60px)' }}>
        Keywulf No. {challenge.gameNumber}
      </h1>
      <p className="start__hint">{formatLongDate(challenge.date)}</p>

      <div className="statgrid tnum" style={{ maxWidth: 560 }}>
        <div className="cell">
          <div className="cell__val cell__val--good">{result.wpm}</div>
          <div className="cell__label">WPM</div>
        </div>
        <div className="cell">
          <div className="cell__val">{formatAccuracyPct(result.accuracy)}%</div>
          <div className="cell__label">Accuracy</div>
        </div>
        <div className="cell">
          <div className="cell__val">
            {result.storyCount > 0 ? `${result.storiesCleared}/${result.storyCount}` : formatDuration(result.elapsedMs)}
          </div>
          <div className="cell__label">{result.storyCount > 0 ? 'Stories' : 'Time'}</div>
        </div>
        <div className="cell">
          <div className="cell__val">{streak}</div>
          <div className="cell__label">Streak</div>
        </div>
      </div>

      <div className="result__actions">
        <button className="btn btn--primary" onClick={onViewResult}>
          View result
        </button>
        <button className="btn" onClick={onPractice}>
          Practice again
        </button>
        <button className="btn btn--ghost" onClick={onViewStats}>
          Stats
        </button>
      </div>

      <p className="start__hint">
        The next briefing arrives by 01:00 UTC
        {next.showLocal ? ` (${next.localTime} your time)` : ''} - in{' '}
        <span className="tnum">{next.countdown}</span>. Your streak continues if you play each day.
      </p>
    </div>
  );
}
