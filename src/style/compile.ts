import type { Entity } from '../model/entities';
import { compileExpression, type CompiledExpression } from '../model/expression/expression';
import { toNumber, toText, truthy, type ExprScope, type ExprValue } from '../model/expression/expressionLib';
import { offsetPath } from '../model/geom/offset';
import type { Vec2 } from '../model/geometry';
import { interiorPoint, placeAlong, type StyledGeometry } from './geometry';
import type { FillPaint, MarkerCommon, MarkerStyle, PrimitiveSink, PrimUnit, StrokeStyle } from './primitives';
import type { DataDefined, FillLayer, LineLayer, MarkerLayer, MarkerSymbol, SizeUnit, Symbol } from './types';

/**
 * Symbol × geometry × object → drawing primitives. Pure and CPU-side:
 * units are converted (mm on paper → metres at the plot scale), data-
 * defined values are evaluated, parallel offsets and marker positions
 * along lines are computed in float64. The result feeds the GPU batches
 * and the Canvas2D previews alike.
 */

/** A CSS pixel on paper (96 dpi), used where a length in px must become geometry. */
export const MM_PER_PX = 25.4 / 96;

/** Compiled expressions by source, shared across a build (null = does not compile). */
export class ExprCache {
  private readonly map = new Map<string, CompiledExpression | null>();
  /** Sources that did not compile, for the style designer to show. */
  readonly errors = new Map<string, string>();

  get(src: string): CompiledExpression | null {
    let e = this.map.get(src);
    if (e === undefined) {
      const r = compileExpression(src);
      e = r.ok ? r.expr : null;
      if (!r.ok) this.errors.set(src, r.error);
      this.map.set(src, e);
    }
    return e;
  }
}

export interface CompileEnv {
  /** Denominator of the project's plot scale (1000 for 1:1000): 1 mm on paper = plotScale/1000 m. */
  readonly plotScale: number;
  readonly exprs: ExprCache;
  layerName(id: string): string;
  /** Height/width of an image asset (tiles keep their proportions); 1 when unknown. */
  assetAspect?(id: string): number;
}

/** The object and its position in the run, as expressions see it. */
export interface CompileTarget {
  readonly entity: Entity;
  readonly index: number;
}

function evaluate(v: { expr: string }, t: CompileTarget, env: CompileEnv): ExprValue {
  const e = env.exprs.get(v.expr);
  if (!e) return null;
  const scope: ExprScope = { entity: t.entity, index: t.index, layerName: env.layerName };
  return e.evaluate(scope);
}

export function ddNumber(v: DataDefined<number> | undefined, t: CompileTarget, env: CompileEnv, fallback: number): number {
  if (v === undefined) return fallback;
  if (typeof v === 'number') return v;
  const n = toNumber(evaluate(v, t, env));
  return n ?? v.fallback ?? fallback;
}

export function ddText(v: DataDefined<string> | undefined, t: CompileTarget, env: CompileEnv): string {
  if (v === undefined) return '';
  if (typeof v === 'string') return v;
  const r = evaluate(v, t, env);
  return r === null ? (v.fallback ?? '') : toText(r);
}

export function ddBool(v: DataDefined<boolean> | undefined, t: CompileTarget, env: CompileEnv): boolean {
  if (v === undefined) return true;
  if (typeof v === 'boolean') return v;
  const r = evaluate(v, t, env);
  return r === null ? (v.fallback ?? true) : truthy(r);
}

const COLOR = /^(#[0-9a-f]{6}([0-9a-f]{2})?|ink|fg|fg-dim)$/i;

export function ddColor(v: DataDefined<string> | null | undefined, t: CompileTarget, env: CompileEnv): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  const r = toText(evaluate(v, t, env)).trim();
  return COLOR.test(r) ? r : (v.fallback ?? null);
}

/** A length that changes geometry (offset, interval, spacing) in metres. */
export function toWorld(v: number, unit: SizeUnit | undefined, env: CompileEnv): number {
  if (unit === 'm') return v;
  const mm = unit === 'px' ? v * MM_PER_PX : v;
  return (mm * env.plotScale) / 1000;
}

/** A drawn size (width, marker size, dash): px stays px for the shader, the rest becomes metres. */
export function toDrawn(v: number, unit: SizeUnit | undefined, env: CompileEnv): { v: number; unit: PrimUnit } {
  return unit === 'px' ? { v, unit: 'px' } : { v: toWorld(v, unit, env), unit: 'world' };
}

const DEG = Math.PI / 180;

// ── Markers ────────────────────────────────────────────────────────────

