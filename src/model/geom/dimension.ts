import type { Vec2 } from '../geometry';
import { normAngle } from './arc';
import type { Edge } from './intersect';

/**
 * Dimensions, drawn the way cadastral sheets do it: extension lines with a
 * small gap from the measured points, the dimension line (or arc) with
 * oblique ticks, and the value above it, always reading left-to-right.
 *
 *   aligned   a–b along their own direction (default)
 *   linear    a–b projected on a fixed direction (`angle`; 0 = ΔY yatay,
 *             90 = ΔX düşey), dimension line parallel to it
 *   angular   the angle at vertex `c` from the arm through a to the arm
 *             through b, counter-clockwise; `offset` is the arc radius
 *   radius    a = centre, b = point on the circle; `offset` extends the
 *             line past the circle (leader)
 *   diameter  as radius, the line running through the centre
 */
export type DimensionStyle = 'aligned' | 'linear' | 'angular' | 'radius' | 'diameter';

export interface DimensionGeom {
  /** Measured points (radius, diameter: a is the centre, b on the circle). */
  a: Vec2;
  b: Vec2;
  /**
   * aligned, linear: signed distance of the dimension line (positive =
   * left of the measured direction); angular: arc radius; radius,
   * diameter: leader length past the circle.
   */
  offset: number;
  /** Text height in metres; gaps and ticks are proportional to it. */
  height: number;
  style?: DimensionStyle;
  /** linear: direction measured along, degrees CCW from east. */
  angle?: number;
  /** angular: the vertex. */
  c?: Vec2;
}

export interface DimensionLayout {
  /** Extension lines, dimension line (an arc as chords) and oblique ticks. */
  lines: [Vec2, Vec2][];
  /** Dimension line (or arc) end points. */
  d1: Vec2;
  d2: Vec2;
  /** Text anchor (centre of text baseline area) and readable rotation in degrees. */
  textAt: Vec2;
  rotation: number;
  /** Measured value: metres, or radians for an angle. */
  value: number;
  unit: 'length' | 'angle';
  /** Written before the value: "R " for a radius, "Ø " for a diameter. */
  prefix: string;
  /** Edges that pick and snap: the dimension line or arc. */
  pick: Edge[];
  /** Where the grip that moves the dimension line sits. */
  handle: Vec2;
}

export const DIMENSION_STYLE_LABEL: Record<DimensionStyle, string> = {
  aligned: 'Hizalı',
  linear: 'Doğrusal',
  angular: 'Açı',
  radius: 'Yarıçap',
  diameter: 'Çap',
};

const add = (p: Vec2, v: Vec2, k: number): Vec2 => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

/** Oblique (45°) ticks centred on a point of a line running along u. */
function tick(lines: [Vec2, Vec2][], p: Vec2, u: Vec2, size: number): void {
  const t = { x: ((u.x - u.y) * Math.SQRT1_2 * size) / 2, y: ((u.y + u.x) * Math.SQRT1_2 * size) / 2 };
  lines.push([{ x: p.x - t.x, y: p.y - t.y }, { x: p.x + t.x, y: p.y + t.y }]);
}

/** Readable text along u through `mid`, lifted to the side that is "above" for the reader. */
function textAlong(mid: Vec2, u: Vec2, height: number): { textAt: Vec2; rotation: number } {
  let rotation = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  let side = 1;
  if (rotation > 90 || rotation <= -90) {
    rotation += rotation > 0 ? -180 : 180;
    side = -1; // flipped reading direction: "above" is the other normal
  }
  return { textAt: add(mid, { x: -u.y, y: u.x }, side * height * 0.35), rotation };
}

/** Extension line from a measured point towards (and a little past) the dimension line. */
function extension(lines: [Vec2, Vec2][], from: Vec2, to: Vec2, gap: number, ext: number): void {
  const l = Math.hypot(to.x - from.x, to.y - from.y);
  if (l <= gap) return;
  const v = { x: (to.x - from.x) / l, y: (to.y - from.y) / l };
  lines.push([add(from, v, gap), add(to, v, ext)]);
}

