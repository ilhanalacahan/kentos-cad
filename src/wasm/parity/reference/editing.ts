import { dist, type Vec2 } from '../../../model/geometry';
import { compose, rotation, scaling, translation, type Affine } from '../../../model/geom/affine';
import { normAngle, type ArcGeom } from '../../../model/geom/arc';
import { sectorArms } from '../../../model/geom/dimension';
import { lineLine } from '../../../model/geom/intersect';

/**
 * What the modify, corner and dimension tools computed inline in TypeScript
 * before the core took it over (docs/adr/0008, S5): rotation and scale
 * parameters, polar array and align transforms, the corner a fillet or chamfer
 * works on and its pieces, and the arms of angular and radial dimensions.
 * Each is the tool's code as it was, the parity reference until S3.
 */

/** Rotation by the direction from `base` to p, less a reference angle (radians). */
export function rotationAngle(base: Vec2, p: Vec2, ref: number): number {
  return Math.atan2(p.y - base.y, p.x - base.x) - ref;
}

/** Scale factor: the distance from `base` to p over the reference length. */
export function scaleFactor(base: Vec2, p: Vec2, refLength: number): number {
  return dist(base, p) / refLength;
}

/**
 * Polar array around c: `count` items (the original included) over `fill`
 * degrees (minus: clockwise). A full turn shares the circle out; a partial
 * fill puts the last copy on the end angle. Copies that do not turn move
 * by where `ref` (the selection's middle) goes.
 */
export function polarArrayTransforms(c: Vec2, count: number, fill: number, rotate: boolean, ref: Vec2): Affine[] {
  const step = Math.abs(Math.abs(fill) - 360) < 1e-9 ? fill / count : fill / (count - 1);
  const out: Affine[] = [];
  for (let k = 1; k < count; k++) {
    const a = (step * k * Math.PI) / 180;
    if (rotate) out.push(rotation(a, c));
    else {
      // The middle's offset from the centre, turned: rotating TM-size coordinates and taking
      // them apart again left the move to the last bits of sin and cos (docs/adr/0008, S5).
      const dx = ref.x - c.x;
      const dy = ref.y - c.y;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      out.push(translation(cos * dx - sin * dy - dx, sin * dx + cos * dy - dy));
    }
  }
  return out;
}

/**
 * ALIGN: the first source point onto the first destination; with a second
 * pair the source direction turns onto the destination direction, and
 * scales to fit when `scale`. `pts` is s1, d1, s2, d2 as far as given.
 */
export function alignTransform(pts: readonly Vec2[], scale: boolean): Affine | null {
  const [s1, d1, s2, d2] = pts;
  if (!s1 || !d1) return null;
  if (!s2 || !d2) return translation(d1.x - s1.x, d1.y - s1.y);
  const ls = dist(s1, s2);
  const ld = dist(d1, d2);
  if (ls < 1e-9 || ld < 1e-9) return null;
  const turn = Math.atan2(d2.y - d1.y, d2.x - d1.x) - Math.atan2(s2.y - s1.y, s2.x - s1.x);
  const k = scale ? ld / ls : 1;
  // Around s1: scale, turn, then carry s1 onto d1.
  return compose(translation(d1.x - s1.x, d1.y - s1.y), compose(rotation(turn, s1), scaling(k, s1)));
}

/**
 * A corner that can be rounded or cut (`tools/cornerTools.ts`): `u1`/`u2`
 * point along the kept sides, `reach` is how far the shorter side goes,
 * `phi` the angle between the sides (radians).
 */
export interface CornerGeom {
  at: Vec2;
  u1: Vec2;
  u2: Vec2;
  reach: number;
  phi: number;
}

