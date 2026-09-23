import { batchImage, MARKER_STRIDE, STROKE_STRIDE, type AtlasSource, type RGBA, type ScaleRange, type StyledBatch } from '../types';
import { AREA_VS, HATCH_FS, MARKER_FS, MARKER_VS, SHAPE_IDS, STROKE_FS, STROKE_VS, TILE_FS } from './styledShaders';

/**
 * WebGL2 side of the styled batches (docs/STYLE.md §6): creates the vertex
 * arrays on upload and draws a layer's batches in their symbol-level order.
 * Zoom-dependent sizes are computed in the shaders from the frame
 * uniforms, so nothing is rebuilt while panning or zooming.
 */

interface Program {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  a: Record<string, number>;
}

export interface GpuStyled {
  batch: StyledBatch;
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
}

export interface StyledFrame {
  cam: readonly [number, number];
  pxPerM: number;
  dpr: number;
  viewPx: readonly [number, number];
  scaleDenominator: number;
}

const FRAME_UNIFORMS = ['u_cam', 'u_pxPerM', 'u_dpr', 'u_viewPx'];
const DASH_UNIFORMS = ['u_dash0', 'u_dash1', 'u_dashTotal', 'u_dashOn', 'u_dashOffset'];
const SHAPE_INDEX = new Map<string, number>(SHAPE_IDS.map((s, i) => [s, i]));

export const inScale = (b: ScaleRange, den: number) => !((b.minScale !== undefined && den < b.minScale) || (b.maxScale !== undefined && den > b.maxScale));

/** Dash uniforms: an odd pattern is repeated to become even (as in SVG). */
function dashValues(dash: readonly number[] | null): { d: number[]; total: number; on: number } {
  if (!dash?.length) return { d: new Array(8).fill(0), total: 0, on: 1 };
  const even = dash.length % 2 ? [...dash, ...dash] : [...dash];
  const d = even.slice(0, 8);
  while (d.length < 8) d.push(0);
  const total = d.reduce((s, v) => s + v, 0);
  const on = d.reduce((s, v, i) => (i % 2 ? s : s + v), 0);
  return { d, total, on: total > 0 ? on / total : 1 };
}

