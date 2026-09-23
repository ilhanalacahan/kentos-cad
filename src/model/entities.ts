import { centroid, emptyBounds, extendBounds, pathLength, signedArea, type Bounds, type Vec2 } from './geometry';
import { arcEnd, arcLength, arcMid, arcStart, TAU, tessellateArc } from './geom/arc';
import { bulgePathLength, bulgePathOutline, bulgeRingArea, hasBulges } from './geom/bulge';
import { ellipseArea, ellipseLength, ellipsePoint, isFullEllipse, quadrantParams, tessellateEllipse } from './geom/ellipse';
import { layoutDimension } from './geom/dimension';
import { catmullRom } from './geom/spline';

export type EntityKind = 'point' | 'line' | 'polyline' | 'polygon' | 'circle' | 'arc' | 'ellipse' | 'spline' | 'xline' | 'ray' | 'text' | 'dimension' | 'hatch';

/**
 * Half-length (1000 km) used when an infinite line meets finite geometry on
 * the CPU. Far beyond any sheet in a TM zone, yet small enough that float64
 * keeps ~10⁻¹⁰ m at its ends (10⁴ km would already round to 2·10⁻⁹ m).
 * Rendering clips to the view instead.
 */
export const CONSTRUCTION_REACH = 1e6;

interface EntityBase {
  id: number;
  layerId: string;
  /** Overrides the layer colour; undefined means "katmana göre" (ByLayer). */
  color?: string;
  /** Free-form GIS attributes (Ada, Parsel, Nitelik…). */
  attrs: Record<string, string>;
  /** Short label drawn at the entity's anchor (parcel number, point name). */
  label?: string;
}

export interface PointEntity extends EntityBase {
  kind: 'point';
  p: Vec2;
  z?: number;
}
export interface LineEntity extends EntityBase {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}
export interface PolylineEntity extends EntityBase {
  kind: 'polyline' | 'polygon';
  pts: Vec2[];
  /**
   * Arc segments: bulges[i] = tan(θ/4) for the segment pts[i] → pts[i+1]
   * (the closing segment for a polygon), positive counter-clockwise.
   * Absent or all zero means straight segments only (DXF LWPOLYLINE bulge).
   */
  bulges?: number[];
}
export interface CircleEntity extends EntityBase {
  kind: 'circle';
  c: Vec2;
  r: number;
}
/** Arc running counter-clockwise from a0 to a1 (radians from east). */
export interface ArcEntity extends EntityBase {
  kind: 'arc';
  c: Vec2;
  r: number;
  a0: number;
  a1: number;
}
/**
 * Ellipse or elliptical arc (DXF ELLIPSE): centre, major axis vector,
 * minor/major ratio and parameters t0 → t1 counter-clockwise; equal
 * parameters mean the whole ellipse. See model/geom/ellipse.
 */
export interface EllipseEntity extends EntityBase {
  kind: 'ellipse';
  c: Vec2;
  major: Vec2;
  ratio: number;
  t0: number;
  t1: number;
}
/** Construction line through p (xline: both ways, ray: towards dir only). dir is a unit vector. */
export interface ConstructionEntity extends EntityBase {
  kind: 'xline' | 'ray';
  p: Vec2;
  dir: Vec2;
}
/** Smooth curve through fit points (centripetal Catmull-Rom). */
export interface SplineEntity extends EntityBase {
  kind: 'spline';
  pts: Vec2[];
  closed: boolean;
}
/** Aligned dimension; `text` overrides the measured value when set. */
export interface DimensionEntity extends EntityBase {
  kind: 'dimension';
  a: Vec2;
  b: Vec2;
  offset: number;
  height: number;
  text?: string;
}
export type HatchPatternType = 'solid' | 'lines' | 'cross';
export interface HatchPattern {
  type: HatchPatternType;
  /** Line direction in degrees, CCW from east. */
  angle: number;
  /** Line spacing in metres (world units). */
  spacing: number;
}
/** Filled or line-patterned area inside a boundary ring (not associative). */
export interface HatchEntity extends EntityBase {
  kind: 'hatch';
  ring: Vec2[];
  pattern: HatchPattern;
}
export interface TextEntity extends EntityBase {
  kind: 'text';
  p: Vec2;
  text: string;
  /** Text height in metres (paper-independent). */
  height: number;
  /** Degrees, counter-clockwise from east. */
  rotation: number;
}

