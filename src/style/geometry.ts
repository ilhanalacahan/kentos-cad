import { entityOutline, isClosedOutline, polygonHoles, polygonRing, type Entity } from '../model/entities';
import { tessellateArc } from '../model/geom/arc';
import { catmullRom } from '../model/geom/spline';
import { centroid, signedArea, type Bounds, type Vec2 } from '../model/geometry';
import type { MarkerPlacement } from '../model/style';

/**
 * Geometry as the style engine sees it: every object is a point, a set of
 * lines or an area. Areas come with the outer ring counter-clockwise and
 * holes clockwise, so "left of the drawing direction" is always into the
 * area (the offset rule of edge layers). Curves are tessellated once here.
 */

export type GeometryClass = 'marker' | 'line' | 'fill';

export type StyledGeometry =
  | { readonly cls: 'marker'; readonly point: Vec2 }
  | { readonly cls: 'line'; readonly paths: readonly { readonly pts: readonly Vec2[]; readonly closed: boolean }[] }
  | { readonly cls: 'fill'; readonly rings: readonly (readonly Vec2[])[] };

/**
 * Areas are polygons and hatches; circles and ellipses stay curves (as in
 * CAD, a circle is not filled). Text and dimensions are drawn elsewhere.
 */
export function geometryClassOf(e: Entity): GeometryClass | null {
  switch (e.kind) {
    case 'point':
      return 'marker';
    case 'polygon':
    case 'hatch':
      return 'fill';
    case 'text':
    case 'dimension':
      return null;
    default:
      return 'line';
  }
}

const oriented = (ring: readonly Vec2[], ccw: boolean): Vec2[] => (signedArea(ring) > 0 === ccw ? [...ring] : [...ring].reverse());

/** Part of an infinite line inside a box (construction lines are clipped to the view). */
function clipLine(p: Vec2, dir: Vec2, ray: boolean, r: Bounds): Vec2[] | null {
  let t0 = ray ? 0 : -Infinity;
  let t1 = Infinity;
  for (const [pp, d, min, max] of [
    [p.x, dir.x, r.minX, r.maxX],
    [p.y, dir.y, r.minY, r.maxY],
  ]) {
    if (Math.abs(d) < 1e-15) {
      if (pp < min || pp > max) return null;
      continue;
    }
    const a = (min - pp) / d;
    const b = (max - pp) / d;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  if (!(t1 > t0)) return null;
  return [
    { x: p.x + dir.x * t0, y: p.y + dir.y * t0 },
    { x: p.x + dir.x * t1, y: p.y + dir.y * t1 },
  ];
}

export function styledGeometry(e: Entity, clip?: Bounds): StyledGeometry | null {
  switch (e.kind) {
    case 'point':
      return { cls: 'marker', point: e.p };
    case 'polygon':
      return { cls: 'fill', rings: [oriented(polygonRing(e), true), ...polygonHoles(e).map((h) => oriented(h, false))] };
    case 'hatch':
      return { cls: 'fill', rings: [oriented(e.ring, true), ...(e.holes ?? []).map((h) => oriented(h, false))] };
    case 'line':
      return { cls: 'line', paths: [{ pts: [e.a, e.b], closed: false }] };
    case 'polyline':
      return { cls: 'line', paths: [{ pts: e.bulges ? entityOutline(e) : e.pts, closed: false }] };
    case 'circle':
    case 'ellipse':
      return { cls: 'line', paths: [{ pts: entityOutline(e), closed: e.kind === 'circle' || isClosedOutline(e) }] };
    case 'arc':
      return { cls: 'line', paths: [{ pts: tessellateArc(e), closed: false }] };
    case 'spline':
      return { cls: 'line', paths: [{ pts: catmullRom(e.pts, e.closed), closed: false }] };
    case 'xline':
    case 'ray': {
      const seg = clip && clipLine(e.p, e.dir, e.kind === 'ray', clip);
      return seg ? { cls: 'line', paths: [{ pts: seg, closed: false }] } : null;
    }
    default:
      return null;
  }
}

// ── Walking along a path ───────────────────────────────────────────────

export interface Placed {
  readonly at: Vec2;
  /** Direction of the path there, radians. */
  readonly angle: number;
}

/** No path gets more markers than this (a tiny interval would hang the page). */
export const MAX_MARKERS_PER_PATH = 50_000;

const dirOf = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);

/** The bisector direction at a corner: the mean of the directions in and out. */
function meanAngle(a: number, b: number): number {
  return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
}

/** Several markers per place, `spacing` apart along the path and centred on it. */
export interface PlaceGroup {
  readonly count: number;
  readonly spacing: number;
}

