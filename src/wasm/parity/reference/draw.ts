import { entityAnchor, entityArea, entityLength, entityOutline, isClosedOutline, polygonHoles, polygonRing, tessellateCircle, type Entity } from '../../../model/entities';
import { tessellateArc } from '../../../model/geom/arc';
import { layoutDimension } from '../../../model/geom/dimension';
import { catmullRom } from '../../../model/geom/spline';
import { signedArea, type Bounds, type Vec2 } from '../../../model/geometry';
import type { StyledGeometry } from '../../../style/geometry';

/**
 * What the layer builders drew of each object as the TypeScript computed
 * it before the geometry store (docs/adr/0008, S2): `styledGeometry` for
 * the style engine (rings oriented), `buildSceneLayer`'s outlines for the
 * highlight layers (rings as they are), and the expressions' geometry
 * values. The parity test holds the store's records, read back by
 * `readDrawn`, to them until the TypeScript geometry is deleted (S3).
 */

const oriented = (ring: readonly Vec2[], ccw: boolean): Vec2[] => (signedArea(ring) > 0 === ccw ? [...ring] : [...ring].reverse());

/** Part of an infinite line inside a box. */
function clipLine(p: Vec2, dir: Vec2, ray: boolean, r: Bounds): Vec2[] | null {
  let t0 = ray ? 0 : -Infinity;
  let t1 = Infinity;
  for (const [pp, d, min, max] of [
    [p.x, dir.x, r.minX, r.maxX],
    [p.y, dir.y, r.minY, r.maxY],
  ]) {
    if (Math.abs(d) < 1e-15) {
      if (pp < min || pp > max) return null;
      continue;
    }
    const a = (min - pp) / d;
    const b = (max - pp) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 > t0)) return null;
  return [
    { x: p.x + dir.x * t0, y: p.y + dir.y * t0 },
    { x: p.x + dir.x * t1, y: p.y + dir.y * t1 },
  ];
}

/** `styledGeometry` as it was; dimensions as the styled layer drew them (their layout lines). */
export function tsStyledGeometry(e: Entity, clip?: Bounds): StyledGeometry | null {
  switch (e.kind) {
    case 'point':
      return { cls: 'marker', point: e.p };
    case 'polygon':
      return { cls: 'fill', rings: [oriented(polygonRing(e), true), ...polygonHoles(e).map((h) => oriented(h, false))] };
    case 'hatch':
      return { cls: 'fill', rings: [oriented(e.ring, true), ...(e.holes ?? []).map((h) => oriented(h, false))] };
    case 'line':
      return { cls: 'line', paths: [{ pts: [e.a, e.b], closed: false }] };
    case 'polyline':
      return { cls: 'line', paths: [{ pts: e.bulges ? entityOutline(e) : e.pts, closed: false }] };
    case 'circle':
    case 'ellipse':
      return { cls: 'line', paths: [{ pts: entityOutline(e), closed: e.kind === 'circle' || isClosedOutline(e) }] };
    case 'arc':
      return { cls: 'line', paths: [{ pts: tessellateArc(e), closed: false }] };
    case 'spline':
      return { cls: 'line', paths: [{ pts: catmullRom(e.pts, e.closed), closed: false }] };
    case 'xline':
    case 'ray': {
      const seg = clip && clipLine(e.p, e.dir, e.kind === 'ray', clip);
      return seg ? { cls: 'line', paths: [{ pts: seg, closed: false }] } : null;
    }
    case 'dimension': {
      const l = layoutDimension(e);
      return l ? { cls: 'line', paths: l.lines.map(([p, q]) => ({ pts: [p, q], closed: false })) } : null;
    }
    default:
      return null;
  }
}

/** The highlight layers' geometry as `buildSceneLayer` took it (rings unoriented). */
export function tsSceneGeometry(e: Entity, clip?: Bounds): StyledGeometry | null {
  switch (e.kind) {
    case 'polygon':
      return { cls: 'fill', rings: [polygonRing(e), ...polygonHoles(e)] };
    case 'hatch':
      return { cls: 'fill', rings: [e.ring, ...(e.holes ?? [])] };
    case 'circle':
      return { cls: 'line', paths: [{ pts: tessellateCircle(e.c, e.r), closed: true }] };
    default:
      return tsStyledGeometry(e, clip);
  }
}

/** The expressions' geometry values: `$uzunluk`, `$alan`, and `$y`/`$x` (the anchor). */
export function tsMeasured(e: Entity): { length: number | null; area: number | null; anchor: Vec2 | null } {
  return { length: entityLength(e), area: entityArea(e), anchor: entityAnchor(e) ?? null };
}
