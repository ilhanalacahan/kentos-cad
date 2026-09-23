import { batchImage, MARKER_STRIDE, STROKE_STRIDE, type AtlasSource, type StyledBatch } from '../types';
import { SHAPE_IDS } from '../webgl2/styledShaders';
import { STYLED_WGSL } from './styledShaders';

/**
 * WebGPU side of the styled batches, twin of webgl2/styledRenderer.ts:
 * pipelines for strokes, solid/hatch/tile fills and markers; one style
 * uniform per batch written at upload (atlas rectangles refreshed when the
 * atlas changes); the atlas as a mipmapped texture (levels drawn by the
 * atlas itself, WebGPU has no generated mipmaps).
 */

const BUFFER = { VERTEX: 0x20, UNIFORM: 0x40, COPY_DST: 0x08 } as const;
const TEXTURE = { COPY_DST: 0x02, TEXTURE_BINDING: 0x04, RENDER_ATTACHMENT: 0x10 } as const;
const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2 } as const;
/** SStyle: 8 vec4f + 1 vec4u. */
const STYLE_BYTES = 144;
const ATLAS_SIZE = 2048;
const ATLAS_MIPS = Math.log2(ATLAS_SIZE) + 1;
const SHAPE_INDEX = new Map<string, number>(SHAPE_IDS.map((s, i) => [s, i]));

interface GpuStyled {
  batch: StyledBatch;
  vertex: GPUBuffer;
  count: number;
  style: GPUBuffer;
  bind: GPUBindGroup;
  data: ArrayBuffer;
  /** Atlas version the style's rectangle was written for (tiles and images). */
  rectVersion: number;
}

export interface GpuStyledLayer {
  list: GpuStyled[];
}

function dashValues(dash: readonly number[] | null): { d: number[]; total: number; on: number } {
  if (!dash?.length) return { d: new Array(8).fill(0), total: 0, on: 1 };
  const even = dash.length % 2 ? [...dash, ...dash] : [...dash];
  const d = even.slice(0, 8);
  while (d.length < 8) d.push(0);
  const total = d.reduce((s, v) => s + v, 0);
  const on = d.reduce((s, v, i) => (i % 2 ? s : s + v), 0);
  return { d, total, on: total > 0 ? on / total : 1 };
}

export class WebGPUStyledRenderer {
  private readonly device: GPUDevice;
  private readonly styleLayout: GPUBindGroupLayout;
  private readonly atlasBind: GPUBindGroup;
  private readonly texture: GPUTexture;
  private readonly pipes: Record<'stroke' | 'solid' | 'hatch' | 'tile' | 'marker', GPURenderPipeline>;
  private atlas: AtlasSource | null = null;
  private textureVersion = -1;

