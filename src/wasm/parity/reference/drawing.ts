import type { EntityGeometry } from '../../../model/entities';
import { dist, type Vec2 } from '../../../model/geometry';
import { arcEnd, normAngle } from '../../../model/geom/arc';
import { bulgeAt, bulgeOfSweep, segmentTangent } from '../../../model/geom/bulge';
import { paramAtPolar, type EllipseGeom } from '../../../model/geom/ellipse';
import { regularPolygon } from '../../../model/geom/shapes';

/**
 * What the drawing tools computed inline in TypeScript before the core took
 * it over (docs/adr/0008, S5): directions, typed-radius polygons, the arc
 * continuation, circle and ellipse helpers, construction line directions,
 * polyline arc bulges, text angles and donut rings. Each is the tool's code
 * as it was, the parity reference until S3.
 */

const DEG = Math.PI / 180;

/** Direction angle from a to b (radians, CCW from east): rectangle rotation, rotation reference. */
export function directionAngle(a: Vec2, b: Vec2): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * Regular polygon for a typed radius (`tools/shapeTools.ts`): the bottom
 * edge horizontal, so the edge middle sits straight below the centre.
 */
export function regularPolygonRadius(c: Vec2, sides: number, r: number, inscribed: boolean): Vec2[] | null {
  const a = inscribed ? -Math.PI / 2 + Math.PI / sides : -Math.PI / 2;
  return regularPolygon(c, sides, { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, inscribed ? 'inscribed' : 'circumscribed');
}

/** End point and travel direction of a line, arc or polyline (arc "Devam"); null for other kinds. */
export function endTangent(e: EntityGeometry): { p: Vec2; dir: Vec2 } | null {
  if (e.kind === 'line' && dist(e.a, e.b) > 1e-9) return { p: e.b, dir: { x: (e.b.x - e.a.x) / dist(e.a, e.b), y: (e.b.y - e.a.y) / dist(e.a, e.b) } };
  if (e.kind === 'arc') return { p: arcEnd(e), dir: { x: -Math.sin(e.a1), y: Math.cos(e.a1) } };
  if (e.kind === 'polyline' && e.pts.length >= 2) {
    const k = e.pts.length;
    return { p: e.pts[k - 1], dir: segmentTangent(e.pts[k - 2], e.pts[k - 1], bulgeAt(e.bulges, k - 2), true) };
  }
  return null;
}

/** Unit direction of a typed angle in degrees (arc start direction). */
export function degDirection(deg: number): Vec2 {
  return { x: Math.cos((deg * Math.PI) / 180), y: Math.sin((deg * Math.PI) / 180) };
}

/** Circle on a diameter (2N). */
export function circleOnDiameter(a: Vec2, b: Vec2): { c: Vec2; r: number } {
  return { c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, r: dist(a, b) / 2 };
}

/** Ellipse parameter at the polar angle of p seen from the centre, relative to the major axis. */
export function ellipseParamToward(g: EllipseGeom, p: Vec2): number {
  return paramAtPolar(g, Math.atan2(p.y - g.c.y, p.x - g.c.x) - Math.atan2(g.major.y, g.major.x));
}

/** The other half-axis for a rotation angle (degrees): the first axis seen tilted, ratio = cos(angle). */
export function ellipseRotationHalf(p0: Vec2, p1: Vec2, fromCenter: boolean, angle: number): number {
  const a = dist(p0, p1) / (fromCenter ? 1 : 2);
  return a * Math.cos(angle * DEG);
}

/** Unit vector from a towards b; null when they (nearly) coincide. */
export function unitToward(a: Vec2, b: Vec2): Vec2 | null {
  const l = dist(a, b);
  return l < 1e-9 ? null : { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

/** Direction of a construction line through p (`tools/constructionTools.ts`); null: not enough input yet. */
export function xlineDirection(mode: string, pts: readonly Vec2[], p: Vec2, angle: number): Vec2 | null {
  switch (mode) {
    case 'horizontal':
      return { x: 1, y: 0 };
    case 'vertical':
      return { x: 0, y: 1 };
    case 'angle':
      return { x: Math.cos(angle * DEG), y: Math.sin(angle * DEG) };
    case 'bisect': {
      if (pts.length < 2) return null;
      const u = unitToward(pts[0], pts[1]);
      const v = unitToward(pts[0], p);
      if (!u || !v) return null;
      const s = { x: u.x + v.x, y: u.y + v.y };
      const l = Math.hypot(s.x, s.y);
      // Opposite arms: the bisector is square to them.
      return l < 1e-12 ? { x: -u.y, y: u.x } : { x: s.x / l, y: s.y / l };
    }
    default:
      return pts.length ? unitToward(pts[0], p) : null;
  }
}

/** The point on the circle (c, r) in the direction of p; null when p is the centre. */
export function radialPoint(c: Vec2, r: number, p: Vec2): Vec2 | null {
  const l = dist(c, p);
  return l < 1e-9 ? null : { x: c.x + ((p.x - c.x) / l) * r, y: c.y + ((p.y - c.y) / l) * r };
}

/**
 * Bulge of a polyline arc of radius r from `last` to p, bending the way the
 * path turns towards p (counter-clockwise without a tangent); null when the
 * chord is longer than the diameter.
 */
export function radiusBulge(last: Vec2, p: Vec2, r: number, tangent: Vec2 | null): number | null {
  const c = dist(last, p);
  if (c > 2 * r) return null;
  const side = tangent ? Math.sign(tangent.x * (p.y - last.y) - tangent.y * (p.x - last.x)) || 1 : 1;
  return side * Math.tan(Math.asin(c / (2 * r)) / 2);
}

/** Bulge of a polyline arc around centre c from `last` to `end`, counter-clockwise; null for no sweep. */
export function centreBulge(c: Vec2, last: Vec2, end: Vec2): number | null {
  const sweep = normAngle(Math.atan2(end.y - c.y, end.x - c.x) - Math.atan2(last.y - c.y, last.x - c.x));
  return sweep > 1e-9 ? bulgeOfSweep(sweep) : null;
}

/** p moved `distance` along `dir`. */
export function offsetAlong(p: Vec2, dir: Vec2, distance: number): Vec2 {
  return { x: p.x + dir.x * distance, y: p.y + dir.y * distance };
}

/** Text angle (degrees) from two points, kept readable: a direction pointing left is turned around. */
export function textAngle(from: Vec2, p: Vec2): number {
  let a = (Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI;
  if (a > 90) a -= 180;
  else if (a <= -90) a += 180;
  return a;
}

const circle = (c: Vec2, r: number, n = 96): Vec2[] => Array.from({ length: n }, (_, i) => ({ x: c.x + Math.cos((i / n) * 2 * Math.PI) * r, y: c.y + Math.sin((i / n) * 2 * Math.PI) * r }));

/** Donut (halka): the outer ring, and the hole when the inner diameter is not zero. */
export function donutRings(c: Vec2, inner: number, outer: number): { ring: Vec2[]; holes?: Vec2[][] } {
  const ring = circle(c, outer / 2);
  return inner > 0 ? { ring, holes: [circle(c, inner / 2)] } : { ring };
}
