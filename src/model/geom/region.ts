import type { Vec2 } from '../geometry';
import { bulgePathEdges, bulgeRingArea, hasBulges, reverseBulgePath } from './bulge';
import type { Edge } from './intersect';
import { faceRings, overlay, winding, type Area, type Ring, type Source } from './overlay';

/**
 * Area algebra on top of the overlay engine: union, intersection,
 * difference, splitting by lines, and the faces that line work encloses.
 * Areas are exact (arcs stay arcs) and may have holes.
 */

export type { Area, Ring, Source };

export const ringArea = (r: Ring) => bulgeRingArea(r.pts, r.bulges);
export const ringEdges = (r: Ring): Edge[] => bulgePathEdges(r.pts, r.bulges, true);

/** The ring running counter-clockwise (`ccw`) or clockwise. */
export function orientRing(r: Ring, ccw: boolean): Ring {
  if (ringArea(r) > 0 === ccw) return r;
  const rev = reverseBulgePath(r.pts, r.bulges, true);
  return hasBulges(rev.bulges) ? rev : { pts: rev.pts };
}

/** Net area: outer ring minus holes (m²). */
export function netArea(a: Area): number {
  return Math.abs(ringArea(a.outer)) - a.holes.reduce((s, h) => s + Math.abs(ringArea(h)), 0);
}

/** Whether p lies inside the area (inside the outer ring, outside every hole). */
export function insideArea(a: Area, p: Vec2): boolean {
  if (winding(ringEdges(a.outer), p) === 0) return false;
  return !a.holes.some((h) => winding(ringEdges(h), p) !== 0);
}

/** Overlay source of areas: outer rings counter-clockwise, holes clockwise. */
export function areaSource(list: readonly Area[]): Source {
  const edges: Edge[] = [];
  const points: Vec2[] = [];
  for (const a of list) {
    for (const r of [orientRing(a.outer, true), ...a.holes.map((h) => orientRing(h, false))]) {
      edges.push(...ringEdges(r));
      points.push(...r.pts);
    }
  }
  return { edges, points };
}

/** Everything covered by any of the areas. */
export function unionAreas(list: readonly Area[]): Area[] {
  if (!list.length) return [];
  return overlay(
    list.map((a) => areaSource([a])),
    (inside) => inside.some(Boolean),
  );
}

/** What all the areas have in common. */
export function intersectAreas(list: readonly Area[]): Area[] {
  if (list.length < 2) return [...list];
  return overlay(
    list.map((a) => areaSource([a])),
    (inside) => inside.every(Boolean),
  );
}

/** `from` with everything covered by `cutters` removed. */
export function subtractAreas(from: readonly Area[], cutters: readonly Area[]): Area[] {
  if (!cutters.length) return [...from];
  return overlay([areaSource(from), areaSource(cutters)], ([a, b]) => a && !b);
}

/**
 * The area cut along lines. A line has to cross the area (or meet another
 * line) to cut; a line ending inside leaves the area whole there.
 */
export function splitArea(a: Area, cut: Source): Area[] {
  return overlay([areaSource([a]), { ...cut, cut: true }], ([inside]) => inside);
}

/**
 * The face of the line work around `p`, or null when `p` is outside every
 * closed shape. With `islands`, closed groups inside the face become holes
 * (a building inside a parcel boundary).
 */
export function faceAt(lines: readonly Source[], p: Vec2, islands = true): Area | null {
  const rs = faceRings(lines);
  const outers = rs.filter((r) => r.area > 0).sort((a, b) => a.area - b.area);
  const outer = outers.find((r) => r.contains(p));
  if (!outer) return null;
  const holes = islands ? rs.filter((r) => r.area < 0 && outers.find((o) => o.contains(r.probe)) === outer).map((r) => r.ring) : [];
  return { outer: outer.ring, holes };
}

/** Every bounded face of the line work, each with the groups inside it as holes. */
export function allFaces(lines: readonly Source[]): Area[] {
  const rs = faceRings(lines);
  const outers = rs.filter((r) => r.area > 0).sort((a, b) => a.area - b.area);
  const holes = new Map(outers.map((o) => [o, [] as Ring[]]));
  for (const r of rs) {
    if (r.area >= 0) continue;
    const host = outers.find((o) => o.contains(r.probe));
    if (host) holes.get(host)!.push(r.ring);
  }
  return outers.map((o) => ({ outer: o.ring, holes: holes.get(o)! }));
}
