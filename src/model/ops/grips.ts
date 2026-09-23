import type { Entity } from '../entities';
import type { Vec2 } from '../geometry';
import { arcEnd, arcMid, arcStart, arcThrough } from '../geom/arc';
import { translation } from '../geom/affine';
import { bulgeAt, bulgeThrough, isArcBulge, segmentMid } from '../geom/bulge';
import { dimensionOffsetAt, layoutDimension } from '../geom/dimension';
import { closestParam, ellipseFromCenter, ellipsePoint, isFullEllipse } from '../geom/ellipse';
import { transformEntity } from './transform';

/** Construction lines show their direction grip this far (m) from the base point. */
const DIRECTION_GRIP = 10;

/**
 * Grip points of an entity, in a stable order that `moveGrip` understands.
 *   line: a, b · path: vertices, then one mid grip per segment, then
 *   the vertices of each hole (polygon)
 *   circle: centre, 4 quadrants · arc: start, mid, end, centre
 *   point/text: insertion point · spline: fit points
 *   dimension: a, b, dimension line (arc, leader end), vertex (angular) · hatch: ring
 */
export function entityGrips(e: Entity): Vec2[] {
  switch (e.kind) {
    case 'point':
    case 'text':
      return [e.p];
    case 'line':
      return [e.a, e.b];
    case 'polyline':
    case 'polygon': {
      const n = e.pts.length;
      const mids: Vec2[] = [];
      for (let i = 0; i < (e.kind === 'polygon' ? n : n - 1); i++) mids.push(segmentMid(e.pts[i], e.pts[(i + 1) % n], bulgeAt(e.bulges, i)));
      return [...e.pts, ...mids, ...(e.kind === 'polygon' ? (e.holes ?? []).flatMap((h) => h.pts) : [])];
    }
    case 'circle':
      return [e.c, { x: e.c.x + e.r, y: e.c.y }, { x: e.c.x, y: e.c.y + e.r }, { x: e.c.x - e.r, y: e.c.y }, { x: e.c.x, y: e.c.y - e.r }];
    case 'arc':
      return [arcStart(e), arcMid(e), arcEnd(e), e.c];
    case 'ellipse': {
      if (!isFullEllipse(e)) return [e.c, ellipsePoint(e, e.t0), ellipsePoint(e, e.t1)];
      return [e.c, ...[0, 1, 2, 3].map((k) => ellipsePoint(e, (k * Math.PI) / 2))];
    }
    case 'xline':
    case 'ray':
      return [e.p, { x: e.p.x + e.dir.x * DIRECTION_GRIP, y: e.p.y + e.dir.y * DIRECTION_GRIP }];
    case 'spline':
      return e.pts;
    case 'hatch':
      return e.ring;
    case 'dimension': {
      const l = layoutDimension(e);
      return l ? [e.a, e.b, l.handle, ...(e.c ? [e.c] : [])] : [e.a, e.b];
    }
  }
}

