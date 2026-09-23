import { signedArea, type Vec2 } from '../../model/geometry';

/**
 * Pure helpers for numbering corner points: the number format, the order
 * a ring is walked in, and one number per location across many shapes
 * (neighbouring parcels share their common corners).
 */

export interface NumberFormat {
  /** Text before the number ("P"). */
  prefix: string;
  /** Total length including the prefix ("P00001" → 6). */
  length: number;
  /** Fills the gap between prefix and digits; empty means no padding. */
  pad: string;
}

/** "P" + 17 at length 6 with "0" → "P00017". A number too long for the width is written in full. */
export function formatNumber(n: number, f: NumberFormat): string {
  const digits = String(n);
  const width = Math.max(0, f.length - f.prefix.length);
  return f.prefix + (f.pad ? digits.padStart(width, f.pad[0]) : digits);
}

/** The number in a name written in this format, or null ("P00017" → 17). */
export function parseNumber(name: string, f: NumberFormat): number | null {
  if (!name.startsWith(f.prefix)) return null;
  const rest = name.slice(f.prefix.length);
  const digits = f.pad && f.pad !== '0' ? rest.replace(new RegExp(`^[${f.pad.replace(/[\\\]^-]/g, '\\$&')}]+`), '') : rest;
  return /^\d+$/.test(digits) ? parseInt(digits, 10) : null;
}

export type StartCorner = 'northwest' | 'north' | 'first' | 'point';
export type Direction = 'cw' | 'ccw';

/** How strongly a vertex is "the start": larger wins. */
function startKey(start: StartCorner, point: Vec2 | null): (p: Vec2, i: number) => number {
  switch (start) {
    case 'northwest':
      // Nearest the north-west: highest northing minus easting (ties go north).
      return (p) => p.y - p.x + p.y * 1e-12;
    case 'north':
      return (p) => p.y - p.x * 1e-12;
    case 'point':
      return (p) => (point ? -Math.hypot(p.x - point.x, p.y - point.y) : 0);
    default:
      return (_p, i) => -i;
  }
}

/**
 * Indices of a ring in walking order: turned to the requested direction
 * and rotated to start at the chosen corner. An open path is walked from
 * whichever end is the better start (direction does not apply).
 */
export function ringOrder(pts: readonly Vec2[], closed: boolean, dir: Direction, start: StartCorner, point: Vec2 | null = null): number[] {
  const n = pts.length;
  const idx = [...Array(n).keys()];
  const key = startKey(start, point);
  if (!closed) {
    if (n < 2) return idx;
    return key(pts[n - 1], n - 1) > key(pts[0], 0) && start !== 'first' ? idx.reverse() : idx;
  }
  const ccw = signedArea(pts) > 0;
  const walk = ccw === (dir === 'ccw') ? idx : [idx[0], ...idx.slice(1).reverse()];
  let best = 0;
  for (let k = 1; k < walk.length; k++) if (key(pts[walk[k]], walk[k]) > key(pts[walk[best]], walk[best])) best = k;
  return [...walk.slice(best), ...walk.slice(0, best)];
}

export interface NumberingInput {
  /** Closed rings (outer first, then holes) or one open path. */
  rings: { pts: readonly Vec2[]; closed: boolean }[];
}

export interface NumberingOptions {
  dir: Direction;
  start: StartCorner;
  point: Vec2 | null;
  format: NumberFormat;
  first: number;
  step: number;
  /** Corners closer than this (m) are one point with one number. */
  tolerance: number;
  /** Merge corners shared by several shapes (and with existing points). */
  shared: boolean;
  /** Points already numbered on the target layer: their names are kept and the counter continues after them. */
  existing: readonly { p: Vec2; name: string }[];
}

export interface NumberedCorner {
  p: Vec2;
  name: string;
  /** Unit vector pointing away from the shape at this corner (for text placement). */
  out: Vec2;
  /** False when the corner reused an existing point or an earlier shape's number. */
  created: boolean;
}

/** Spatial hash of named points, merging within the tolerance. */
class PointIndex {
  private readonly cell: number;
  private readonly grid = new Map<string, { p: Vec2; name: string }[]>();
  constructor(tolerance: number) {
    this.cell = Math.max(tolerance, 1e-9);
  }
  private key(x: number, y: number) {
    return `${x},${y}`;
  }
  find(p: Vec2): string | null {
    const gx = Math.floor(p.x / this.cell);
    const gy = Math.floor(p.y / this.cell);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const q of this.grid.get(this.key(i, j)) ?? []) if (Math.hypot(q.p.x - p.x, q.p.y - p.y) <= this.cell) return q.name;
    return null;
  }
  add(p: Vec2, name: string): void {
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    const list = this.grid.get(k);
    if (list) list.push({ p, name });
    else this.grid.set(k, [{ p, name }]);
  }
}

/** Outward unit direction at corner i of a ring (bisector of the two edge normals). */
function outward(pts: readonly Vec2[], i: number, closed: boolean): Vec2 {
  const n = pts.length;
  const ccw = closed && signedArea(pts) > 0;
  const normal = (a: Vec2, b: Vec2) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Right of travel is outside a counter-clockwise ring.
    const s = !closed || ccw ? 1 : -1;
    return { x: ((b.y - a.y) / l) * s, y: (-(b.x - a.x) / l) * s };
  };
  const prev = i > 0 ? normal(pts[i - 1], pts[i]) : closed ? normal(pts[n - 1], pts[0]) : null;
  const next = i < n - 1 ? normal(pts[i], pts[i + 1]) : closed ? normal(pts[n - 1], pts[0]) : null;
  const sx = (prev?.x ?? 0) + (next?.x ?? 0);
  const sy = (prev?.y ?? 0) + (next?.y ?? 0);
  const l = Math.hypot(sx, sy);
  return l > 1e-12 ? { x: sx / l, y: sy / l } : { x: 0, y: 1 };
}

/**
 * Numbers the corners of every shape. Shapes are taken in order of their
 * start corner (north-west first for the compass starts, nearest first
 * for a point, as given for "first"); each ring is walked from its start
 * in the chosen direction, outer ring before holes.
 */
export function numberCorners(inputs: readonly NumberingInput[], o: NumberingOptions): NumberedCorner[] {
  const index = new PointIndex(o.tolerance);
  let next = o.first;
  for (const e of o.existing) {
    if (o.shared) index.add(e.p, e.name);
    const n = parseNumber(e.name, o.format);
    if (n !== null && n + o.step > next) next = n + o.step;
  }
  const key = startKey(o.start, o.point);
  const ordered = inputs
    .map((input, i) => {
      const r = input.rings[0];
      const order = r ? ringOrder(r.pts, r.closed, o.dir, o.start, o.point) : [];
      return { input, i, score: r && order.length ? key(r.pts[order[0]], o.start === 'first' ? i : order[0]) : -Infinity };
    })
    .sort((a, b) => (o.start === 'first' ? a.i - b.i : b.score - a.score));
  const out: NumberedCorner[] = [];
  for (const { input } of ordered)
    for (const ring of input.rings) {
      const order = ringOrder(ring.pts, ring.closed, o.dir, o.start, o.point);
      for (const i of order) {
        const p = ring.pts[i];
        const known = o.shared ? index.find(p) : null;
        const name = known ?? formatNumber(next, o.format);
        if (!known) {
          next += o.step;
          index.add(p, name);
        }
        out.push({ p, name, out: outward(ring.pts, i, ring.closed), created: !known });
      }
    }
  return out;
}
