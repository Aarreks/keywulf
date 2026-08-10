import { useMemo, useState } from 'react';
import type { Challenge } from '../types';
import type { RunResult } from './Play';
import { formatAccuracyPct, formatDuration, formatWpm } from '../lib/scoring';
import { buildShareText, shareOrCopy } from '../lib/share';
import { ShareIcon, CheckIcon } from './icons';
import { RunGraph } from './RunGraph';
import { Sources } from './Sources';

interface Props {
  challenge: Challenge;
  result: RunResult;
  practice: boolean;
  streak: number;
  longest: number;
  bestWpm: number;
  gamesCompleted: number;
  onPracticeAgain: () => void;
  onViewStats: () => void;
}

export function Result({
  challenge,
  result,
  practice,
  streak,
  longest,
  bestWpm,
  gamesCompleted,
  onPracticeAgain,
  onViewStats,
}: Props) {
  const [shareState, setShareState] = useState<'idle' | 'shared' | 'copied' | 'failed'>('idle');
  const [showSources, setShowSources] = useState(false);

  const shareText = useMemo(
    () =>
      buildShareText({
        gameNumber: challenge.gameNumber,
        wpm: result.wpm,
        accuracy: result.accuracy,
        elapsedMs: result.elapsedMs,
        storiesCleared: result.storiesCleared,
        storyCount: result.storyCount,
        streak,
        practice,
      }),
    [challenge.gameNumber, result, streak, practice],
  );

  async function doShare() {
    const outcome = await shareOrCopy(shareText);
    setShareState(outcome);
    if (outcome !== 'failed') setTimeout(() => setShareState('idle'), 2600);
  }

  return (
    <div className="result enter">
      <div className="result__hero">
        <div className="howl" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="result__label">
          {practice
            ? 'Practice run'
            : result.timedOut
              ? `Keywulf #${challenge.gameNumber} - time`
              : `Keywulf #${challenge.gameNumber} - briefing cleared`}
        </div>
        <div className="result__wpm tnum">
          {formatWpm(result.wpm)}
          <span>WPM</span>
        </div>
        <div className="pill">
          <span className="pill__dot" />
          {formatAccuracyPct(result.accuracy)}% accuracy &middot; {formatDuration(result.elapsedMs)}
        </div>
      </div>

      <RunGraph samples={result.samples} />

      <div className="statgrid tnum">
        <Cell label="Accuracy" value={`${formatAccuracyPct(result.accuracy)}%`} good />
        <Cell label="Time" value={formatDuration(result.elapsedMs)} />
        <Cell label="Errors" value={String(result.errors)} />
        <Cell label="Stories" value={`${result.storiesCleared}/${result.storyCount}`} />
        <Cell label={practice ? 'Streak (unchanged)' : 'Current streak'} value={String(streak)} />
        <Cell label="Longest streak" value={String(longest)} />
        <Cell label="Best WPM" value={String(bestWpm)} />
        <Cell label="Games played" value={String(gamesCompleted)} />
      </div>

      {practice && (
        <p className="start__hint">
          This was a practice run. Your official result, streak, and daily record are unchanged.
        </p>
      )}

      <div className="result__actions">
        <button className="btn btn--primary" onClick={doShare}>
          {shareState === 'idle' && (
            <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <ShareIcon size={16} /> Share result
            </span>
          )}
          {shareState === 'shared' && (
            <span className="share-ok" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <CheckIcon size={16} /> Shared
            </span>
          )}
          {shareState === 'copied' && (
            <span className="share-ok" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <CheckIcon size={16} /> Copied
            </span>
          )}
          {shareState === 'failed' && <span>Copy failed - try again</span>}
        </button>
        <button className="btn" onClick={onPracticeAgain}>
          Practice again
        </button>
        <button className="btn btn--ghost" onClick={() => setShowSources((s) => !s)}>
          {showSources ? 'Hide sources' : 'Sources'}
        </button>
        <button className="btn btn--ghost" onClick={onViewStats}>
          Stats
        </button>
      </div>

      {showSources && <Sources challenge={challenge} />}
    </div>
  );
}

function Cell({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="cell">
      <div className={`cell__val ${good ? 'cell__val--good' : ''}`}>{value}</div>
      <div className="cell__label">{label}</div>
    </div>
  );
}
