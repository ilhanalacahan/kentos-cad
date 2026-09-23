import type { Vec2 } from '../geometry';

/**
 * Centripetal Catmull-Rom curve through fit points (Barry–Goldman
 * evaluation, α = 0.5). It passes through every point, never forms cusps
 * or self-loops within a span, and is invariant under similarity
 * transforms — so rotating/scaling/mirroring the fit points is exact.
 */
export function catmullRom(pts: readonly Vec2[], closed: boolean, perSpan = 16): Vec2[] {
  const n = pts.length;
  if (n < 3) return [...pts];
  const at = (i: number): Vec2 => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return reflect(pts[1], pts[0]);
    if (i >= n) return reflect(pts[n - 2], pts[n - 1]);
    return pts[i];
  };
  const out: Vec2[] = [];
  const spans = closed ? n : n - 1;
  for (let i = 0; i < spans; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let s = 0; s < perSpan; s++) {
      const t = t1 + ((t2 - t1) * s) / perSpan;
      out.push(evalSpan(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  out.push(closed ? pts[0] : pts[n - 1]);
  return out;
}

/** Mirror `a` through `b` (phantom end points for open curves). */
const reflect = (a: Vec2, b: Vec2): Vec2 => ({ x: 2 * b.x - a.x, y: 2 * b.y - a.y });

/** Centripetal knot spacing; tiny epsilon keeps coincident points finite. */
const knot = (a: Vec2, b: Vec2) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-6;

function lerp(a: Vec2, b: Vec2, ta: number, tb: number, t: number): Vec2 {
  const d = tb - ta || 1e-12;
  const u = (tb - t) / d;
  const v = (t - ta) / d;
  return { x: a.x * u + b.x * v, y: a.y * u + b.y * v };
}

function evalSpan(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t0: number, t1: number, t2: number, t3: number, t: number): Vec2 {
  const a1 = lerp(p0, p1, t0, t1, t);
  const a2 = lerp(p1, p2, t1, t2, t);
  const a3 = lerp(p2, p3, t2, t3, t);
  const b1 = lerp(a1, a2, t0, t2, t);
  const b2 = lerp(a2, a3, t1, t3, t);
  return lerp(b1, b2, t1, t2, t);
}
