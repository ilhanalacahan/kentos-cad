/**
 * Styled drawing in WebGL2 (docs/STYLE.md §6): thick capped and dashed
 * strokes, hatch and tile fills computed per pixel, and instanced markers
 * (shape distance fields or atlas images). Sizes arrive in their own unit
 * (metres or CSS px) and are turned into device pixels here, so zooming
 * never rebuilds buffers. The WGSL twins are in ../webgpu/styledShaders.ts;
 * change both together.
 */

/** Frame transform shared by the styled programs: origin-relative metres → device px → clip. */
const FRAME = /* glsl */ `
uniform vec2 u_cam;       // camera centre, origin-relative metres
uniform float u_pxPerM;   // device px per metre
uniform float u_dpr;
uniform vec2 u_viewPx;    // viewport size in device px
vec2 toPx(vec2 p) { return (p - u_cam) * u_pxPerM; }
vec4 pxToClip(vec2 px) { return vec4(px / (0.5 * u_viewPx), 0.0, 1.0); }
`;

/** Dash coverage along a distance s (device px); pattern lengths in device px. */
const DASH = /* glsl */ `
uniform vec4 u_dash0;
uniform vec4 u_dash1;
uniform float u_dashTotal; // raw units (0 = continuous)
uniform float u_dashOn;    // share of the pattern that is "on" (for far zoom)
uniform float u_dashOffset;
float dashCover(float s, float k) {
  float total = u_dashTotal * k;
  if (total <= 0.0) return 1.0;
  if (total < 4.0) return u_dashOn; // too fine to see: an even tint
  float t = mod(s + u_dashOffset * k, total);
  float d[8] = float[8](u_dash0.x, u_dash0.y, u_dash0.z, u_dash0.w, u_dash1.x, u_dash1.y, u_dash1.z, u_dash1.w);
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    float l = d[i] * k;
    if (t < acc + l) {
      if ((i & 1) == 1) return 0.0;
      return clamp(min(t - acc, acc + l - t) + 0.5, 0.0, 1.0);
    }
    acc += l;
  }
  return 0.0;
}
`;

const CORNERS = /* glsl */ `const vec2 CORNER[6] = vec2[6](vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));`;

// ── Strokes ────────────────────────────────────────────────────────────

export const STROKE_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec4 a_seg;  // ax, ay, bx, by
layout(location = 1) in vec2 a_meta; // distance at a (m), end flags
${FRAME}
uniform float u_width;
uniform int u_unit; // 0 metres, 1 CSS px
${CORNERS}
out vec2 v_local;
out float v_len;
out float v_s0;
flat out int v_ends;
flat out float v_halfW;
void main() {
  float k = u_unit == 0 ? u_pxPerM : u_dpr;
  float halfW = max(u_width * k, 1.0) * 0.5;
  vec2 A = toPx(a_seg.xy);
  vec2 B = toPx(a_seg.zw);
  vec2 d = B - A;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  vec2 c = CORNER[gl_VertexID];
  float ext = halfW + 1.0;
  float along = mix(-ext, len + ext, c.x);
  float across = mix(-ext, ext, c.y);
  gl_Position = pxToClip(A + dir * along + n * across);
  v_local = vec2(along, across);
  v_len = len;
  v_s0 = a_meta.x * u_pxPerM;
  v_ends = int(a_meta.y + 0.5);
  v_halfW = halfW;
}`;

export const STROKE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
in float v_len;
in float v_s0;
flat in int v_ends;
flat in float v_halfW;
uniform vec4 u_color;
uniform int u_cap;   // 0 butt, 1 round, 2 square
uniform int u_unit;
uniform float u_pxPerM;
uniform float u_dpr;
${DASH}
out vec4 outColor;
float capCover(float x, float y, int cap) {
  if (cap == 1) return clamp(v_halfW + 0.5 - length(vec2(x, y)), 0.0, 1.0);
  float body = clamp(v_halfW + 0.5 - y, 0.0, 1.0);
  if (cap == 2) return body * clamp(v_halfW + 0.5 - x, 0.0, 1.0);
  return body * clamp(0.5 - x, 0.0, 1.0);
}
void main() {
  float x = v_local.x;
  float y = abs(v_local.y);
  float a;
  // Path ends take the cap; joints between segments are round.
  if (x < 0.0) a = capCover(-x, y, (v_ends & 1) != 0 ? u_cap : 1);
  else if (x > v_len) a = capCover(x - v_len, y, (v_ends & 2) != 0 ? u_cap : 1);
  else a = clamp(v_halfW + 0.5 - y, 0.0, 1.0);
  float k = u_unit == 0 ? u_pxPerM : u_dpr;
  a *= dashCover(v_s0 + x, k);
  if (a < 0.004) discard;
  outColor = vec4(u_color.rgb, u_color.a * a);
}`;

// ── Fills ──────────────────────────────────────────────────────────────

