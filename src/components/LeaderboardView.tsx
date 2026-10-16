import { useEffect, useState } from 'react';
import { getBoard } from '../lib/communityClient';
import type { LeaderboardPage } from '../lib/leaderboard';
import { formatAccuracyPct, formatWpm } from '../lib/scoring';

export function LeaderboardView({ date }: { date: string }) {
  const [board, setBoard] = useState<LeaderboardPage | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBoard(null); setError('');
    void getBoard(date, controller.signal).then(value => { if (!controller.signal.aborted) setBoard(value); }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Leaderboard unavailable');
    });
    return () => controller.abort();
  }, [date, reload]);
  return <section className="result enter" aria-labelledby="leaderboard-title">
    <h1 className="start__title" style={{ fontSize: 'clamp(30px, 5vw, 52px)' }} id="leaderboard-title">Daily leaderboard</h1>
    <p className="start__hint">{date} · First official run per browser. All scores speed-checked.</p>
    {error ? <p role="alert">{error}</p> : !board ? <p role="status">Loading scores…</p>
      : board.entries.length === 0 ? <p>No scores yet. Finish today’s game to join.</p>
        : <div className="tablelist tnum" role="table" aria-label="Daily scores">
          <div className="tablelist__row" role="row" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
            <span role="columnheader">Typist</span><span role="columnheader">WPM</span><span role="columnheader">Accuracy</span>
          </div>
          {board.entries.map((entry, i) => <div className="tablelist__row" role="row" key={entry.id} style={{ gridTemplateColumns: 'minmax(0, 1fr) auto auto' }}>
            <span role="cell" style={{ overflowWrap: 'anywhere' }}>{i + 1}. {entry.name}</span>
            <span role="cell">{formatWpm(entry.wpm)}</span><span role="cell" className="muted">{formatAccuracyPct(entry.accuracy)}%</span>
          </div>)}
        </div>}
    <button className="btn" onClick={() => setReload(value => value + 1)}>Refresh scores</button>
  </section>;
}
