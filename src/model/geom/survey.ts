import type { Vec2 } from '../geometry';
import { circleCircle, lineLine } from './intersect';

/**
 * Surveying point constructions ("Koordinat hesap makinası"), in the
 * conventions a Turkish surveyor reads off field notes: abscissa along the
 * line A→B, ordinate square to it and positive to the right; horizontal
 * angles clockwise from the reference direction.
 */

const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const unit = (a: Vec2, b: Vec2): Vec2 | null => {
  const d = sub(b, a);
  const l = Math.hypot(d.x, d.y);
  return l < 1e-12 ? null : { x: d.x / l, y: d.y / l };
};

/** Yan nokta (dik ayak / dik boy): `absis` along A→B from A, `ordinat` square to it (+ right). */
export function sidePoint(a: Vec2, b: Vec2, absis: number, ordinat: number): Vec2 | null {
  const u = unit(a, b);
  if (!u) return null;
  // Right of travel is the direction turned −90°: (u.y, −u.x).
  return { x: a.x + u.x * absis + u.y * ordinat, y: a.y + u.y * absis - u.x * ordinat };
}

/** Absis and ordinat (+ right) of p relative to the line A→B. */
export function sideOffsets(a: Vec2, b: Vec2, p: Vec2): { absis: number; ordinat: number } | null {
  const u = unit(a, b);
  if (!u) return null;
  const v = sub(p, a);
  return { absis: v.x * u.x + v.y * u.y, ordinat: v.x * u.y - v.y * u.x };
}

/**
 * Kenar kesişimi: points at distance d1 from A and d2 from B. Two
 * solutions, the one right of A→B first; one when the circles touch.
 */
export function distanceIntersection(a: Vec2, b: Vec2, d1: number, d2: number): Vec2[] {
  if (!(d1 > 0) || !(d2 > 0)) return [];
  const pts = circleCircle(a, d1, b, d2);
  return pts.sort((p, q) => (sideOffsets(a, b, q)?.ordinat ?? 0) - (sideOffsets(a, b, p)?.ordinat ?? 0));
}

/** Doğru kesişimi: where the lines A→B and C→D (unbounded) cross. */
export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  return lineLine(a, b, c, d)?.p ?? null;
}

/** Hat üzerinde nokta: `distance` from A towards B (negative: behind A). */
export function alongLine(a: Vec2, b: Vec2, distance: number): Vec2 | null {
  const u = unit(a, b);
  return u ? { x: a.x + u.x * distance, y: a.y + u.y * distance } : null;
}

/** Açı-mesafe: from station S, `angle` (radians) clockwise from S→R, then `distance`. */
export function polarPoint(s: Vec2, r: Vec2, angle: number, distance: number): Vec2 | null {
  const u = unit(s, r);
  if (!u) return null;
  const c = Math.cos(-angle);
  const n = Math.sin(-angle);
  return { x: s.x + (u.x * c - u.y * n) * distance, y: s.y + (u.x * n + u.y * c) * distance };
}

/** Clockwise angle (radians, 0…2π) at S from S→R to S→P. */
export function clockwiseAngle(s: Vec2, r: Vec2, p: Vec2): number {
  const a = Math.atan2(r.y - s.y, r.x - s.x) - Math.atan2(p.y - s.y, p.x - s.x);
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}