export const AREA_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec2 a_pos;
${FRAME}
out vec2 v_world;
void main() {
  gl_Position = pxToClip(toPx(a_pos));
  v_world = a_pos;
}`;

/** Parallel hatch lines anchored to the world (or the screen for px units). */
export const HATCH_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_world;
uniform vec4 u_color;
uniform vec2 u_dir;      // line direction (cos, sin)
uniform float u_spacing;
uniform float u_width;
uniform float u_offset;
uniform int u_unit;
uniform float u_pxPerM;
uniform float u_dpr;
${DASH}
out vec4 outColor;
void main() {
  bool screen = u_unit == 1;
  vec2 p = screen ? gl_FragCoord.xy / u_dpr : v_world;
  float k = screen ? u_dpr : u_pxPerM;
  vec2 n = vec2(-u_dir.y, u_dir.x);
  float halfW = max(u_width * k, 1.0) * 0.5;
  float gap = u_spacing * k;
  float a;
  if (gap < 3.0) {
    a = min(1.0, 2.0 * halfW / max(gap, 1e-4));
  } else {
    float u = dot(p, n) - u_offset;
    float d = abs(fract(u / u_spacing + 0.5) - 0.5) * gap;
    a = clamp(halfW + 0.5 - d, 0.0, 1.0);
    a *= dashCover(dot(p, u_dir) * k, k);
  }
  if (a < 0.004) discard;
  outColor = vec4(u_color.rgb, u_color.a * a);
}`;