/** One marker layer at a point; `angle` is the placement direction (radians). */
export function emitMarker(layer: MarkerLayer, at: Vec2, angle: number, level: number, t: CompileTarget, env: CompileEnv, sink: PrimitiveSink): void {
  const style = markerStyle(layer, level, t, env);
  if (style) sink.marker(style, at, angle);
}

export function markerStyle(layer: MarkerLayer, level: number, t: CompileTarget, env: CompileEnv): MarkerStyle | null {
  if (!ddBool(layer.enabled, t, env)) return null;
  const size = toDrawn(ddNumber(layer.size, t, env, 2), layer.unit, env);
  const off = layer.offset ?? [0, 0];
  const conv = (v: number) => (size.unit === 'px' ? v : toWorld(v, layer.unit, env));
  const common: MarkerCommon = {
    unit: size.unit,
    opacity: layer.opacity ?? 1,
    offset: [conv(off[0]), conv(off[1])],
    anchor: layer.anchor ?? 'center',
    rotation: ddNumber(layer.rotation, t, env, 0) * DEG,
    level,
  };
  switch (layer.type) {
    case 'shape':
      return {
        kind: 'shape',
        shape: layer.shape,
        size: size.v,
        height: layer.height !== undefined ? conv(layer.height) : size.v,
        fill: ddColor(layer.fill, t, env),
        stroke: ddColor(layer.stroke, t, env),
        strokeWidth: layer.strokeWidth !== undefined ? conv(layer.strokeWidth) : 0,
        common,
      };
    case 'svg':
      return { kind: 'svg', asset: layer.asset, size: size.v, fill: ddColor(layer.fill, t, env), stroke: ddColor(layer.stroke, t, env), common };
    case 'raster':
      return { kind: 'raster', asset: layer.asset, size: size.v, common };
    case 'text': {
      const text = ddText(layer.text, t, env);
      if (!text) return null;
      return {
        kind: 'text',
        text,
        size: size.v,
        font: layer.font ?? 'ui',
        weight: layer.weight ?? 400,
        italic: !!layer.italic,
        color: ddColor(layer.color, t, env) ?? 'ink',
        halo: layer.halo ? { color: layer.halo.color, width: conv(layer.halo.width) } : null,
        common,
      };
    }
  }
}

function emitMarkerSymbol(symbol: MarkerSymbol, at: Vec2, angle: number, level: number, t: CompileTarget, env: CompileEnv, sink: PrimitiveSink): void {
  for (const layer of symbol.layers) emitMarker(layer, at, angle, level, t, env, sink);
}

// ── Lines ──────────────────────────────────────────────────────────────

function strokeStyle(layer: Extract<LineLayer, { type: 'simpleLine' }>, level: number, t: CompileTarget, env: CompileEnv): StrokeStyle | null {
  const color = ddColor(layer.color, t, env);
  if (!color) return null;
  const width = toDrawn(ddNumber(layer.width, t, env, 0), layer.unit, env);
  const dash = layer.dash?.length ? layer.dash.map((d) => (width.unit === 'px' ? d : toWorld(d, layer.unit, env))) : null;
  return {
    color,
    opacity: layer.opacity ?? 1,
    width: width.v,
    unit: width.unit,
    dash,
    dashOffset: layer.dashOffset ? (width.unit === 'px' ? layer.dashOffset : toWorld(layer.dashOffset, layer.unit, env)) : 0,
    cap: layer.cap ?? 'butt',
    join: layer.join ?? 'miter',
    level,
  };
}

/** A line layer on one path (a line, or an area ring when `ring` says which). */
function emitLineLayer(layer: LineLayer, pts: readonly Vec2[], closed: boolean, level: number, t: CompileTarget, env: CompileEnv, sink: PrimitiveSink): void {
  if (!ddBool(layer.enabled, t, env)) return;
  const d = layer.offset ? toWorld(layer.offset, layer.unit, env) : 0;
  const path = d ? offsetPath(pts, d, closed) : pts;
  if (path.length < 2) return;
  if (layer.type === 'simpleLine') {
    const style = strokeStyle(layer, level, t, env);
    if (style) sink.stroke(style, path, closed);
    return;
  }
  const interval = layer.interval !== undefined ? toWorld(layer.interval, layer.unit, env) : 0;
  const along = layer.offsetAlong !== undefined ? toWorld(layer.offsetAlong, layer.unit, env) : 0;
  for (const p of placeAlong(path, closed, layer.placement, interval, along)) emitMarkerSymbol(layer.marker, p.at, layer.rotate === false ? 0 : p.angle, level, t, env, sink);
}

// ── Fills ──────────────────────────────────────────────────────────────