export type Entity =
  | PointEntity
  | LineEntity
  | PolylineEntity
  | CircleEntity
  | ArcEntity
  | EllipseEntity
  | ConstructionEntity
  | SplineEntity
  | TextEntity
  | DimensionEntity
  | HatchEntity;

/** Entity without id, as passed to CadDocument.add. */
export type NewEntity = Entity extends infer E ? (E extends Entity ? Omit<E, 'id'> : never) : never;

export const ENTITY_KIND_LABEL: Record<EntityKind, string> = {
  point: 'Nokta',
  line: 'Çizgi',
  polyline: 'Çoklu çizgi',
  polygon: 'Kapalı alan',
  circle: 'Daire',
  arc: 'Yay',
  ellipse: 'Elips',
  spline: 'Eğri',
  xline: 'Yardımcı çizgi',
  ray: 'Işın',
  text: 'Yazı',
  dimension: 'Ölçü',
  hatch: 'Tarama',
};

export const HATCH_PATTERN_LABEL: Record<HatchPatternType, string> = {
  solid: 'Dolu',
  lines: 'Çizgili',
  cross: 'Çapraz',
};

export function tessellateCircle(c: Vec2, r: number, segments = 72): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
  }
  return pts;
}

/** Characteristic vertices — used for grips, snapping and coordinate tables. */
export function entityVertices(e: EntityGeometry): Vec2[] {
  switch (e.kind) {
    case 'point':
    case 'text':
      return [e.p];
    case 'line':
      return [e.a, e.b];
    case 'polyline':
    case 'polygon':
      return e.pts;
    case 'circle':
      return [e.c, { x: e.c.x + e.r, y: e.c.y }, { x: e.c.x, y: e.c.y + e.r }, { x: e.c.x - e.r, y: e.c.y }, { x: e.c.x, y: e.c.y - e.r }];
    case 'arc':
      return [arcStart(e), arcMid(e), arcEnd(e)];
    case 'ellipse':
      return [e.c, ...(isFullEllipse(e) ? [] : [ellipsePoint(e, e.t0), ellipsePoint(e, e.t1)]), ...quadrantParams(e).map((t) => ellipsePoint(e, t))];
    case 'xline':
    case 'ray':
      return [e.p];
    case 'spline':
      return e.pts;
    case 'dimension':
      return [e.a, e.b];
    case 'hatch':
      return e.ring;
  }
}

/** Outline as a point list (curves tessellated) — for previews, bounds and hit tests. */
export function entityOutline(e: EntityGeometry, segments = 72): Vec2[] {
  switch (e.kind) {
    case 'circle':
      return tessellateCircle(e.c, e.r, segments);
    case 'arc':
      return tessellateArc(e);
    case 'ellipse':
      return tessellateEllipse(e, Math.max(64, segments * 2));
    case 'xline':
    case 'ray': {
      // Long enough for any preview; the renderer clips to the view.
      const r = CONSTRUCTION_REACH;
      return [e.kind === 'ray' ? e.p : { x: e.p.x - e.dir.x * r, y: e.p.y - e.dir.y * r }, { x: e.p.x + e.dir.x * r, y: e.p.y + e.dir.y * r }];
    }
    case 'spline':
      return catmullRom(e.pts, e.closed);
    case 'polyline':
    case 'polygon':
      return bulgePathOutline(e.pts, e.bulges, e.kind === 'polygon', TAU / segments);
    case 'dimension': {
      const l = layoutDimension(e);
      return l ? [e.a, l.d1, l.d2, e.b] : [e.a, e.b];
    }
    default:
      return entityVertices(e);
  }
}

/** Closed ring of a polygon, arcs tessellated — for fills, hit tests and hatching. */
export const polygonRing = (e: { pts: Vec2[]; bulges?: number[] }): Vec2[] => (hasBulges(e.bulges) ? bulgePathOutline(e.pts, e.bulges, true) : e.pts);