/** An atlas tile repeated over the area (premultiplied output). */
export const TILE_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_world;
uniform sampler2D u_atlas;
uniform vec4 u_rect;     // uv x, y, w, h
uniform vec2 u_tile;     // tile size in the unit
uniform vec2 u_rot;      // cos, sin of the pattern angle
uniform vec2 u_shift;
uniform float u_opacity;
uniform int u_unit;
uniform float u_dpr;
out vec4 outColor;
void main() {
  vec2 p = u_unit == 1 ? gl_FragCoord.xy / u_dpr : v_world;
  p = vec2(u_rot.x * p.x + u_rot.y * p.y, -u_rot.y * p.x + u_rot.x * p.y) - u_shift;
  vec2 q = p / u_tile;
  vec2 f = fract(q);
  vec2 inset = vec2(0.5 / 2048.0);
  vec2 uv = u_rect.xy + inset + vec2(f.x, 1.0 - f.y) * (u_rect.zw - 2.0 * inset);
  vec4 c = textureGrad(u_atlas, uv, dFdx(q) * u_rect.zw, dFdy(q) * u_rect.zw) * u_opacity;
  if (c.a < 0.004) discard;
  outColor = c;
}`;

// ── Markers ────────────────────────────────────────────────────────────

export const MARKER_VS = /* glsl */ `#version 300 es
layout(location = 0) in vec4 a_i0;  // x, y, angle, width
layout(location = 1) in float a_i1; // height
${FRAME}
uniform int u_unit;
uniform vec2 u_offset;   // in the unit, turned with the marker
uniform vec2 u_anchor;
uniform int u_fit;       // 0 w and h given, 1 width (h from aspect), 2 height (w from aspect)
uniform float u_aspect;  // image height / width
uniform float u_strokeW;
${CORNERS}
out vec2 v_local;
flat out vec2 v_half;
flat out float v_sw;
void main() {
  float k = u_unit == 0 ? u_pxPerM : u_dpr;
  float w = a_i0.w * k;
  float h = a_i1 * k;
  if (u_fit == 1) h = w * u_aspect;
  else if (u_fit == 2) w = h / max(u_aspect, 1e-6);
  else if (h <= 0.0) h = w;
  float sw = u_strokeW > 0.0 ? max(u_strokeW * k, 1.0) : 0.0;
  float pad = sw * 0.5 + 1.5;
  vec2 c = CORNER[gl_VertexID] - 0.5;
  vec2 local = c * (vec2(w, h) + 2.0 * pad);
  vec2 q = local - u_anchor * vec2(w, h) + u_offset * k;
  float ca = cos(a_i0.z);
  float sa = sin(a_i0.z);
  gl_Position = pxToClip(toPx(a_i0.xy) + vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y));
  v_local = local;
  v_half = vec2(w, h) * 0.5;
  v_sw = sw;
}`;

/** Distance fields of the marker shapes (px, centred, y up); open shapes return an unsigned line distance. */
const SHAPES = /* glsl */ `
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
float sdRhombus(vec2 p, vec2 b) {
  p = abs(p);
  float h = clamp((b.x * (b.x - 2.0 * p.x) - b.y * (b.y - 2.0 * p.y)) / dot(b, b), -1.0, 1.0);
  float d = length(p - 0.5 * b * vec2(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}
float sdTri(vec2 p, float r) {
  const float k = 1.7320508;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
float sdPentagon(vec2 p, float r) {
  const vec3 k = vec3(0.809016994, 0.587785252, 0.726542528);
  p.x = abs(p.x);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= vec2(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}
float sdHexagon(vec2 p, float r) {
  const vec3 k = vec3(-0.866025404, 0.5, 0.577350269);
  p = abs(p.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdOctagon(vec2 p, float r) {
  const vec3 k = vec3(-0.9238795325, 0.3826834323, 0.4142135623);
  p = abs(p);
  p -= 2.0 * min(dot(vec2(k.x, k.y), p), 0.0) * vec2(k.x, k.y);
  p -= 2.0 * min(dot(vec2(-k.x, k.y), p), 0.0) * vec2(-k.x, k.y);
  p -= vec2(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
float sdStar(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// Shape ids: 0 circle 1 ring 2 square 3 rectangle 4 diamond 5 triangle 6 pentagon 7 hexagon 8 octagon
// 9 star 10 cross 11 x 12 line 13 arrow 14 arrowhead 15 semicircle 16 quartercircle
float shapeDist(int s, vec2 p, vec2 hs) {
  float r = min(hs.x, hs.y);
  if (s == 0 || s == 1) return length(p) - r;
  if (s == 2) return sdBox(p, vec2(r));
  if (s == 3) return sdBox(p, hs);
  if (s == 4) return sdRhombus(p, hs);
  if (s == 5) return sdTri(p, r);
  if (s == 6) return sdPentagon(p, r);
  if (s == 7) return sdHexagon(p, r);
  if (s == 8) return sdOctagon(p, r);
  if (s == 9) return sdStar(p, r, 0.4);
  if (s == 10) return min(sdSeg(p, vec2(-r, 0.0), vec2(r, 0.0)), sdSeg(p, vec2(0.0, -r), vec2(0.0, r)));
  if (s == 11) { float d = r * 0.7071068; return min(sdSeg(p, vec2(-d), vec2(d)), sdSeg(p, vec2(-d, d), vec2(d, -d))); }
  if (s == 12) return sdSeg(p, vec2(-hs.x, 0.0), vec2(hs.x, 0.0));
  if (s == 13) return min(sdSeg(p, vec2(-hs.x, 0.0), vec2(hs.x, 0.0)), min(sdSeg(p, vec2(hs.x * 0.5, hs.y * 0.4), vec2(hs.x, 0.0)), sdSeg(p, vec2(hs.x * 0.5, -hs.y * 0.4), vec2(hs.x, 0.0))));
  if (s == 14) {
    vec2 a = vec2(hs.x, 0.0), b = vec2(-hs.x, hs.y * 0.8), c = vec2(-hs.x, -hs.y * 0.8);
    float d = min(sdSeg(p, a, b), min(sdSeg(p, b, c), sdSeg(p, c, a)));
    bool inside = p.x >= -hs.x && abs(p.y) <= (hs.x - p.x) * 0.4 * hs.y / hs.x;
    return inside ? -d : d;
  }
  if (s == 15) return max(length(p) - r, -p.y);
  return max(length(p) - r, max(-p.x, -p.y));
}
bool isOpen(int s) { return s == 10 || s == 11 || s == 12 || s == 13; }
`;

export const MARKER_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_local;
flat in vec2 v_half;
flat in float v_sw;
uniform int u_kind;      // 0 shape, 1 atlas image
uniform int u_shape;
uniform vec4 u_fill;     // alpha 0 = none
uniform vec4 u_stroke;   // alpha 0 = none
uniform sampler2D u_atlas;
uniform vec4 u_rect;
uniform float u_opacity;
uniform float u_dpr;
${SHAPES}
out vec4 outColor;
void main() {
  vec4 col = vec4(0.0);
  if (u_kind == 1) {
    vec2 t = v_local / (2.0 * v_half) + 0.5;
    if (any(lessThan(t, vec2(0.0))) || any(greaterThan(t, vec2(1.0)))) discard;
    col = texture(u_atlas, u_rect.xy + vec2(t.x, 1.0 - t.y) * u_rect.zw);
  } else {
    float d = shapeDist(u_shape, v_local, v_half);
    bool open = isOpen(u_shape);
    vec4 stroke = u_stroke.a > 0.0 ? u_stroke : (open ? u_fill : vec4(0.0));
    float sw = v_sw > 0.0 ? v_sw : (open ? max(u_dpr, 1.0) : 0.0);
    if (!open && u_fill.a > 0.0) col = vec4(u_fill.rgb * u_fill.a, u_fill.a) * clamp(0.5 - d, 0.0, 1.0);
    if (stroke.a > 0.0 && sw > 0.0) {
      float sa = clamp(sw * 0.5 + 0.5 - abs(d), 0.0, 1.0);
      vec4 sc = vec4(stroke.rgb * stroke.a, stroke.a) * sa;
      col = sc + col * (1.0 - sc.a);
    }
    if (u_shape == 1 && stroke.a > 0.0) {
      float dot = clamp(max(1.2 * u_dpr, v_half.x * 0.16) + 0.5 - length(v_local), 0.0, 1.0);
      vec4 dc = vec4(stroke.rgb * stroke.a, stroke.a) * dot;
      col = dc + col * (1.0 - dc.a);
    }
  }
  col *= u_opacity;
  if (col.a < 0.004) discard;
  outColor = col;
}`;

/** Shape ids in the order shapeDist knows them. */
export const SHAPE_IDS = ['circle', 'ring', 'square', 'rectangle', 'diamond', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'cross', 'x', 'line', 'arrow', 'arrowhead', 'semicircle', 'quartercircle'] as const;
