import type { Vec2 } from '../model/geometry';
import type { LibraryAsset } from '../model/style';
import { MM_PER_PX } from '../style/compile';
import type { FillPaint, MarkerStyle, PrimitiveSink, PrimUnit, StrokeStyle, TileSource } from '../style/primitives';
import { parseHex, resolveColor, type CanvasPalette } from './color';
import { triangulate } from './triangulate';
import { MARKER_STRIDE, STROKE_STRIDE, TEXT_BOX, type AtlasImage, type MarkerLook, type RGBA, type ScaleRange, type StyledBatch, type TileMark } from './types';

/**
 * Receives the style engine's primitives for one layer and packs them into
 * GPU batches: equal styles share a batch, geometry becomes origin-relative
 * float32 (never absolute coordinates on the GPU), colours are resolved
 * with the theme palette, and images get atlas keys. Batches come out in
 * symbol-level order: by level, and within a level fills, lines, markers.
 */

export interface SinkOptions {
  origin: Vec2;
  palette: CanvasPalette;
  /** Denominator of the plot scale, to relate px and paper mm inside pattern tiles. */
  plotScale: number;
  asset(id: string): LibraryAsset | undefined;
}

const ANCHOR: Record<string, readonly [number, number]> = {
  center: [0, 0],
  top: [0, 0.5],
  bottom: [0, -0.5],
  left: [-0.5, 0],
  right: [0.5, 0],
  'top-left': [-0.5, 0.5],
  'top-right': [0.5, 0.5],
  'bottom-left': [-0.5, -0.5],
  'bottom-right': [0.5, -0.5],
};

const KIND_ORDER = { fill: 0, stroke: 1, marker: 2 } as const;

interface Entry {
  batch: StyledBatch;
  level: number;
  order: number;
  data: number[];
}