/**
 * Approximate rotated box of a text entity (Barlow averages ~0.55 em per
 * glyph). Used for picking and bounds until real glyph metrics exist.
 */
export function textBox(e: { p: Vec2; text: string; height: number; rotation: number }): Vec2[] {
  const w = Math.max(1, e.text.length) * e.height * 0.55;
  const h = e.height * 1.15;
  const r = (e.rotation * Math.PI) / 180;
  const ux = Math.cos(r);
  const uy = Math.sin(r);
  const at = (u: number, v: number) => ({ x: e.p.x + ux * u - uy * v, y: e.p.y + uy * u + ux * v });
  return [at(0, -h * 0.2), at(w, -h * 0.2), at(w, h), at(0, h)];
}

/** Whether the outline is a closed ring. */
export const isClosedOutline = (e: EntityGeometry) =>
  e.kind === 'polygon' || e.kind === 'circle' || e.kind === 'hatch' || (e.kind === 'spline' && e.closed) || (e.kind === 'ellipse' && isFullEllipse(e));

export function entityBounds(e: Entity): Bounds {
  const b = emptyBounds();
  if (e.kind === 'circle') {
    extendBounds(b, e.c, e.r);
    return b;
  }
  if (e.kind === 'text') {
    for (const p of textBox(e)) extendBounds(b, p);
    return b;
  }
  if (e.kind === 'xline' || e.kind === 'ray' || e.kind === 'ellipse') {
    // Construction lines count by their base point only (zoom extents ignores their reach).
    for (const p of e.kind === 'ellipse' ? tessellateEllipse(e, 256) : [e.p]) extendBounds(b, p);
    return b;
  }
  if (e.kind === 'arc' || e.kind === 'spline' || e.kind === 'dimension' || ((e.kind === 'polyline' || e.kind === 'polygon') && hasBulges(e.bulges))) {
    for (const p of entityOutline(e)) extendBounds(b, p);
    if (e.kind === 'dimension') extendBounds(b, { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }, e.height * 2);
    return b;
  }
  for (const p of entityVertices(e)) extendBounds(b, p);
  return b;
}

export function entityAnchor(e: Entity): Vec2 {
  switch (e.kind) {
    case 'polygon':
      return centroid(polygonRing(e));
    case 'circle':
    case 'ellipse':
      return e.c;
    case 'arc':
      return arcMid(e);
    case 'line':
      return { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    case 'polyline':
    case 'spline':
      return e.pts[Math.floor(e.pts.length / 2)];
    case 'dimension': {
      const l = layoutDimension(e);
      return l ? l.textAt : e.a;
    }
    case 'hatch':
      return centroid(e.ring);
    default:
      return e.p;
  }
}

export function entityLength(e: Entity): number | null {
  switch (e.kind) {
    case 'line':
      return pathLength([e.a, e.b]);
    case 'polyline':
    case 'polygon':
      return bulgePathLength(e.pts, e.bulges, e.kind === 'polygon');
    case 'circle':
      return 2 * Math.PI * e.r;
    case 'arc':
      return arcLength(e);
    case 'ellipse':
      return ellipseLength(e);
    case 'spline':
      return pathLength(catmullRom(e.pts, e.closed));
    case 'dimension':
      return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y);
    default:
      return null;
  }
}

export function entityArea(e: Entity): number | null {
  if (e.kind === 'polygon') return Math.abs(bulgeRingArea(e.pts, e.bulges));
  if (e.kind === 'circle') return Math.PI * e.r * e.r;
  if (e.kind === 'ellipse' && isFullEllipse(e)) return ellipseArea(e);
  if (e.kind === 'hatch') return Math.abs(signedArea(e.ring));
  return null;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Pure geometry of an entity (what modify operations produce). */
export type EntityGeometry = DistributiveOmit<Entity, 'id' | 'layerId' | 'attrs' | 'color' | 'label'>;

/** Geometry-only view of an entity (drops id, layer, colour, attributes, label). */
export function entityGeometry(e: Entity): EntityGeometry {
  const { id: _i, layerId: _l, attrs: _a, color: _c, label: _t, ...g } = e;
  return g as EntityGeometry;
}
