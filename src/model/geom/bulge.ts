import { pathLength, signedArea, type Vec2 } from '../geometry';
import { circleThrough, normAngle, TAU } from './arc';
import type { Edge } from './intersect';

/**
 * Polyline arc segments follow the DXF "bulge" convention: the segment from
 * pts[i] to pts[i+1] carries bulge = tan(θ/4), θ being its included angle,
 * positive when the arc runs counter-clockwise; 0 is a straight segment.
 * Vertices stay the only coordinates (grips, snaps and coordinate lists
 * need no special case) and the data maps one-to-one onto DXF LWPOLYLINE.
 */

const EPS = 1e-12;

export const bulgeAt = (bulges: readonly number[] | undefined, i: number) => bulges?.[i] ?? 0;
export const isArcBulge = (b: number) => Math.abs(b) > EPS;
export const hasBulges = (bulges: readonly number[] | undefined) => !!bulges && bulges.some(isArcBulge);

/** Circle, start angle and signed sweep of an arc segment; null when straight or degenerate. */
export function bulgeArc(a: Vec2, b: Vec2, bulge: number): { c: Vec2; r: number; a0: number; sweep: number } | null {
  if (!isArcBulge(bulge)) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord < EPS) return null;
  // Centre sits on the chord's left normal at chord·(1−b²)/(4b); r = chord·(1+b²)/(4|b|).
  const k = (1 - bulge * bulge) / (4 * bulge);
  const c = { x: (a.x + b.x) / 2 - dy * k, y: (a.y + b.y) / 2 + dx * k };
  const r = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  return { c, r, a0: Math.atan2(a.y - c.y, a.x - c.x), sweep: 4 * Math.atan(bulge) };
}

export const bulgeOfSweep = (sweep: number) => Math.tan(sweep / 4);

/** Middle of a segment: the chord midpoint, or the arc's midpoint when bulged. */
export function segmentMid(a: Vec2, b: Vec2, bulge: number): Vec2 {
  // The sagitta is bulge·chord/2, perpendicular to the chord (right of travel for a CCW arc).
  return { x: (a.x + b.x) / 2 + ((b.y - a.y) * bulge) / 2, y: (a.y + b.y) / 2 - ((b.x - a.x) * bulge) / 2 };
}

/** Bulge of the arc from `a` through `m` to `b`; 0 when the points are collinear. */
export function bulgeThrough(a: Vec2, m: Vec2, b: Vec2): number {
  const circle = circleThrough(a, m, b);
  if (!circle) return 0;
  const { c } = circle;
  const as = Math.atan2(a.y - c.y, a.x - c.x);
  const am = Math.atan2(m.y - c.y, m.x - c.x);
  const ae = Math.atan2(b.y - c.y, b.x - c.x);
  const ccw = normAngle(am - as) < normAngle(ae - as);
  return bulgeOfSweep(ccw ? normAngle(ae - as) : -normAngle(as - ae));
}

/**
 * Bulge of the arc leaving `a` along direction `dir` and ending at `b`
 * (polyline arc mode continues tangentially). Null when `b` lies straight
 * behind `a`, which would need a full circle.
 */
export function tangentBulge(a: Vec2, dir: Vec2, b: Vec2): number | null {
  const cx = b.x - a.x;
  const cy = b.y - a.y;
  if (Math.hypot(cx, cy) < EPS) return null;
  const alpha = Math.atan2(dir.x * cy - dir.y * cx, dir.x * cx + dir.y * cy);
  if (Math.PI - Math.abs(alpha) < 1e-6) return null;
  // The included angle is twice the angle between tangent and chord.
  return Math.tan(alpha / 2);
}

/** Unit travel direction at the end (`atEnd`) or start of a segment. */
export function segmentTangent(a: Vec2, b: Vec2, bulge: number, atEnd: boolean): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const half = 2 * Math.atan(bulge); // θ/2
  const rot = atEnd ? half : -half;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { x: (dx * cos - dy * sin) / l, y: (dx * sin + dy * cos) / l };
}

const segCount = (n: number, closed: boolean) => (closed ? n : n - 1);

