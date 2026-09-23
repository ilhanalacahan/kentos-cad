import { signedArea, type Vec2 } from '../model/geometry';

/**
 * Ear-clipping triangulation of a ring with holes, written as
 * origin-relative triangles into `out`. Holes are first joined to the outer
 * ring by bridges (Eberly, "Triangulation by Ear Clipping"), giving one
 * weakly simple ring for the ear clipper. Fine for parcel and building
 * rings; very large rings belong in a worker (CLAUDE.md §6.2).
 */
export function triangulate(outer: readonly Vec2[], holes: readonly (readonly Vec2[])[], origin: Vec2, out: number[]): void {
  let ring = orient(outer, true);
  // Rightmost holes first: a later bridge then never has to cross an earlier one.
  const hs = holes
    .filter((h) => h.length >= 3)
    .map((h) => orient(h, false))
    .map((h) => ({ h, m: rightmost(h) }))
    .sort((a, b) => b.h[b.m].x - a.h[a.m].x);
  for (const { h, m } of hs) ring = bridge(ring, h, m);
  earClip(ring, origin, out);
}

function orient(pts: readonly Vec2[], ccw: boolean): Vec2[] {
  return signedArea(pts) > 0 === ccw ? [...pts] : [...pts].reverse();
}

function rightmost(pts: readonly Vec2[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].x > pts[m].x || (pts[i].x === pts[m].x && pts[i].y < pts[m].y)) m = i;
  return m;
}

const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const same = (p: Vec2, q: Vec2) => p.x === q.x && p.y === q.y;

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/**
 * Joins a clockwise hole to a counter-clockwise ring: from the hole's
 * rightmost vertex M a ray to the right meets the ring at I on an edge;
 * the edge's right end P is visible from M unless a reflex vertex lies in
 * triangle M-I-P, in which case the one closest in angle to the ray is.
 */
function bridge(ring: Vec2[], hole: Vec2[], mi: number): Vec2[] {
  const M = hole[mi];
  let bestX = Infinity;
  let edge = -1;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    if (a.y === b.y || M.y < Math.min(a.y, b.y) || M.y > Math.max(a.y, b.y)) continue;
    const x = a.x + ((M.y - a.y) * (b.x - a.x)) / (b.y - a.y);
    if (x >= M.x && x < bestX) {
      bestX = x;
      edge = i;
    }
  }
  if (edge < 0) return ring; // hole outside the ring: nothing sensible to join
  const I = { x: bestX, y: M.y };
  let pi = ring[edge].x >= ring[(edge + 1) % n].x ? edge : (edge + 1) % n;
  const P = ring[pi];
  if (!same(P, I)) {
    let bestAngle = Infinity;
    let bestDist = Infinity;
    // M, I, P as a counter-clockwise triangle for the inside test.
    const [t0, t1, t2] = cross(M, I, P) >= 0 ? [M, I, P] : [M, P, I];
    for (let i = 0; i < n; i++) {
      if (i === pi) continue;
      const v = ring[i];
      const reflex = cross(ring[(i - 1 + n) % n], v, ring[(i + 1) % n]) < 0;
      if (!reflex || !inTriangle(v, t0, t1, t2)) continue;
      const ang = Math.abs(Math.atan2(v.y - M.y, v.x - M.x));
      const d = Math.hypot(v.x - M.x, v.y - M.y);
      if (ang < bestAngle - 1e-12 || (Math.abs(ang - bestAngle) <= 1e-12 && d < bestDist)) {
        bestAngle = ang;
        bestDist = d;
        pi = i;
      }
    }
  }
  return [...ring.slice(0, pi + 1), ...hole.slice(mi), ...hole.slice(0, mi + 1), ring[pi], ...ring.slice(pi + 1)];
}

/** Ear clipping of a counter-clockwise (weakly simple) ring. */
function earClip(pts: readonly Vec2[], origin: Vec2, out: number[]): void {
  const idx = [...Array(pts.length).keys()];
  const emit = (a: Vec2, b: Vec2, c: Vec2) => out.push(a.x - origin.x, a.y - origin.y, b.x - origin.x, b.y - origin.y, c.x - origin.x, c.y - origin.y);
  let guard = 0;
  while (idx.length > 3 && guard++ < 100_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (cross(a, b, c) <= 0) continue;
      let ear = true;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        const p = pts[k];
        // Bridge ends appear twice; a copy of a corner does not block the ear.
        if (same(p, a) || same(p, b) || same(p, c)) continue;
        if (inTriangle(p, a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      emit(a, b, c);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Only flat (zero-area) corners left, e.g. a bridge's two edges: drop one.
      const flat = idx.findIndex((ib, i) => cross(pts[idx[(i - 1 + idx.length) % idx.length]], pts[ib], pts[idx[(i + 1) % idx.length]]) === 0);
      if (flat < 0) return; // degenerate ring; drop the remainder
      idx.splice(flat, 1);
    }
  }
  if (idx.length === 3) {
    const [a, b, c] = idx.map((i) => pts[i]);
    if (cross(a, b, c) > 0) emit(a, b, c);
  }
}
