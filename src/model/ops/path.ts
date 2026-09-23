import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { normAngle } from '../geom/arc';
import { bulgeOfSweep, cleanBulgePath } from '../geom/bulge';
import { closestOnEdge, intersectEdges, pointAt, type Edge } from '../geom/intersect';
import { edgeLength, entityEdges } from './edges';

/**
 * An entity seen as a path parameterised by arc length s ∈ [0, L]. Trim,
 * break, divide and measure all work on s values, so every kind that
 * provides edges (lines, bulged polylines, arcs, circles) behaves the same.
 */
export interface Path {
  edges: Edge[];
  /** Arc length at the start of each edge. */
  cum: number[];
  length: number;
  closed: boolean;
}

export function pathOf(e: Entity): Path | null {
  const edges = entityEdges(e);
  if (!edges.length) return null;
  const cum: number[] = [];
  let s = 0;
  for (const ed of edges) {
    cum.push(s);
    s += edgeLength(ed);
  }
  const closed = e.kind === 'polygon' || e.kind === 'circle' || (e.kind === 'spline' && e.closed);
  return { edges, cum, length: s, closed };
}

/** Wraps s into [0, L) on closed paths, clamps it on open ones. */
export function normS(path: Path, s: number): number {
  const L = path.length;
  return path.closed ? ((s % L) + L) % L : Math.max(0, Math.min(L, s));
}

function edgeIndexAt(path: Path, q: number): number {
  for (let i = path.edges.length - 1; i >= 0; i--) if (q >= path.cum[i] - 1e-12) return i;
  return 0;
}

export function pointAtS(path: Path, s: number): Vec2 {
  const q = normS(path, s);
  const i = edgeIndexAt(path, q);
  const len = edgeLength(path.edges[i]) || 1;
  return pointAt(path.edges[i], Math.min(1, (q - path.cum[i]) / len));
}

/** Unit travel direction at s. */
export function tangentAtS(path: Path, s: number): Vec2 {
  const q = normS(path, s);
  const ed = path.edges[edgeIndexAt(path, q)];
  if (ed.kind === 'seg') {
    const l = Math.hypot(ed.b.x - ed.a.x, ed.b.y - ed.a.y) || 1;
    return { x: (ed.b.x - ed.a.x) / l, y: (ed.b.y - ed.a.y) / l };
  }
  const p = pointAtS(path, s);
  const dir = Math.sign(ed.sweep) || 1;
  return { x: (-(p.y - ed.c.y) / ed.r) * dir, y: ((p.x - ed.c.x) / ed.r) * dir };
}

/** Arc length of the point on the path nearest to p. */
export function nearestS(path: Path, p: Vec2): number {
  let best = { d: Infinity, s: 0 };
  path.edges.forEach((ed, i) => {
    const c = closestOnEdge(ed, p);
    if (c.d < best.d) best = { d: c.d, s: path.cum[i] + c.t * edgeLength(ed) };
  });
  return best.s;
}

/** Sorted, de-duplicated s values where `boundaries` cross the path (ends excluded when open). */
export function cutsOn(path: Path, boundaries: readonly Edge[]): number[] {
  const out: number[] = [];
  path.edges.forEach((ed, i) => {
    const len = edgeLength(ed);
    for (const b of boundaries) for (const h of intersectEdges(ed, b)) out.push(path.cum[i] + h.t * len);
  });
  const eps = 1e-7 * Math.max(1, path.length);
  const sorted = out
    .map((s) => (path.closed ? normS(path, s) : s))
    .filter((s) => path.closed || (s > eps && s < path.length - eps))
    .sort((a, b) => a - b);
  return sorted.filter((s, i) => i === 0 || s - sorted[i - 1] > eps);
}

/**
 * Geometry of the sub-path from s0 to s1 (s1 may exceed L on closed
 * paths). Pieces of lines stay lines, of arcs and circles arcs, and of
 * polylines polylines with their arc segments cut exactly.
 */
export function subPath(path: Path, s0: number, s1: number, source: Entity): EntityGeometry {
  const first = path.edges[0];
  if ((source.kind === 'arc' || source.kind === 'circle') && first.kind === 'arc') {
    // The edge is counter-clockwise; s is arc length along it.
    return { kind: 'arc', c: first.c, r: first.r, a0: normAngle(first.a0 + s0 / first.r), a1: normAngle(first.a0 + s1 / first.r) };
  }
  const L = path.length;
  const n = path.edges.length;
  const pts: Vec2[] = [pointAtS(path, s0)];
  const bulges: number[] = [];
  const rounds = path.closed ? 2 : 1;
  for (let round = 0; round < rounds; round++)
    for (let i = 0; i < n; i++) {
      const ed = path.edges[i];
      const len = edgeLength(ed);
      const g0 = path.cum[i] + round * L;
      const lo = Math.max(s0, g0);
      const hi = Math.min(s1, g0 + len);
      if (hi - lo <= 1e-9 * Math.max(1, L)) continue;
      const t1 = (hi - g0) / (len || 1);
      const t0 = (lo - g0) / (len || 1);
      bulges.push(ed.kind === 'arc' ? bulgeOfSweep(ed.sweep * (t1 - t0)) : 0);
      pts.push(pointAt(ed, Math.min(1, t1)));
    }
  bulges.push(0);
  if (source.kind === 'line' || (pts.length === 2 && bulges[0] === 0)) return { kind: 'line', a: pts[0], b: pts[pts.length - 1] };
  const clean = cleanBulgePath(pts, bulges, false);
  return { kind: 'polyline', ...clean };
}

/** Evenly spaced s values: n parts (points between them) or every `step` from the start. */
export function divisionParams(path: Path, opts: { parts: number } | { step: number }): number[] {
  const L = path.length;
  const out: number[] = [];
  if ('parts' in opts) {
    const n = Math.floor(opts.parts);
    if (n < 2) return out;
    // A closed path gets n points (its start included); an open one n − 1.
    for (let k = path.closed ? 0 : 1; k < n; k++) out.push((L * k) / n);
    return out;
  }
  if (!(opts.step > 0)) return out;
  const eps = 1e-9 * Math.max(1, L);
  for (let s = opts.step; s < L - eps; s += opts.step) out.push(s);
  return out;
}