function emitFillLayer(layer: FillLayer, rings: readonly (readonly Vec2[])[], level: number, t: CompileTarget, env: CompileEnv, sink: PrimitiveSink): void {
  if (layer.type === 'simpleLine' || layer.type === 'markerLine') {
    const which = layer.rings ?? 'all';
    rings.forEach((r, i) => {
      if ((which === 'exterior' && i > 0) || (which === 'interior' && i === 0)) return;
      emitLineLayer(layer, r, true, level, t, env, sink);
    });
    return;
  }
  if (!ddBool(layer.enabled, t, env)) return;
  const opacity = layer.opacity ?? 1;
  switch (layer.type) {
    case 'simpleFill': {
      const color = ddColor(layer.color, t, env);
      if (color) sink.fill({ kind: 'solid', color, opacity, level }, rings);
      return;
    }
    case 'hatchFill': {
      const color = ddColor(layer.color, t, env);
      if (!color || !(layer.spacing > 0)) return;
      const px = layer.unit === 'px';
      const len = (v: number) => (px ? v : toWorld(v, layer.unit, env));
      const paint: FillPaint = {
        kind: 'hatch',
        color,
        opacity,
        angle: layer.angle * DEG,
        spacing: len(layer.spacing),
        width: len(layer.width),
        offset: len(layer.offset ?? 0),
        dash: layer.dash?.length ? layer.dash.map(len) : null,
        unit: px ? 'px' : 'world',
        level,
      };
      sink.fill(paint, rings);
      return;
    }
    case 'patternFill': {
      if (!(layer.spacingX > 0 && layer.spacingY > 0)) return;
      // Pattern markers are drawn into a tile, so their sizes stay in the tile's unit.
      const markers = layer.marker.layers.flatMap((m) => markerStyle(m, level, t, env) ?? []);
      if (!markers.length) return;
      const px = layer.unit === 'px';
      const len = (v: number) => (px ? v : toWorld(v, layer.unit, env));
      const off = layer.offset ?? [0, 0];
      sink.fill(
        { kind: 'tile', tile: { kind: 'markers', markers, stagger: !!layer.stagger }, size: [len(layer.spacingX), len(layer.spacingY)], angle: (layer.angle ?? 0) * DEG, offset: [len(off[0]), len(off[1])], opacity, unit: px ? 'px' : 'world', level },
        rings,
      );
      return;
    }
    case 'imageFill': {
      if (!(layer.tileSize > 0)) return;
      const px = layer.unit === 'px';
      const w = px ? layer.tileSize : toWorld(layer.tileSize, layer.unit, env);
      const aspect = env.assetAspect?.(layer.asset) ?? 1;
      sink.fill({ kind: 'tile', tile: { kind: 'asset', asset: layer.asset }, size: [w, w * aspect], angle: (layer.angle ?? 0) * DEG, offset: [0, 0], opacity, unit: px ? 'px' : 'world', level }, rings);
      return;
    }
    case 'centroidMarker': {
      const at = layer.position === 'centroid' ? centroidOf(rings[0]) : interiorPoint(rings);
      if (at) emitMarkerSymbol(layer.marker, at, 0, level, t, env, sink);
      return;
    }
  }
}

function centroidOf(ring: readonly Vec2[] | undefined): Vec2 | null {
  if (!ring?.length) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
    a += f;
    cx += (ring[j].x + ring[i].x) * f;
    cy += (ring[j].y + ring[i].y) * f;
  }
  return Math.abs(a) < 1e-12 ? ring[0] : { x: cx / (3 * a), y: cy / (3 * a) };
}

// ── Entry point ────────────────────────────────────────────────────────

/**
 * Draws a symbol on a geometry of the matching class; a symbol of another
 * class draws nothing. `levelBase` orders symbol layers across a layer
 * (fills first, then lines, then markers: see the scene builder).
 */
export function compileSymbol(symbol: Symbol, geom: StyledGeometry, t: CompileTarget, env: CompileEnv, sink: PrimitiveSink, levelBase = 0): void {
  if (symbol.type === 'marker' && geom.cls === 'marker') {
    symbol.layers.forEach((l, i) => emitMarker(l, geom.point, 0, levelBase + i, t, env, sink));
  } else if (symbol.type === 'line' && geom.cls === 'line') {
    symbol.layers.forEach((l, i) => {
      for (const p of geom.paths) emitLineLayer(l, p.pts, p.closed, levelBase + i, t, env, sink);
    });
  } else if (symbol.type === 'fill' && geom.cls === 'fill') {
    symbol.layers.forEach((l, i) => emitFillLayer(l, geom.rings, levelBase + i, t, env, sink));
  }
}
