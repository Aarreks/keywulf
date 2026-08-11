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
  return (
    <div className="start enter">
      <div className="start__head">
        <span className="pill">
          <span className="pill__dot" />
          No. {challenge.gameNumber}
        </span>
        <h1 className="start__title">
          Daily news <b>typeracing</b>.
        </h1>
        <p className="start__tag">
          The day's news, in two minutes of typing. Same briefing for everyone, everywhere.
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
        <span>2:00 on the clock</span>
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
        Type the briefing in order, most important first. The clock starts on your first keystroke
        and stops at 2:00 - or sooner, if you clear the lot. Progress is saved in this browser only.
      </p>
    </div>
  );
}
