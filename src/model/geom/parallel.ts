import { signedArea, type Vec2 } from '../geometry';
import { offsetPath } from './offset';
import type { Area } from './overlay';

/**
 * Netcad "Paralel çizgi": hatches beside an axis at a left and a right
 * distance (road edges beside the centre line, both faces of a wall).
 * Corners are mitred like Ötele; the corridor between the two sides can
 * also be read as one area.
 */

/** Axis without repeated points (a double click must not make a zero-length leg). */
export function cleanAxis(axis: readonly Vec2[], closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const p of axis) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) out.push(p);
  }
  if (closed && out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-9) out.pop();
  return out;
}

/**
 * The two sides: `left` metres left of the travel direction, `right`
 * metres right of it. A side at distance 0 is the axis itself (null).
 */
export function parallelSides(axis: readonly Vec2[], left: number, right: number, closed: boolean): { left: Vec2[] | null; right: Vec2[] | null } {
  const pts = cleanAxis(axis, closed);
  if (pts.length < (closed ? 3 : 2)) return { left: null, right: null };
  return {
    left: left > 0 ? offsetPath(pts, left, closed) : null,
    right: right > 0 ? offsetPath(pts, -right, closed) : null,
  };
}

/**
 * The corridor between the sides as an area. An open axis gives one ring
 * (left side out, right side back); a closed axis gives a ring with a hole.
 * Null when the corridor has no width or the axis is too short.
 */
export function corridorArea(axis: readonly Vec2[], left: number, right: number, closed: boolean): Area | null {
  if (!(left + right > 0)) return null;
  const pts = cleanAxis(axis, closed);
  if (pts.length < (closed ? 3 : 2)) return null;
  const l = left > 0 ? offsetPath(pts, left, closed) : pts;
  const r = right > 0 ? offsetPath(pts, -right, closed) : pts;
  if (!closed) {
    const ring = [...l, ...[...r].reverse()];
    return { outer: { pts: signedArea(ring) >= 0 ? ring : ring.reverse() }, holes: [] };
  }
  // A closed axis: the larger ring is the outline, the smaller one the hole.
  const [outer, hole] = Math.abs(signedArea(l)) >= Math.abs(signedArea(r)) ? [l, r] : [r, l];
  const ccw = (ring: Vec2[], want: boolean) => (signedArea(ring) > 0 === want ? ring : [...ring].reverse());
  return { outer: { pts: ccw(outer, true) }, holes: [{ pts: ccw(hole, false) }] };
}
