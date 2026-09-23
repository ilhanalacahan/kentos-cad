import type { Vec2 } from '../geometry';
import { normAngle, sweep, type ArcGeom } from '../geom/arc';
import { bulgeAt, cleanBulgePath } from '../geom/bulge';
import { lineLine } from '../geom/intersect';

export interface Seg {
  a: Vec2;
  b: Vec2;
}

export type FilletResult = { line1: Seg; line2: Seg; arc: ArcGeom | null } | { error: string };

const unit = (v: Vec2) => {
  const l = Math.hypot(v.x, v.y);
  return { x: v.x / l, y: v.y / l };
};
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;

/**
 * Joins two lines with a tangent arc of radius r (r = 0 makes a sharp
 * corner). The picked side of each line is kept.
 */
export function filletLines(l1: Seg, pick1: Vec2, l2: Seg, pick2: Vec2, r: number): FilletResult {
  const hit = lineLine(l1.a, l1.b, l2.a, l2.b);
  if (!hit) return { error: 'Çizgiler paralel; köşe oluşturulamaz.' };
  const X = hit.p;
  const keep = (l: Seg, pick: Vec2) => {
    const d = unit({ x: l.b.x - l.a.x, y: l.b.y - l.a.y });
    const s = dot({ x: pick.x - X.x, y: pick.y - X.y }, d);
    const u = s >= 0 ? d : { x: -d.x, y: -d.y };
    // Kept end: the endpoint furthest along u from the corner.
    const far = dot({ x: l.a.x - X.x, y: l.a.y - X.y }, u) >= dot({ x: l.b.x - X.x, y: l.b.y - X.y }, u) ? l.a : l.b;
    return { u, far, reach: dot({ x: far.x - X.x, y: far.y - X.y }, u) };
  };
  const k1 = keep(l1, pick1);
  const k2 = keep(l2, pick2);
  if (k1.reach <= 1e-9 || k2.reach <= 1e-9) return { error: 'Seçilen tarafta çizgi yok; köşeye doğru uzanan kısma tıklayın.' };
  if (r <= 0) return { line1: { a: k1.far, b: X }, line2: { a: k2.far, b: X }, arc: null };

  const cosPhi = Math.max(-1, Math.min(1, dot(k1.u, k2.u)));
  const phi = Math.acos(cosPhi);
  if (phi < 1e-6 || Math.PI - phi < 1e-6) return { error: 'Çizgiler aynı doğrultuda; yuvarlatılamaz.' };
  const half = phi / 2;
  const dT = r / Math.tan(half);
  if (dT > k1.reach + 1e-9 || dT > k2.reach + 1e-9) return { error: 'Yarıçap bu çizgiler için çok büyük.' };
  const T1 = { x: X.x + k1.u.x * dT, y: X.y + k1.u.y * dT };
  const T2 = { x: X.x + k2.u.x * dT, y: X.y + k2.u.y * dT };
  const bis = unit({ x: k1.u.x + k2.u.x, y: k1.u.y + k2.u.y });
  const dc = r / Math.sin(half);
  const c = { x: X.x + bis.x * dc, y: X.y + bis.y * dc };
  let a0 = normAngle(Math.atan2(T1.y - c.y, T1.x - c.x));
  let a1 = normAngle(Math.atan2(T2.y - c.y, T2.x - c.x));
  // The fillet is always the minor arc between the tangent points.
  if (sweep(a0, a1) > Math.PI) [a0, a1] = [a1, a0];
  return { line1: { a: k1.far, b: T1 }, line2: { a: k2.far, b: T2 }, arc: { c, r, a0, a1 } };
}

export type ChamferResult = { line1: Seg; line2: Seg; cut: Seg | null } | { error: string };

/**
 * Chamfer ("Pah"): cuts the corner of two lines at distance d1 along the
 * first and d2 along the second, measured from their intersection. Zero
 * distances make a sharp corner. The picked side of each line is kept.
 */
export function chamferLines(l1: Seg, pick1: Vec2, l2: Seg, pick2: Vec2, d1: number, d2: number): ChamferResult {
  const hit = lineLine(l1.a, l1.b, l2.a, l2.b);
  if (!hit) return { error: 'Çizgiler paralel; pah kırılamaz.' };
  const X = hit.p;
  const k1 = keptSide(l1, pick1, X);
  const k2 = keptSide(l2, pick2, X);
  if (k1.reach <= 1e-9 || k2.reach <= 1e-9) return { error: 'Seçilen tarafta çizgi yok; köşeye doğru uzanan kısma tıklayın.' };
  if (d1 <= 0 && d2 <= 0) return { line1: { a: k1.far, b: X }, line2: { a: k2.far, b: X }, cut: null };
  if (d1 > k1.reach + 1e-9 || d2 > k2.reach + 1e-9) return { error: 'Pah mesafesi çizgi boyundan büyük.' };
  const C1 = { x: X.x + k1.u.x * d1, y: X.y + k1.u.y * d1 };
  const C2 = { x: X.x + k2.u.x * d2, y: X.y + k2.u.y * d2 };
  return { line1: { a: k1.far, b: C1 }, line2: { a: k2.far, b: C2 }, cut: { a: C1, b: C2 } };
}

