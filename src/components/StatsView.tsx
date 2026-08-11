import { useEffect, useRef, useState } from 'react';
import type { AggregateStats } from '../lib/storage';
import { formatAccuracyPct } from '../lib/scoring';
import { curvePath } from '../lib/graph';

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

// Pixel-space graph (NO viewBox: user units = CSS pixels), matching the result
// graph's visual language - so dots are true circles and strokes are uniform
// on every screen.
function HistoryGraph({ data }: { data: Array<{ g: number; wpm: number }> }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 120 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(160, Math.round(r.width)), h: Math.max(80, Math.round(r.height)) });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = size;
  const PAD_X = 8; // keeps end dots un-clipped
  const PAD_TOP = 10;
  const PAD_BOTTOM = 12;
  const wpms = data.map((d) => d.wpm);
  const min = Math.min(...wpms);
  const max = Math.max(...wpms);
  const range = Math.max(1, max - min);
  const n = data.length;
  const pts = data.map((d, i) => ({
    x: PAD_X + (i / (n - 1)) * (w - PAD_X * 2),
    y: PAD_TOP + (1 - (d.wpm - min) / range) * (h - PAD_TOP - PAD_BOTTOM),
  }));
  const line = curvePath(pts);
  const area = `${line} L ${pts[n - 1].x.toFixed(1)} ${h - 1} L ${pts[0].x.toFixed(1)} ${h - 1} Z`;

  return (
    <div ref={boxRef} className="spark" role="img" aria-label="WPM history">
      <svg width={w} height={h}>
        <line className="telemetry__grid" x1="0" y1={h - 1} x2={w} y2={h - 1} />
        <path className="telemetry__area" d={area} />
        <path className="telemetry__line" d={line} />
        {pts.map((p, i) => (
          <circle
            key={i}
            className="telemetry__dot"
            cx={p.x.toFixed(1)}
            cy={p.y.toFixed(1)}
            r={i === n - 1 ? 4.5 : 3}
          />
        ))}
      </svg>
      <span className="spark__minmax tnum" style={{ top: 0 }}>
        {max}
      </span>
      <span className="spark__minmax tnum" style={{ bottom: 0 }}>
        {min}
      </span>
    </div>
  );
}
