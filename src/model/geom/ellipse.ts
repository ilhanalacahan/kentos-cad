import type { Vec2 } from '../geometry';
import { normAngle, sweep, TAU } from './arc';
import { lineCircleParams, tangentPoints } from './intersect';

/**
 * Ellipse and elliptical arc in the DXF ELLIPSE form: centre, major axis
 * (vector from the centre to one end), ratio minor/major (0 < ratio ≤ 1)
 * and parameters t0 → t1, counter-clockwise; equal parameters mean the
 * whole ellipse. P(t) = c + major·cos t + minor·sin t, where minor is the
 * major axis turned +90° and scaled by ratio.
 *
 * An affine map takes the ellipse to the unit circle, so line crossings
 * and tangents are exact; the closest point is found with Newton steps.
 */
export interface EllipseGeom {
  c: Vec2;
  major: Vec2;
  ratio: number;
  t0: number;
  t1: number;
}

export const minorAxis = (e: EllipseGeom): Vec2 => ({ x: -e.major.y * e.ratio, y: e.major.x * e.ratio });
export const majorLength = (e: EllipseGeom) => Math.hypot(e.major.x, e.major.y);
export const ellipseSweep = (e: EllipseGeom) => sweep(e.t0, e.t1);
export const isFullEllipse = (e: EllipseGeom) => ellipseSweep(e) >= TAU - 1e-12;

export function ellipsePoint(e: EllipseGeom, t: number): Vec2 {
  const m = minorAxis(e);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: e.c.x + e.major.x * c + m.x * s, y: e.c.y + e.major.y * c + m.y * s };
}

/** Derivative dP/dt (not normalised). */
export function ellipseDerivative(e: EllipseGeom, t: number): Vec2 {
  const m = minorAxis(e);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: -e.major.x * s + m.x * c, y: -e.major.y * s + m.y * c };
}

/** World point → unit-circle space of the ellipse. */
function toUnit(e: EllipseGeom, p: Vec2): Vec2 {
  const m = minorAxis(e);
  const det = e.major.x * m.y - e.major.y * m.x;
  const dx = p.x - e.c.x;
  const dy = p.y - e.c.y;
  return { x: (m.y * dx - m.x * dy) / det, y: (-e.major.y * dx + e.major.x * dy) / det };
}

/** Parameter of a point on (or projected radially onto) the ellipse. */
export const paramOfPoint = (e: EllipseGeom, p: Vec2) => {
  const q = toUnit(e, p);
  return normAngle(Math.atan2(q.y, q.x));
};

/** Parameter of the ellipse point seen from the centre at `angle` (radians) from the major axis. */
export function paramAtPolar(e: EllipseGeom, angle: number): number {
  return normAngle(Math.atan2(Math.sin(angle) / e.ratio, Math.cos(angle)));
}

/** Whether parameter t lies on the (arc) range. */
export function onEllipse(e: EllipseGeom, t: number, eps = 1e-9): boolean {
  const sw = ellipseSweep(e);
  if (sw >= TAU - eps) return true;
  const d = normAngle(t - e.t0);
  return d <= sw + eps || d >= TAU - eps;
}

/** Point list along the curve; a whole ellipse returns a ring (first point not repeated). */
export function tessellateEllipse(e: EllipseGeom, perTurn = 128): Vec2[] {
  const sw = ellipseSweep(e);
  const full = sw >= TAU - 1e-12;
  const n = Math.max(full ? 16 : 4, Math.ceil((sw / TAU) * perTurn));
  const out: Vec2[] = [];
  for (let i = 0; i < (full ? n : n + 1); i++) out.push(ellipsePoint(e, e.t0 + (sw * i) / n));
  return out;
}

