import type { FrameState, RenderBackend, SceneLayer } from '../types';

/**
 * WebGPU backend placeholder. It implements the same RenderBackend contract
 * as WebGL2Backend so it can be swapped in without touching the viewport,
 * tools or UI. The scene format (origin-relative float32 batches, per-batch
 * colour and dash pattern) maps 1:1 onto WGSL pipelines:
 *   - lines  → line-list pipeline, vertex {pos: vec2f, dist: f32}
 *   - fills  → triangle-list pipeline
 *   - points → instanced quads (WebGPU has no point size)
 * Until those pipelines land, init() rejects and createBackend() falls back.
 */
export class WebGPUBackend implements RenderBackend {
  readonly kind = 'webgpu' as const;
  readonly label = 'WebGPU';

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  async init(_canvas: HTMLCanvasElement): Promise<void> {
    throw new Error('WebGPU arka ucu henüz etkin değil');
  }

  resize(_width: number, _height: number, _dpr: number): void {}
  upload(_layer: SceneLayer): void {}
  remove(_id: string): void {}
  render(_frame: FrameState): void {}
  dispose(): void {}
}