/** Entity with grip `index` moved to `p` (same id), or null if the result would be degenerate. */
export function moveGrip<E extends Entity>(e: E, index: number, p: Vec2): E | null {
  switch (e.kind) {
    case 'point':
    case 'text':
      return { ...e, p };
    case 'line':
      return index === 0 ? { ...e, a: p } : { ...e, b: p };
    case 'polyline':
    case 'polygon': {
      const hole = holeGrip(e, index);
      if (hole) {
        const holes = (e.holes ?? []).map((h, k) => (k === hole.hole ? { ...h, pts: h.pts.map((q, i) => (i === hole.vertex ? p : q)) } : h));
        return { ...e, holes };
      }
      const seg = midGripSegment(e, index);
      if (seg === null) return { ...e, pts: e.pts.map((q, i) => (i === index ? p : q)) };
      const n = e.pts.length;
      const a = e.pts[seg];
      const b = e.pts[(seg + 1) % n];
      // Arc segment: the arc now passes through p. Straight: p becomes a new vertex.
      if (isArcBulge(bulgeAt(e.bulges, seg))) {
        const bulge = bulgeThrough(a, p, b);
        const bulges = e.pts.map((_, i) => (i === seg ? bulge : bulgeAt(e.bulges, i)));
        return { ...e, bulges };
      }
      const pts = [...e.pts.slice(0, seg + 1), p, ...e.pts.slice(seg + 1)];
      const bulges = e.bulges ? [...e.bulges.slice(0, seg + 1), 0, ...e.bulges.slice(seg + 1)] : undefined;
      return bulges ? { ...e, pts, bulges } : { ...e, pts };
    }
    case 'circle': {
      if (index === 0) return { ...e, c: p };
      const r = Math.hypot(p.x - e.c.x, p.y - e.c.y);
      return r > 1e-9 ? { ...e, r } : null;
    }
    case 'arc': {
      if (index === 3) return transformEntity(e, translation(p.x - e.c.x, p.y - e.c.y));
      // The arc keeps passing through its other two defining points.
      const pts = [arcStart(e), arcMid(e), arcEnd(e)];
      pts[index] = p;
      const g = arcThrough(pts[0], pts[1], pts[2]);
      return g ? { ...e, ...g } : null;
    }
    case 'ellipse': {
      if (index === 0) return transformEntity(e, translation(p.x - e.c.x, p.y - e.c.y));
      if (!isFullEllipse(e)) {
        // Arc ends slide along the ellipse.
        const t = closestParam({ ...e, t0: 0, t1: 0 }, p);
        return index === 1 ? { ...e, t0: t } : { ...e, t1: t };
      }
      const a = Math.hypot(e.major.x, e.major.y);
      const b = a * e.ratio;
      const d = Math.hypot(p.x - e.c.x, p.y - e.c.y);
      // Axis ends: 1/3 re-aim and resize the major axis, 2/4 resize the minor one.
      const g =
        index === 1 || index === 3
          ? ellipseFromCenter(e.c, index === 1 ? p : { x: 2 * e.c.x - p.x, y: 2 * e.c.y - p.y }, b)
          : ellipseFromCenter(e.c, { x: e.c.x + e.major.x, y: e.c.y + e.major.y }, d);
      return g ? { ...e, ...g } : null;
    }
    case 'xline':
    case 'ray': {
      if (index === 0) return { ...e, p };
      const l = Math.hypot(p.x - e.p.x, p.y - e.p.y);
      return l > 1e-9 ? { ...e, dir: { x: (p.x - e.p.x) / l, y: (p.y - e.p.y) / l } } : null;
    }
    case 'spline':
      return { ...e, pts: e.pts.map((q, i) => (i === index ? p : q)) };
    case 'hatch':
      return { ...e, ring: e.ring.map((q, i) => (i === index ? p : q)) };
    case 'dimension': {
      if (index === 0) return Math.hypot(e.b.x - p.x, e.b.y - p.y) > 1e-9 ? { ...e, a: p } : null;
      if (index === 1) return Math.hypot(p.x - e.a.x, p.y - e.a.y) > 1e-9 ? { ...e, b: p } : null;
      if (index === 3) return { ...e, c: p };
      return { ...e, offset: dimensionOffsetAt(e, p) };
    }
  }
}

const segmentCount = (e: { kind: string; pts: Vec2[] }) => (e.kind === 'polygon' ? e.pts.length : e.pts.length - 1);

/** Segment index of a path's mid grip (grip indices after the vertices), else null. */
export function midGripSegment(e: Entity, index: number): number | null {
  if (e.kind !== 'polyline' && e.kind !== 'polygon') return null;
  const n = e.pts.length;
  return index >= n && index < n + segmentCount(e) ? index - n : null;
}

/** Hole and vertex of a polygon's hole grip (after the outer vertices and mid grips), else null. */
export function holeGrip(e: Entity, index: number): { hole: number; vertex: number } | null {
  if (e.kind !== 'polygon' || !e.holes) return null;
  let i = index - 2 * e.pts.length;
  if (i < 0) return null;
  for (let hole = 0; hole < e.holes.length; hole++) {
    if (i < e.holes[hole].pts.length) return { hole, vertex: i };
    i -= e.holes[hole].pts.length;
  }
  return null;
}
