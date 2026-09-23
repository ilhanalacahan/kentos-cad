import { dist, signedArea, type Vec2 } from '../geometry';
import { normAngle, type ArcGeom } from './arc';
import { bulgeArc, tangentBulge } from './bulge';

/**
 * Constructions behind the drawing tools (rectangles, regular polygons,
 * AutoCAD's arc modes). Pure: points in, rings or arcs out; null when the
 * input cannot make a shape.
 */

const sub = (a: Vec2, b: Vec2) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Vec2) => Math.hypot(v.x, v.y);
const ang = (from: Vec2, to: Vec2) => Math.atan2(to.y - from.y, to.x - from.x);
const at = (c: Vec2, r: number, a: number) => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });

// ── Dikdörtgen ─────────────────────────────────────────────────────────

/** Rectangle on edge p1→p2, `width` to its left (negative: right). */
export function rectFromEdge(p1: Vec2, p2: Vec2, width: number): Vec2[] | null {
  const d = sub(p2, p1);
  const l = len(d);
  if (l < 1e-9 || Math.abs(width) < 1e-9) return null;
  const n = { x: (-d.y / l) * width, y: (d.x / l) * width };
  return [p1, p2, { x: p2.x + n.x, y: p2.y + n.y }, { x: p1.x + n.x, y: p1.y + n.y }];
}

/** Signed distance of p from the line p1→p2 (positive on the left). */
export function sideDistance(p1: Vec2, p2: Vec2, p: Vec2): number {
  const d = sub(p2, p1);
  const l = len(d) || 1;
  return (d.x * (p.y - p1.y) - d.y * (p.x - p1.x)) / l;
}

/** Rectangle with opposite corners a and b whose sides run at `rotation` (radians). */
export function rectFromCorners(a: Vec2, b: Vec2, rotation = 0): Vec2[] | null {
  const u = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const v = { x: -u.y, y: u.x };
  const w = sub(b, a);
  const du = w.x * u.x + w.y * u.y;
  const dv = w.x * v.x + w.y * v.y;
  if (Math.abs(du) < 1e-9 || Math.abs(dv) < 1e-9) return null;
  return [a, { x: a.x + u.x * du, y: a.y + u.y * du }, { x: a.x + u.x * du + v.x * dv, y: a.y + u.y * du + v.y * dv }, { x: a.x + v.x * dv, y: a.y + v.y * dv }];
}

/**
 * Rectangle of given length (along the rotation) and width from corner a,
 * placed in the quadrant (of the rotated frame) that `towards` lies in.
 */
export function rectFromSize(a: Vec2, length: number, width: number, rotation: number, towards: Vec2): Vec2[] | null {
  const u = { x: Math.cos(rotation), y: Math.sin(rotation) };
  const w = sub(towards, a);
  const su = w.x * u.x + w.y * u.y >= 0 ? 1 : -1;
  const sv = -w.x * u.y + w.y * u.x >= 0 ? 1 : -1;
  const b = { x: a.x + u.x * length * su - u.y * width * sv, y: a.y + u.y * length * su + u.x * width * sv };
  return rectFromCorners(a, b, rotation);
}

// ── Düzgün çokgen ──────────────────────────────────────────────────────

/**
 * Regular n-gon about `center`. Inscribed: `p` is a vertex (the circle
 * passes through the corners). Circumscribed: `p` is the middle of an edge
 * (the circle touches the edges).
 */
export function regularPolygon(center: Vec2, sides: number, p: Vec2, mode: 'inscribed' | 'circumscribed'): Vec2[] | null {
  const n = Math.round(sides);
  const r0 = len(sub(p, center));
  if (n < 3 || r0 < 1e-9) return null;
  const a0 = ang(center, p);
  const R = mode === 'inscribed' ? r0 : r0 / Math.cos(Math.PI / n);
  const start = mode === 'inscribed' ? a0 : a0 - Math.PI / n;
  return Array.from({ length: n }, (_, k) => at(center, R, start + (2 * Math.PI * k) / n));
}

/** Regular n-gon built on edge p1→p2, counter-clockwise (to the left of the edge). */
export function regularPolygonOnEdge(p1: Vec2, p2: Vec2, sides: number): Vec2[] | null {
  const n = Math.round(sides);
  const s = len(sub(p2, p1));
  if (n < 3 || s < 1e-9) return null;
  const a = ang(p1, p2);
  const out: Vec2[] = [p1];
  for (let k = 0; k < n - 1; k++) {
    const q = out[k];
    const t = a + (2 * Math.PI * k) / n;
    out.push(k === 0 ? p2 : { x: q.x + Math.cos(t) * s, y: q.y + Math.sin(t) * s });
  }
  return out;
}

