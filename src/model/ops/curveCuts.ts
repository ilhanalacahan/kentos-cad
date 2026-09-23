import type { ConstructionEntity, EllipseEntity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { normAngle, TAU } from '../geom/arc';
import {
  closestParam,
  ellipseDerivative,
  ellipsePoint,
  ellipseSweep,
  isFullEllipse,
  lineEllipse,
  paramOfPoint,
  tessellateEllipse,
  type EllipseGeom,
} from '../geom/ellipse';
import { closestOnEdge, intersectEdges, lineCircleParams, lineLine, onEdgeArc, type Edge } from '../geom/intersect';

/**
 * Trim, break, extend and offset for the curves that are not paths of
 * segments and circular arcs: ellipses (cut in parameter space, pieces stay
 * elliptical arcs) and construction lines (pieces become rays or lines, as
 * AutoCAD does).
 */

type Cut = { pieces: EntityGeometry[] } | { error: string };

// ── Ellipse ────────────────────────────────────────────────────────────

const full = (e: EllipseGeom): EllipseGeom => ({ ...e, t0: 0, t1: 0 });
const arcOf = (e: EllipseEntity, a: number, b: number): EntityGeometry => ({ kind: 'ellipse', c: e.c, major: e.major, ratio: e.ratio, t0: normAngle(e.t0 + a), t1: normAngle(e.t0 + b) });

/** Parameters where boundaries cross the curve `e` (exact for straight boundaries). */
export function ellipseCrossings(e: EllipseGeom, boundaries: readonly Edge[]): number[] {
  const out: number[] = [];
  const chords = tessellateEllipse(e, 256);
  const closed = isFullEllipse(e);
  const edges: Edge[] = [];
  for (let i = 0; i < (closed ? chords.length : chords.length - 1); i++) edges.push({ kind: 'seg', a: chords[i], b: chords[(i + 1) % chords.length] });
  for (const b of boundaries) {
    if (b.kind === 'seg') {
      for (const h of lineEllipse(e, b.a, b.b)) if (h.u >= -1e-9 && h.u <= 1 + 1e-9) out.push(h.t);
      continue;
    }
    for (const ed of edges)
      for (const h of intersectEdges(ed, b)) {
        // Alternate projections: onto the ellipse, onto the circle, until they agree.
        let q = h.p;
        for (let k = 0; k < 40; k++) q = closestOnEdge(b, ellipsePoint(full(e), closestParam(full(e), q))).p;
        out.push(paramOfPoint(e, q));
      }
  }
  return out;
}

/** Offsets d (0..sweep) of cut parameters along the curve, sorted and de-duplicated. */
function offsets(e: EllipseEntity, ts: number[]): number[] {
  const sw = ellipseSweep(e);
  const closed = isFullEllipse(e);
  const d = ts.map((t) => normAngle(t - e.t0)).filter((x) => closed || (x > 1e-9 && x < sw - 1e-9)).sort((a, b) => a - b);
  return d.filter((x, i) => i === 0 || x - d[i - 1] > 1e-9);
}

export function trimEllipse(e: EllipseEntity, pick: Vec2, boundaries: readonly Edge[]): Cut {
  const cuts = offsets(e, ellipseCrossings(e, boundaries));
  const dp = normAngle(closestParam(e, pick) - e.t0);
  const sw = ellipseSweep(e);
  if (isFullEllipse(e)) {
    if (cuts.length < 2) return { error: 'Elipsi budamak için en az iki kesişim gerekir.' };
    const below = cuts.filter((c) => c < dp);
    const above = cuts.filter((c) => c > dp);
    const lo = below.length ? below[below.length - 1] : cuts[cuts.length - 1] - TAU;
    const hi = above.length ? above[0] : cuts[0] + TAU;
    return { pieces: [arcOf(e, hi, lo + TAU)] };
  }
  const lo = Math.max(0, ...cuts.filter((c) => c < dp));
  const hi = Math.min(sw, ...cuts.filter((c) => c > dp));
  if (lo <= 1e-9 && hi >= sw - 1e-9) return { error: 'Tıklanan kısmı kesen bir kenar yok.' };
  const pieces: EntityGeometry[] = [];
  if (lo > 1e-9) pieces.push(arcOf(e, 0, lo));
  if (hi < sw - 1e-9) pieces.push(arcOf(e, hi, sw));
  return { pieces };
}

export function breakEllipse(e: EllipseEntity, p1: Vec2, p2: Vec2): Cut {
  const d1 = normAngle(closestParam(e, p1) - e.t0);
  const d2 = normAngle(closestParam(e, p2) - e.t0);
  const sw = ellipseSweep(e);
  const same = Math.abs(d1 - d2) < 1e-9;
  if (isFullEllipse(e)) {
    if (same) return { error: 'Elips tek noktadan kırılamaz; ikinci bir nokta gösterin.' };
    // Removed: counter-clockwise from the first pick to the second.
    return { pieces: [arcOf(e, d2, d1 > d2 ? d1 : d1 + TAU)] };
  }
  if (same) {
    if (d1 <= 1e-9 || d1 >= sw - 1e-9) return { error: 'Yay ucundan kırılamaz; iç kısmında bir nokta gösterin.' };
    return { pieces: [arcOf(e, 0, d1), arcOf(e, d1, sw)] };
  }
  const lo = Math.min(d1, d2);
  const hi = Math.max(d1, d2);
  const pieces: EntityGeometry[] = [];
  if (lo > 1e-9) pieces.push(arcOf(e, 0, lo));
  if (hi < sw - 1e-9) pieces.push(arcOf(e, hi, sw));
  return pieces.length ? { pieces } : { error: 'İki nokta yayın tamamını kapsıyor; silmek için Sil kullanın.' };
}

/** Grows the end of an elliptical arc nearer to `pick` along its ellipse to the first boundary. */
export function extendEllipse(e: EllipseEntity, pick: Vec2, boundaries: readonly Edge[]): { geometry: EntityGeometry } | { error: string } {
  if (isFullEllipse(e)) return { error: 'Tam elips uzatılamaz.' };
  const s = ellipsePoint(e, e.t0);
  const f = ellipsePoint(e, e.t1);
  const atEnd = Math.hypot(pick.x - f.x, pick.y - f.y) <= Math.hypot(pick.x - s.x, pick.y - s.y);
  const gap = TAU - ellipseSweep(e);
  let best = Infinity;
  for (const t of ellipseCrossings(full(e), boundaries)) {
    const delta = atEnd ? normAngle(t - e.t1) : normAngle(e.t0 - t);
    if (delta > 1e-9 && delta < gap - 1e-9) best = Math.min(best, delta);
  }
  if (!Number.isFinite(best)) return { error: 'Bu yönde ulaşılacak bir sınır yok.' };
  return { geometry: { kind: 'ellipse', c: e.c, major: e.major, ratio: e.ratio, t0: atEnd ? e.t0 : normAngle(e.t0 - best), t1: atEnd ? normAngle(e.t1 + best) : e.t1 } };
}

/**
 * Offset of an ellipse at distance d towards `through`. The true offset of
 * an ellipse is not an ellipse; like AutoCAD, the result follows it with a
 * dense polyline through exact offset points.
 */
export function offsetEllipse(e: EllipseEntity, d: number, through: Vec2): { geometry: EntityGeometry } | { error: string } {
  const t = closestParam(e, through);
  const q = ellipsePoint(e, t);
  const tan = ellipseDerivative(e, t);
  // Counter-clockwise parameterisation: the outside is right of travel.
  const outward = (through.x - q.x) * tan.y - (through.y - q.y) * tan.x > 0;
  const a = Math.hypot(e.major.x, e.major.y);
  const b = a * e.ratio;
  if (!outward && d >= (b * b) / a - 1e-9) return { error: 'Mesafe elipsin en küçük eğrilik yarıçapından büyük; içe doğru öteleme bozulur.' };
  const closed = isFullEllipse(e);
  const n = 512;
  const sw = ellipseSweep(e);
  const pts: Vec2[] = [];
  for (let i = 0; i < (closed ? n : n + 1); i++) {
    const u = e.t0 + (sw * i) / n;
    const p = ellipsePoint(e, u);
    const dp = ellipseDerivative(e, u);
    const l = Math.hypot(dp.x, dp.y) || 1;
    const s = outward ? d : -d;
    pts.push({ x: p.x + (dp.y / l) * s, y: p.y - (dp.x / l) * s });
  }
  return { geometry: { kind: closed ? 'polygon' : 'polyline', pts } };
}

// ── Construction lines ─────────────────────────────────────────────────

/** Piece of the line p + dir·t between lo and hi (±Infinity allowed). */
function linePiece(e: ConstructionEntity, lo: number, hi: number): EntityGeometry {
  const at = (t: number) => ({ x: e.p.x + e.dir.x * t, y: e.p.y + e.dir.y * t });
  if (lo === -Infinity && hi === Infinity) return { kind: 'xline', p: e.p, dir: e.dir };
  // `|| 0` turns −0 into 0 so reversed axis directions stay clean.
  if (lo === -Infinity) return { kind: 'ray', p: at(hi), dir: { x: -e.dir.x || 0, y: -e.dir.y || 0 } };
  if (hi === Infinity) return { kind: 'ray', p: at(lo), dir: e.dir };
  return { kind: 'line', a: at(lo), b: at(hi) };
}

const paramOn = (e: ConstructionEntity, p: Vec2) => (p.x - e.p.x) * e.dir.x + (p.y - e.p.y) * e.dir.y;

/**
 * Line parameters (metres from p along dir) where boundaries cross the
 * construction line, solved from p itself: the far ends of its CPU edge
 * would cost precision.
 */
function lineCuts(e: ConstructionEntity, boundaries: readonly Edge[]): number[] {
  const q = { x: e.p.x + e.dir.x, y: e.p.y + e.dir.y };
  const out: number[] = [];
  for (const b of boundaries) {
    if (b.kind === 'seg') {
      const h = lineLine(e.p, q, b.a, b.b);
      if (h && h.u >= -1e-9 && h.u <= 1 + 1e-9) out.push(h.t);
      continue;
    }
    for (const t of lineCircleParams(e.p, q, b.c, b.r)) {
      const x = e.p.x + e.dir.x * t;
      const y = e.p.y + e.dir.y * t;
      if (onEdgeArc(b, Math.atan2(y - b.c.y, x - b.c.x))) out.push(t);
    }
  }
  const min = e.kind === 'ray' ? 1e-9 : -Infinity;
  return out.filter((t) => t > min).sort((a, b) => a - b);
}

export function trimConstruction(e: ConstructionEntity, pick: Vec2, boundaries: readonly Edge[]): Cut {
  const cuts = lineCuts(e, boundaries);
  const tp = paramOn(e, pick);
  const start = e.kind === 'ray' ? 0 : -Infinity;
  const lo = Math.max(start, ...cuts.filter((c) => c < tp));
  const hi = Math.min(Infinity, ...cuts.filter((c) => c > tp));
  if (lo === start && hi === Infinity) return { error: 'Tıklanan kısmı kesen bir kenar yok.' };
  const pieces: EntityGeometry[] = [];
  if (lo > start) pieces.push(linePiece(e, start, lo));
  if (hi < Infinity) pieces.push(linePiece(e, hi, Infinity));
  return { pieces };
}

export function breakConstruction(e: ConstructionEntity, p1: Vec2, p2: Vec2): Cut {
  const t1 = paramOn(e, p1);
  const t2 = paramOn(e, p2);
  const start = e.kind === 'ray' ? 0 : -Infinity;
  const lo = Math.max(start, Math.min(t1, t2));
  const hi = Math.max(t1, t2);
  if (Math.abs(t1 - t2) < 1e-9) {
    if (lo <= start + 1e-9) return { error: 'Işın başlangıcından kırılamaz; ilerisinde bir nokta gösterin.' };
    return { pieces: [linePiece(e, start, lo), linePiece(e, lo, Infinity)] };
  }
  const pieces: EntityGeometry[] = [];
  if (lo > start + 1e-9) pieces.push(linePiece(e, start, lo));
  pieces.push(linePiece(e, hi, Infinity));
  return { pieces };
}

export function offsetConstruction(e: ConstructionEntity, d: number, through: Vec2): { geometry: EntityGeometry } {
  const side = e.dir.x * (through.y - e.p.y) - e.dir.y * (through.x - e.p.x) >= 0 ? 1 : -1;
  return { geometry: { kind: e.kind, p: { x: e.p.x - e.dir.y * d * side, y: e.p.y + e.dir.x * d * side }, dir: e.dir } };
}