/**
 * Marker positions along a path. `interval` places one every `interval`
 * from `offsetAlong` (a closed path does not repeat its start at the end);
 * vertices face the bisector of their corner. A `group` puts `count`
 * markers at each place instead of one, centred on it (dots in a dash
 * gap); on a closed path they wrap around, on an open one those past an
 * end are left out.
 */
export function placeAlong(pts: readonly Vec2[], closed: boolean, placement: MarkerPlacement, interval = 0, offsetAlong = 0, group?: PlaceGroup): Placed[] {
  const n = pts.length;
  if (n < 2) return n === 1 ? [{ at: pts[0], angle: 0 }] : [];
  const segCount = closed ? n : n - 1;
  const segs: { a: Vec2; b: Vec2; len: number; start: number; angle: number }[] = [];
  let total = 0;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) continue;
    segs.push({ a, b, len, start: total, angle: dirOf(a, b) });
    total += len;
  }
  if (!segs.length) return [];
  const at = (s: number): Placed => {
    // Binary search for the segment containing s.
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= s) lo = mid;
      else hi = mid - 1;
    }
    const g = segs[lo];
    const t = Math.min(1, Math.max(0, (s - g.start) / g.len));
    return { at: { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t }, angle: g.angle };
  };
  // Where along the path each place is (vertices keep their bisector unless grouped).
  const places: { s: number; placed?: Placed }[] = [];
  switch (placement) {
    case 'interval': {
      if (!(interval > 0)) return [];
      const first = ((offsetAlong % interval) + interval) % interval;
      const end = closed ? total - 1e-9 : total + 1e-9;
      for (let s = closed ? first : offsetAlong; s <= end && places.length < MAX_MARKERS_PER_PATH; s += interval) if (s >= -1e-9) places.push({ s: Math.max(0, s) });
      break;
    }
    case 'center':
      places.push({ s: total / 2 });
      break;
    case 'segmentCenter':
      for (const g of segs) places.push({ s: g.start + g.len / 2, placed: { at: { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }, angle: g.angle } });
      break;
    case 'first':
      places.push({ s: 0, placed: { at: segs[0].a, angle: segs[0].angle } });
      break;
    case 'last': {
      const g = segs[segs.length - 1];
      places.push({ s: total, placed: { at: g.b, angle: g.angle } });
      break;
    }
    case 'vertex':
    case 'innerVertex': {
      for (let i = 0; i < segs.length; i++) {
        const prev = segs[i - 1] ?? (closed ? segs[segs.length - 1] : null);
        if (!prev && placement === 'innerVertex') continue;
        places.push({ s: segs[i].start, placed: { at: segs[i].a, angle: prev ? meanAngle(prev.angle, segs[i].angle) : segs[i].angle } });
      }
      if (!closed && placement === 'vertex') {
        const g = segs[segs.length - 1];
        places.push({ s: total, placed: { at: g.b, angle: g.angle } });
      }
      break;
    }
  }
  const count = group ? Math.max(1, Math.floor(group.count)) : 1;
  if (count === 1 || !(group!.spacing > 0)) return places.map((p) => p.placed ?? at(p.s));
  const out: Placed[] = [];
  const half = ((count - 1) * group!.spacing) / 2;
  for (const p of places) {
    for (let i = 0; i < count && out.length < MAX_MARKERS_PER_PATH; i++) {
      let s = p.s - half + i * group!.spacing;
      if (closed) s = ((s % total) + total) % total;
      else if (s < -1e-9 || s > total + 1e-9) continue;
      out.push(at(Math.min(total, Math.max(0, s))));
    }
  }
  return out;
}

// ── Waves ──────────────────────────────────────────────────────────────

/** Points per wave: enough for a smooth sine at any zoom a symbol is drawn at. */
const WAVE_STEPS = 16;

export interface WaveSpec {
  readonly shape: 'sine' | 'zigzag' | 'square';
  /** One wave's length along the path, its height to each side, and the repeat (world units). */
  readonly length: number;
  readonly amplitude: number;
  readonly spacing: number;
  /** Straight line between waves when the repeat is longer than a wave. */
  readonly connect: boolean;
}

/** Height of a wave at t ∈ [0, 1] of its length, in amplitudes (starts and ends on the line). */
function waveAt(shape: WaveSpec['shape'], t: number): number {
  if (shape === 'sine') return Math.sin(t * 2 * Math.PI);
  if (shape === 'zigzag') return t < 0.25 ? t * 4 : t < 0.75 ? 2 - t * 4 : t * 4 - 4;
  return t <= 0 || t >= 1 ? 0 : t < 0.5 ? 1 : -1;
}

