/**
 * WGSL twins of the styled WebGL2 shaders (../webgl2/styledShaders.ts):
 * strokes, solid/hatch/tile fills and markers, with the same distance
 * fields, dash test and unit handling. Group 0 is the frame (shared with
 * the plain pipelines), group 1 the batch style, group 2 the atlas.
 * Derivatives are taken before any branch (WGSL uniformity rules) and
 * textures are sampled with explicit gradients.
 */
export const STYLED_WGSL = /* wgsl */ `
struct Frame {
  offset: vec2f,     // camera centre, origin-relative metres
  scale: vec2f,
  pxPerM: f32,       // device px per metre
  dpr: f32,
  viewport: vec2f,   // device px
};
struct SStyle {
  color: vec4f,
  stroke: vec4f,
  dash0: vec4f,
  dash1: vec4f,
  rect: vec4f,
  a: vec4f,
  b: vec4f,
  c: vec4f,
  flags: vec4u,      // unit, cap | kind, shape, fit
};
@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var<uniform> st: SStyle;
@group(2) @binding(0) var atlasTex: texture_2d<f32>;
@group(2) @binding(1) var atlasSmp: sampler;

fn toPx(p: vec2f) -> vec2f { return (p - frame.offset) * frame.pxPerM; }
fn pxToClip(px: vec2f) -> vec4f { return vec4f(px / (0.5 * frame.viewport), 0.0, 1.0); }
fn unitK() -> f32 { if (st.flags.x == 0u) { return frame.pxPerM; } return frame.dpr; }
fn fmod(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

fn corner(i: u32) -> vec2f {
  var c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(0.0, 1.0));
  return c[i];
}

// Dash coverage: s in device px, pattern (raw units) scaled by k; total/on/offset as for WebGL2.
fn dashCover(s: f32, k: f32, totalRaw: f32, onShare: f32, offsetRaw: f32) -> f32 {
  let total = totalRaw * k;
  if (total <= 0.0) { return 1.0; }
  if (total < 4.0) { return onShare; }
  let t = fmod(s + offsetRaw * k, total);
  let d = array<f32, 8>(st.dash0.x, st.dash0.y, st.dash0.z, st.dash0.w, st.dash1.x, st.dash1.y, st.dash1.z, st.dash1.w);
  var acc = 0.0;
  for (var i = 0u; i < 8u; i++) {
    let l = d[i] * k;
    if (t < acc + l) {
      if ((i & 1u) == 1u) { return 0.0; }
      return clamp(min(t - acc, acc + l - t) + 0.5, 0.0, 1.0);
    }
    acc += l;
  }
  return 0.0;
}

// ── Strokes: a = (width, dashTotal, dashOn, dashOffset), flags = (unit, cap) ──
struct StrokeOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) len: f32,
  @location(2) s0: f32,
  @location(3) @interpolate(flat) ends: u32,
  @location(4) @interpolate(flat) halfW: f32,
};
@vertex fn strokeVs(@builtin(vertex_index) vi: u32, @location(0) seg: vec4f, @location(1) mt: vec2f) -> StrokeOut {
  let halfW = max(st.a.x * unitK(), 1.0) * 0.5;
  let A = toPx(seg.xy);
  let B = toPx(seg.zw);
  let d = B - A;
  let len = length(d);
  var dir = vec2f(1.0, 0.0);
  if (len > 1e-4) { dir = d / len; }
  let n = vec2f(-dir.y, dir.x);
  let c = corner(vi);
  let ext = halfW + 1.0;
  let along = mix(-ext, len + ext, c.x);
  let across = mix(-ext, ext, c.y);
  var o: StrokeOut;
  o.pos = pxToClip(A + dir * along + n * across);
  o.local = vec2f(along, across);
  o.len = len;
  o.s0 = mt.x * frame.pxPerM;
  o.ends = u32(mt.y + 0.5);
  o.halfW = halfW;
  return o;
}
fn capCover(x: f32, y: f32, cap: u32, halfW: f32) -> f32 {
  if (cap == 1u) { return clamp(halfW + 0.5 - length(vec2f(x, y)), 0.0, 1.0); }
  let body = clamp(halfW + 0.5 - y, 0.0, 1.0);
  if (cap == 2u) { return body * clamp(halfW + 0.5 - x, 0.0, 1.0); }
  return body * clamp(0.5 - x, 0.0, 1.0);
}
@fragment fn strokeFs(i: StrokeOut) -> @location(0) vec4f {
  let x = i.local.x;
  let y = abs(i.local.y);
  var a: f32;
  if (x < 0.0) {
    var cap = 1u;
    if ((i.ends & 1u) != 0u) { cap = st.flags.y; }
    a = capCover(-x, y, cap, i.halfW);
  } else if (x > i.len) {
    var cap = 1u;
    if ((i.ends & 2u) != 0u) { cap = st.flags.y; }
    a = capCover(x - i.len, y, cap, i.halfW);
  } else {
    a = clamp(i.halfW + 0.5 - y, 0.0, 1.0);
  }
  a *= dashCover(i.s0 + x, unitK(), st.a.y, st.a.z, st.a.w);
  if (a < 0.004) { discard; }
  return vec4f(st.color.rgb, st.color.a * a);
}

// ── Areas ──
struct AreaOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec2f,
};
@vertex fn areaVs(@location(0) p: vec2f) -> AreaOut {
  var o: AreaOut;
  o.pos = pxToClip(toPx(p));
  o.world = p;
  return o;
}
@fragment fn solidFs(i: AreaOut) -> @location(0) vec4f {
  return st.color;
}
// Hatch: a = (dir.x, dir.y, spacing, width), b = (offset, dashTotal, dashOn, 0), flags.x = unit.
@fragment fn hatchFs(i: AreaOut) -> @location(0) vec4f {
  let screen = st.flags.x == 1u;
  var p = i.world;
  var k = frame.pxPerM;
  if (screen) { p = i.pos.xy * vec2f(1.0, -1.0) / frame.dpr; k = frame.dpr; }
  let dir = st.a.xy;
  let n = vec2f(-dir.y, dir.x);
  let halfW = max(st.a.w * k, 1.0) * 0.5;
  let gap = st.a.z * k;
  var a: f32;
  if (gap < 3.0) {
    a = min(1.0, 2.0 * halfW / max(gap, 1e-4));
  } else {
    let u = dot(p, n) - st.b.x;
    let d = abs(fract(u / st.a.z + 0.5) - 0.5) * gap;
    a = clamp(halfW + 0.5 - d, 0.0, 1.0);
    a *= dashCover(dot(p, dir) * k, k, st.b.y, st.b.z, 0.0);
  }
  if (a < 0.004) { discard; }
  return vec4f(st.color.rgb, st.color.a * a);
}
// Tile: rect, a = (tile.x, tile.y, cos, sin), b = (shift.x, shift.y, opacity, 0), flags.x = unit. Premultiplied out.
@fragment fn tileFs(i: AreaOut) -> @location(0) vec4f {
  var p = i.world;
  if (st.flags.x == 1u) { p = i.pos.xy * vec2f(1.0, -1.0) / frame.dpr; }
  let r = st.a.zw;
  p = vec2f(r.x * p.x + r.y * p.y, -r.y * p.x + r.x * p.y) - st.b.xy;
  let q = p / st.a.xy;
  let gx = dpdx(q) * st.rect.zw;
  let gy = dpdy(q) * st.rect.zw;
  let f = fract(q);
  let inset = vec2f(0.5 / 2048.0);
  let uv = st.rect.xy + inset + vec2f(f.x, 1.0 - f.y) * (st.rect.zw - 2.0 * inset);
  let c = textureSampleGrad(atlasTex, atlasSmp, uv, gx, gy) * st.b.z;
  if (c.a < 0.004) { discard; }
  return c;
}

// ── Markers: color = fill, stroke, rect, a = (offset.xy, anchor.xy), b = (aspect, strokeW, opacity, 0), flags = (unit, kind, shape, fit) ──
struct MarkerOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) hs: vec2f,
  @location(2) @interpolate(flat) sw: f32,
};
@vertex fn markerVs(@builtin(vertex_index) vi: u32, @location(0) i0: vec4f, @location(1) i1: f32) -> MarkerOut {
  let k = unitK();
  var w = i0.w * k;
  var h = i1 * k;
  let fit = st.flags.w;
  if (fit == 1u) { h = w * st.b.x; } else if (fit == 2u) { w = h / max(st.b.x, 1e-6); } else if (h <= 0.0) { h = w; }
  var sw = 0.0;
  if (st.b.y > 0.0) { sw = max(st.b.y * k, 1.0); }
  let pad = sw * 0.5 + 1.5;
  let c = corner(vi) - vec2f(0.5);
  let local = c * (vec2f(w, h) + 2.0 * pad);
  let q = local - st.a.zw * vec2f(w, h) + st.a.xy * k;
  let ca = cos(i0.z);
  let sa = sin(i0.z);
  var o: MarkerOut;
  o.pos = pxToClip(toPx(i0.xy) + vec2f(ca * q.x - sa * q.y, sa * q.x + ca * q.y));
  o.local = local;
  o.hs = vec2f(w, h) * 0.5;
  o.sw = sw;
  return o;
}

fn sdBox(p: vec2f, b: vec2f) -> f32 { let d = abs(p) - b; return length(max(d, vec2f(0.0))) + min(max(d.x, d.y), 0.0); }
fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
fn sdRhombus(q: vec2f, b: vec2f) -> f32 {
  let p = abs(q);
  let h = clamp((b.x * (b.x - 2.0 * p.x) - b.y * (b.y - 2.0 * p.y)) / dot(b, b), -1.0, 1.0);
  let d = length(p - 0.5 * b * vec2f(1.0 - h, 1.0 + h));
  return d * sign(p.x * b.y + p.y * b.x - b.x * b.y);
}
fn sdTri(q: vec2f, r: f32) -> f32 {
  let k = 1.7320508;
  var p = q;
  p.x = abs(p.x) - r;
  p.y = p.y + r / k;
  if (p.x + k * p.y > 0.0) { p = vec2f(p.x - k * p.y, -k * p.x - p.y) / 2.0; }
  p.x = p.x - clamp(p.x, -2.0 * r, 0.0);
  return -length(p) * sign(p.y);
}
fn sdPentagon(q: vec2f, r: f32) -> f32 {
  let k = vec3f(0.809016994, 0.587785252, 0.726542528);
  var p = vec2f(abs(q.x), q.y);
  p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
  p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
  p -= vec2f(clamp(p.x, -r * k.z, r * k.z), r);
  return length(p) * sign(p.y);
}
fn sdHexagon(q: vec2f, r: f32) -> f32 {
  let k = vec3f(-0.866025404, 0.5, 0.577350269);
  var p = abs(q.yx);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
fn sdOctagon(q: vec2f, r: f32) -> f32 {
  let k = vec3f(-0.9238795325, 0.3826834323, 0.4142135623);
  var p = abs(q);
  p -= 2.0 * min(dot(vec2f(k.x, k.y), p), 0.0) * vec2f(k.x, k.y);
  p -= 2.0 * min(dot(vec2f(-k.x, k.y), p), 0.0) * vec2f(-k.x, k.y);
  p -= vec2f(clamp(p.x, -k.z * r, k.z * r), r);
  return length(p) * sign(p.y);
}
fn sdStar(q: vec2f, r: f32, rf: f32) -> f32 {
  let k1 = vec2f(0.809016994375, -0.587785252292);
  let k2 = vec2f(-0.809016994375, -0.587785252292);
  var p = vec2f(abs(q.x), q.y);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  let ba = rf * vec2f(-k1.y, k1.x) - vec2f(0.0, 1.0);
  let h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
fn shapeDist(s: u32, p: vec2f, hs: vec2f) -> f32 {
  let r = min(hs.x, hs.y);
  switch s {
    case 0u, 1u: { return length(p) - r; }
    case 2u: { return sdBox(p, vec2f(r)); }
    case 3u: { return sdBox(p, hs); }
    case 4u: { return sdRhombus(p, hs); }
    case 5u: { return sdTri(p, r); }
    case 6u: { return sdPentagon(p, r); }
    case 7u: { return sdHexagon(p, r); }
    case 8u: { return sdOctagon(p, r); }
    case 9u: { return sdStar(p, r, 0.4); }
    case 10u: { return min(sdSeg(p, vec2f(-r, 0.0), vec2f(r, 0.0)), sdSeg(p, vec2f(0.0, -r), vec2f(0.0, r))); }
    case 11u: { let d = r * 0.7071068; return min(sdSeg(p, vec2f(-d), vec2f(d)), sdSeg(p, vec2f(-d, d), vec2f(d, -d))); }
    case 12u: { return sdSeg(p, vec2f(-hs.x, 0.0), vec2f(hs.x, 0.0)); }
    case 13u: { return min(sdSeg(p, vec2f(-hs.x, 0.0), vec2f(hs.x, 0.0)), min(sdSeg(p, vec2f(hs.x * 0.5, hs.y * 0.4), vec2f(hs.x, 0.0)), sdSeg(p, vec2f(hs.x * 0.5, -hs.y * 0.4), vec2f(hs.x, 0.0)))); }
    case 14u: {
      let a = vec2f(hs.x, 0.0);
      let b = vec2f(-hs.x, hs.y * 0.8);
      let c = vec2f(-hs.x, -hs.y * 0.8);
      let d = min(sdSeg(p, a, b), min(sdSeg(p, b, c), sdSeg(p, c, a)));
      let inside = p.x >= -hs.x && abs(p.y) <= (hs.x - p.x) * 0.4 * hs.y / hs.x;
      if (inside) { return -d; }
      return d;
    }
    case 15u: { return max(length(p) - r, -p.y); }
    default: { return max(length(p) - r, max(-p.x, -p.y)); }
  }
}
fn isOpen(s: u32) -> bool { return s == 10u || s == 11u || s == 12u || s == 13u; }

@fragment fn markerFs(i: MarkerOut) -> @location(0) vec4f {
  // Texture coordinates and their gradients first, in uniform control flow.
  let t = i.local / (2.0 * i.hs) + 0.5;
  let uv = st.rect.xy + vec2f(t.x, 1.0 - t.y) * st.rect.zw;
  let gx = dpdx(uv);
  let gy = dpdy(uv);
  let img = textureSampleGrad(atlasTex, atlasSmp, uv, gx, gy);
  var col = vec4f(0.0);
  if (st.flags.y == 1u) {
    if (any(t < vec2f(0.0)) || any(t > vec2f(1.0))) { discard; }
    col = img;
  } else {
    let shape = st.flags.z;
    let d = shapeDist(shape, i.local, i.hs);
    let open = isOpen(shape);
    var stroke = st.stroke;
    if (stroke.a <= 0.0) { if (open) { stroke = st.color; } else { stroke = vec4f(0.0); } }
    var sw = i.sw;
    if (sw <= 0.0 && open) { sw = max(frame.dpr, 1.0); }
    if (!open && st.color.a > 0.0) { col = vec4f(st.color.rgb * st.color.a, st.color.a) * clamp(0.5 - d, 0.0, 1.0); }
    if (stroke.a > 0.0 && sw > 0.0) {
      let sa = clamp(sw * 0.5 + 0.5 - abs(d), 0.0, 1.0);
      let sc = vec4f(stroke.rgb * stroke.a, stroke.a) * sa;
      col = sc + col * (1.0 - sc.a);
    }
    if (shape == 1u && stroke.a > 0.0) {
      let dt = clamp(max(1.2 * frame.dpr, i.hs.x * 0.16) + 0.5 - length(i.local), 0.0, 1.0);
      let dc = vec4f(stroke.rgb * stroke.a, stroke.a) * dt;
      col = dc + col * (1.0 - dc.a);
    }
  }
  col *= st.b.z;
  if (col.a < 0.004) { discard; }
  return col;
}
`;
