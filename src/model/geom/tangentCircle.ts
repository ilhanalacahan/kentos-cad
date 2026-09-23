import type { Vec2 } from '../geometry';
import { circleCircle, lineCircleParams, lineLine, type Edge } from './intersect';

/**
 * Circle of radius r tangent to two edges ("Teğet, teğet, yarıçap"). Lines
 * count as infinite, arcs as their full circle. The centre lies on a
 * parallel of each at distance r (lines: ±r, circles: R ± r); among the
 * crossings of those, the one whose tangent points are nearest to the
 * picked points wins.
 */
export function tangentTangentRadius(e1: Edge, pick1: Vec2, e2: Edge, pick2: Vec2, r: number): { c: Vec2; r: number } | null {
  if (!(r > 0)) return null;
  const candidates: Vec2[] = [];
  for (const o1 of parallels(e1, r))
    for (const o2 of parallels(e2, r)) candidates.push(...crossings(o1, o2));
  let best: { c: Vec2; score: number } | null = null;
  for (const c of candidates) {
    const t1 = touchPoint(e1, c);
    const t2 = touchPoint(e2, c);
    if (!t1 || !t2) continue;
    const score = Math.hypot(t1.x - pick1.x, t1.y - pick1.y) + Math.hypot(t2.x - pick2.x, t2.y - pick2.y);
    if (!best || score < best.score) best = { c, score };
  }
  return best ? { c: best.c, r } : null;
}

type Support = { kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'circle'; c: Vec2; r: number };

function parallels(e: Edge, r: number): Support[] {
  if (e.kind === 'seg') {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-12) return [];
    const nx = (-dy / l) * r;
    const ny = (dx / l) * r;
    return [1, -1].map((s) => ({ kind: 'line', a: { x: e.a.x + nx * s, y: e.a.y + ny * s }, b: { x: e.b.x + nx * s, y: e.b.y + ny * s } }));
  }
  const out: Support[] = [{ kind: 'circle', c: e.c, r: e.r + r }];
  if (Math.abs(e.r - r) > 1e-9) out.push({ kind: 'circle', c: e.c, r: Math.abs(e.r - r) });
  return out;
}

function crossings(a: Support, b: Support): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const h = lineLine(a.a, a.b, b.a, b.b);
    return h ? [h.p] : [];
  }
  if (a.kind === 'circle' && b.kind === 'circle') return circleCircle(a.c, a.r, b.c, b.r);
  const line = (a.kind === 'line' ? a : b) as Extract<Support, { kind: 'line' }>;
  const circle = (a.kind === 'circle' ? a : b) as Extract<Support, { kind: 'circle' }>;
  return lineCircleParams(line.a, line.b, circle.c, circle.r).map((t) => ({ x: line.a.x + (line.b.x - line.a.x) * t, y: line.a.y + (line.b.y - line.a.y) * t }));
}

/** Where a circle centred at c touches the edge's supporting line or circle. */
function touchPoint(e: Edge, c: Vec2): Vec2 | null {
  if (e.kind === 'seg') {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const l2 = dx * dx + dy * dy;
    const t = ((c.x - e.a.x) * dx + (c.y - e.a.y) * dy) / l2;
    return { x: e.a.x + dx * t, y: e.a.y + dy * t };
  }
  const d = Math.hypot(c.x - e.c.x, c.y - e.c.y);
  if (d < 1e-12) return null;
  return { x: e.c.x + ((c.x - e.c.x) / d) * e.r, y: e.c.y + ((c.y - e.c.y) / d) * e.r };
}
