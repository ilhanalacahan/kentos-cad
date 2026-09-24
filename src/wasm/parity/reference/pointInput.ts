import { dist, type Vec2 } from '../../../model/geometry';
import { alongLine, polarPoint } from '../../../model/geom/survey';

/**
 * The point input computations as the tools did them in TypeScript before
 * the core took them over (docs/adr/0008, S5): typed coordinates
 * (`tools/coordinateInput.ts`), the ortho and polar cursor
 * (`tools/tracking.ts`) and the point calculator's own arithmetic
 * (`tools/pointCalc.ts`). They are the parity reference until S3.
 */

/** `@dY,dX`: the last point moved by the typed differences. */
export function relativePoint(last: Vec2, dx: number, dy: number): Vec2 {
  return { x: last.x + dx, y: last.y + dy };
}

/** `@distance<angle`: from the last point, the angle in degrees counter-clockwise from east. */
export function polarOffset(last: Vec2, distance: number, angle: number): Vec2 {
  const a = (angle * Math.PI) / 180;
  return { x: last.x + Math.cos(a) * distance, y: last.y + Math.sin(a) * distance };
}

/** A bare number: that far from the last point towards the cursor; null when they coincide. */
export function towardPoint(last: Vec2, cursor: Vec2, distance: number): Vec2 | null {
  const dx = cursor.x - last.x;
  const dy = cursor.y - last.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return null;
  return { x: last.x + (dx / l) * distance, y: last.y + (dy / l) * distance };
}

/** A polar-tracking ray the cursor is locked to. */
export interface Tracking {
  origin: Vec2;
  /** Degrees, CCW from east. */
  angle: number;
}

/**
 * The effective cursor for point input from `from`: an exact point (object
 * snap or tracking) stays, ortho keeps the larger of the two moves, polar
 * tracking (`polarStep` degrees; null when off) locks onto the nearest
 * ray within `tol`.
 */
export function constrainCursor(from: Vec2 | null, world: Vec2, exact: boolean, ortho: boolean, polarStep: number | null, tol: number): { point: Vec2; tracking: Tracking | null } {
  if (!from || exact) return { point: world, tracking: null };
  const dx = world.x - from.x;
  const dy = world.y - from.y;
  if (ortho) return { point: Math.abs(dx) > Math.abs(dy) ? { x: world.x, y: from.y } : { x: from.x, y: world.y }, tracking: null };
  if (polarStep === null) return { point: world, tracking: null };
  const inc = polarStep;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const snapped = Math.round(ang / inc) * inc;
  const rad = (snapped * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const along = dx * ux + dy * uy;
  const off = Math.abs(-dx * uy + dy * ux);
  if (along <= 0 || off > tol) return { point: world, tracking: null };
  return { point: { x: from.x + ux * along, y: from.y + uy * along }, tracking: { origin: from, angle: ((snapped % 360) + 360) % 360 } };
}

/** İki nokta ortası. */
export function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Hat üzerinde nokta by ratio: `num/den` of the way from A to B. */
export function alongRatio(a: Vec2, b: Vec2, num: number, den: number): Vec2 | null {
  return alongLine(a, b, (dist(a, b) * num) / den);
}

/** Açı-mesafe with the angle in the project's unit (degrees, else grads), clockwise from S→R. */
export function calcPolar(s: Vec2, r: Vec2, angle: number, unit: string, distance: number): Vec2 | null {
  const perUnit = unit === 'deg' ? Math.PI / 180 : Math.PI / 200;
  return polarPoint(s, r, angle * perUnit, distance);
}

/** The candidate nearest to p (the first of equally near ones); null for none. */
export function nearestOf(points: readonly Vec2[], p: Vec2): Vec2 | null {
  if (!points.length) return null;
  return points.reduce((a, b) => (dist(a, p) <= dist(b, p) ? a : b));
}
