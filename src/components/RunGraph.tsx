// A compact SVG graph of how WPM evolved across the run. No charting library.

interface Props {
  samples: Array<{ p: number; wpm: number }>;
}

export function RunGraph({ samples }: Props) {
  if (samples.length < 2) return null;
  const W = 100;
  const H = 34;
  let peak = 60;
  for (const s of samples) peak = Math.max(peak, s.wpm);
  const maxWpm = peak * 1.1;

  // Sort/clamp by progress and build the polyline.
  const pts = samples
    .filter((s) => Number.isFinite(s.wpm) && s.wpm >= 0)
    .map((s) => {
      const x = Math.max(0, Math.min(1, s.p)) * W;
      const y = H - Math.max(0, Math.min(1, s.wpm / maxWpm)) * H;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

  const line = pts.join(' ');
  const area = `0,${H} ${line} ${W},${H}`;

  return (
    <div className="telemetry" style={{ height: 90, opacity: 1 }} aria-label="WPM across the run" role="img">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line className="telemetry__grid" x1="0" y1={H / 2} x2={W} y2={H / 2} />
        <polygon className="telemetry__area" points={area} />
        <polyline className="telemetry__line" points={line} />
      </svg>
    </div>
  );
}