const unit = (a: Vec2, b: Vec2) => {
  const l = dist(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const angleBetween = (u: Vec2, v: Vec2) => Math.acos(Math.max(-1, Math.min(1, dot(u, v))));

/**
 * The corner at a path vertex `at` between the segment from `prev` (bulge
 * `bulgeIn`) and the one to `next` (`bulgeOut`); null beside an arc, on a
 * straight run or where the path turns back.
 */
export function vertexCorner(prev: Vec2, at: Vec2, next: Vec2, bulgeIn: number, bulgeOut: number): CornerGeom | null {
  if (Math.abs(bulgeIn) > 1e-12 || Math.abs(bulgeOut) > 1e-12) return null;
  const u1 = unit(at, prev);
  const u2 = unit(at, next);
  const phi = angleBetween(u1, u2);
  if (phi < 1e-6 || Math.PI - phi < 1e-6) return null;
  return { at, u1, u2, reach: Math.min(dist(at, prev), dist(at, next)), phi };
}

/** Corner of two lines (a1–b1 picked at p1, a2–b2 at p2); each keeps the side its pick point is on. */
export function linesCornerAt(a1: Vec2, b1: Vec2, p1: Vec2, a2: Vec2, b2: Vec2, p2: Vec2): CornerGeom | null {
  const hit = lineLine(a1, b1, a2, b2);
  if (!hit) return null;
  const X = hit.p;
  const side = (a: Vec2, b: Vec2, pick: Vec2) => {
    const d = unit(a, b);
    const u = dot({ x: pick.x - X.x, y: pick.y - X.y }, d) >= 0 ? d : { x: -d.x, y: -d.y };
    const reach = Math.max(dot({ x: a.x - X.x, y: a.y - X.y }, u), dot({ x: b.x - X.x, y: b.y - X.y }, u));
    return { u, reach };
  };
  const s1 = side(a1, b1, p1);
  const s2 = side(a2, b2, p2);
  if (s1.reach <= 1e-9 || s2.reach <= 1e-9) return null;
  const phi = angleBetween(s1.u, s2.u);
  if (phi < 1e-6 || Math.PI - phi < 1e-6) return null;
  return { at: X, u1: s1.u, u2: s2.u, reach: Math.min(s1.reach, s2.reach), phi };
}

/**
 * How far the cursor has been pulled along the nearer side, rounded to a
 * step that suits the zoom (`tol`: four pixels in metres); the corner
 * itself without a cursor.
 */
export function pulledDistance(c: CornerGeom, cursor: Vec2 | null, tol: number): number {
  const cur = cursor ?? c.at;
  const v = { x: cur.x - c.at.x, y: cur.y - c.at.y };
  const t = Math.min(Math.max(dot(v, c.u1), dot(v, c.u2), 0), c.reach);
  const step = 10 ** Math.floor(Math.log10(Math.max(tol, 1e-3)));
  return Math.min(Math.round(t / step) * step, c.reach);
}

/** Fillet radius for a pulled distance: that is where the arc meets the side (tangent length). */
export function filletRadiusFor(t: number, phi: number): number {
  return t * Math.tan(phi / 2);
}

/** The fillet arc alone (“Kırp: hayır”): the short arc between the tangent points; null for no radius. */
export function filletArc(c: CornerGeom, radius: number): ArcGeom | null {
  if (!(radius > 0)) return null;
  // Tangent points at r / tan(φ/2) along each side; centre on the bisector at r / sin(φ/2).
  const t = radius / Math.tan(c.phi / 2);
  const bis = unit({ x: 0, y: 0 }, { x: c.u1.x + c.u2.x, y: c.u1.y + c.u2.y });
  const k = radius / Math.sin(c.phi / 2);
  const centre = { x: c.at.x + bis.x * k, y: c.at.y + bis.y * k };
  const angle = (u: Vec2) => Math.atan2(c.at.y + u.y * t - centre.y, c.at.x + u.x * t - centre.x);
  const [a0, a1] = [angle(c.u1), angle(c.u2)];
  // The fillet is the short arc between the tangent points; arcs run counter-clockwise.
  const ccw = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) < Math.PI;
  return { c: centre, r: radius, a0: ccw ? a0 : a1, a1: ccw ? a1 : a0 };
}

/** The chamfer cut alone (“Kırp: hayır”); null unless both distances are positive. */
export function chamferLine(c: CornerGeom, d1: number, d2: number): { a: Vec2; b: Vec2 } | null {
  if (!(d1 > 0) || !(d2 > 0)) return null;
  return { a: { x: c.at.x + c.u1.x * d1, y: c.at.y + c.u1.y * d1 }, b: { x: c.at.x + c.u2.x * d2, y: c.at.y + c.u2.y * d2 } };
}

/**
 * Angular dimension from its vertex c and a point on each arm: the arc
 * goes where it is placed (`loc`), from p1 to p2 counter-clockwise, or the
 * other way round.
 */
export function vertexArms(c: Vec2, p1: Vec2, p2: Vec2, loc: Vec2): { c: Vec2; a: Vec2; b: Vec2 } {
  const t = normAngle(Math.atan2(loc.y - c.y, loc.x - c.x) - Math.atan2(p1.y - c.y, p1.x - c.x));
  const sweep = normAngle(Math.atan2(p2.y - c.y, p2.x - c.x) - Math.atan2(p1.y - c.y, p1.x - c.x));
  return t <= sweep ? { c, a: p1, b: p2 } : { c, a: p2, b: p1 };
}

/** A straight edge picked for an angular dimension, and where it was clicked. */
export interface PickedEdge {
  a: Vec2;
  b: Vec2;
  at: Vec2;
}

/**
 * Angular dimension between two picked edges: the vertex where their lines
 * cross, the sector the arc is placed in (`loc`), each arm as far as its
 * edge was clicked (at least a millimetre); null for parallel edges.
 */
export function edgeArms(e1: PickedEdge, e2: PickedEdge, loc: Vec2): { c: Vec2; a: Vec2; b: Vec2 } | null {
  const hit = lineLine(e1.a, e1.b, e2.a, e2.b);
  if (!hit) return null;
  const c = hit.p;
  const dir = (s: PickedEdge): Vec2 => {
    const l = dist(s.a, s.b);
    return { x: (s.b.x - s.a.x) / l, y: (s.b.y - s.a.y) / l };
  };
  const u1 = dir(e1);
  const u2 = dir(e2);
  const [s, e] = sectorArms(c, u1, u2, loc);
  const reach = (u: Vec2) => {
    const edge = Math.abs(u.x * u1.y - u.y * u1.x) < 1e-9 ? e1 : e2;
    return Math.max(dist(c, edge.at), 1e-3);
  };
  return { c, a: { x: c.x + s.x * reach(s), y: c.y + s.y * reach(s) }, b: { x: c.x + e.x * reach(e), y: c.y + e.y * reach(e) } };
}

/** Radius or diameter dimension placed at `loc`: the point on the circle towards it and how far outside it is. */
export function radialDimension(c: Vec2, r: number, loc: Vec2): { b: Vec2; offset: number } {
  const l = dist(c, loc);
  const u = l > 1e-9 ? { x: (loc.x - c.x) / l, y: (loc.y - c.y) / l } : { x: 1, y: 0 };
  const b = { x: c.x + u.x * r, y: c.y + u.y * r };
  return { b, offset: Math.max(0, l - r) };
}
