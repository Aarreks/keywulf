import type { Challenge } from '../types';
import { formatLongDate } from '../lib/gameNumber';

interface Props {
  challenge: Challenge;
  isToday: boolean;
  resumable: boolean;
  onStart: () => void;
  onResume: () => void;
}

export function StartScreen({ challenge, isToday, resumable, onStart, onResume }: Props) {
  const minutes = Math.max(1, Math.round(challenge.wordCount / 45));
  return (
    <div className="start enter">
      <div className="start__head">
        <span className="pill">
          <span className="pill__dot" />
          Keywulf #{challenge.gameNumber}
        </span>
        <h1 className="start__title">
          Type the <b>world</b>.
        </h1>
        <p className="start__tag">
          Today's most important news, deduplicated and ranked, as one shared typing run.
        </p>
      </div>

      <div className="start__meta tnum">
        <span>{formatLongDate(challenge.date)}</span>
        <span>&middot;</span>
        <span>
          <span className="tnum">{challenge.stories.length}</span> stories
        </span>
        <span>&middot;</span>
        <span>
          <span className="tnum">{challenge.wordCount}</span> words
        </span>
        <span>&middot;</span>
        <span>~{minutes} min</span>
      </div>

      {!isToday && (
        <p className="start__hint">
          Showing the latest published briefing ({formatLongDate(challenge.date)}). Your run will be
          recorded against that day.
        </p>
      )}

      <div className="start__actions">
        {resumable ? (
          <>
            <button className="btn btn--primary btn--big" onClick={onResume}>
              Resume today's run
            </button>
            <button className="btn btn--big" onClick={onStart}>
              Restart
            </button>
          </>
        ) : (
          <button className="btn btn--primary btn--big" onClick={onStart} autoFocus>
            Start
          </button>
        )}
      </div>

      <p className="start__hint">
        Type the headlines and stories in order. The timer starts when you begin. Most important
        stories come first. Progress is saved in this browser only.
      </p>
    </div>
  );
}
