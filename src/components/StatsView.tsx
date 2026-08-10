import type { AggregateStats } from '../lib/storage';
import { formatAccuracyPct } from '../lib/scoring';

interface Props {
  stats: AggregateStats;
}

// A compact WPM history graph (SVG, no charting lib) over the retained daily
// results, plus headline metrics and a recent-results list.
export function StatsView({ stats }: Props) {
  const history = [...stats.recent].sort((a, b) => a.gameNumber - b.gameNumber).slice(-30);

  return (
    <div className="result enter">
      <h1 className="start__title" style={{ fontSize: 'clamp(30px, 5vw, 52px)' }}>
        Your stats
      </h1>

      <div className="statgrid tnum">
        <Cell label="Games played" value={String(stats.gamesCompleted)} />
        <Cell label="Current streak" value={String(stats.current)} good />
        <Cell label="Longest streak" value={String(stats.longest)} />
        <Cell label="Best WPM" value={String(stats.bestWpm)} good />
        <Cell label="Average WPM" value={stats.averageWpm ? stats.averageWpm.toFixed(0) : '-'} />
        <Cell
          label="Average accuracy"
          value={stats.averageAccuracy ? `${formatAccuracyPct(stats.averageAccuracy)}%` : '-'}
        />
      </div>

      {history.length >= 2 ? (
        <div className="panel">
          <div className="result__label" style={{ marginBottom: 12 }}>
            WPM - last {history.length} games
          </div>
          <HistoryGraph data={history.map((r) => ({ g: r.gameNumber, wpm: r.wpm }))} />
        </div>
      ) : (
        <p className="start__hint">Play a few daily games to see your performance trend here.</p>
      )}

      {stats.recent.length > 0 && (
        <div>
          <div className="result__label" style={{ marginBottom: 12 }}>
            Recent results
          </div>
          <div className="tablelist tnum">
            {stats.recent.slice(0, 12).map((r) => (
              <div className="tablelist__row" key={r.date}>
                <span>#{r.gameNumber}</span>
                <span className="muted">{r.date}</span>
                <span>{r.wpm} wpm</span>
                <span className="muted">{formatAccuracyPct(r.accuracy)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
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

function HistoryGraph({ data }: { data: Array<{ g: number; wpm: number }> }) {
  const W = 100;
  const H = 30;
  const wpms = data.map((d) => d.wpm);
  const min = Math.min(...wpms);
  const max = Math.max(...wpms);
  const range = Math.max(1, max - min);
  const n = data.length;
  const points = data.map((d, i) => {
    const x = (i / (n - 1)) * W;
    // Pad the vertical range a little so the line is not glued to edges.
    const y = H - 3 - ((d.wpm - min) / range) * (H - 6);
    return { x, y, wpm: d.wpm };
  });
  const line = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="WPM history">
      <line className="spark__axis" x1="0" y1={H - 1} x2={W} y2={H - 1} />
      <polyline className="spark__line" points={line} />
      {points.map((p, i) => (
        <circle key={i} className="spark__dot" cx={p.x} cy={p.y} r={i === n - 1 ? 1.2 : 0.7} />
      ))}
    </svg>
  );
}
