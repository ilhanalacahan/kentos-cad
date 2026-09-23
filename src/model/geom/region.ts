import type { Vec2 } from '../geometry';
import { bulgePathEdges, bulgeRingArea, hasBulges, reverseBulgePath } from './bulge';
import type { Edge } from './intersect';
import { faceRings, overlay, winding, type Area, type FaceRing, type Ring, type Source } from './overlay';

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

/** Faces of line work, computed once and queried many times (hover previews). */
export interface FaceIndex {
  /**
   * The face around `p`, or null when `p` is outside every closed shape.
   * With `islands`, closed groups inside the face become holes (a
   * building inside a parcel boundary).
   */
  at(p: Vec2, islands?: boolean): Area | null;
  /** Every bounded face, each with the groups inside it as holes. */
  all(): Area[];
}

export function faceIndex(lines: readonly Source[]): FaceIndex {
  const rs = faceRings(lines);
  const inBox = (r: FaceRing, p: Vec2) => p.x >= r.box.minX && p.x <= r.box.maxX && p.y >= r.box.minY && p.y <= r.box.maxY;
  const outers = rs.filter((r) => r.area > 0).sort((a, b) => a.area - b.area);
  // The face a group outline belongs to: the smallest face around a point just outside it.
  const container = new Map<FaceRing, FaceRing | undefined>();
  const host = (r: FaceRing) => {
    if (!container.has(r)) container.set(r, outers.find((o) => inBox(o, r.probe) && o.contains(r.probe)));
    return container.get(r);
  };
  const groups = rs.filter((r) => r.area < 0);
  const holesOf = (outer: FaceRing) => groups.filter((r) => inBox(outer, r.probe) && host(r) === outer).map((r) => r.ring);
  return {
    at(p, islands = true) {
      const outer = outers.find((r) => inBox(r, p) && r.contains(p));
      return outer ? { outer: outer.ring, holes: islands ? holesOf(outer) : [] } : null;
    },
    all: () => outers.map((o) => ({ outer: o.ring, holes: holesOf(o) })),
  };
}

/** The face of the line work around `p` (see FaceIndex.at). */
export const faceAt = (lines: readonly Source[], p: Vec2, islands = true): Area | null => faceIndex(lines).at(p, islands);

/** Every bounded face of the line work, each with the groups inside it as holes. */
export const allFaces = (lines: readonly Source[]): Area[] => faceIndex(lines).all();
