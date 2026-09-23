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

export interface SceneLayer {
  id: string;
  lines: LineBatch[];
  fills: FillBatch[];
  points: PointBatch[];
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
  clearColor: RGBA;
  /** Draw order of persistent layers, bottom first; hidden layers omitted. */
  order: readonly string[];
  /** Transient layers drawn on top in this order (grid first, highlight last). */
  underlays: readonly string[];
  overlays: readonly string[];
}

export type BackendKind = 'webgl2' | 'webgpu';

export interface RenderBackend {
  readonly kind: BackendKind;
  /** Human label for the status bar, e.g. "WebGL2 · ANGLE (Intel…)". */
  readonly label: string;
  init(canvas: HTMLCanvasElement): Promise<void>;
  resize(width: number, height: number, dpr: number): void;
  /** Create or replace GPU resources for a layer. */
  upload(layer: SceneLayer): void;
  remove(id: string): void;
  render(frame: FrameState): void;
  dispose(): void;
}
