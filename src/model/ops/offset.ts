import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { hasBulges } from '../geom/bulge';
import { closestOnEdge } from '../geom/intersect';
import { offsetBulgePath, offsetPath, sideOf } from '../geom/offset';
import { offsetConstruction, offsetEllipse } from './curveCuts';
import { entityEdges } from './edges';

export type OffsetResult = { geometry: EntityGeometry } | { error: string };

/**
 * Parallel copy at `distance`, on the side of `through`. Circles and arcs
 * grow or shrink concentrically; paths are offset with mitred corners.
 */
export function offsetEntity(e: Entity, distance: number, through: Vec2): OffsetResult {
  if (!(distance > 0)) return { error: 'Öteleme mesafesi sıfırdan büyük olmalı.' };
  switch (e.kind) {
    case 'line': {
      const side = sideOf([e.a, e.b], false, through);
      const [a, b] = offsetPath([e.a, e.b], side * distance, false);
      return { geometry: { kind: 'line', a, b } };
    }
    case 'polyline':
    case 'polygon': {
      const closed = e.kind === 'polygon';
      if (hasBulges(e.bulges)) {
        const r = offsetBulgePath(e.pts, e.bulges!, bulgedSide(e, through) * distance, closed);
        return 'error' in r ? r : { geometry: { kind: e.kind, ...r } };
      }
      const side = sideOf(e.pts, closed, through);
      const pts = offsetPath(e.pts, side * distance, closed);
      return pts.length >= 2 ? { geometry: { kind: e.kind, pts } } : { error: 'Öteleme sonucu geçerli bir şekil oluşmadı.' };
    }
    case 'circle':
    case 'arc': {
      const outside = Math.hypot(through.x - e.c.x, through.y - e.c.y) > e.r;
      const r = e.r + (outside ? distance : -distance);
      if (r <= 1e-9) return { error: 'Yarıçap sıfırın altına düşüyor; daha küçük bir mesafe girin.' };
      return { geometry: e.kind === 'circle' ? { kind: 'circle', c: e.c, r } : { kind: 'arc', c: e.c, r, a0: e.a0, a1: e.a1 } };
    }
    case 'ellipse':
      return offsetEllipse(e, distance, through);
    case 'xline':
    case 'ray':
      return offsetConstruction(e, distance, through);
    default:
      return { error: 'Yalnızca çizgi, çoklu çizgi, kapalı alan, daire, yay, elips ve yardımcı çizgiler ötelenebilir.' };
  }
}

/** Side of a bulged path a point lies on (+1 left of travel), judged at the nearest edge. */
function bulgedSide(e: Entity, p: Vec2): 1 | -1 {
  let best = { d: Infinity, side: 1 as 1 | -1 };
  for (const ed of entityEdges(e)) {
    const c = closestOnEdge(ed, p);
    if (c.d >= best.d) continue;
    let side: 1 | -1;
    if (ed.kind === 'seg') side = (ed.b.x - ed.a.x) * (p.y - ed.a.y) - (ed.b.y - ed.a.y) * (p.x - ed.a.x) >= 0 ? 1 : -1;
    else {
      // Inside the circle is left of a counter-clockwise arc.
      const inside = Math.hypot(p.x - ed.c.x, p.y - ed.c.y) < ed.r;
      side = inside === ed.sweep > 0 ? 1 : -1;
    }
    best = { d: c.d, side };
  }
  return best.side;
}