/** Primitive edges of a bulged path (arc edges keep the travel direction). */
export function bulgePathEdges(pts: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean): Edge[] {
  const out: Edge[] = [];
  const n = pts.length;
  for (let i = 0; i < segCount(n, closed); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const arc = bulgeArc(a, b, bulgeAt(bulges, i));
    out.push(arc ? { kind: 'arc', ...arc } : { kind: 'seg', a, b });
  }
  return out;
}

/**
 * Point list with arc segments tessellated (step ≤ `maxStep` radians). A
 * closed path returns a ring without repeating its first point.
 */
export function bulgePathOutline(pts: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean, maxStep = TAU / 72): Vec2[] {
  const n = pts.length;
  if (!hasBulges(bulges)) return [...pts];
  const out: Vec2[] = [];
  for (let i = 0; i < segCount(n, closed); i++) {
    const a = pts[i];
    out.push(a);
    const arc = bulgeArc(a, pts[(i + 1) % n], bulgeAt(bulges, i));
    if (!arc) continue;
    const steps = Math.max(2, Math.ceil(Math.abs(arc.sweep) / maxStep));
    for (let k = 1; k < steps; k++) {
      const t = arc.a0 + (arc.sweep * k) / steps;
      out.push({ x: arc.c.x + Math.cos(t) * arc.r, y: arc.c.y + Math.sin(t) * arc.r });
    }
  }
  if (!closed && n) out.push(pts[n - 1]);
  return out;
}

/** Length along the path, arcs measured exactly. */
export function bulgePathLength(pts: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean): number {
  if (!hasBulges(bulges)) return pathLength(pts, closed);
  let l = 0;
  const n = pts.length;
  for (let i = 0; i < segCount(n, closed); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const arc = bulgeArc(a, b, bulgeAt(bulges, i));
    l += arc ? arc.r * Math.abs(arc.sweep) : Math.hypot(b.x - a.x, b.y - a.y);
  }
  return l;
}

/** Signed area of a closed bulged ring: shoelace plus each arc's circular segment. */
export function bulgeRingArea(pts: readonly Vec2[], bulges: readonly number[] | undefined): number {
  let area = signedArea(pts);
  if (!hasBulges(bulges)) return area;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const arc = bulgeArc(pts[i], pts[(i + 1) % n], bulgeAt(bulges, i));
    if (arc) area += ((arc.r * arc.r) / 2) * (arc.sweep - Math.sin(arc.sweep));
  }
  return area;
}

/** Path reversed: vertex order flips and every arc turns the other way. */
export function reverseBulgePath(pts: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean): { pts: Vec2[]; bulges: number[] } {
  const n = pts.length;
  const rp = [...pts].reverse();
  const rb: number[] = new Array(n).fill(0);
  if (closed) {
    // Segment i of the reversed ring runs rp[i] → rp[i+1] = pts[n-1-i] → pts[n-2-i].
    for (let i = 0; i < n; i++) rb[i] = -bulgeAt(bulges, (2 * n - 2 - i) % n);
  } else for (let i = 0; i < n - 1; i++) rb[i] = -bulgeAt(bulges, n - 2 - i);
  return { pts: rp, bulges: rb };
}

/**
 * Drops zero-length segments (coincident consecutive vertices), keeping
 * the bulge of the segment that survives. Returns bulges only when one is
 * an arc.
 */
export function cleanBulgePath(pts: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean, tol = 1e-9): { pts: Vec2[]; bulges?: number[] } {
  const outP: Vec2[] = [];
  const outB: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const last = outP.at(-1);
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= tol) {
      outB[outB.length - 1] = bulgeAt(bulges, i);
      continue;
    }
    outP.push(p);
    outB.push(bulgeAt(bulges, i));
  }
  if (closed && outP.length > 1) {
    const f = outP[0];
    const l = outP[outP.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) <= tol) {
      outP.pop();
      outB.pop();
    }
  }
  if (!closed && outB.length) outB[outB.length - 1] = 0;
  return hasBulges(outB) ? { pts: outP, bulges: outB } : { pts: outP };
}