export class StyledRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly stroke: Program;
  private readonly hatch: Program;
  private readonly tile: Program;
  private readonly solid: Program;
  private readonly marker: Program;
  private atlas: AtlasSource | null = null;
  private texture: WebGLTexture | null = null;
  private textureVersion = -1;

  constructor(gl: WebGL2RenderingContext, compile: (vs: string, fs: string, attribs: string[], uniforms: string[]) => Program) {
    this.gl = gl;
    this.stroke = compile(STROKE_VS, STROKE_FS, ['a_seg', 'a_meta'], [...FRAME_UNIFORMS, ...DASH_UNIFORMS, 'u_width', 'u_unit', 'u_color', 'u_cap']);
    const SOLID_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_world;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;
    this.solid = compile(AREA_VS, SOLID_FS, ['a_pos'], [...FRAME_UNIFORMS, 'u_color']);
    this.hatch = compile(AREA_VS, HATCH_FS, ['a_pos'], [...FRAME_UNIFORMS, ...DASH_UNIFORMS, 'u_color', 'u_dir', 'u_spacing', 'u_width', 'u_offset', 'u_unit']);
    this.tile = compile(AREA_VS, TILE_FS, ['a_pos'], [...FRAME_UNIFORMS, 'u_atlas', 'u_rect', 'u_tile', 'u_rot', 'u_shift', 'u_opacity', 'u_unit']);
    this.marker = compile(MARKER_VS, MARKER_FS, ['a_i0', 'a_i1'], [...FRAME_UNIFORMS, 'u_unit', 'u_offset', 'u_anchor', 'u_fit', 'u_aspect', 'u_strokeW', 'u_kind', 'u_shape', 'u_fill', 'u_stroke', 'u_atlas', 'u_rect', 'u_opacity']);
  }

  useAtlas(atlas: AtlasSource): void {
    this.atlas = atlas;
    this.textureVersion = -1;
  }

  // ── Upload ───────────────────────────────────────────────────────────

  upload(batches: readonly StyledBatch[]): GpuStyled[] {
    const gl = this.gl;
    const out: GpuStyled[] = [];
    for (const b of batches) {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      if (b.kind === 'stroke') {
        gl.bufferData(gl.ARRAY_BUFFER, b.segments, gl.STATIC_DRAW);
        const stride = STROKE_STRIDE * 4;
        this.attrib(this.stroke.a.a_seg, 4, stride, 0, 1);
        this.attrib(this.stroke.a.a_meta, 2, stride, 16, 1);
        out.push({ batch: b, vao, buffers: [buf], count: b.segments.length / STROKE_STRIDE });
      } else if (b.kind === 'marker') {
        gl.bufferData(gl.ARRAY_BUFFER, b.instances, gl.STATIC_DRAW);
        const stride = MARKER_STRIDE * 4;
        this.attrib(this.marker.a.a_i0, 4, stride, 0, 1);
        this.attrib(this.marker.a.a_i1, 1, stride, 16, 1);
        out.push({ batch: b, vao, buffers: [buf], count: b.instances.length / MARKER_STRIDE });
      } else {
        gl.bufferData(gl.ARRAY_BUFFER, b.positions, gl.STATIC_DRAW);
        // Every area program reads a_pos at the same location (compiled from one vertex shader).
        this.attrib(this.solid.a.a_pos, 2, 0, 0, 0);
        out.push({ batch: b, vao, buffers: [buf], count: b.positions.length / 2 });
      }
    }
    gl.bindVertexArray(null);
    return out;
  }

  private attrib(loc: number, size: number, stride: number, offset: number, divisor: number): void {
    if (loc < 0) return;
    const gl = this.gl;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(loc, divisor);
  }

  release(list: readonly GpuStyled[]): void {
    for (const s of list) {
      this.gl.deleteVertexArray(s.vao);
      s.buffers.forEach((b) => this.gl.deleteBuffer(b));
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────

  private syncAtlas(): void {
    const gl = this.gl;
    if (!this.atlas || this.atlas.version === this.textureVersion) return;
    if (!this.texture) this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas as TexImageSource);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textureVersion = this.atlas.version;
  }

  private use(p: Program, f: StyledFrame): void {
    const gl = this.gl;
    gl.useProgram(p.program);
    gl.uniform2f(p.u.u_cam, f.cam[0], f.cam[1]);
    gl.uniform1f(p.u.u_pxPerM, f.pxPerM);
    gl.uniform1f(p.u.u_dpr, f.dpr);
    gl.uniform2f(p.u.u_viewPx, f.viewPx[0], f.viewPx[1]);
  }

  private dash(p: Program, dash: readonly number[] | null, offset: number): void {
    const gl = this.gl;
    const v = dashValues(dash);
    gl.uniform4f(p.u.u_dash0, v.d[0], v.d[1], v.d[2], v.d[3]);
    gl.uniform4f(p.u.u_dash1, v.d[4], v.d[5], v.d[6], v.d[7]);
    gl.uniform1f(p.u.u_dashTotal, v.total);
    gl.uniform1f(p.u.u_dashOn, v.on);
    gl.uniform1f(p.u.u_dashOffset, offset);
  }

  private premultiplied(on: boolean): void {
    const gl = this.gl;
    if (on) gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  draw(list: readonly GpuStyled[], f: StyledFrame): void {
    if (!list.length) return;
    const gl = this.gl;
    this.atlas?.prefetch(list.flatMap((s) => batchImage(s.batch) ?? []));
    this.syncAtlas();
    if (this.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
    }
    for (const s of list) {
      const b = s.batch;
      if (!inScale(b, f.scaleDenominator)) continue;
      gl.bindVertexArray(s.vao);
      if (b.kind === 'stroke') {
        const p = this.stroke;
        this.use(p, f);
        this.premultiplied(false);
        gl.uniform1f(p.u.u_width, b.width);
        gl.uniform1i(p.u.u_unit, b.unit === 'world' ? 0 : 1);
        gl.uniform4fv(p.u.u_color, b.color);
        gl.uniform1i(p.u.u_cap, b.cap === 'round' ? 1 : b.cap === 'square' ? 2 : 0);
        this.dash(p, b.dash, b.dashOffset);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.count);
      } else if (b.kind === 'fill') {
        const paint = b.paint;
        if (paint.kind === 'solid') {
          this.use(this.solid, f);
          this.premultiplied(false);
          gl.uniform4fv(this.solid.u.u_color, paint.color);
        } else if (paint.kind === 'hatch') {
          const p = this.hatch;
          this.use(p, f);
          this.premultiplied(false);
          gl.uniform4fv(p.u.u_color, paint.color);
          gl.uniform2f(p.u.u_dir, Math.cos(paint.angle), Math.sin(paint.angle));
          gl.uniform1f(p.u.u_spacing, paint.spacing);
          gl.uniform1f(p.u.u_width, paint.width);
          gl.uniform1f(p.u.u_offset, paint.offset);
          gl.uniform1i(p.u.u_unit, paint.unit === 'world' ? 0 : 1);
          this.dash(p, paint.dash, 0);
        } else {
          const hit = this.atlas?.lookup(paint.image);
          if (!hit) continue;
          const p = this.tile;
          this.use(p, f);
          this.premultiplied(true);
          gl.uniform1i(p.u.u_atlas, 0);
          gl.uniform4f(p.u.u_rect, hit.uv[0], hit.uv[1], hit.uv[2], hit.uv[3]);
          gl.uniform2f(p.u.u_tile, paint.size[0], paint.size[1]);
          gl.uniform2f(p.u.u_rot, Math.cos(paint.angle), Math.sin(paint.angle));
          gl.uniform2f(p.u.u_shift, paint.offset[0], paint.offset[1]);
          gl.uniform1f(p.u.u_opacity, paint.opacity);
          gl.uniform1i(p.u.u_unit, paint.unit === 'world' ? 0 : 1);
        }
        gl.drawArrays(gl.TRIANGLES, 0, s.count);
      } else {
        const p = this.marker;
        const look = b.look;
        let aspect = 1;
        let rect: readonly number[] = [0, 0, 0, 0];
        if (look.kind === 'image') {
          const hit = this.atlas?.lookup(look.image);
          if (!hit) continue;
          aspect = hit.aspect;
          rect = hit.uv;
        }
        this.use(p, f);
        this.premultiplied(true);
        gl.uniform1i(p.u.u_unit, b.unit === 'world' ? 0 : 1);
        gl.uniform2f(p.u.u_offset, b.offset[0], b.offset[1]);
        gl.uniform2f(p.u.u_anchor, b.anchor[0], b.anchor[1]);
        gl.uniform1f(p.u.u_opacity, b.opacity);
        gl.uniform1i(p.u.u_atlas, 0);
        gl.uniform4f(p.u.u_rect, rect[0], rect[1], rect[2], rect[3]);
        gl.uniform1f(p.u.u_aspect, aspect);
        if (look.kind === 'shape') {
          const none: RGBA = [0, 0, 0, 0];
          gl.uniform1i(p.u.u_kind, 0);
          gl.uniform1i(p.u.u_fit, 0);
          gl.uniform1i(p.u.u_shape, SHAPE_INDEX.get(look.shape) ?? 0);
          gl.uniform4fv(p.u.u_fill, look.fill ?? none);
          gl.uniform4fv(p.u.u_stroke, look.stroke ?? none);
          gl.uniform1f(p.u.u_strokeW, look.stroke || look.shape === 'cross' || look.shape === 'x' || look.shape === 'line' || look.shape === 'arrow' ? look.strokeWidth : 0);
        } else {
          gl.uniform1i(p.u.u_kind, 1);
          gl.uniform1i(p.u.u_fit, look.fit === 'width' ? 1 : 2);
          gl.uniform1f(p.u.u_strokeW, 0);
        }
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, s.count);
      }
    }
    this.premultiplied(false);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of [this.stroke, this.hatch, this.tile, this.solid, this.marker]) gl.deleteProgram(p.program);
    if (this.texture) gl.deleteTexture(this.texture);
  }
}
