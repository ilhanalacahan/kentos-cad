import type { Vec2 } from '../model/geometry';

/**
 * Backend-agnostic scene description. Geometry is already relative to the
 * document origin (float32-safe). Any RenderBackend — WebGL2 today, WebGPU
 * next — consumes exactly this.
 */

export type RGBA = readonly [number, number, number, number];

export interface LineBatch {
  /** Segment list: 2 vertices per segment, xy pairs. */
  positions: Float32Array;
  /** Cumulative distance along the polyline per vertex (for dash patterns). */
  distances: Float32Array;
  color: RGBA;
  /** Dash pattern in CSS px, e.g. [8, 3, 1, 3]; null = continuous. */
  dash: readonly number[] | null;
}

export interface FillBatch {
  /** Triangle list, xy pairs. */
  positions: Float32Array;
  color: RGBA;
}

export interface PointBatch {
  positions: Float32Array;
  color: RGBA;
  /** Symbol diameter in CSS px. */
  size: number;
  shape: 'ring' | 'cross' | 'triangle';
}

// ── Styled drawing (docs/STYLE.md §6) ──────────────────────────────────

/** 1:N screen scale range a batch is drawn in; checked per frame (no rebuild). */
export interface ScaleRange {
  minScale?: number;
  maxScale?: number;
}

/** Sizes in metres ("world", from paper mm at the plot scale) or screen pixels. */
export type StyleUnit = 'world' | 'px';

/** Thick, capped, dashed lines as instanced segments. */
export interface StrokeBatch extends ScaleRange {
  kind: 'stroke';
  /**
   * STROKE_STRIDE floats per segment: ax, ay, bx, by (origin-relative),
   * distance along the path at a (metres), end flags (1: a is a path end,
   * 2: b is a path end; other ends join round).
   */
  segments: Float32Array;
  color: RGBA;
  width: number;
  unit: StyleUnit;
  /** On/off lengths in `unit`, at most 8 values; null = continuous. */
  dash: readonly number[] | null;
  dashOffset: number;
  cap: 'butt' | 'round' | 'square';
}

export const STROKE_STRIDE = 6;

export type FillPaintBatch =
  | { kind: 'solid'; color: RGBA }
  | { kind: 'hatch'; color: RGBA; angle: number; spacing: number; width: number; offset: number; dash: readonly number[] | null; unit: StyleUnit }
  /** A tile from the atlas repeated over the area; `size` in `unit`. */
  | { kind: 'tile'; image: AtlasImage; size: readonly [number, number]; angle: number; offset: readonly [number, number]; opacity: number; unit: StyleUnit };

/** Triangulated areas with a paint computed per pixel (hatch lines and tiles cost no geometry). */
export interface PaintFillBatch extends ScaleRange {
  kind: 'fill';
  positions: Float32Array;
  paint: FillPaintBatch;
}

/** Shapes drawn from distance fields in the shader. */
export type ShapeId = 'circle' | 'ring' | 'square' | 'rectangle' | 'diamond' | 'triangle' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'cross' | 'x' | 'line' | 'arrow' | 'arrowhead' | 'semicircle' | 'quartercircle';

export type MarkerLook =
  | { kind: 'shape'; shape: ShapeId; fill: RGBA | null; stroke: RGBA | null; strokeWidth: number }
  /** An atlas image; `fit` says which side `size` gives (the other follows the image). */
  | { kind: 'image'; image: AtlasImage; fit: 'width' | 'height' };

/** Instanced markers sharing one look. */
export interface MarkerBatch extends ScaleRange {
  kind: 'marker';
  /** MARKER_STRIDE floats per marker: x, y (origin-relative), angle (radians), width, height (in `unit`). */
  instances: Float32Array;
  unit: StyleUnit;
  look: MarkerLook;
  /** Shift in `unit`, turned with the marker. */
  offset: readonly [number, number];
  /** Where the point sits in the box: (0,0) centre, (0,0.5) top edge, (-0.5,0) left edge … */
  anchor: readonly [number, number];
  opacity: number;
}