// ── Yay modları (AutoCAD ARC) ──────────────────────────────────────────

/** Arc from a signed sweep (as bulge arcs carry) to the stored counter-clockwise form. */
function ccw(c: Vec2, r: number, a0: number, sweep: number): ArcGeom | null {
  if (!(r > 1e-9) || Math.abs(sweep) < 1e-9 || !Number.isFinite(r)) return null;
  const s = a0;
  const e = a0 + sweep;
  return sweep > 0 ? { c, r, a0: normAngle(s), a1: normAngle(e) } : { c, r, a0: normAngle(e), a1: normAngle(s) };
}

/** Start, centre, end direction: counter-clockwise from start to the ray through `end`. */
export function arcStartCenterEnd(start: Vec2, center: Vec2, end: Vec2): ArcGeom | null {
  const r = len(sub(start, center));
  if (r < 1e-9 || len(sub(end, center)) < 1e-9) return null;
  const a0 = ang(center, start);
  let sw = normAngle(ang(center, end) - a0);
  if (sw < 1e-9) sw = 2 * Math.PI;
  return ccw(center, r, a0, sw);
}

/** Start, centre, included angle (degrees; negative runs clockwise). */
export function arcStartCenterAngle(start: Vec2, center: Vec2, degrees: number): ArcGeom | null {
  const r = len(sub(start, center));
  return ccw(center, r, ang(center, start), (degrees * Math.PI) / 180);
}

/** Start, centre, chord length (positive: minor arc CCW; negative: major arc). */
export function arcStartCenterChord(start: Vec2, center: Vec2, chord: number): ArcGeom | null {
  const r = len(sub(start, center));
  const c = Math.abs(chord);
  if (r < 1e-9 || c < 1e-9 || c > 2 * r + 1e-9) return null;
  const minor = 2 * Math.asin(Math.min(1, c / (2 * r)));
  return ccw(center, r, ang(center, start), chord > 0 ? minor : 2 * Math.PI - minor);
}

/** Start, end, included angle (degrees; positive counter-clockwise from start to end). */
export function arcStartEndAngle(start: Vec2, end: Vec2, degrees: number): ArcGeom | null {
  const t = (degrees * Math.PI) / 180;
  if (Math.abs(t) < 1e-9 || Math.abs(t) >= 2 * Math.PI) return null;
  const a = bulgeArc(start, end, Math.tan(t / 4));
  return a && ccw(a.c, a.r, a.a0, a.sweep);
}

/** Start, end, tangent direction at the start. */
export function arcStartEndDirection(start: Vec2, end: Vec2, dir: Vec2): ArcGeom | null {
  const b = tangentBulge(start, dir, end);
  const a = b === null ? null : bulgeArc(start, end, b);
  return a && ccw(a.c, a.r, a.a0, a.sweep);
}

/** Start, end, radius (positive: minor arc CCW from start to end; negative: major arc). */
export function arcStartEndRadius(start: Vec2, end: Vec2, radius: number): ArcGeom | null {
  const d = len(sub(end, start));
  const r = Math.abs(radius);
  if (d < 1e-9 || r < d / 2 - 1e-9) return null;
  const half = Math.asin(Math.min(1, d / (2 * r)));
  return arcStartEndAngle(start, end, ((radius > 0 ? 2 * half : 2 * Math.PI - 2 * half) * 180) / Math.PI);
}

/** Start, end and centre (the radius comes from the start; the end fixes the direction). */
export function arcStartEndCenter(start: Vec2, end: Vec2, center: Vec2): ArcGeom | null {
  return arcStartCenterEnd(start, center, end);
}

/** Bulge of the cloud's scallops: about 106° arcs, outward on a counter-clockwise ring. */
const SCALLOP = 0.5;

/**
 * Scalloped outline of a closed ring: each side is divided into chords of
 * about `arc` metres and every chord bulges outwards.
 */
export function cloudOf(ring: readonly Vec2[], arc: number): { pts: Vec2[]; bulges: number[] } | null {
  if (ring.length < 3 || !(arc > 0)) return null;
  const ccw = signedArea(ring) > 0 ? [...ring] : [...ring].reverse();
  const pts: Vec2[] = [];
  for (let i = 0; i < ccw.length; i++) {
    const a = ccw[i];
    const b = ccw[(i + 1) % ccw.length];
    const k = Math.max(1, Math.round(dist(a, b) / arc));
    for (let j = 0; j < k; j++) pts.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
  }
  return { pts, bulges: pts.map(() => SCALLOP) };
}
