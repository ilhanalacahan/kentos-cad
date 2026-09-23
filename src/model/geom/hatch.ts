import type { Vec2 } from '../geometry';

/** Upper bound on generated hatch lines; beyond this the spacing is unusable anyway. */
export const MAX_HATCH_LINES = 20_000;

/**
 * Parallel hatch lines clipped to a ring (even–odd rule).
 * Lines sit on world-anchored multiples of `spacing`, so neighbouring
 * hatches with the same pattern line up across shared boundaries.
 *
 * @param angleDeg direction of the lines, CCW from east
 * @returns segment endpoints as [a, b] pairs and whether output was capped
 */
export function hatchLines(ring: readonly Vec2[], angleDeg: number, spacing: number): { segments: [Vec2, Vec2][]; capped: boolean } {
  const segments: [Vec2, Vec2][] = [];
  if (ring.length < 3 || !(spacing > 0)) return { segments, capped: false };
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // Local frame: u along the lines, v across them.
  const toLocal = (p: Vec2) => ({ u: p.x * cos + p.y * sin, v: -p.x * sin + p.y * cos });
  const toWorld = (u: number, v: number): Vec2 => ({ x: u * cos - v * sin, y: u * sin + v * cos });
  const loc = ring.map(toLocal);
  let minV = Infinity;
  let maxV = -Infinity;
  for (const p of loc) {
    minV = Math.min(minV, p.v);
    maxV = Math.max(maxV, p.v);
  }
  const first = Math.ceil(minV / spacing);
  const last = Math.floor(maxV / spacing);
  if (last - first + 1 > MAX_HATCH_LINES) return { segments, capped: true };
  const n = loc.length;
  const xs: number[] = [];
  for (let k = first; k <= last; k++) {
    const v = k * spacing;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = loc[j];
      const b = loc[i];
      // Half-open rule so a line through a vertex is counted once.
      if (a.v <= v !== b.v <= v) xs.push(a.u + ((v - a.v) / (b.v - a.v)) * (b.u - a.u));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > 1e-9) segments.push([toWorld(xs[i], v), toWorld(xs[i + 1], v)]);
    }
  }
  return { segments, capped: false };
}
