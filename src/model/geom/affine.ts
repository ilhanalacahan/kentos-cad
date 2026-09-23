import type { Vec2 } from '../geometry';

/**
 * 2D affine transform as [a, b, c, d, e, f]:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 * All CAD modify operations (move, rotate, scale, mirror, array) are
 * expressed as one of these so every entity kind needs one code path.
 */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export const translation = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy];

/** Rotation by `angle` radians (CCW) around `o`. */
export function rotation(angle: number, o: Vec2 = { x: 0, y: 0 }): Affine {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, sin, -sin, cos, o.x - cos * o.x + sin * o.y, o.y - sin * o.x - cos * o.y];
}

/** Uniform scale around `o`. */
export function scaling(s: number, o: Vec2 = { x: 0, y: 0 }): Affine {
  return [s, 0, 0, s, o.x * (1 - s), o.y * (1 - s)];
}

/** Reflection across the line through `p` and `q`. */
export function mirror(p: Vec2, q: Vec2): Affine {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l2 = dx * dx + dy * dy || 1;
  const a = (dx * dx - dy * dy) / l2;
  const b = (2 * dx * dy) / l2;
  // Linear part [[a, b], [b, -a]] applied around p.
  return [a, b, b, -a, p.x - a * p.x - b * p.y, p.y - b * p.x + a * p.y];
}

/** m2 ∘ m1: first m1, then m2. */
export function compose(m2: Affine, m1: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [a2 * a1 + c2 * b1, b2 * a1 + d2 * b1, a2 * c1 + c2 * d1, b2 * c1 + d2 * d1, a2 * e1 + c2 * f1 + e2, b2 * e1 + d2 * f1 + f2];
}

export function apply(m: Affine, p: Vec2): Vec2 {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

/** Applies only the linear part (for direction vectors). */
export function applyLinear(m: Affine, v: Vec2): Vec2 {
  return { x: m[0] * v.x + m[2] * v.y, y: m[1] * v.x + m[3] * v.y };
}

export const determinant = (m: Affine) => m[0] * m[3] - m[1] * m[2];

/** Length scale factor for similarity transforms (rotation/uniform scale/mirror). */
export const lengthScale = (m: Affine) => Math.sqrt(Math.abs(determinant(m)));

/** True when the transform flips orientation (mirror). */
export const isReflection = (m: Affine) => determinant(m) < 0;
