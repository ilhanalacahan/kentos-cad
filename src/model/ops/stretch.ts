import { entityGeometry, type Entity, type EntityGeometry } from '../entities';
import type { Bounds, Vec2 } from '../geometry';
import { arcEnd, arcMid, arcStart, arcThrough } from '../geom/arc';

const inside = (p: Vec2, r: Bounds) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/**
 * Stretch ("Esnet"): vertices inside the crossing window move by (dx, dy),
 * the rest stay; an entity entirely inside simply moves. Returns null when
 * nothing of the entity lies in the window.
 */
export function stretchEntity(e: Entity, r: Bounds, dx: number, dy: number): EntityGeometry | null {
  const mv = (p: Vec2) => (inside(p, r) ? { x: p.x + dx, y: p.y + dy } : p);
  const any = (pts: readonly Vec2[]) => pts.some((p) => inside(p, r));
  const geom = entityGeometry(e);
  switch (geom.kind) {
    case 'point':
    case 'text':
      return inside(geom.p, r) ? { ...geom, p: mv(geom.p) } : null;
    case 'line':
      return any([geom.a, geom.b]) ? { ...geom, a: mv(geom.a), b: mv(geom.b) } : null;
    case 'polyline':
    case 'spline':
      // Arc segments keep their bulge, so they bend with their moved ends.
      return any(geom.pts) ? { ...geom, pts: geom.pts.map(mv) } : null;
    case 'polygon': {
      const holes = geom.holes ?? [];
      if (!any(geom.pts) && !holes.some((h) => any(h.pts))) return null;
      return { ...geom, pts: geom.pts.map(mv), ...(geom.holes && { holes: holes.map((h) => ({ ...h, pts: h.pts.map(mv) })) }) };
    }
    case 'hatch':
      if (!any(geom.ring) && !(geom.holes ?? []).some(any)) return null;
      return { ...geom, ring: geom.ring.map(mv), ...(geom.holes && { holes: geom.holes.map((h) => h.map(mv)) }) };
    case 'dimension':
      return any(geom.c ? [geom.a, geom.b, geom.c] : [geom.a, geom.b]) ? { ...geom, a: mv(geom.a), b: mv(geom.b), ...(geom.c && { c: mv(geom.c) }) } : null;
    case 'circle':
    case 'ellipse':
      return inside(geom.c, r) ? { ...geom, c: mv(geom.c) } : null;
    case 'xline':
    case 'ray':
      return inside(geom.p, r) ? { ...geom, p: mv(geom.p) } : null;
    case 'arc': {
      const s = arcStart(geom);
      const m = arcMid(geom);
      const f = arcEnd(geom);
      const inS = inside(s, r);
      const inF = inside(f, r);
      if (!inS && !inF && !inside(m, r)) return null;
      // One end moving drags the middle half-way, keeping the arc's bow.
      const half = (p: Vec2) => ({ x: p.x + dx / 2, y: p.y + dy / 2 });
      const mid = inS && inF ? mv(m) : inS !== inF ? half(m) : mv(m);
      const g2 = arcThrough(mv(s), mid, mv(f));
      return g2 ? { kind: 'arc', ...g2 } : null;
    }
  }
}
