import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { normAngle, sweep as ccwSweep, TAU } from '../geom/arc';
import { bulgeAt, bulgeArc, bulgeOfSweep } from '../geom/bulge';
import { nearestS, pathOf, subPath } from './path';

/**
 * Uzat-kısalt (AutoCAD LENGTHEN): a line, an arc or an open polyline gets
 * a new total length, changed at one end. Shortening cuts the path there
 * (arcs exactly); lengthening continues the end segment: a straight one
 * along its direction, an arc on its own circle.
 */

export type LengthenResult = { geometry: EntityGeometry } | { error: string };

const canLengthen = (e: Entity) => e.kind === 'line' || e.kind === 'arc' || e.kind === 'polyline';

/** Current length of what Uzat-kısalt accepts, or null. */
export function lengthOf(e: Entity): number | null {
  if (!canLengthen(e)) return null;
  return pathOf(e)?.length ?? null;
}

/** Whether a click at p is nearer the end (true) or the start of the entity. */
export function nearEnd(e: Entity, p: Vec2): boolean {
  const path = pathOf(e);
  return !!path && nearestS(path, p) > path.length / 2;
}

export function lengthenEntity(e: Entity, atEnd: boolean, newLength: number): LengthenResult {
  if (!canLengthen(e)) return { error: 'Uzat-kısalt çizgi, yay ve açık çoklu çizgide çalışır.' };
  const path = pathOf(e);
  if (!path) return { error: 'Nesnenin uzunluğu yok.' };
  if (!(newLength > 1e-9)) return { error: 'Yeni uzunluk sıfırdan büyük olmalı.' };
  const L = path.length;
  if (Math.abs(newLength - L) <= 1e-12 * Math.max(1, L)) return { geometry: geometryOf(e) };
  if (newLength < L) {
    const g = atEnd ? subPath(path, 0, newLength, e) : subPath(path, L - newLength, L, e);
    // A short polyline stays a polyline.
    return { geometry: e.kind === 'polyline' && g.kind === 'line' ? { kind: 'polyline', pts: [g.a, g.b] } : g };
  }
  const delta = newLength - L;
  switch (e.kind) {
    case 'line': {
      const [from, to] = atEnd ? [e.a, e.b] : [e.b, e.a];
      const k = newLength / L;
      const end = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      return { geometry: atEnd ? { kind: 'line', a: e.a, b: end } : { kind: 'line', a: end, b: e.b } };
    }
    case 'arc': {
      const sw = ccwSweep(e.a0, e.a1) + delta / e.r;
      if (sw >= TAU - 1e-9) return { error: 'Yay bu uzunlukta kendini kapatır; en çok bir tam daireden kısa olabilir.' };
      return { geometry: atEnd ? { kind: 'arc', c: e.c, r: e.r, a0: e.a0, a1: normAngle(e.a0 + sw) } : { kind: 'arc', c: e.c, r: e.r, a0: normAngle(e.a1 - sw), a1: e.a1 } };
    }
    case 'polyline': {
      const n = e.pts.length;
      const pts = [...e.pts];
      const bulges = e.pts.map((_, i) => bulgeAt(e.bulges, i));
      // The end segment, walked away from the rest of the path.
      const seg = atEnd ? n - 2 : 0;
      const [fixed, moving] = atEnd ? [pts[n - 2], pts[n - 1]] : [pts[1], pts[0]];
      const b = bulges[seg];
      const arc = bulgeArc(pts[seg], pts[seg + 1], b);
      if (!arc) {
        const l = Math.hypot(moving.x - fixed.x, moving.y - fixed.y);
        const k = (l + delta) / l;
        const end = { x: fixed.x + (moving.x - fixed.x) * k, y: fixed.y + (moving.y - fixed.y) * k };
        pts[atEnd ? n - 1 : 0] = end;
      } else {
        // Grow the arc on its circle: the sweep gains delta / r in its own direction.
        const sw = arc.sweep + Math.sign(arc.sweep) * (delta / arc.r);
        if (Math.abs(sw) >= TAU - 1e-9) return { error: 'Yay parçası bu uzunlukta kendini kapatır.' };
        const a0 = atEnd ? arc.a0 : arc.a0 + arc.sweep - sw;
        const start = { x: arc.c.x + Math.cos(a0) * arc.r, y: arc.c.y + Math.sin(a0) * arc.r };
        const end = { x: arc.c.x + Math.cos(a0 + sw) * arc.r, y: arc.c.y + Math.sin(a0 + sw) * arc.r };
        if (atEnd) pts[n - 1] = end;
        else pts[0] = start;
        bulges[seg] = bulgeOfSweep(sw);
      }
      return { geometry: bulges.some((x) => x !== 0) ? { kind: 'polyline', pts, bulges } : { kind: 'polyline', pts } };
    }
    default:
      return { error: 'Uzat-kısalt çizgi, yay ve açık çoklu çizgide çalışır.' };
  }
}

/**
 * The total length that puts the moving end at the point nearest to p:
 * beyond the end the end segment continues (line direction or circle),
 * inside the path the length up to p's projection.
 */
export function lengthToward(e: Entity, atEnd: boolean, p: Vec2): number | null {
  const path = pathOf(e);
  if (!path || !canLengthen(e)) return null;
  const L = path.length;
  const edges = path.edges;
  const last = atEnd ? edges[edges.length - 1] : edges[0];
  const before = atEnd ? path.cum[edges.length - 1] : 0;
  const lastLen = atEnd ? L - path.cum[edges.length - 1] : (edges.length > 1 ? path.cum[1] : L);
  const inside = atEnd ? nearestS(path, p) : L - nearestS(path, p);
  if (last.kind === 'seg') {
    const [from, to] = atEnd ? [last.a, last.b] : [last.b, last.a];
    const l = Math.hypot(to.x - from.x, to.y - from.y);
    const t = ((p.x - from.x) * (to.x - from.x) + (p.y - from.y) * (to.y - from.y)) / l;
    return t > l ? before + t : inside;
  }
  // Arc: angle travelled from the fixed end of the segment, in its direction.
  const dir = Math.sign(last.sweep) || 1;
  const fixedAngle = atEnd ? last.a0 : last.a0 + last.sweep;
  const walk = atEnd ? dir : -dir;
  const theta = normAngle((Math.atan2(p.y - last.c.y, p.x - last.c.x) - fixedAngle) * walk);
  const travelled = theta * last.r;
  // Past the end but not so far round that it would rather be the start again.
  return travelled > lastLen && theta < Math.PI + Math.abs(last.sweep) / 2 ? L - lastLen + travelled : inside;
}

function geometryOf(e: Entity): EntityGeometry {
  const { id: _i, layerId: _l, attrs: _a, color: _c, label: _t, ...g } = e;
  return g as EntityGeometry;
}
