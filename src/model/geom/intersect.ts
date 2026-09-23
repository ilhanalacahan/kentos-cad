import type { Vec2 } from '../geometry';
import { normAngle, onArc, TAU } from './arc';

/**
 * Primitive edges every entity decomposes into. Circles are arcs with a
 * full sweep. Intersection, trimming, extending and snapping all work on
 * these, so a new entity kind only has to provide its edges.
 *
 * An arc edge runs from angle `a0` through the signed `sweep`: positive is
 * counter-clockwise, negative clockwise. The sign keeps the travel
 * direction of polyline arc segments, so parameters along a path stay
 * monotonic.
 */
export type Edge =
  | { kind: 'seg'; a: Vec2; b: Vec2 }
  | { kind: 'arc'; c: Vec2; r: number; a0: number; sweep: number };

type ArcEdge = Extract<Edge, { kind: 'arc' }>;

/** Whether angle θ lies on the arc edge (either direction). */
export function onEdgeArc(e: ArcEdge, theta: number): boolean {
  return e.sweep >= 0 ? onArc(theta, e.a0, e.sweep) : onArc(theta, e.a0 + e.sweep, -e.sweep);
}

/** A hit on edge 1 at parameter t (0..1 along it) and on edge 2 at u. */
export interface Hit {
  p: Vec2;
  t: number;
  u: number;
}

const EPS = 1e-12;
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/** Infinite-line intersection; t, u are parameters along a→b and c→d. */
export function lineLine(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Hit | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = cross(rx, ry, sx, sy);
  if (Math.abs(den) < EPS * Math.max(1, Math.hypot(rx, ry) * Math.hypot(sx, sy))) return null; // parallel
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = cross(qx, qy, sx, sy) / den;
  const u = cross(qx, qy, rx, ry) / den;
  return { p: { x: a.x + t * rx, y: a.y + t * ry }, t, u };
}

export function segSeg(a: Vec2, b: Vec2, c: Vec2, d: Vec2, eps = 1e-9): Hit | null {
  const h = lineLine(a, b, c, d);
  return h && h.t >= -eps && h.t <= 1 + eps && h.u >= -eps && h.u <= 1 + eps ? h : null;
}

/**
 * Parameters t along a→b (unbounded) where the line meets the circle.
 * Solved from the foot of the perpendicular from the centre rather than
 * the quadratic's discriminant: construction lines are 2·10⁷ m long, and
 * the discriminant would lose most of its digits to cancellation.
 */
export function lineCircleParams(a: Vec2, b: Vec2, c: Vec2, r: number): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const A = dx * dx + dy * dy;
  if (A < EPS) return [];
  const s = ((c.x - a.x) * dx + (c.y - a.y) * dy) / A;
  const fx = a.x + dx * s - c.x;
  const fy = a.y + dy * s - c.y;
  const h2 = r * r - (fx * fx + fy * fy);
  const tol = 1e-12 * Math.max(1, r * r);
  if (h2 < -tol) return [];
  if (h2 <= tol) return [s];
  const h = Math.sqrt(h2 / A);
  return [s - h, s + h];
}

export function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  if (h < 1e-12) return [{ x: mx, y: my }];
  return [
    { x: mx + (h * dy) / d, y: my - (h * dx) / d },
    { x: mx - (h * dy) / d, y: my + (h * dx) / d },
  ];
}

const angleOf = (c: Vec2, p: Vec2) => Math.atan2(p.y - c.y, p.x - c.x);

/** Parameter (0..1) of a point known to lie on the edge. */
export function paramOn(e: Edge, p: Vec2): number {
  if (e.kind === 'seg') {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const l2 = dx * dx + dy * dy;
    return l2 < EPS ? 0 : ((p.x - e.a.x) * dx + (p.y - e.a.y) * dy) / l2;
  }
  if (e.sweep >= 0) return normAngle(angleOf(e.c, p) - e.a0) / e.sweep;
  return normAngle(e.a0 - angleOf(e.c, p)) / -e.sweep;
}

export function pointAt(e: Edge, t: number): Vec2 {
  if (e.kind === 'seg') return { x: e.a.x + (e.b.x - e.a.x) * t, y: e.a.y + (e.b.y - e.a.y) * t };
  const a = e.a0 + e.sweep * t;
  return { x: e.c.x + Math.cos(a) * e.r, y: e.c.y + Math.sin(a) * e.r };
}

