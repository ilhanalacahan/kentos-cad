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

/**
 * Circle tangent to three edges ("Teğet, teğet, teğet"; Apollonius).
 * Each edge gives one equation in the centre and radius: a line (taken
 * as infinite) keeps the centre at ±r from it, a circle at R + r, R − r
 * or r − R from its centre. Every side combination is solved (three
 * lines exactly, anything with a circle by Newton's method started at the
 * picked points); the circle whose tangent points lie nearest the picks
 * wins.
 */
export function tangentTangentTangent(edges: readonly [Edge, Edge, Edge], picks: readonly [Vec2, Vec2, Vec2]): { c: Vec2; r: number } | null {
  // Work near the picks: the equations lose digits at TM magnitudes.
  const o = { x: (picks[0].x + picks[1].x + picks[2].x) / 3, y: (picks[0].y + picks[1].y + picks[2].y) / 3 };
  const local = edges.map((e) => shift(e, o));
  const lp = picks.map((p) => ({ x: p.x - o.x, y: p.y - o.y }));
  const scale = Math.max(1, ...lp.map((p) => Math.hypot(p.x, p.y)));
  const options = local.map((e): Constraint[] => {
    if (e.kind === 'seg') {
      const l = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
      if (l < 1e-12) return [];
      const n = { x: -(e.b.y - e.a.y) / l, y: (e.b.x - e.a.x) / l };
      return [1, -1].map((s) => ({ kind: 'line', a: e.a, n, s }));
    }
    return [1, -1, 0].map((s) => ({ kind: 'circle', c: e.c, R: e.r, s }));
  });
  const r0 = lp.reduce((m, p) => m + Math.hypot(p.x, p.y), 0) / 3 || 1;
  let best: { c: Vec2; r: number; score: number } | null = null;
  for (const c1 of options[0])
    for (const c2 of options[1])
      for (const c3 of options[2]) {
        const sol = solve3([c1, c2, c3], { x: 0, y: 0 }, r0, scale);
        if (!sol || !(sol.r > 1e-9)) continue;
        let score = 0;
        for (let i = 0; i < 3; i++) {
          const t = touchPoint(local[i], sol.c);
          score += t ? Math.hypot(t.x - lp[i].x, t.y - lp[i].y) : Infinity;
        }
        if (!best || score < best.score) best = { ...sol, score };
      }
  return best ? { c: { x: best.c.x + o.x, y: best.c.y + o.y }, r: best.r } : null;
}

/**
 * One tangency: a line keeps n·(c − a) = s·r; a circle keeps |c − C| =
 * R + r (s = 1), R − r (s = −1) or r − R (s = 0, the given circle inside).
 */
type Constraint = { kind: 'line'; a: Vec2; n: Vec2; s: number } | { kind: 'circle'; c: Vec2; R: number; s: number };

function shift(e: Edge, o: Vec2): Edge {
  if (e.kind === 'seg') return { kind: 'seg', a: { x: e.a.x - o.x, y: e.a.y - o.y }, b: { x: e.b.x - o.x, y: e.b.y - o.y } };
  return { ...e, c: { x: e.c.x - o.x, y: e.c.y - o.y } };
}

/** Residual and gradient (∂/∂cx, ∂/∂cy, ∂/∂r) of a constraint. */
function residual(k: Constraint, c: Vec2, r: number): [number, number, number, number] {
  if (k.kind === 'line') return [k.n.x * (c.x - k.a.x) + k.n.y * (c.y - k.a.y) - k.s * r, k.n.x, k.n.y, -k.s];
  const dx = c.x - k.c.x;
  const dy = c.y - k.c.y;
  const d = Math.hypot(dx, dy) || 1e-12;
  const target = k.s === 0 ? r - k.R : k.R + k.s * r;
  return [d - target, dx / d, dy / d, k.s === 0 ? -1 : -k.s];
}

function det3(m: number[][]): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

/** Newton's method (exact in one step when all three are lines). */
function solve3(ks: Constraint[], c0: Vec2, r0: number, scale: number): { c: Vec2; r: number } | null {
  let c = c0;
  let r = r0;
  for (let it = 0; it < 60; it++) {
    const rows = ks.map((k) => residual(k, c, r));
    const J = rows.map((row) => [row[1], row[2], row[3]]);
    const F = rows.map((row) => row[0]);
    const D = det3(J);
    if (Math.abs(D) < 1e-14) return null;
    const col = (i: number) => J.map((row, j) => row.map((v, k) => (k === i ? -F[j] : v)));
    const step = [det3(col(0)) / D, det3(col(1)) / D, det3(col(2)) / D];
    c = { x: c.x + step[0], y: c.y + step[1] };
    r += step[2];
    if (Math.hypot(step[0], step[1], step[2]) <= 1e-13 * scale) break;
  }
  const worst = Math.max(...ks.map((k) => Math.abs(residual(k, c, r)[0])));
  return worst <= 1e-9 * Math.max(scale, r) ? { c, r } : null;
}