export function layoutDimension(d: DimensionGeom): DimensionLayout | null {
  switch (d.style ?? 'aligned') {
    case 'linear':
      return linear(d, d.angle ?? 0);
    case 'angular':
      return angular(d);
    case 'radius':
    case 'diameter':
      return radial(d, d.style === 'diameter');
    default:
      return aligned(d);
  }
}

function aligned(d: DimensionGeom): DimensionLayout | null {
  const dx = d.b.x - d.a.x;
  const dy = d.b.y - d.a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  return straight(d, { x: dx / length, y: dy / length }, d.offset);
}

function linear(d: DimensionGeom, angleDeg: number): DimensionLayout | null {
  const t = (angleDeg * Math.PI) / 180;
  const u = { x: Math.cos(t), y: Math.sin(t) };
  return straight(d, u, d.offset);
}

/**
 * A distance measured along u: the dimension line runs parallel to u at
 * `offset` left of a (in u's normal), the value is the projected distance.
 */
function straight(d: DimensionGeom, u: Vec2, offset: number): DimensionLayout | null {
  const n = { x: -u.y, y: u.x };
  const value = Math.abs(dot({ x: d.b.x - d.a.x, y: d.b.y - d.a.y }, u));
  if (value < 1e-9) return null;
  const d1 = add(d.a, n, offset);
  const d2 = add(d.b, n, offset + dot(n, { x: d.a.x - d.b.x, y: d.a.y - d.b.y }));
  const gap = d.height * 0.5;
  const lines: [Vec2, Vec2][] = [];
  extension(lines, d.a, d1, gap, d.height * 0.5);
  extension(lines, d.b, d2, gap, d.height * 0.5);
  lines.push([d1, d2]);
  const l = Math.hypot(d2.x - d1.x, d2.y - d1.y);
  const along = { x: (d2.x - d1.x) / l, y: (d2.y - d1.y) / l };
  tick(lines, d1, along, d.height * 0.6);
  tick(lines, d2, along, d.height * 0.6);
  const mid = { x: (d1.x + d2.x) / 2, y: (d1.y + d2.y) / 2 };
  return { lines, d1, d2, ...textAlong(mid, along, d.height), value, unit: 'length', prefix: '', pick: [{ kind: 'seg', a: d1, b: d2 }], handle: mid };
}

