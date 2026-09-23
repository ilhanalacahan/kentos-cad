import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { bulgeRingArea } from '../geom/bulge';
import { nearestS, pathOf, subPath } from './path';

export type BreakResult = { pieces: EntityGeometry[] } | { error: string };

/**
 * Removes the part between two picked points ("Kır"). With p2 = p1 the
 * object is split at that point and nothing is removed. On closed shapes
 * the removed part runs counter-clockwise from p1 to p2, as on circles;
 * breaking a polygon at a single point opens it there.
 */
export function breakEntity(e: Entity, p1: Vec2, p2: Vec2): BreakResult {
  if (e.kind === 'spline') return { error: 'Eğri kırılamaz; önce Patlat (X) ile çoklu çizgiye dönüştürün.' };
  if (e.kind !== 'line' && e.kind !== 'polyline' && e.kind !== 'polygon' && e.kind !== 'arc' && e.kind !== 'circle') {
    return { error: 'Yalnızca çizgi, çoklu çizgi, kapalı alan, yay ve daire kırılabilir.' };
  }
  const path = pathOf(e);
  if (!path) return { error: 'Bu nesne kırılamaz.' };
  const L = path.length;
  const eps = 1e-7 * Math.max(1, L);
  let s1 = nearestS(path, p1);
  let s2 = nearestS(path, p2);
  const atPoint = Math.abs(s1 - s2) <= eps || (path.closed && Math.abs(Math.abs(s1 - s2) - L) <= eps);

  if (!path.closed) {
    if (atPoint) {
      if (s1 <= eps || s1 >= L - eps) return { error: 'Nesne ucundan kırılamaz; iç kısmında bir nokta gösterin.' };
      return { pieces: [subPath(path, 0, s1, e), subPath(path, s1, L, e)] };
    }
    const lo = Math.min(s1, s2);
    const hi = Math.max(s1, s2);
    const pieces: EntityGeometry[] = [];
    if (lo > eps) pieces.push(subPath(path, 0, lo, e));
    if (hi < L - eps) pieces.push(subPath(path, hi, L, e));
    return pieces.length ? { pieces } : { error: 'İki nokta nesnenin tamamını kapsıyor; silmek için Sil kullanın.' };
  }

  if (atPoint) {
    if (e.kind === 'circle') return { error: 'Daire tek noktadan kırılamaz; ikinci bir nokta gösterin.' };
    return { pieces: [subPath(path, s1, s1 + L, e)] };
  }
  // Circles run counter-clockwise; a clockwise ring swaps the picks so the removed part stays CCW.
  const ccw = e.kind === 'circle' || e.kind === 'arc' || (e.kind === 'polygon' && bulgeRingArea(e.pts, e.bulges) > 0);
  if (!ccw) [s1, s2] = [s2, s1];
  // Remove s1 → s2 forwards; keep s2 → s1 (+L).
  const keepEnd = s1 > s2 ? s1 : s1 + L;
  return { pieces: [subPath(path, s2, keepEnd, e)] };
}
