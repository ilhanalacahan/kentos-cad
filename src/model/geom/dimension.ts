import type { Vec2 } from '../geometry';

export interface DimensionGeom {
  /** Measured points. */
  a: Vec2;
  b: Vec2;
  /** Signed distance of the dimension line from a→b (positive = left). */
  offset: number;
  /** Text height in metres; gaps and ticks are proportional to it. */
  height: number;
}

export interface DimensionLayout {
  /** Extension lines, dimension line and oblique ticks. */
  lines: [Vec2, Vec2][];
  /** Dimension line end points. */
  d1: Vec2;
  d2: Vec2;
  /** Text anchor (centre of text baseline area) and readable rotation in degrees. */
  textAt: Vec2;
  rotation: number;
  length: number;
}

/**
 * Aligned dimension drawn the way cadastral sheets do it: extension lines
 * with a small gap from the measured points, a dimension line with oblique
 * ticks, and the value above the line, always reading left-to-right.
 */
export function layoutDimension(d: DimensionGeom): DimensionLayout | null {
  const dx = d.b.x - d.a.x;
  const dy = d.b.y - d.a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const side = d.offset >= 0 ? 1 : -1;
  const gap = d.height * 0.5;
  const ext = d.height * 0.5;
  const tick = d.height * 0.6;
  const at = (p: Vec2, k: number) => ({ x: p.x + nx * k, y: p.y + ny * k });
  const d1 = at(d.a, d.offset);
  const d2 = at(d.b, d.offset);
  const lines: [Vec2, Vec2][] = [];
  if (Math.abs(d.offset) > gap) {
    lines.push([at(d.a, side * gap), at(d.a, d.offset + side * ext)]);
    lines.push([at(d.b, side * gap), at(d.b, d.offset + side * ext)]);
  }
  lines.push([d1, d2]);
  // Oblique (45°) ticks centred on the dimension line ends.
  const tx = ((ux + nx) * Math.SQRT1_2 * tick) / 2;
  const ty = ((uy + ny) * Math.SQRT1_2 * tick) / 2;
  for (const p of [d1, d2]) lines.push([{ x: p.x - tx, y: p.y - ty }, { x: p.x + tx, y: p.y + ty }]);

  let rotation = (Math.atan2(uy, ux) * 180) / Math.PI;
  let textSide = 1;
  if (rotation > 90 || rotation <= -90) {
    rotation += rotation > 0 ? -180 : 180;
    textSide = -1; // flipped reading direction: "above" is the other normal
  }
  const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
  const lift = textSide * (d.height * 0.35);
  return { lines, d1, d2, textAt: { x: mid.x + nx * lift, y: mid.y + ny * lift }, rotation, length };
}

/** Signed perpendicular distance of p from the line a→b (positive = left). */
export function signedOffset(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return (dx * (p.y - a.y) - dy * (p.x - a.x)) / l;
}