export const MARKER_STRIDE = 5;

/** Height of a text marker's box relative to its font size (room for accents and descenders). */
export const TEXT_BOX = 1.25;

export type StyledBatch = StrokeBatch | PaintFillBatch | MarkerBatch;

/**
 * What the atlas draws for an image, keyed by `key` (equal keys share one
 * atlas entry). Text is laid out by the atlas; SVG and raster data come
 * resolved from the style library.
 */
export type AtlasImage =
  | { key: string; kind: 'svg'; svg: string; width: number; height: number }
  | { key: string; kind: 'raster'; url: string; width: number; height: number }
  | { key: string; kind: 'text'; text: string; font: string; weight: number; italic: boolean; color: string; halo: { color: string; width: number } | null }
  /** Pattern tile: marker looks laid out on a grid cell of aspect w:h (staggered rows get a second, half-shifted copy). */
  | { key: string; kind: 'tile'; aspect: number; stagger: boolean; draw: readonly TileMark[] };

/** A marker inside a pattern tile, in tile fractions (0..1) and tile-width units. */
export interface TileMark {
  look: MarkerLook;
  /** Size as a fraction of the tile width. */
  w: number;
  h: number;
  offset: readonly [number, number];
  rotation: number;
}

export interface SceneLayer {
  id: string;
  lines: LineBatch[];
  fills: FillBatch[];
  points: PointBatch[];
  /** Styled batches in draw order (symbol levels): drawn between the plain fills and the plain lines. */
  styled?: StyledBatch[];
}

export const emptySceneLayer = (id: string): SceneLayer => ({ id, lines: [], fills: [], points: [] });

export interface ViewState {
  /** Camera centre relative to document origin (float64 on CPU). */
  center: Vec2;
  /** CSS pixels per world metre. */
  scale: number;
  width: number;
  height: number;
  dpr: number;
}

export interface FrameState {
  view: ViewState;
  /** Screen scale 1:N at 96 dpi (rule scale ranges). */
  scaleDenominator: number;
  clearColor: RGBA;
  /** Draw order of persistent layers, bottom first; hidden layers omitted. */
  order: readonly string[];
  /** Transient layers drawn on top in this order (grid first, highlight last). */
  underlays: readonly string[];
  overlays: readonly string[];
}

export type BackendKind = 'webgl2' | 'webgpu';

/** The atlas as a backend sees it: a canvas to upload when `version` changes, and where each image sits. */
export interface AtlasSource {
  readonly version: number;
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  /** Canvases for mip levels 1…n (WebGPU has no generated mipmaps). */
  mipLevels(): readonly (HTMLCanvasElement | OffscreenCanvas)[];
  /** UV rect (x, y, w, h in 0..1) and height/width of an image, or null while it is still loading. */
  lookup(image: AtlasImage): { uv: readonly [number, number, number, number]; aspect: number } | null;
  /** Places the images a draw will need before the texture is uploaded for it. */
  prefetch(images: Iterable<AtlasImage>): void;
}

/** The atlas images a styled batch draws with. */
export function batchImage(b: StyledBatch): AtlasImage | null {
  if (b.kind === 'fill' && b.paint.kind === 'tile') return b.paint.image;
  if (b.kind === 'marker' && b.look.kind === 'image') return b.look.image;
  return null;
}

export interface RenderBackend {
  readonly kind: BackendKind;
  /** Human label for the status bar, e.g. "WebGL2 · ANGLE (Intel…)". */
  readonly label: string;
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  /** Create or replace GPU resources for a layer. */
  upload(layer: SceneLayer): void;
  /** Where atlas images (SVG, text, raster, pattern tiles) come from; shared by both backends. */
  useAtlas(atlas: AtlasSource): void;
  remove(id: string): void;
  render(frame: FrameState): void;
  dispose(): void;
}
