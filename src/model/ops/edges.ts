import { CONSTRUCTION_REACH, type Entity } from '../entities';
import { isFullEllipse, tessellateEllipse } from '../geom/ellipse';
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
      return bulgePathEdges(e.pts, e.bulges, false);
    case 'polygon':
      return [...bulgePathEdges(e.pts, e.bulges, true), ...(e.holes ?? []).flatMap((h) => bulgePathEdges(h.pts, h.bulges, true))];
    case 'spline':
      // The tessellated curve already ends on its first point when closed.
      return pathEdges(catmullRom(e.pts, e.closed), false);
    case 'hatch':
      return [...pathEdges(e.ring, true), ...(e.holes ?? []).flatMap((h) => pathEdges(h, true))];
    case 'dimension': {
      return layoutDimension(e)?.pick ?? [];
    }
    case 'circle':
      return [fullCircle(e.c, e.r)];
    case 'arc':
      return [{ kind: 'arc', c: e.c, r: e.r, a0: e.a0, sweep: sweep(e.a0, e.a1) }];
    case 'ellipse': {
      // Fine chords for boundaries and nearest points; crossings are refined onto the curve (picking, trim).
      return pathEdges(tessellateEllipse(e, 256), isFullEllipse(e));
    }
    case 'xline':
    case 'ray': {
      const r = CONSTRUCTION_REACH;
      const a = e.kind === 'ray' ? e.p : { x: e.p.x - e.dir.x * r, y: e.p.y - e.dir.y * r };
      return [{ kind: 'seg', a, b: { x: e.p.x + e.dir.x * r, y: e.p.y + e.dir.y * r } }];
    }
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