/** Arc length (composite Simpson, far below drawing precision). */
export function ellipseLength(e: EllipseGeom): number {
  const sw = ellipseSweep(e);
  const n = 2048;
  const h = sw / n;
  const f = (t: number) => {
    const d = ellipseDerivative(e, t);
    return Math.hypot(d.x, d.y);
  };
  let s = f(e.t0) + f(e.t0 + sw);
  for (let i = 1; i < n; i++) s += f(e.t0 + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Area of a whole ellipse (π·a·b). */
export const ellipseArea = (e: EllipseGeom) => Math.PI * majorLength(e) * majorLength(e) * e.ratio;

/**
 * Parameter of the point on the curve nearest to p (within the arc range).
 * The nearest of 65 samples tells which way the distance falls; the foot
 * between it and the next sample that way is found by Newton steps on
 * f(t) = (P(t) − p)·P′(t), bisecting whenever a step would leave that
 * bracket, so the search always converges. When the distance only grows
 * past an arc end, the end is the answer. Offsets are taken from p before
 * the steps: TM coordinates would otherwise cancel the digits they are
 * made of (§4.8.1).
 */
export function closestParam(e: EllipseGeom, p: Vec2): number {
  const sw = ellipseSweep(e);
  const full = sw >= TAU - 1e-12;
  const m = minorAxis(e);
  const ox = e.c.x - p.x;
  const oy = e.c.y - p.y;
  const samples = 64;
  const at = (i: number) => e.t0 + (sw * i) / samples;
  // Squared distance and f at t.
  const dist2 = (t: number) => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = ox + e.major.x * c + m.x * s;
    const y = oy + e.major.y * c + m.y * s;
    return x * x + y * y;
  };
  const slope = (t: number) => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = ox + e.major.x * c + m.x * s;
    const y = oy + e.major.y * c + m.y * s;
    return x * (-e.major.x * s + m.x * c) + y * (-e.major.y * s + m.y * c);
  };
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i <= samples; i++) {
    const d = dist2(at(i));
    if (d < bd) {
      bi = i;
      bd = d;
    }
  }
  const tb = at(bi);
  const fb = slope(tb);
  // Falling ahead (fb < 0): the foot lies before the next sample; rising: before the previous one.
  const j = fb < 0 ? bi + 1 : fb > 0 ? bi - 1 : bi;
  if (j === bi || (!full && (j < 0 || j > samples))) return normAngle(tb);
  let lo = Math.min(tb, at(j));
  let hi = Math.max(tb, at(j));
  // The sign has to change across the bracket; otherwise the sample stays.
  if (!(slope(lo) < 0 && slope(hi) > 0)) return normAngle(tb);
  let t = tb;
  for (let k = 0; k < 100; k++) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const ux = e.major.x * c + m.x * s;
    const uy = e.major.y * c + m.y * s;
    const x = ox + ux;
    const y = oy + uy;
    const dx = -e.major.x * s + m.x * c;
    const dy = -e.major.y * s + m.y * c;
    const f = x * dx + y * dy;
    if (f === 0) break;
    if (f < 0) lo = t;
    else hi = t;
    // f′ = |P′|² + (P − p)·P″, with P″ = −(P − c).
    const fp = dx * dx + dy * dy - (x * ux + y * uy);
    const newton = t - f / fp;
    const next = fp > 0 && newton > lo && newton < hi ? newton : (lo + hi) / 2;
    const done = Math.abs(next - t) <= 4e-16 * Math.max(1, Math.abs(t)) || hi - lo <= 4e-16 * Math.max(1, Math.abs(t));
    t = next;
    if (done) break;
  }
  return normAngle(t);
}

/** Crossings of the infinite line a→b with the curve: line parameter and ellipse parameter. */
export function lineEllipse(e: EllipseGeom, a: Vec2, b: Vec2): { u: number; t: number }[] {
  const qa = toUnit(e, a);
  const qb = toUnit(e, b);
  return lineCircleParams(qa, qb, { x: 0, y: 0 }, 1)
    .map((u) => ({ u, t: normAngle(Math.atan2(qa.y + (qb.y - qa.y) * u, qa.x + (qb.x - qa.x) * u)) }))
    .filter((h) => onEllipse(e, h.t));
}

/** Points where lines from p touch the curve (empty when p is inside). */
export function ellipseTangentPoints(e: EllipseGeom, p: Vec2): Vec2[] {
  return tangentPoints(toUnit(e, p), { x: 0, y: 0 }, 1)
    .map((q) => normAngle(Math.atan2(q.y, q.x)))
    .filter((t) => onEllipse(e, t))
    .map((t) => ellipsePoint(e, t));
}

/** Parameters of the four axis ends (quadrant snaps) that lie on the curve. */
export function quadrantParams(e: EllipseGeom): number[] {
  return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].filter((t) => onEllipse(e, t));
}

/** Whether p is inside a whole ellipse. */
export function insideEllipse(e: EllipseGeom, p: Vec2): boolean {
  const q = toUnit(e, p);
  return q.x * q.x + q.y * q.y < 1;
}

/**
 * Ellipse through an axis (two ends) and the distance from the centre to
 * the other axis — AutoCAD's default construction. The longer axis is the
 * major one.
 */
export function ellipseFromAxis(p1: Vec2, p2: Vec2, otherHalf: number): EllipseGeom | null {
  const c = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  return ellipseFromCenter(c, p2, otherHalf);
}

/** Ellipse from its centre, one axis end and the other half-axis length. */
export function ellipseFromCenter(c: Vec2, axisEnd: Vec2, otherHalf: number): EllipseGeom | null {
  const v = { x: axisEnd.x - c.x, y: axisEnd.y - c.y };
  const a = Math.hypot(v.x, v.y);
  const b = Math.abs(otherHalf);
  if (a < 1e-9 || b < 1e-9) return null;
  if (b <= a) return { c, major: v, ratio: b / a, t0: 0, t1: 0 };
  // The given axis is the minor one: the major runs at +90°.
  return { c, major: { x: (-v.y / a) * b, y: (v.x / a) * b }, ratio: a / b, t0: 0, t1: 0 };
}