/** All intersections between two bounded edges. */
export function intersectEdges(e1: Edge, e2: Edge): Hit[] {
  if (e1.kind === 'seg' && e2.kind === 'seg') {
    const h = segSeg(e1.a, e1.b, e2.a, e2.b);
    return h ? [h] : [];
  }
  if (e1.kind === 'seg' && e2.kind === 'arc') return segArc(e1, e2);
  if (e1.kind === 'arc' && e2.kind === 'seg') return segArc(e2, e1).map((h) => ({ p: h.p, t: h.u, u: h.t }));
  if (e1.kind === 'arc' && e2.kind === 'arc') {
    return circleCircle(e1.c, e1.r, e2.c, e2.r)
      .filter((p) => onEdgeArc(e1, angleOf(e1.c, p)) && onEdgeArc(e2, angleOf(e2.c, p)))
      .map((p) => ({ p, t: paramOn(e1, p), u: paramOn(e2, p) }));
  }
  return [];
}

function segArc(s: Extract<Edge, { kind: 'seg' }>, a: ArcEdge): Hit[] {
  const out: Hit[] = [];
  for (const t of lineCircleParams(s.a, s.b, a.c, a.r)) {
    if (t < -1e-9 || t > 1 + 1e-9) continue;
    const p = pointAt(s, t);
    if (!onEdgeArc(a, angleOf(a.c, p))) continue;
    out.push({ p, t, u: paramOn(a, p) });
  }
  return out;
}

/**
 * Where a ray from `o` along `dir` first meets an edge beyond `minT`
 * (ray parameter in units of |dir|). Used by Extend.
 */
export function rayEdge(o: Vec2, dir: Vec2, e: Edge, minT = 1e-9): number[] {
  const far = { x: o.x + dir.x, y: o.y + dir.y };
  if (e.kind === 'seg') {
    const h = lineLine(o, far, e.a, e.b);
    return h && h.t > minT && h.u >= -1e-9 && h.u <= 1 + 1e-9 ? [h.t] : [];
  }
  return lineCircleParams(o, far, e.c, e.r).filter((t) => t > minT && onEdgeArc(e, angleOf(e.c, pointAt({ kind: 'seg', a: o, b: far }, t))));
}

/** Closest point on an edge and its parameter. */
export function closestOnEdge(e: Edge, p: Vec2): { p: Vec2; t: number; d: number } {
  if (e.kind === 'seg') {
    const t = Math.max(0, Math.min(1, paramOn(e, p)));
    const q = pointAt(e, t);
    return { p: q, t, d: Math.hypot(p.x - q.x, p.y - q.y) };
  }
  const ang = angleOf(e.c, p);
  if (onEdgeArc(e, ang)) {
    const q = { x: e.c.x + Math.cos(ang) * e.r, y: e.c.y + Math.sin(ang) * e.r };
    return { p: q, t: paramOn(e, q), d: Math.abs(Math.hypot(p.x - e.c.x, p.y - e.c.y) - e.r) };
  }
  const s = pointAt(e, 0);
  const f = pointAt(e, 1);
  const ds = Math.hypot(p.x - s.x, p.y - s.y);
  const df = Math.hypot(p.x - f.x, p.y - f.y);
  return ds <= df ? { p: s, t: 0, d: ds } : { p: f, t: 1, d: df };
}

/** Foot of the perpendicular from p onto the edge's supporting line/circle, if it lies on the edge. */
export function perpendicularFoot(e: Edge, p: Vec2): Vec2 | null {
  if (e.kind === 'seg') {
    const t = paramOn(e, p);
    return t >= -1e-9 && t <= 1 + 1e-9 ? pointAt(e, t) : null;
  }
  const ang = angleOf(e.c, p);
  if (Math.hypot(p.x - e.c.x, p.y - e.c.y) < EPS) return null;
  return onEdgeArc(e, ang) ? { x: e.c.x + Math.cos(ang) * e.r, y: e.c.y + Math.sin(ang) * e.r } : null;
}

export const fullCircle = (c: Vec2, r: number): Edge => ({ kind: 'arc', c, r, a0: 0, sweep: TAU });

/** Points where lines from `p` touch the circle (c, r); empty when p is inside. */
export function tangentPoints(p: Vec2, c: Vec2, r: number): Vec2[] {
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const d2 = dx * dx + dy * dy;
  if (d2 <= r * r + 1e-12) return [];
  const d = Math.sqrt(d2);
  const base = Math.atan2(dy, dx);
  const half = Math.acos(r / d);
  return [base + half, base - half].map((a) => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }));
}
