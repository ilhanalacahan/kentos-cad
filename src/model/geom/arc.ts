import type { Vec2 } from '../geometry';

export const TAU = Math.PI * 2;

/** Normalizes an angle to [0, 2π). */
export function normAngle(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** CCW sweep from a0 to a1 in (0, 2π]. Equal angles mean a full turn. */
export function sweep(a0: number, a1: number): number {
  const s = normAngle(a1 - a0);
  return s < 1e-12 ? TAU : s;
}

/** Whether angle θ lies on the CCW arc from a0 spanning `sw` (inclusive, with tolerance). */
export function onArc(theta: number, a0: number, sw: number, eps = 1e-9): boolean {
  if (sw >= TAU - eps) return true;
  const d = normAngle(theta - a0);
  return d <= sw + eps || d >= TAU - eps;
}

/** Position of angle θ along the arc as 0..1 (for trimming parameters). */
export function arcParam(theta: number, a0: number, sw: number): number {
  return normAngle(theta - a0) / sw;
}

export const pointOnCircle = (c: Vec2, r: number, a: number): Vec2 => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });

export function circleThrough(p1: Vec2, p2: Vec2, p3: Vec2): { c: Vec2; r: number } | null {
  const ax = p2.x - p1.x;
  const ay = p2.y - p1.y;
  const bx = p3.x - p1.x;
  const by = p3.y - p1.y;
  const d = 2 * (ax * by - ay * bx);
  if (Math.abs(d) < 1e-12) return null; // collinear
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const cx = (by * a2 - ay * b2) / d;
  const cy = (ax * b2 - bx * a2) / d;
  return { c: { x: p1.x + cx, y: p1.y + cy }, r: Math.hypot(cx, cy) };
}

export interface ArcGeom {
  c: Vec2;
  r: number;
  /** Start angle (radians, CCW from east). */
  a0: number;
  /** End angle; the arc runs CCW from a0 to a1. */
  a1: number;
}

/**
 * Arc from start through mid to end. Stored CCW, so a clockwise pick order
 * swaps start and end — the drawn shape is the same.
 */
export function arcThrough(start: Vec2, mid: Vec2, end: Vec2): ArcGeom | null {
  const circle = circleThrough(start, mid, end);
  if (!circle) return null;
  const { c, r } = circle;
  const as = Math.atan2(start.y - c.y, start.x - c.x);
  const am = Math.atan2(mid.y - c.y, mid.x - c.x);
  const ae = Math.atan2(end.y - c.y, end.x - c.x);
  const ccw = normAngle(am - as) < normAngle(ae - as);
  return ccw ? { c, r, a0: normAngle(as), a1: normAngle(ae) } : { c, r, a0: normAngle(ae), a1: normAngle(as) };
}

export function tessellateArc(a: ArcGeom, maxStep = TAU / 72): Vec2[] {
  const sw = sweep(a.a0, a.a1);
  const n = Math.max(2, Math.ceil(sw / maxStep));
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(pointOnCircle(a.c, a.r, a.a0 + (sw * i) / n));
  return pts;
}

export const arcStart = (a: ArcGeom) => pointOnCircle(a.c, a.r, a.a0);
export const arcEnd = (a: ArcGeom) => pointOnCircle(a.c, a.r, a.a1);
export const arcMid = (a: ArcGeom) => pointOnCircle(a.c, a.r, a.a0 + sweep(a.a0, a.a1) / 2);
export const arcLength = (a: ArcGeom) => a.r * sweep(a.a0, a.a1);

/** DXF bulge (tan(θ/4)) of a counter-clockwise arc. */
export const bulgeFromArc = (a: ArcGeom) => Math.tan(sweep(a.a0, a.a1) / 4);