function angular(d: DimensionGeom): DimensionLayout | null {
  const c = d.c;
  const r = Math.abs(d.offset);
  if (!c || r < 1e-9) return null;
  const t0 = Math.atan2(d.a.y - c.y, d.a.x - c.x);
  const sweep = normAngle(Math.atan2(d.b.y - c.y, d.b.x - c.x) - t0);
  if (sweep < 1e-9) return null;
  const at = (t: number) => ({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
  const lines: [Vec2, Vec2][] = [];
  const gap = d.height * 0.5;
  // Arms are extended to the arc when it lies beyond the measured points.
  for (const [p, t] of [
    [d.a, t0],
    [d.b, t0 + sweep],
  ] as const) {
    const rp = Math.hypot(p.x - c.x, p.y - c.y);
    if (r > rp + gap) lines.push([at2(c, t, rp + gap), at2(c, t, r + d.height * 0.5)]);
  }
  const steps = Math.max(8, Math.ceil(sweep / (Math.PI / 36)));
  for (let i = 0; i < steps; i++) lines.push([at(t0 + (sweep * i) / steps), at(t0 + (sweep * (i + 1)) / steps)]);
  const d1 = at(t0);
  const d2 = at(t0 + sweep);
  const tangent = (t: number) => ({ x: -Math.sin(t), y: Math.cos(t) });
  tick(lines, d1, tangent(t0), d.height * 0.6);
  tick(lines, d2, tangent(t0 + sweep), d.height * 0.6);
  const tm = t0 + sweep / 2;
  const mid = at(tm);
  return { lines, d1, d2, ...textAlong(mid, tangent(tm), d.height), value: sweep, unit: 'angle', prefix: '', pick: [{ kind: 'arc', c, r, a0: t0, sweep }], handle: mid };
}

const at2 = (c: Vec2, t: number, r: number): Vec2 => ({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });

function radial(d: DimensionGeom, diameter: boolean): DimensionLayout | null {
  const c = d.a;
  const r = Math.hypot(d.b.x - c.x, d.b.y - c.y);
  if (r < 1e-9) return null;
  const u = { x: (d.b.x - c.x) / r, y: (d.b.y - c.y) / r };
  const leader = Math.max(0, d.offset);
  const end = add(d.b, u, leader);
  const start = diameter ? add(c, u, -r) : c;
  const lines: [Vec2, Vec2][] = [[start, end]];
  tick(lines, d.b, u, d.height * 0.6);
  if (diameter) tick(lines, start, u, d.height * 0.6);
  // The value sits on the leader when there is one, else half-way from the centre to the circle.
  const [p0, p1] = leader > d.height ? [d.b, end] : [c, d.b];
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  return {
    lines,
    d1: start,
    d2: end,
    ...textAlong(mid, u, d.height),
    value: diameter ? 2 * r : r,
    unit: 'length',
    prefix: diameter ? 'Ø ' : 'R ',
    pick: [{ kind: 'seg', a: start, b: end }],
    handle: end,
  };
}

/** Signed perpendicular distance of p from the line a→b (positive = left). */
export function signedOffset(a: Vec2, b: Vec2, p: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return (dx * (p.y - a.y) - dy * (p.x - a.x)) / l;
}

/** The `offset` that puts the dimension line (arc, leader end) through p. */
export function dimensionOffsetAt(d: DimensionGeom, p: Vec2): number {
  switch (d.style ?? 'aligned') {
    case 'linear': {
      const t = ((d.angle ?? 0) * Math.PI) / 180;
      return -Math.sin(t) * (p.x - d.a.x) + Math.cos(t) * (p.y - d.a.y);
    }
    case 'angular':
      return d.c ? Math.hypot(p.x - d.c.x, p.y - d.c.y) : d.offset;
    case 'radius':
    case 'diameter':
      return Math.max(0, Math.hypot(p.x - d.a.x, p.y - d.a.y) - Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y));
    default:
      return signedOffset(d.a, d.b, p);
  }
}

/** The text a dimension shows: its override, or prefix + value in project units. */
export function dimensionLabel(text: string | undefined, l: DimensionLayout, fmt: { length: (m: number) => string; angle: (rad: number) => string }): string {
  if (text) return text;
  return l.prefix + (l.unit === 'angle' ? fmt.angle(l.value) : fmt.length(l.value));
}

/**
 * Horizontal (ΔY, 0°) or vertical (ΔX, 90°) for a linear dimension placed
 * at p, as AutoCAD decides it: beside the measured points → vertical,
 * above or below them → horizontal.
 */
export function linearAngleFor(a: Vec2, b: Vec2, p: Vec2): 0 | 90 {
  const outX = Math.max(Math.min(a.x, b.x) - p.x, p.x - Math.max(a.x, b.x), 0);
  const outY = Math.max(Math.min(a.y, b.y) - p.y, p.y - Math.max(a.y, b.y), 0);
  return outX > outY ? 90 : 0;
}

/**
 * The angle two lines make, chosen by where the arc goes: the two arm
 * directions bounding the sector around `p` (counter-clockwise order),
 * from the vertex `c`. Lines are given by a direction each.
 */
export function sectorArms(c: Vec2, u1: Vec2, u2: Vec2, p: Vec2): [Vec2, Vec2] {
  const dirs = [u1, u2, { x: -u1.x, y: -u1.y }, { x: -u2.x, y: -u2.y }].map((u) => ({ u, t: Math.atan2(u.y, u.x) }));
  const tp = Math.atan2(p.y - c.y, p.x - c.x);
  let best: [Vec2, Vec2] = [u1, u2];
  let bestSweep = Infinity;
  // The arm just clockwise of p starts the sector, the one just counter-clockwise ends it.
  for (const s of dirs) {
    const back = normAngle(tp - s.t);
    for (const e of dirs) {
      if (e === s) continue;
      const sweep = normAngle(e.t - s.t);
      if (sweep > 1e-9 && back <= sweep && sweep < bestSweep) {
        bestSweep = sweep;
        best = [s.u, e.u];
      }
    }
  }
  return best;
}