  constructor(device: GPUDevice, format: GPUTextureFormat, frameLayout: GPUBindGroupLayout, samples: number) {
    this.device = device;
    const module = device.createShaderModule({ code: STYLED_WGSL });
    this.styleLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'uniform' } }] });
    const atlasLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: STAGE.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.texture = device.createTexture({ size: [ATLAS_SIZE, ATLAS_SIZE], format: 'rgba8unorm', mipLevelCount: ATLAS_MIPS, usage: TEXTURE.COPY_DST | TEXTURE.TEXTURE_BINDING | TEXTURE.RENDER_ATTACHMENT });
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.atlasBind = device.createBindGroup({ layout: atlasLayout, entries: [{ binding: 0, resource: this.texture.createView() }, { binding: 1, resource: sampler }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [frameLayout, this.styleLayout, atlasLayout] });
    const straight: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const premul: GPUBlendState = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const pipe = (vs: string, fs: string, buffers: GPUVertexBufferLayout[], blend: GPUBlendState) =>
      device.createRenderPipeline({
        layout,
        vertex: { module, entryPoint: vs, buffers },
        fragment: { module, entryPoint: fs, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
        multisample: { count: samples },
      });
    const area: GPUVertexBufferLayout = { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] };
    this.pipes = {
      stroke: pipe(
        'strokeVs',
        'strokeFs',
        [
          {
            arrayStride: STROKE_STRIDE * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32x2' },
            ],
          },
        ],
        straight,
      ),
      solid: pipe('areaVs', 'solidFs', [area], straight),
      hatch: pipe('areaVs', 'hatchFs', [area], straight),
      tile: pipe('areaVs', 'tileFs', [area], premul),
      marker: pipe(
        'markerVs',
        'markerFs',
        [
          {
            arrayStride: MARKER_STRIDE * 4,
            stepMode: 'instance',
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32' },
            ],
          },
        ],
        premul,
      ),
    };
  }

  useAtlas(atlas: AtlasSource): void {
    this.atlas = atlas;
    this.textureVersion = -1;
  }

  // ── Upload ───────────────────────────────────────────────────────────

  upload(batches: readonly StyledBatch[]): GpuStyledLayer {
    const list: GpuStyled[] = [];
    for (const b of batches) {
      const src = b.kind === 'stroke' ? b.segments : b.kind === 'marker' ? b.instances : b.positions;
      const vertex = this.device.createBuffer({ size: Math.max(4, src.byteLength), usage: BUFFER.VERTEX | BUFFER.COPY_DST });
      this.device.queue.writeBuffer(vertex, 0, src.buffer, src.byteOffset, src.byteLength);
      const count = b.kind === 'stroke' ? src.length / STROKE_STRIDE : b.kind === 'marker' ? src.length / MARKER_STRIDE : src.length / 2;
      const data = this.styleData(b);
      const style = this.device.createBuffer({ size: STYLE_BYTES, usage: BUFFER.UNIFORM | BUFFER.COPY_DST });
      this.device.queue.writeBuffer(style, 0, data);
      const bind = this.device.createBindGroup({ layout: this.styleLayout, entries: [{ binding: 0, resource: { buffer: style } }] });
      list.push({ batch: b, vertex, count, style, bind, data, rectVersion: -1 });
    }
    return { list };
  }

  release(layer: GpuStyledLayer): void {
    for (const s of layer.list) {
      s.vertex.destroy();
      s.style.destroy();
    }
  }

  /** The style uniform of a batch; atlas rectangles are filled in at draw time. */
  private styleData(b: StyledBatch): ArrayBuffer {
    const data = new ArrayBuffer(STYLE_BYTES);
    const f = new Float32Array(data);
    const u = new Uint32Array(data);
    const dash = (d: readonly number[] | null) => {
      const v = dashValues(d);
      f.set(v.d, 8);
      return v;
    };
    if (b.kind === 'stroke') {
      f.set(b.color, 0);
      const v = dash(b.dash);
      f.set([b.width, v.total, v.on, b.dashOffset], 20);
      u.set([b.unit === 'world' ? 0 : 1, b.cap === 'round' ? 1 : b.cap === 'square' ? 2 : 0, 0, 0], 32);
    } else if (b.kind === 'fill') {
      const p = b.paint;
      if (p.kind === 'solid') f.set(p.color, 0);
      else if (p.kind === 'hatch') {
        f.set(p.color, 0);
        const v = dash(p.dash);
        f.set([Math.cos(p.angle), Math.sin(p.angle), p.spacing, p.width], 20);
        f.set([p.offset, v.total, v.on, 0], 24);
        u[32] = p.unit === 'world' ? 0 : 1;
      } else {
        f.set([p.size[0], p.size[1], Math.cos(p.angle), Math.sin(p.angle)], 20);
        f.set([p.offset[0], p.offset[1], p.opacity, 0], 24);
        u[32] = p.unit === 'world' ? 0 : 1;
      }
    } else {
      const look = b.look;
      f.set([b.offset[0], b.offset[1], b.anchor[0], b.anchor[1]], 20);
      if (look.kind === 'shape') {
        f.set(look.fill ?? [0, 0, 0, 0], 0);
        f.set(look.stroke ?? [0, 0, 0, 0], 4);
        const open = look.shape === 'cross' || look.shape === 'x' || look.shape === 'line' || look.shape === 'arrow';
        f.set([1, look.stroke || open ? look.strokeWidth : 0, b.opacity, 0], 24);
        u.set([b.unit === 'world' ? 0 : 1, 0, SHAPE_INDEX.get(look.shape) ?? 0, 0], 32);
      } else {
        f.set([1, 0, b.opacity, 0], 24);
        u.set([b.unit === 'world' ? 0 : 1, 1, 0, look.fit === 'width' ? 1 : 2], 32);
      }
    }
    return data;
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  private syncAtlas(): void {
    const a = this.atlas;
    if (!a || a.version === this.textureVersion) return;
    const q = this.device.queue;
    q.copyExternalImageToTexture({ source: a.canvas }, { texture: this.texture, mipLevel: 0, premultipliedAlpha: true }, [ATLAS_SIZE, ATLAS_SIZE]);
    a.mipLevels()
      .slice(0, ATLAS_MIPS - 1)
      .forEach((c, i) => {
        const size = ATLAS_SIZE >> (i + 1);
        q.copyExternalImageToTexture({ source: c }, { texture: this.texture, mipLevel: i + 1, premultipliedAlpha: true }, [size, size]);
      });
    this.textureVersion = a.version;
  }

  /** Writes the atlas rectangle (and image aspect) of a tile or image batch; false while its image is loading. */
  private refreshRect(s: GpuStyled): boolean {
    const b = s.batch;
    const image = b.kind === 'fill' && b.paint.kind === 'tile' ? b.paint.image : b.kind === 'marker' && b.look.kind === 'image' ? b.look.image : null;
    if (!image) return true;
    if (!this.atlas) return false;
    if (s.rectVersion === this.atlas.version) return true;
    const hit = this.atlas.lookup(image);
    if (!hit) return false;
    const f = new Float32Array(s.data);
    f.set(hit.uv, 16);
    if (b.kind === 'marker') f[24] = hit.aspect;
    this.device.queue.writeBuffer(s.style, 0, s.data);
    s.rectVersion = this.atlas.version;
    return true;
  }

  draw(pass: GPURenderPassEncoder, layer: GpuStyledLayer, scaleDenominator: number): void {
    if (!layer.list.length) return;
    this.atlas?.prefetch(layer.list.flatMap((s) => batchImage(s.batch) ?? []));
    this.syncAtlas();
    pass.setBindGroup(2, this.atlasBind);
    for (const s of layer.list) {
      const b = s.batch;
      if ((b.minScale !== undefined && scaleDenominator < b.minScale) || (b.maxScale !== undefined && scaleDenominator > b.maxScale)) continue;
      if (!this.refreshRect(s)) continue;
      const pipe = b.kind === 'stroke' ? this.pipes.stroke : b.kind === 'marker' ? this.pipes.marker : this.pipes[b.paint.kind];
      pass.setPipeline(pipe);
      pass.setBindGroup(1, s.bind);
      pass.setVertexBuffer(0, s.vertex);
      if (b.kind === 'fill') pass.draw(s.count);
      else pass.draw(6, s.count);
    }
  }

  dispose(): void {
    this.texture.destroy();
  }
}
