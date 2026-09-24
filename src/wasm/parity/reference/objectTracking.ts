import type { Vec2 } from '../../../model/geometry';

/**
 * Object snap tracking ("nesne izleme"). Points acquired by resting the
 * cursor on a snap emit alignment lines (horizontal/vertical, plus polar
 * steps when polar tracking is on). The cursor locks onto the nearest
 * line, or onto the crossing of two lines from different origins — "above
 * this corner and level with that one". Pure: the viewport feeds it world
 * coordinates and a world tolerance.
 *
 * This is the TypeScript as it was before the Rust core took it over
 * (`src/viewport/objectTracking.ts` now calls the core, docs/adr/0008 S5);
 * the parity test holds the core to it until S3.
 */

export interface TrackLine {
  origin: Vec2;
  /** Degrees, counter-clockwise from east. */
  angle: number;
}

export interface TrackHit {
  point: Vec2;
  /** One line, or two when the point is where two alignments cross. */
  lines: TrackLine[];
}

/** Alignment directions: always 0/90/180/270, plus every polar step. */
export function trackAngles(polarStep: number | null): number[] {
  const out = new Set([0, 90, 180, 270]);
  if (polarStep && polarStep > 0) for (let a = 0; a < 360 - 1e-9; a += polarStep) out.add(Math.round(a * 1e6) / 1e6);
  return [...out];
}

/** Unit direction; exact for the axes so "straight above" keeps the very same X. */
const AXES: Record<number, Vec2> = { 0: { x: 1, y: 0 }, 90: { x: 0, y: 1 }, 180: { x: -1, y: 0 }, 270: { x: 0, y: -1 } };
const dir = (deg: number): Vec2 => {
  const a = ((deg % 360) + 360) % 360;
  if (AXES[a]) return AXES[a];
  const r = (a * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
};

/**
 * Where the cursor `p` locks to, if anywhere within `tol`. `acquired` are
 * the tracking points; `from` (the command's last point) only takes part
 * in crossings, since polar tracking already covers lines through it.
 */
export function trackPoint(p: Vec2, acquired: readonly Vec2[], from: Vec2 | null, angles: readonly number[], tol: number): TrackHit | null {
  if (!acquired.length) return null;
  const lines: { line: TrackLine; d: Vec2; off: number }[] = [];
  const origins = from ? [...acquired, from] : [...acquired];
  origins.forEach((o, i) => {
    for (const angle of angles) {
      const d = dir(angle);
      const vx = p.x - o.x;
      const vy = p.y - o.y;
      // Rays point away from their origin; the opposite angle covers the other side.
      if (vx * d.x + vy * d.y <= 0) continue;
      lines.push({ line: { origin: o, angle }, d, off: Math.abs(d.x * vy - d.y * vx) + (i >= acquired.length ? Infinity : 0) });
    }
  });

  // Crossings of two lines from different origins near the cursor win over a single line.
  let best: { hit: TrackHit; err: number } | null = null;
  const all = origins.flatMap((o, i) => angles.map((angle) => ({ o, i, angle, d: dir(angle) })));
  for (let a = 0; a < all.length; a++)
    for (let b = a + 1; b < all.length; b++) {
      const A = all[a];
      const B = all[b];
      if (A.i === B.i) continue;
      const den = A.d.x * B.d.y - A.d.y * B.d.x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((B.o.x - A.o.x) * B.d.y - (B.o.y - A.o.y) * B.d.x) / den;
      const u = ((B.o.x - A.o.x) * A.d.y - (B.o.y - A.o.y) * A.d.x) / den;
      if (t <= 1e-9 || u <= 1e-9) continue;
      const X = { x: A.o.x + A.d.x * t, y: A.o.y + A.d.y * t };
      const err = Math.hypot(X.x - p.x, X.y - p.y);
      if (err <= tol && (!best || err < best.err)) best = { hit: { point: X, lines: [{ origin: A.o, angle: A.angle }, { origin: B.o, angle: B.angle }] }, err };
    }
  if (best) return best.hit;

  let single: (typeof lines)[number] | null = null;
  for (const l of lines) if (l.off <= tol && (!single || l.off < single.off)) single = l;
  if (!single) return null;
  const o = single.line.origin;
  const t = (p.x - o.x) * single.d.x + (p.y - o.y) * single.d.y;
  return { point: { x: o.x + single.d.x * t, y: o.y + single.d.y * t }, lines: [single.line] };
}

/** Point `distance` along a single tracking line from its origin (typed distance while tracking). */
export function alongTrack(hit: TrackHit, distance: number): Vec2 | null {
  if (hit.lines.length !== 1) return null;
  const { origin, angle } = hit.lines[0];
  const d = dir(angle);
  return { x: origin.x + d.x * distance, y: origin.y + d.y * distance };
}
