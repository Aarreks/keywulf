// A compact SVG graph of how WPM evolved across the run. No charting library.
//
// Samples arrive at a fixed telemetry interval, so sample index is a uniform
// time axis - plotting by index (not by progress) avoids the vertical pile-ups
// that made stalls look like squashed rectangles. The series is downsampled,
// lightly smoothed, and drawn as a Catmull-Rom curve.
//
// Coordinates are computed in PIXEL space (the viewBox matches the element's
// measured size), so strokes are uniform and the end dot is a true circle on
// every screen - a stretched unit viewBox distorted strokes into chisel tips.

import { useEffect, useRef, useState } from 'react';
import { curvePath, downsample, smoothSeries } from '../lib/graph';

interface Props {
  samples: Array<{ p: number; wpm: number }>;
}

const MAX_POINTS = 56;
const PAD_TOP = 14;
const PAD_BOTTOM = 3;
const DOT_R = 4;

export function RunGraph({ samples }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 96 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(120, Math.round(r.width)), h: Math.max(48, Math.round(r.height)) });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const raw = samples.filter((s) => Number.isFinite(s.wpm) && s.wpm >= 0).map((s) => s.wpm);
  if (raw.length < 4) return null;

  const series = smoothSeries(downsample(raw, MAX_POINTS));
  const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
  const peak = Math.max(60, ...series, avg);
  const maxWpm = peak * 1.15;

  const { w, h } = size;
  const usableH = h - PAD_TOP - PAD_BOTTOM;
  // Leave room on the right so the end dot is never clipped.
  const usableW = w - DOT_R - 1;
  const n = series.length;
  const yFor = (wpm: number) =>
    PAD_TOP + usableH - Math.max(0, Math.min(1, wpm / maxWpm)) * usableH;
  const pts = series.map((wpm, i) => ({ x: (i / (n - 1)) * usableW, y: yFor(wpm) }));

  const line = curvePath(pts);
  const area = `${line} L ${usableW} ${h} L 0 ${h} Z`;
  const avgY = yFor(avg);
  const end = pts[n - 1];

  return (
    <div
      ref={boxRef}
      className="telemetry telemetry--result"
      aria-label={`WPM over the run, averaging ${Math.round(avg)}`}
      role="img"
    >
      {/* Intentionally NO viewBox: user units = CSS pixels, no stretch ever. */}
      <svg width={w} height={h}>
        <line className="telemetry__grid" x1="0" y1={h - 1} x2={w} y2={h - 1} />
        <line className="telemetry__avg" x1="0" y1={avgY.toFixed(1)} x2={w} y2={avgY.toFixed(1)} />
        <path className="telemetry__area" d={area} />
        <path className="telemetry__line" d={line} />
        <circle className="telemetry__dot" cx={end.x.toFixed(1)} cy={end.y.toFixed(1)} r={DOT_R} />
      </svg>
      <span className="telemetry__avg-label tnum">avg {Math.round(avg)}</span>
    </div>
  );
}
