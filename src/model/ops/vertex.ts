import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { bulgeArc, bulgeAt, bulgeOfSweep, cleanBulgePath } from '../geom/bulge';
import { closestOnEdge } from '../geom/intersect';
import { entityEdges } from './edges';

export type VertexResult = { geometry: EntityGeometry } | { error: string };

/**
 * Index of the segment of a line/polyline/polygon nearest to p. Edges within
 * 1e-9 m of each other tie and the first wins: at a shared vertex both edges
 * are nearest, and rounding in an arc's end must not pick between them.
 */
export function nearestSegment(e: Entity, p: Vec2): number {
  let best = { d: Infinity, i: 0 };
  entityEdges(e).forEach((ed, i) => {
    const d = closestOnEdge(ed, p).d;
    if (d < best.d - 1e-9) best = { d, i };
  });
  return best.i;
}

/**
 * Adds a vertex on segment `seg` at the point nearest to p. A line becomes
 * a two-segment polyline; an arc segment is split into two arcs that
 * together keep the original curve.
 */
export function insertVertex(e: Entity, seg: number, p: Vec2): VertexResult {
  if (e.kind === 'line') {
    const q = closestOnEdge({ kind: 'seg', a: e.a, b: e.b }, p);
    if (q.t <= 1e-9 || q.t >= 1 - 1e-9) return { error: 'Köşe çizginin iç kısmına eklenmeli.' };
    return { geometry: { kind: 'polyline', pts: [e.a, q.p, e.b] } };
  }
  if (e.kind !== 'polyline' && e.kind !== 'polygon') return { error: 'Köşe yalnızca çizgi, çoklu çizgi ve kapalı alana eklenebilir.' };
  const n = e.pts.length;
  const a = e.pts[seg];
  const b = e.pts[(seg + 1) % n];
  const arc = bulgeArc(a, b, bulgeAt(e.bulges, seg));
  const edge = entityEdges(e)[seg];
  const q = closestOnEdge(edge, p);
  if (q.t <= 1e-9 || q.t >= 1 - 1e-9) return { error: 'Köşe bir kenarın iç kısmına eklenmeli; mevcut köşeye çok yakın.' };
  const pts = [...e.pts.slice(0, seg + 1), q.p, ...e.pts.slice(seg + 1)];
  const bulges = e.pts.map((_, i) => bulgeAt(e.bulges, i));
  // Splitting an arc at parameter t: both halves keep the circle.
  const halves = arc ? [bulgeOfSweep(arc.sweep * q.t), bulgeOfSweep(arc.sweep * (1 - q.t))] : [0, 0];
  bulges.splice(seg, 1, ...halves);
  return { geometry: { kind: e.kind, ...cleanBulgePath(pts, bulges, e.kind === 'polygon') } };
}

/** Removes vertex `index`; its two segments merge into one straight segment. */
export function removeVertex(e: Entity, index: number): VertexResult {
  if (e.kind !== 'polyline' && e.kind !== 'polygon') return { error: 'Köşe yalnızca çoklu çizgi ve kapalı alandan silinebilir.' };
  const n = e.pts.length;
  const min = e.kind === 'polygon' ? 4 : 3;
  if (n < min) return { error: e.kind === 'polygon' ? 'Kapalı alanda en az üç köşe kalmalı.' : 'Çoklu çizgide en az iki köşe kalmalı.' };
  const pts = e.pts.filter((_, i) => i !== index);
  const bulges = e.pts.map((_, i) => bulgeAt(e.bulges, i));
  if (e.kind === 'polyline' && index === 0) bulges.splice(0, 1);
  else if (e.kind === 'polyline' && index === n - 1) bulges.splice(n - 1, 1), (bulges[n - 2] = 0);
  else {
    // Segments (index−1 → index) and (index → index+1) become one straight segment.
    const prev = (index - 1 + n) % n;
    bulges[prev] = 0;
    bulges.splice(index, 1);
  }
  return { geometry: { kind: e.kind, ...cleanBulgePath(pts, bulges, e.kind === 'polygon') } };
}