/**
 * A path drawn as waves: each wave is laid along the path (following its
 * bends) and pushed to the left by the wave height. Returns the pieces to
 * stroke: one continuous path when the waves connect, one per wave when the
 * line between them is left out. Waves that would pass an open path's end
 * are cut short there.
 */
export function wavePaths(pts: readonly Vec2[], closed: boolean, w: WaveSpec): Vec2[][] {
  if (!(w.length > 0) || pts.length < 2) return [pts.slice()];
  const spacing = Math.max(w.length, w.spacing);
  const along = walker(pts, closed);
  if (!along) return [];
  const total = along.total;
  const count = Math.min(MAX_MARKERS_PER_PATH, Math.floor((total + 1e-9) / spacing));
  if (count < 1) return [pts.slice()];
  const out: Vec2[][] = [];
  let current: Vec2[] = [];
  const push = (s: number, h: number) => {
    const p = along.at(s);
    current.push({ x: p.at.x - Math.sin(p.angle) * h, y: p.at.y + Math.cos(p.angle) * h });
  };
  // Waves centred along the path, the rest shared at both ends.
  const start = (total - count * spacing) / 2 + (spacing - w.length) / 2;
  const steps = w.shape === 'square' ? 0 : WAVE_STEPS;
  for (let k = 0; k < count; k++) {
    const s0 = start + k * spacing;
    if (w.connect) {
      if (k === 0) push(0, 0);
      // The corners of the path between waves stay corners.
      along.cornersBetween(k === 0 ? 0 : s0 - (spacing - w.length), s0).forEach((c) => current.push(c));
    } else if (current.length) {
      out.push(current);
      current = [];
    }
    if (w.shape === 'square') {
      const a = w.amplitude;
      push(s0, 0);
      push(s0, a);
      push(s0 + w.length / 2, a);
      push(s0 + w.length / 2, -a);
      push(s0 + w.length, -a);
      push(s0 + w.length, 0);
    } else for (let i = 0; i <= steps; i++) push(s0 + (w.length * i) / steps, waveAt(w.shape, i / steps) * w.amplitude);
  }
  if (w.connect) {
    along.cornersBetween(start + (count - 1) * spacing + w.length, total).forEach((c) => current.push(c));
    push(closed ? 0 : total, 0);
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** Arc-length access to a path: point and direction at a distance, and the corners inside a stretch. */
function walker(pts: readonly Vec2[], closed: boolean) {
  const segs: { a: Vec2; b: Vec2; len: number; start: number; angle: number }[] = [];
  let total = 0;
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) continue;
    segs.push({ a, b, len, start: total, angle: dirOf(a, b) });
    total += len;
  }
  if (!segs.length) return null;
  const find = (s: number) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segs[mid].start <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return {
    total,
    at(s: number): Placed {
      const g = segs[find(Math.min(total, Math.max(0, s)))];
      const t = Math.min(1, Math.max(0, (s - g.start) / g.len));
      return { at: { x: g.a.x + (g.b.x - g.a.x) * t, y: g.a.y + (g.b.y - g.a.y) * t }, angle: g.angle };
    },
    cornersBetween(s0: number, s1: number): Vec2[] {
      const out: Vec2[] = [];
      for (const g of segs) if (g.start > s0 + 1e-9 && g.start < s1 - 1e-9) out.push(g.a);
      return out;
    },
  };
}

// ── Inside point ───────────────────────────────────────────────────────

function insideRings(rings: readonly (readonly Vec2[])[], p: Vec2): boolean {
  let inside = false;
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  return inside;
}

/**
 * A point inside the area where a symbol or text sits well: the centroid
 * when it is inside, else the middle of the widest inside stretch of a
 * few horizontal scan lines (GEOS "point on surface", simplified).
 */
export function interiorPoint(rings: readonly (readonly Vec2[])[]): Vec2 | null {
  const outer = rings[0];
  if (!outer || outer.length < 3) return null;
  const c = centroid(outer);
  if (insideRings(rings, c)) return c;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  let best: { x: number; y: number; w: number } | null = null;
  for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
    const y = minY + (maxY - minY) * f;
    const xs: number[] = [];
    for (const r of rings)
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const a = r[i];
        const b = r[j];
        if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const w = xs[k + 1] - xs[k];
      if (!best || w > best.w) best = { x: (xs[k] + xs[k + 1]) / 2, y, w };
    }
  }
  return best ? { x: best.x, y: best.y } : c;
}
