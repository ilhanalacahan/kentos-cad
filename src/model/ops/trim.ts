import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { normAngle, TAU } from '../geom/arc';
import { bulgeArc, bulgeAt, bulgeOfSweep } from '../geom/bulge';
import { circleCircle, lineCircleParams, onEdgeArc, pointAt, rayEdge, type Edge } from '../geom/intersect';
import { extendEllipse, trimConstruction, trimEllipse } from './curveCuts';
import { cutsOn, nearestS, pathOf, subPath } from './path';

/**
 * Quick trim and extend (AutoCAD-style: every other visible edge acts as
 * a boundary). The target is treated as a path parameterised by arc
 * length s ∈ [0, L] (see ./path); cuts are the s values where boundaries
 * cross it.
 */

export type TrimResult = { pieces: EntityGeometry[] } | { error: string };

/** Removes the part of `target` between the two cuts that bracket `pick`. */
export function trimEntity(target: Entity, pick: Vec2, boundaries: readonly Edge[]): TrimResult {
  if (target.kind === 'spline') return { error: 'Eğri budanamaz; önce Patlat (X) ile çoklu çizgiye dönüştürün.' };
  if (target.kind === 'dimension' || target.kind === 'hatch') return { error: 'Ölçü ve tarama budanamaz.' };
  if (target.kind === 'ellipse') return trimEllipse(target, pick, boundaries);
  if (target.kind === 'xline' || target.kind === 'ray') return trimConstruction(target, pick, boundaries);
  const path = pathOf(target);
  if (!path) return { error: 'Bu nesne budanamaz.' };
  const cuts = cutsOn(path, boundaries);
  const sp = nearestS(path, pick);
  const eps = 1e-7 * Math.max(1, path.length);
  if (!path.closed) {
    const lo = Math.max(0, ...cuts.filter((c) => c < sp));
    const hi = Math.min(path.length, ...cuts.filter((c) => c > sp));
    if (lo <= eps && hi >= path.length - eps) return { error: 'Tıklanan kısmı kesen bir kenar yok.' };
    const pieces: EntityGeometry[] = [];
    if (lo > eps) pieces.push(subPath(path, 0, lo, target));
    if (hi < path.length - eps) pieces.push(subPath(path, hi, path.length, target));
    return { pieces };
  }
  if (cuts.length < 2) return { error: 'Kapalı nesneyi budamak için en az iki kesişim gerekir.' };
  const below = cuts.filter((c) => c < sp);
  const above = cuts.filter((c) => c > sp);
  const lo = below.length ? below[below.length - 1] : cuts[cuts.length - 1] - path.length;
  const hi = above.length ? above[0] : cuts[0] + path.length;
  // Keep the complement: from hi around to lo.
  return { pieces: [subPath(path, hi, lo + path.length, target)] };
}

export type ExtendResult = { geometry: EntityGeometry } | { error: string };