/** SVG colours given by the symbol: param(fill) / param(stroke) (optionally with a default after them), and currentColor. */
export function applySvgParams(svg: string, fill: string | null, stroke: string | null): string {
  return svg
    .replace(/param\(\s*(fill|stroke)\s*\)(\s+#[0-9a-f]{3,8})?/gi, (_m, which: string, def?: string) => (which.toLowerCase() === 'fill' ? fill : stroke) ?? def?.trim() ?? '#000000')
    .replace(/currentColor/g, fill ?? stroke ?? '#000000');
}

export class StyledSink implements PrimitiveSink {
  private readonly opts: SinkOptions;
  private readonly entries = new Map<string, Entry>();
  /** Batch keys by style object (markers along a line share one object). */
  private readonly keys = new WeakMap<object, string>();
  private scale: ScaleRange = {};
  private seq = 0;

  constructor(opts: SinkOptions) {
    this.opts = opts;
  }

  /** Scale range of what follows (a rule's range), until changed. */
  setScale(range: ScaleRange): void {
    this.scale = range;
  }

  private rgba(color: string, opacity: number): RGBA {
    const c = parseHex(resolveColor(color, this.opts.palette));
    return [c[0], c[1], c[2], c[3] * opacity];
  }

  private entry(key: string, level: number, make: () => StyledBatch): Entry {
    const k = `${key}|${this.scale.minScale ?? ''}|${this.scale.maxScale ?? ''}`;
    let e = this.entries.get(k);
    if (!e) this.entries.set(k, (e = { batch: { ...make(), ...this.scale }, level, order: this.seq++, data: [] }));
    return e;
  }

  // ── PrimitiveSink ────────────────────────────────────────────────────

  stroke(style: StrokeStyle, path: readonly Vec2[], closed: boolean): void {
    const { origin } = this.opts;
    const e = this.entry(`s|${JSON.stringify(style)}`, style.level, () => ({
      kind: 'stroke',
      segments: new Float32Array(0),
      color: this.rgba(style.color, style.opacity),
      width: style.width,
      unit: style.unit,
      dash: style.dash ? style.dash.slice(0, 8) : null,
      dashOffset: style.dashOffset,
      cap: style.cap,
    }));
    const n = path.length;
    const count = closed ? n : n - 1;
    let d = 0;
    for (let i = 0; i < count; i++) {
      const a = path[i];
      const b = path[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-12) continue;
      const ends = (!closed && i === 0 ? 1 : 0) | (!closed && i === count - 1 ? 2 : 0);
      e.data.push(a.x - origin.x, a.y - origin.y, b.x - origin.x, b.y - origin.y, d, ends);
      d += len;
    }
  }

  fill(paint: FillPaint, rings: readonly (readonly Vec2[])[]): void {
    if (!rings.length || rings[0].length < 3) return;
    const e = this.entry(`f|${JSON.stringify(paint)}`, paint.level, () => ({ kind: 'fill', positions: new Float32Array(0), paint: this.paint(paint) }));
    triangulate(rings[0], rings.slice(1), this.opts.origin, e.data);
  }

  marker(style: MarkerStyle, at: Vec2, angle: number): void {
    let key = this.keys.get(style);
    if (!key) {
      // Size and rotation vary per object (data-defined) without splitting the batch.
      const { size: _s, ...rest } = style as MarkerStyle & { height?: number };
      key = `m|${JSON.stringify({ ...rest, height: undefined, common: { ...style.common, rotation: 0 } })}`;
      this.keys.set(style, key);
    }
    const e = this.entry(key, style.common.level, () => ({
      kind: 'marker',
      instances: new Float32Array(0),
      unit: style.common.unit,
      look: this.look(style),
      offset: style.common.offset,
      anchor: ANCHOR[style.common.anchor] ?? [0, 0],
      opacity: style.common.opacity,
    }));
    const { origin } = this.opts;
    const w = style.kind === 'text' ? 0 : style.size;
    const h = style.kind === 'shape' ? style.height : style.kind === 'text' ? style.size * TEXT_BOX : 0;
    e.data.push(at.x - origin.x, at.y - origin.y, angle + style.common.rotation, w, h);
  }

  // ── Looks and paints ─────────────────────────────────────────────────

  private look(style: MarkerStyle): MarkerLook {
    const op = style.common.opacity;
    switch (style.kind) {
      case 'shape':
        return { kind: 'shape', shape: style.shape, fill: style.fill ? this.rgba(style.fill, 1) : null, stroke: style.stroke ? this.rgba(style.stroke, 1) : null, strokeWidth: style.strokeWidth };
      case 'text': {
        const color = resolveColor(style.color, this.opts.palette);
        const halo = style.halo ? { color: resolveColor(style.halo.color, this.opts.palette), width: style.halo.width / Math.max(style.size, 1e-9) } : null;
        const font = style.font === 'serif' ? 'Georgia, "Times New Roman", serif' : style.font === 'mono' ? '"IBM Plex Mono", monospace' : 'Barlow, "Segoe UI", sans-serif';
        const key = `t|${style.text}|${style.font}|${style.weight}|${style.italic}|${color}|${halo ? `${halo.color}/${halo.width.toFixed(3)}` : ''}`;
        return { kind: 'image', image: { key, kind: 'text', text: style.text, font, weight: style.weight, italic: style.italic, color, halo }, fit: 'height' };
      }
      case 'svg':
      case 'raster':
        return { kind: 'image', image: this.assetImage(style.kind === 'svg' ? style : { ...style, fill: null, stroke: null }, op), fit: 'width' };
    }
  }

  private assetImage(s: { asset: string; fill: string | null; stroke: string | null }, _opacity: number): AtlasImage {
    const a = this.opts.asset(s.asset);
    if (!a) return { key: `missing|${s.asset}`, kind: 'svg', svg: MISSING_SVG, width: 24, height: 24 };
    if (a.format === 'svg') {
      const fill = s.fill ? resolveColor(s.fill, this.opts.palette) : null;
      const stroke = s.stroke ? resolveColor(s.stroke, this.opts.palette) : null;
      return { key: `svg|${a.id}|${fill}|${stroke}|${a.data.length}`, kind: 'svg', svg: applySvgParams(a.data, fill, stroke), width: a.width, height: a.height };
    }
    return { key: `img|${a.id}|${a.data.length}`, kind: 'raster', url: a.data, width: a.width, height: a.height };
  }

  private paint(p: FillPaint): StyledBatch extends infer _ ? Extract<StyledBatch, { kind: 'fill' }>['paint'] : never {
    switch (p.kind) {
      case 'solid':
        return { kind: 'solid', color: this.rgba(p.color, p.opacity) };
      case 'hatch':
        return { kind: 'hatch', color: this.rgba(p.color, p.opacity), angle: p.angle, spacing: p.spacing, width: p.width, offset: p.offset, dash: p.dash ? p.dash.slice(0, 8) : null, unit: p.unit };
      case 'tile': {
        const stagger = p.tile.kind === 'markers' && p.tile.stagger;
        const size: [number, number] = [p.size[0], p.size[1] * (stagger ? 2 : 1)];
        return { kind: 'tile', image: this.tileImage(p.tile, p.size, p.unit), size, angle: p.angle, offset: p.offset, opacity: p.opacity, unit: p.unit };
      }
    }
  }

  /** A pattern tile: marker looks placed in a cell, sized relative to the tile width. */
  private tileImage(tile: TileSource, size: readonly [number, number], unit: PrimUnit): AtlasImage {
    if (tile.kind === 'asset') return this.assetImage({ asset: tile.asset, fill: null, stroke: null }, 1);
    const worldPerPx = (MM_PER_PX * this.opts.plotScale) / 1000;
    const inTileUnit = (v: number, u: PrimUnit) => (u === unit ? v : u === 'px' ? v * worldPerPx : v / worldPerPx);
    const tw = size[0];
    const draw: TileMark[] = tile.markers.map((m) => {
      const w = inTileUnit(m.kind === 'text' ? m.size : m.size, m.common.unit) / tw;
      const h = inTileUnit(m.kind === 'shape' ? m.height : m.size, m.common.unit) / tw;
      const look = this.look(m);
      const lookScaled = look.kind === 'shape' ? { ...look, strokeWidth: inTileUnit(look.strokeWidth, m.common.unit) / tw } : look;
      return { look: lookScaled, w, h, offset: [inTileUnit(m.common.offset[0], m.common.unit) / tw, inTileUnit(m.common.offset[1], m.common.unit) / tw], rotation: m.common.rotation };
    });
    // A staggered tile holds two rows (the second half-shifted).
    const aspect = (size[1] / size[0]) * (tile.stagger ? 2 : 1);
    return { key: `tile|${JSON.stringify(draw)}|${aspect.toFixed(4)}|${tile.stagger}`, kind: 'tile', aspect, stagger: tile.stagger, draw };
  }

  /** The batches, in draw order. */
  finish(): StyledBatch[] {
    const list = [...this.entries.values()].sort((a, b) => a.level - b.level || KIND_ORDER[a.batch.kind] - KIND_ORDER[b.batch.kind] || a.order - b.order);
    return list.flatMap((e): StyledBatch[] => {
      const data = new Float32Array(e.data);
      const b = e.batch;
      if (b.kind === 'stroke') return data.length >= STROKE_STRIDE ? [{ ...b, segments: data }] : [];
      if (b.kind === 'fill') return data.length >= 6 ? [{ ...b, positions: data }] : [];
      return data.length >= MARKER_STRIDE ? [{ ...b, instances: data }] : [];
    });
  }
}

/** Drawn where a symbol's SVG asset is missing from the library: a crossed box. */
const MISSING_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect x="2" y="2" width="20" height="20" fill="none" stroke="#E0457B" stroke-width="2"/><path d="M4 4L20 20M20 4L4 20" stroke="#E0457B" stroke-width="2"/></svg>';
