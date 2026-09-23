import { entityOutline, isClosedOutline, polygonRing, tessellateCircle, type Entity } from '../model/entities';
import { tessellateArc } from '../model/geom/arc';
import { layoutDimension } from '../model/geom/dimension';
import { hatchLines } from '../model/geom/hatch';
import { catmullRom } from '../model/geom/spline';
import type { Bounds, Vec2 } from '../model/geometry';
import type { LayerStyle, LineType } from '../model/layers';
import { parseHex, resolveColor, withAlpha, type CanvasPalette } from './color';
import type { LineBatch, PointBatch, RGBA, SceneLayer } from './types';

export const DASH_PATTERNS: Record<LineType, readonly number[] | null> = {
  continuous: null,
  dashed: [9, 5],
  dashdot: [14, 4, 2, 4],
  dotted: [2, 4],
};

class LineAccumulator {
  pos: number[] = [];
  dist: number[] = [];

  path(pts: readonly Vec2[], origin: Vec2, closed: boolean): void {
    let d = 0;
    const n = pts.length;
    const count = closed ? n : n - 1;
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const ax = a.x - origin.x;
      const ay = a.y - origin.y;
      const bx = b.x - origin.x;
      const by = b.y - origin.y;
      const len = Math.hypot(bx - ax, by - ay);
      this.pos.push(ax, ay, bx, by);
      this.dist.push(d, d + len);
      d += len;
    }
  }

  batch(color: RGBA, dash: readonly number[] | null): LineBatch | null {
    if (!this.pos.length) return null;
    return { positions: new Float32Array(this.pos), distances: new Float32Array(this.dist), color, dash };
  }
}

/** Ear-clipping triangulation — fine for parcel/building rings. */
export function triangulate(pts: readonly Vec2[], origin: Vec2, out: number[]): void {
  const n = pts.length;
  if (n < 3) return;
  const idx = [...Array(n).keys()];
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  if (area < 0) idx.reverse();
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const inside = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10_000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (cross(a, b, c) <= 0) continue;
      let ear = true;
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue;
        if (inside(pts[k], a, b, c)) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push(a.x - origin.x, a.y - origin.y, b.x - origin.x, b.y - origin.y, c.x - origin.x, c.y - origin.y);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate ring; drop the remainder
  }
  if (idx.length === 3) {
    const [a, b, c] = idx.map((i) => pts[i]);
    out.push(a.x - origin.x, a.y - origin.y, b.x - origin.x, b.y - origin.y, c.x - origin.x, c.y - origin.y);
  }
}

export interface BuildOptions {
  origin: Vec2;
  palette: CanvasPalette;
  /** Force every batch into one colour (selection / hover highlight). */
  overrideColor?: RGBA;
  overrideFill?: RGBA | null;
  overrideDash?: readonly number[] | null;
  pointStyle?: Pick<PointBatch, 'size' | 'shape'>;
  /**
   * World box infinite construction lines are clipped to (a few view sizes
   * around the camera). Keeps GPU coordinates small; the viewport rebuilds
   * those layers when the view leaves it.
   */
  clip?: Bounds;
}

/** Part of the line p + dir·t (t ≥ 0 for a ray) inside box r, or null. */
function clipLine(p: Vec2, dir: Vec2, ray: boolean, r: Bounds): [Vec2, Vec2] | null {
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

/** Converts entities of one layer (or a highlight set) into GPU-ready batches. */
export function buildSceneLayer(id: string, entities: readonly Entity[], style: LayerStyle, opts: BuildOptions): SceneLayer {
  const layer: SceneLayer = { id, lines: [], fills: [], points: [] };
  // Solid hatches get their own, stronger fill than the layer's polygon fill.
  const byColor = new Map<string, { lines: LineAccumulator; fill: number[]; solid: number[]; points: number[] }>();
  const bucket = (color: string) => {
    let b = byColor.get(color);
    if (!b) byColor.set(color, (b = { lines: new LineAccumulator(), fill: [], solid: [], points: [] }));
    return b;
  };
  const { origin } = opts;

  for (const e of entities) {
    const b = bucket(e.color ?? style.color);
    switch (e.kind) {
      case 'line':
        b.lines.path([e.a, e.b], origin, false);
        break;
      case 'polyline':
        b.lines.path(e.bulges ? entityOutline(e) : e.pts, origin, false);
        break;
      case 'polygon': {
        const ring = polygonRing(e);
        b.lines.path(ring, origin, true);
        if (style.fill || opts.overrideFill) triangulate(ring, origin, b.fill);
        break;
      }
      case 'circle':
        b.lines.path(tessellateCircle(e.c, e.r), origin, true);
        break;
      case 'arc':
        b.lines.path(tessellateArc(e), origin, false);
        break;
      case 'ellipse':
        b.lines.path(entityOutline(e), origin, isClosedOutline(e));
        break;
      case 'xline':
      case 'ray': {
        const seg = opts.clip && clipLine(e.p, e.dir, e.kind === 'ray', opts.clip);
        if (seg) b.lines.path(seg, origin, false);
        break;
      }
      case 'spline':
        b.lines.path(catmullRom(e.pts, e.closed), origin, false);
        break;
      case 'dimension': {
        const l = layoutDimension(e);
        if (l) for (const [p, q] of l.lines) b.lines.path([p, q], origin, false);
        break;
      }
      case 'hatch':
        if (opts.overrideColor) {
          // Highlight: outline plus a light fill regardless of pattern.
          b.lines.path(e.ring, origin, true);
          if (opts.overrideFill) triangulate(e.ring, origin, b.fill);
        } else if (e.pattern.type === 'solid') triangulate(e.ring, origin, b.solid);
        else {
          for (const [p, q] of hatchLines(e.ring, e.pattern.angle, e.pattern.spacing).segments) b.lines.path([p, q], origin, false);
          if (e.pattern.type === 'cross')
            for (const [p, q] of hatchLines(e.ring, e.pattern.angle + 90, e.pattern.spacing).segments) b.lines.path([p, q], origin, false);
        }
        break;
      case 'point':
        b.points.push(e.p.x - origin.x, e.p.y - origin.y);
        break;
      case 'text':
        break; // text is drawn by the overlay for now (SDF text is a later milestone)
    }
  }

  const dash = opts.overrideDash !== undefined ? opts.overrideDash : DASH_PATTERNS[style.lineType];
  for (const [color, b] of byColor) {
    const rgba = opts.overrideColor ?? parseHex(resolveColor(color, opts.palette));
    const lines = b.lines.batch(rgba, dash);
    if (lines) layer.lines.push(lines);
    if (b.fill.length) {
      const fill = opts.overrideFill ?? (style.fill ? parseHex(style.fill) : withAlpha(rgba, 0.12));
      layer.fills.push({ positions: new Float32Array(b.fill), color: fill });
    }
    if (b.solid.length) layer.fills.push({ positions: new Float32Array(b.solid), color: withAlpha(rgba, 0.45) });
    if (b.points.length) {
      const pb: PointBatch = {
        positions: new Float32Array(b.points),
        color: rgba,
        size: opts.pointStyle?.size ?? style.point?.size ?? 7,
        shape: opts.pointStyle?.shape ?? style.point?.symbol ?? 'ring',
      };
      layer.points.push(pb);
    }
  }
  return layer;
}
