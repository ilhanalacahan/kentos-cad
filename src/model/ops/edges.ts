import type { Entity } from '../entities';
import type { Vec2 } from '../geometry';
import { sweep } from '../geom/arc';
import { bulgePathEdges } from '../geom/bulge';
import { layoutDimension } from '../geom/dimension';
import { catmullRom } from '../geom/spline';
import { fullCircle, type Edge } from '../geom/intersect';

/** Decomposes an entity into primitive edges (points and text have none). */
export function entityEdges(e: Entity): Edge[] {
  switch (e.kind) {
    case 'line':
      return [{ kind: 'seg', a: e.a, b: e.b }];
    case 'polyline':
    case 'polygon':
      return bulgePathEdges(e.pts, e.bulges, e.kind === 'polygon');
    case 'spline':
      // The tessellated curve already ends on its first point when closed.
      return pathEdges(catmullRom(e.pts, e.closed), false);
    case 'hatch':
      return pathEdges(e.ring, true);
    case 'dimension': {
      const l = layoutDimension(e);
      return l ? [{ kind: 'seg', a: l.d1, b: l.d2 }] : [];
    }
    case 'circle':
      return [fullCircle(e.c, e.r)];
    case 'arc':
      return [{ kind: 'arc', c: e.c, r: e.r, a0: e.a0, sweep: sweep(e.a0, e.a1) }];
    default:
      return [];
  }
}

export const edgeLength = (e: Edge) => (e.kind === 'seg' ? Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) : e.r * Math.abs(e.sweep));

function pathEdges(pts: readonly Vec2[], closed: boolean): Edge[] {
  const out: Edge[] = [];
  const n = pts.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) out.push({ kind: 'seg', a: pts[i], b: pts[(i + 1) % n] });
  return out;
}
