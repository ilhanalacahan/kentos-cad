import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { arcEnd, arcStart, bulgeFromArc } from '../geom/arc';
import { bulgeAt, cleanBulgePath, reverseBulgePath } from '../geom/bulge';

/** An open run of vertices with segment bulges (bulges[i] for pts[i] → pts[i+1]). */
interface Chain {
  pts: Vec2[];
  bulges: number[];
}

function chainOf(e: Entity): Chain | null {
  switch (e.kind) {
    case 'line':
      return { pts: [e.a, e.b], bulges: [0, 0] };
    case 'arc':
      return { pts: [arcStart(e), arcEnd(e)], bulges: [bulgeFromArc(e), 0] };
    case 'polyline':
      return { pts: [...e.pts], bulges: e.pts.map((_, i) => bulgeAt(e.bulges, i)) };
    default:
      return null;
  }
}

const near = (a: Vec2, b: Vec2, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

export interface JoinGroup {
  geometry: EntityGeometry;
  /** Source ids in chain order; the first decides layer and attributes. */
  sources: number[];
}

/**
 * Joins lines, arcs and open polylines whose ends meet (within `tol`) into
 * polylines with arc segments; a chain that returns to its start becomes a
 * closed polygon. Entities that connect to nothing are left out.
 */
export function joinEntities(list: readonly Entity[], tol: number): { groups: JoinGroup[]; skipped: number[] } {
  const items = list.map((e) => ({ e, c: chainOf(e) }));
  const skipped = items.filter((it) => !it.c).map((it) => it.e.id);
  const pool = items.filter((it): it is { e: Entity; c: Chain } => !!it.c);
  const used = new Set<number>();
  const groups: JoinGroup[] = [];

  for (const seed of pool) {
    if (used.has(seed.e.id)) continue;
    used.add(seed.e.id);
    let chain: Chain = { pts: [...seed.c.pts], bulges: [...seed.c.bulges] };
    const sources = [seed.e.id];
    let grew = true;
    while (grew) {
      grew = false;
      for (const it of pool) {
        if (used.has(it.e.id)) continue;
        const head = chain.pts[0];
        const tail = chain.pts[chain.pts.length - 1];
        if (near(head, tail, tol) && chain.pts.length > 2) break; // already closed
        const s = it.c.pts[0];
        const f = it.c.pts[it.c.pts.length - 1];
        let next: Chain | null = null;
        let atTail = true;
        if (near(tail, s, tol)) next = it.c;
        else if (near(tail, f, tol)) next = reversed(it.c);
        else if (near(head, f, tol)) (next = it.c), (atTail = false);
        else if (near(head, s, tol)) (next = reversed(it.c)), (atTail = false);
        if (!next) continue;
        chain = atTail ? append(chain, next) : append(next, chain);
        if (atTail) sources.push(it.e.id);
        else sources.unshift(it.e.id);
        used.add(it.e.id);
        grew = true;
      }
    }
    if (sources.length < 2) continue;
    groups.push({ geometry: toGeometry(chain, tol), sources });
  }
  const joined = new Set(groups.flatMap((g) => g.sources));
  for (const it of pool) if (!joined.has(it.e.id)) skipped.push(it.e.id);
  return { groups, skipped };
}

function reversed(c: Chain): Chain {
  return reverseBulgePath(c.pts, c.bulges, false);
}

/** a followed by b; b's first point is dropped (it meets a's last). */
function append(a: Chain, b: Chain): Chain {
  const pts = [...a.pts, ...b.pts.slice(1)];
  const bulges = [...a.bulges.slice(0, -1), ...b.bulges];
  return { pts, bulges };
}

function toGeometry(c: Chain, tol: number): EntityGeometry {
  const first = c.pts[0];
  const last = c.pts[c.pts.length - 1];
  const closed = c.pts.length > 2 && near(first, last, tol);
  const pts = closed ? c.pts.slice(0, -1) : c.pts;
  // Closed: the last segment (into the dropped duplicate) becomes the closing one.
  const bulges = closed ? c.bulges.slice(0, -1) : c.bulges;
  const clean = cleanBulgePath(pts, bulges, closed);
  return { kind: closed ? 'polygon' : 'polyline', ...clean };
}
