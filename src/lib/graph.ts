// Tiny SVG graph helpers shared by the result graph and the stats history
// graph. No charting library; both render in pixel space (no viewBox).

export interface Pt {
  x: number;
  y: number;
}

/** Catmull-Rom spline through the points, emitted as a cubic bezier path. */
export function curvePath(pts: Pt[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Average consecutive samples down to at most `max` points. */
export function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const stride = values.length / max;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const start = Math.floor(i * stride);
    const end = Math.max(start + 1, Math.floor((i + 1) * stride));
    let sum = 0;
    for (let k = start; k < end; k++) sum += values[k];
    out.push(sum / (end - start));
  }
  return out;
}

/** Centered moving average (window 3) to take the jitter off a series. */
export function smoothSeries(values: number[]): number[] {
  if (values.length < 3) return values;
  return values.map((v, i) => {
    const a = values[i - 1] ?? v;
    const b = values[i + 1] ?? v;
    return (a + v + b) / 3;
  });
}
