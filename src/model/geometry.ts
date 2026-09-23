/** World coordinates in metres. x = easting (Y, sağa), y = northing (X, yukarı). */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });
export const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.y - a.y);

export function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function extendBounds(b: Bounds, p: Vec2, pad = 0): Bounds {
  b.minX = Math.min(b.minX, p.x - pad);
  b.minY = Math.min(b.minY, p.y - pad);
  b.maxX = Math.max(b.maxX, p.x + pad);
  b.maxY = Math.max(b.maxY, p.y + pad);
  return b;
}

export const isEmptyBounds = (b: Bounds) => !(b.maxX >= b.minX && b.maxY >= b.minY);

/**
 * Signed shoelace area; positive for counter-clockwise rings. Coordinates
 * are taken relative to the first vertex: products of raw TM coordinates
 * (4.4·10⁶ m) would cancel away the fourth decimal of a parcel area.
 */
export function signedArea(pts: readonly Vec2[]): number {
  if (pts.length < 3) return 0;
  const ox = pts[0].x;
  const oy = pts[0].y;
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - ox) * (pts[i].y - oy) - (pts[i].x - ox) * (pts[j].y - oy);
  return a / 2;
}

export function pathLength(pts: readonly Vec2[], closed = false): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 2) l += dist(pts[pts.length - 1], pts[0]);
  return l;
}

export function centroid(pts: readonly Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: s.x / pts.length, y: s.y / pts.length };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    cx += (pts[j].x + pts[i].x) * f;
    cy += (pts[j].y + pts[i].y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Angle in degrees, counter-clockwise from east (CAD convention). */
export const angleDeg = (a: Vec2, b: Vec2) => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

/**
 * Surveying bearing (semt) in grads, clockwise from grid north — the unit
 * Turkish surveyors read off a total station.
 */
export function bearingGrad(a: Vec2, b: Vec2): number {
  const g = (Math.atan2(b.x - a.x, b.y - a.y) * 200) / Math.PI;
  return (g + 400) % 400;
}
