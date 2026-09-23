import type { Vec2 } from '../geometry';
import { normAngle } from './arc';
import { bulgeArc, bulgeOfSweep, cleanBulgePath } from './bulge';
import { circleCircle, lineCircleParams, lineLine } from './intersect';

/** Beyond this multiple of the offset distance a corner is bevelled, not mitred. */
const MITER_LIMIT = 4;

/**
 * Offsets a polyline by `d` (positive = left of the travel direction).
 * Corners are mitred; very sharp corners get a bevel so the result never
 * shoots far away from the source.
 */
export function offsetPath(pts: readonly Vec2[], d: number, closed: boolean): Vec2[] {
  const n = pts.length;
  if (n < 2) return [...pts];
  const segCount = closed ? n : n - 1;
  const segs: { a: Vec2; b: Vec2 }[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-12) continue;
    const nx = (-dy / l) * d;
    const ny = (dx / l) * d;
    segs.push({ a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny } });
  }
  if (!segs.length) return [];
  const out: Vec2[] = [];
  const join = (s1: { a: Vec2; b: Vec2 }, s2: { a: Vec2; b: Vec2 }, corner: Vec2) => {
    const h = lineLine(s1.a, s1.b, s2.a, s2.b);
    if (!h) return void out.push(s2.a); // collinear
    if (Math.hypot(h.p.x - corner.x, h.p.y - corner.y) > MITER_LIMIT * Math.abs(d)) out.push(s1.b, s2.a);
    else out.push(h.p);
  };
  if (closed) {
    for (let i = 0; i < segs.length; i++) join(segs[(i - 1 + segs.length) % segs.length], segs[i], pts[i]);
  } else {
    out.push(segs[0].a);
    for (let i = 1; i < segs.length; i++) join(segs[i - 1], segs[i], pts[i]);
    out.push(segs[segs.length - 1].b);
  }
  return out;
}

/** Which side of a path a point lies on: +1 left, −1 right (nearest segment decides). */
export function sideOf(pts: readonly Vec2[], closed: boolean, p: Vec2): 1 | -1 {
  let best = Infinity;
  let side: 1 | -1 = 1;
  const n = pts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best) {
      best = d;
      side = dx * (p.y - a.y) - dy * (p.x - a.x) >= 0 ? 1 : -1;
    }
  }
  return side;
}

interface OffsetPiece {
  a: Vec2;
  b: Vec2;
  /** Arc pieces keep their circle and turning direction; endpoints may move at joins. */
  arc: { c: Vec2; r: number; ccw: boolean } | null;
}

/**
 * Offsets a path with arc segments (DXF bulges) by `d` (positive = left of
 * travel). Lines shift along their normal, arcs grow or shrink about their
 * centre; neighbours meet where their supporting line/circle cross (nearest
 * to the source corner) or get a straight bevel when they do not.
 */
export function offsetBulgePath(pts: readonly Vec2[], bulges: readonly number[], d: number, closed: boolean): { pts: Vec2[]; bulges: number[] } | { error: string } {
  const n = pts.length;
  const count = closed ? n : n - 1;
  const pieces: OffsetPiece[] = [];
  const corners: Vec2[] = [];
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const arc = bulgeArc(a, b, bulges[i] ?? 0);
    if (arc) {
      const ccw = arc.sweep > 0;
      // Left of a counter-clockwise arc is its centre side.
      const r = arc.r + (ccw ? -d : d);
      if (r <= 1e-9) return { error: 'Öteleme mesafesi bir yay parçasının yarıçapından büyük.' };
      const k = r / arc.r;
      const scale = (p: Vec2) => ({ x: arc.c.x + (p.x - arc.c.x) * k, y: arc.c.y + (p.y - arc.c.y) * k });
      pieces.push({ a: scale(a), b: scale(b), arc: { c: arc.c, r, ccw } });
    } else {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-12) continue;
      const nx = (-dy / l) * d;
      const ny = (dx / l) * d;
      pieces.push({ a: { x: a.x + nx, y: a.y + ny }, b: { x: b.x + nx, y: b.y + ny }, arc: null });
    }
    corners.push(b);
  }
  if (!pieces.length) return { error: 'Öteleme sonucu geçerli bir şekil oluşmadı.' };

  // Joins: piece k ends where piece k+1 starts (corner = source vertex between them).
  const bevels = new Map<number, boolean>();
  const joins = closed ? pieces.length : pieces.length - 1;
  for (let k = 0; k < joins; k++) {
    const p1 = pieces[k];
    const p2 = pieces[(k + 1) % pieces.length];
    if (Math.hypot(p1.b.x - p2.a.x, p1.b.y - p2.a.y) < 1e-9) continue; // tangent continuation
    const corner = corners[k];
    const hit = supportHits(p1, p2).sort((u, v) => Math.hypot(u.x - corner.x, u.y - corner.y) - Math.hypot(v.x - corner.x, v.y - corner.y))[0];
    if (hit && Math.hypot(hit.x - corner.x, hit.y - corner.y) <= MITER_LIMIT * Math.abs(d)) {
      p1.b = hit;
      p2.a = hit;
    } else bevels.set(k, true);
  }

  const outP: Vec2[] = [pieces[0].a];
  const outB: number[] = [];
  pieces.forEach((p, k) => {
    outB.push(p.arc ? arcBulge(p) : 0);
    outP.push(p.b);
    if (bevels.get(k) && (closed || k < pieces.length - 1)) {
      outB.push(0);
      outP.push(pieces[(k + 1) % pieces.length].a);
    }
  });
  if (closed) outP.pop(); // the ring closes on its first point
  else outB.push(0);
  const clean = cleanBulgePath(outP, outB, closed);
  return { pts: clean.pts, bulges: clean.bulges ?? new Array(clean.pts.length).fill(0) };
}

function arcBulge(p: OffsetPiece): number {
  const { c, ccw } = p.arc!;
  const s = Math.atan2(p.a.y - c.y, p.a.x - c.x);
  const e = Math.atan2(p.b.y - c.y, p.b.x - c.x);
  return bulgeOfSweep(ccw ? normAngle(e - s) : -normAngle(s - e));
}

/** Crossings of the supporting line/circle of two pieces (unbounded). */
function supportHits(p1: OffsetPiece, p2: OffsetPiece): Vec2[] {
  if (!p1.arc && !p2.arc) {
    const h = lineLine(p1.a, p1.b, p2.a, p2.b);
    return h ? [h.p] : [];
  }
  if (p1.arc && p2.arc) return circleCircle(p1.arc.c, p1.arc.r, p2.arc.c, p2.arc.r);
  const line = p1.arc ? p2 : p1;
  const circle = (p1.arc ?? p2.arc)!;
  return lineCircleParams(line.a, line.b, circle.c, circle.r).map((t) => ({ x: line.a.x + (line.b.x - line.a.x) * t, y: line.a.y + (line.b.y - line.a.y) * t }));
}
