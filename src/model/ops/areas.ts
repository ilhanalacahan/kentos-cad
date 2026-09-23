import type { Entity, EntityGeometry, RingGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { arcEnd, arcStart } from '../geom/arc';
import { hasBulges } from '../geom/bulge';
import { isFullEllipse, tessellateEllipse } from '../geom/ellipse';
import type { Area, Ring, Source } from '../geom/region';
import { catmullRom } from '../geom/spline';
import { entityEdges } from './edges';

/**
 * Entities ↔ areas for the area tools (Alan işlemleri). Polygons and
 * circles convert exactly (a circle is two half-circle bulges); a full
 * ellipse or a closed spline becomes a fine polygon, within 1 mm of the
 * curve, since the result is an area of straight and circular edges.
 */

/** Chord deviation allowed when a curve has to become straight edges (m). */
const CURVE_TOL = 1e-3;
/** Polyline ends closer than this count as closed. */
const CLOSE_TOL = 1e-6;

const ring = (pts: Vec2[], bulges?: number[]): Ring => (hasBulges(bulges) ? { pts, bulges } : { pts });

/** The area an entity encloses, or null for open or non-area entities. Hatches are fills, not areas. */
export function areaOfEntity(e: EntityGeometry): Area | null {
  switch (e.kind) {
    case 'polygon':
      return e.pts.length >= 2 ? { outer: ring(e.pts, e.bulges), holes: (e.holes ?? []).map((h) => ring(h.pts, h.bulges)) } : null;
    case 'circle':
      return { outer: { pts: [{ x: e.c.x + e.r, y: e.c.y }, { x: e.c.x - e.r, y: e.c.y }], bulges: [1, 1] }, holes: [] };
    case 'ellipse': {
      if (!isFullEllipse(e)) return null;
      const a = Math.hypot(e.major.x, e.major.y);
      // Sagitta a·(π/n)²/2 ≤ tolerance.
      const n = Math.min(4096, Math.max(64, Math.ceil(Math.PI / Math.sqrt((2 * CURVE_TOL) / a))));
      return { outer: { pts: tessellateEllipse(e, n) }, holes: [] };
    }
    case 'spline':
      return e.closed && e.pts.length >= 3 ? { outer: { pts: catmullRom(e.pts, true, 32).slice(0, -1) }, holes: [] } : null;
    case 'polyline': {
      const n = e.pts.length;
      if (n < 3) return null;
      const f = e.pts[0];
      const l = e.pts[n - 1];
      if (Math.hypot(f.x - l.x, f.y - l.y) > CLOSE_TOL) return null;
      // Drop the repeated end; the last segment's bulge becomes the closing one.
      return { outer: ring(e.pts.slice(0, -1), e.bulges?.slice(0, n - 1)), holes: [] };
    }
    default:
      return null;
  }
}

/** Polygon geometry of an area (holes only when there are some). */
export function polygonOfArea(a: Area): EntityGeometry {
  const holes: RingGeometry[] = a.holes.map((h) => ({ ...h }));
  return { kind: 'polygon', ...a.outer, ...(holes.length && { holes }) };
}

/** A polygon's rings as closed polylines (first point repeated at the end): outer first, then holes. */
export function polylinesOfPolygon(e: Extract<EntityGeometry, { kind: 'polyline' | 'polygon' }>): EntityGeometry[] {
  return [e, ...(e.holes ?? [])].map((r) => {
    const pts = [...r.pts, r.pts[0]];
    const bulges = hasBulges(r.bulges) ? [...r.pts.map((_, i) => r.bulges?.[i] ?? 0), 0] : undefined;
    return bulges ? { kind: 'polyline', pts, bulges } : { kind: 'polyline', pts };
  });
}

/** Line work as an overlay source (cut lines, boundaries of "click inside"). */
export function lineSource(entities: readonly Entity[]): Source {
  const edges = entities.flatMap((e) => entityEdges(e));
  const points: Vec2[] = [];
  for (const e of entities) {
    if (e.kind === 'line') points.push(e.a, e.b);
    else if (e.kind === 'polyline' || e.kind === 'polygon') points.push(...e.pts, ...(e.kind === 'polygon' ? (e.holes ?? []).flatMap((h) => h.pts) : []));
    else if (e.kind === 'arc') points.push(arcStart(e), arcEnd(e));
  }
  return { edges, points, cut: true };
}