function keptSide(l: Seg, pick: Vec2, X: Vec2) {
  const d = unit({ x: l.b.x - l.a.x, y: l.b.y - l.a.y });
  const s = dot({ x: pick.x - X.x, y: pick.y - X.y }, d);
  const u = s >= 0 ? d : { x: -d.x, y: -d.y };
  const far = dot({ x: l.a.x - X.x, y: l.a.y - X.y }, u) >= dot({ x: l.b.x - X.x, y: l.b.y - X.y }, u) ? l.a : l.b;
  return { u, far, reach: dot({ x: far.x - X.x, y: far.y - X.y }, u) };
}

export type CornerResult = { pts: Vec2[]; bulges?: number[] } | { error: string };

/**
 * Rounds (`radius`) or chamfers (`d1`, `d2`) the corner at vertex `index`
 * of a polyline or polygon. Both neighbouring segments must be straight;
 * the corner vertex is replaced by the two tangent (or cut) points, joined
 * by an arc segment or a straight cut.
 */
export function cornerOfPath(
  pts: readonly Vec2[],
  bulges: readonly number[] | undefined,
  closed: boolean,
  index: number,
  op: { radius: number } | { d1: number; d2: number },
): CornerResult {
  const n = pts.length;
  if (!closed && (index <= 0 || index >= n - 1)) return { error: 'Açık çoklu çizginin uç noktası köşe değildir.' };
  const iPrev = (index - 1 + n) % n;
  const iNext = (index + 1) % n;
  if (Math.abs(bulgeAt(bulges, iPrev)) > 1e-12 || Math.abs(bulgeAt(bulges, index)) > 1e-12) return { error: 'Köşeyi oluşturan kenarlardan biri yay; yalnızca düz kenarlar arasındaki köşe işlenebilir.' };
  const V = pts[index];
  const P = pts[iPrev];
  const N = pts[iNext];
  const lp = Math.hypot(P.x - V.x, P.y - V.y);
  const ln = Math.hypot(N.x - V.x, N.y - V.y);
  if (lp < 1e-12 || ln < 1e-12) return { error: 'Köşede sıfır uzunluklu kenar var.' };
  const u1 = { x: (P.x - V.x) / lp, y: (P.y - V.y) / lp };
  const u2 = { x: (N.x - V.x) / ln, y: (N.y - V.y) / ln };
  const phi = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (phi < 1e-6 || Math.PI - phi < 1e-6) return { error: 'Kenarlar aynı doğrultuda; burada köşe yok.' };
  let d1: number;
  let d2: number;
  let bulge = 0;
  if ('radius' in op) {
    if (op.radius <= 0) return { error: 'Köşe zaten keskin; sıfırdan büyük bir yarıçap girin.' };
    d1 = d2 = op.radius / Math.tan(phi / 2);
    // Turning left at the corner means the fillet runs counter-clockwise.
    const turn = Math.sign(-u1.x * u2.y + u1.y * u2.x);
    bulge = turn * Math.tan((Math.PI - phi) / 4);
  } else {
    if (op.d1 <= 0 && op.d2 <= 0) return { error: 'Pah mesafeleri sıfırdan büyük olmalı.' };
    d1 = op.d1;
    d2 = op.d2;
  }
  if (d1 > lp + 1e-9 || d2 > ln + 1e-9) return { error: 'radius' in op ? 'Yarıçap bu kenarlar için çok büyük.' : 'Pah mesafesi kenar boyundan büyük.' };
  const T1 = { x: V.x + u1.x * d1, y: V.y + u1.y * d1 };
  const T2 = { x: V.x + u2.x * d2, y: V.y + u2.y * d2 };
  const outP = [...pts.slice(0, index), T1, T2, ...pts.slice(index + 1)];
  const src = pts.map((_, i) => bulgeAt(bulges, i));
  const outB = [...src.slice(0, index), bulge, ...src.slice(index)];
  return cleanBulgePath(outP, outB, closed);
}
