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

// Shown when this browser has already completed today's official challenge.
export function CompletedCard({ challenge, result, streak, onViewResult, onPractice, onViewStats }: Props) {
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

      <p className="start__hint">Come back after 00:00 UTC for the next briefing. Your streak continues if you play each day.</p>
    </div>
  );
}