/** Extends the end of `target` nearest to `pick` to the first boundary it meets. */
export function extendEntity(target: Entity, pick: Vec2, boundaries: readonly Edge[]): ExtendResult {
  if (target.kind === 'ellipse') return extendEllipse(target, pick, boundaries);
  if (target.kind === 'line' || target.kind === 'polyline') {
    const pts = target.kind === 'line' ? [target.a, target.b] : [...target.pts];
    const bulges = target.kind === 'polyline' && target.bulges ? [...target.bulges] : null;
    const n = pts.length;
    const atEnd = Math.hypot(pick.x - pts[n - 1].x, pick.y - pts[n - 1].y) <= Math.hypot(pick.x - pts[0].x, pick.y - pts[0].y);
    const seg = atEnd ? n - 2 : 0;
    const arc = bulgeArc(pts[seg], pts[seg + 1], bulgeAt(bulges ?? undefined, seg));
    if (arc) {
      // An arc end segment grows along its own circle.
      const ccw = arc.sweep > 0;
      const endAngle = atEnd ? arc.a0 + arc.sweep : arc.a0;
      const forward = atEnd === ccw; // the tip moves counter-clockwise
      const delta = arcReach(arc.c, arc.r, endAngle, forward, TAU - Math.abs(arc.sweep), boundaries);
      if (delta === null) return { error: 'Bu yönde ulaşılacak bir sınır yok.' };
      const tipAngle = endAngle + (forward ? delta : -delta);
      const tip = { x: arc.c.x + Math.cos(tipAngle) * arc.r, y: arc.c.y + Math.sin(tipAngle) * arc.r };
      const sw = arc.sweep + (ccw ? delta : -delta);
      if (atEnd) pts[n - 1] = tip;
      else pts[0] = tip;
      bulges![seg] = bulgeOfSweep(sw);
      return { geometry: { kind: 'polyline', pts, bulges: bulges! } };
    }
    const tip = atEnd ? pts[n - 1] : pts[0];
    const prev = atEnd ? pts[n - 2] : pts[1];
    const len = Math.hypot(tip.x - prev.x, tip.y - prev.y);
    if (len < 1e-12) return { error: 'Sıfır uzunluklu kenar uzatılamaz.' };
    const dir = { x: (tip.x - prev.x) / len, y: (tip.y - prev.y) / len };
    let best = Infinity;
    for (const b of boundaries) for (const t of rayEdge(tip, dir, b, 1e-7)) best = Math.min(best, t);
    if (!Number.isFinite(best)) return { error: 'Bu doğrultuda ulaşılacak bir sınır yok.' };
    const np = { x: tip.x + dir.x * best, y: tip.y + dir.y * best };
    if (atEnd) pts[n - 1] = np;
    else pts[0] = np;
    if (target.kind === 'line') return { geometry: { kind: 'line', a: pts[0], b: pts[1] } };
    return { geometry: bulges ? { kind: 'polyline', pts, bulges } : { kind: 'polyline', pts } };
  }
  if (target.kind === 'arc') {
    const toStart = Math.hypot(pick.x - (target.c.x + Math.cos(target.a0) * target.r), pick.y - (target.c.y + Math.sin(target.a0) * target.r));
    const toEnd = Math.hypot(pick.x - (target.c.x + Math.cos(target.a1) * target.r), pick.y - (target.c.y + Math.sin(target.a1) * target.r));
    const atEnd = toEnd <= toStart;
    const gap = TAU - normAngle(target.a1 - target.a0);
    const best = arcReach(target.c, target.r, atEnd ? target.a1 : target.a0, atEnd, gap, boundaries);
    if (best === null) return { error: 'Bu yönde ulaşılacak bir sınır yok.' };
    return { geometry: { kind: 'arc', c: target.c, r: target.r, a0: atEnd ? target.a0 : normAngle(target.a0 - best), a1: atEnd ? normAngle(target.a1 + best) : target.a1 } };
  }
  return { error: 'Yalnızca çizgi, açık çoklu çizgi, yay ve eliptik yay uzatılabilir.' };
}

/**
 * Smallest angle (< `gap`) by which an arc end at `from` can grow —
 * counter-clockwise when `ccw` — before it meets a boundary.
 */
function arcReach(c: Vec2, r: number, from: number, ccw: boolean, gap: number, boundaries: readonly Edge[]): number | null {
  let best = Infinity;
  for (const b of boundaries) {
    for (const p of circleHits(c, r, b)) {
      const th = Math.atan2(p.y - c.y, p.x - c.x);
      const delta = ccw ? normAngle(th - from) : normAngle(from - th);
      if (delta > 1e-9 && delta < gap - 1e-9) best = Math.min(best, delta);
    }
  }
  return Number.isFinite(best) ? best : null;
}

/** Intersections of a full circle with an edge (boundary side bounded). */
function circleHits(c: Vec2, r: number, b: Edge): Vec2[] {
  if (b.kind === 'seg') {
    return lineCircleParams(b.a, b.b, c, r)
      .filter((t) => t >= -1e-9 && t <= 1 + 1e-9)
      .map((t) => pointAt(b, t));
  }
  return circleCircle(c, r, b.c, b.r).filter((p) => onEdgeArc(b, Math.atan2(p.y - b.c.y, p.x - b.c.x)));
}
