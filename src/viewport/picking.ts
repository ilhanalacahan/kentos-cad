import type { CadDocument } from '../model/document';
import { entityBounds, entityOutline, entityVertices, isClosedOutline, polygonRing, textBox, type Entity } from '../model/entities';
import { pointInPolygon, signedArea, type Bounds, type Vec2 } from '../model/geometry';
import { arcEnd, arcMid, arcStart } from '../model/geom/arc';
import { bulgeArc, bulgeAt, segmentMid } from '../model/geom/bulge';
import {
  closestParam,
  ellipseArea,
  ellipsePoint,
  ellipseTangentPoints,
  insideEllipse,
  isFullEllipse,
  lineEllipse,
  quadrantParams,
  tessellateEllipse,
  type EllipseGeom,
} from '../model/geom/ellipse';
import { layoutDimension } from '../model/geom/dimension';
import { closestOnEdge, intersectEdges, onEdgeArc, perpendicularFoot, segSeg, tangentPoints, type Edge } from '../model/geom/intersect';
import { entityEdges } from '../model/ops/edges';

export type SnapKind = 'endpoint' | 'midpoint' | 'center' | 'node' | 'quadrant' | 'intersection' | 'perpendicular' | 'tangent' | 'nearest';

export interface SnapHit {
  kind: SnapKind;
  point: Vec2;
  entityId: number;
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  endpoint: 'Uç nokta',
  midpoint: 'Orta nokta',
  center: 'Merkez',
  node: 'Nokta',
  quadrant: 'Çeyrek',
  intersection: 'Kesişim',
  perpendicular: 'Dik',
  tangent: 'Teğet',
  nearest: 'En yakın',
};

/**
 * Distance multipliers when several snaps compete: at equal distance the
 * more meaningful point wins. "En yakın" only applies when nothing else does.
 */
const SNAP_WEIGHT: Record<SnapKind, number> = {
  endpoint: 1,
  node: 1,
  intersection: 1.02,
  center: 1.08,
  quadrant: 1.1,
  midpoint: 1.15,
  perpendicular: 1.25,
  tangent: 1.2,
  nearest: Infinity,
};

/**
 * CPU-side spatial queries. A flat bounds cache is enough for tens of
 * thousands of entities; swap for an R-tree behind the same API later.
 */
export class PickIndex {
  private bounds = new Map<number, Bounds>();
  private readonly doc: CadDocument;

  constructor(doc: CadDocument) {
    this.doc = doc;
    doc.events.on('changed', () => this.bounds.clear());
  }

  boundsOf(e: Entity): Bounds {
    let b = this.bounds.get(e.id);
    if (!b) this.bounds.set(e.id, (b = entityBounds(e)));
    return b;
  }

  /** Visible entities whose bounds come within `tol` of `p`. */
  *near(p: Vec2, tol: number): Generator<Entity> {
    const layers = this.doc.layers;
    for (const e of this.doc.all()) {
      if (!layers.isVisible(e.layerId)) continue;
      // Infinite lines have no useful bounds; their distance test decides.
      if (e.kind === 'xline' || e.kind === 'ray') {
        yield e;
        continue;
      }
      const b = this.boundsOf(e);
      if (p.x < b.minX - tol || p.x > b.maxX + tol || p.y < b.minY - tol || p.y > b.maxY + tol) continue;
      yield e;
    }
  }

  /** Visible entities whose bounds overlap `r`. */
  *overlapping(r: Bounds, exceptId?: number): Generator<Entity> {
    const layers = this.doc.layers;
    for (const e of this.doc.all()) {
      if (e.id === exceptId || !layers.isVisible(e.layerId)) continue;
      if (e.kind === 'xline' || e.kind === 'ray') {
        yield e;
        continue;
      }
      const b = this.boundsOf(e);
      if (b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY) continue;
      yield e;
    }
  }

  /**
   * Picks the most specific entity: points and edges first, then the
   * smallest polygon containing the cursor (building before parcel before
   * block). Layers with `pickInterior: false` are edge-pick only.
   */
  hit(p: Vec2, tol: number, filter?: (e: Entity) => boolean): Entity | null {
    const layers = this.doc.layers;
    let edge: { e: Entity; d: number } | null = null;
    let area: { e: Entity; a: number } | null = null;
    for (const e of this.near(p, tol * 1.5)) {
      if (filter && !filter(e)) continue;
      const d = edgeDistance(e, p);
      const t = e.kind === 'point' || e.kind === 'text' ? tol * 1.5 : tol;
      if (d <= t && (!edge || d < edge.d)) edge = { e, d };
      if (layers.get(e.layerId)?.style.pickInterior === false) continue;
      if (e.kind === 'hatch' && pointInPolygon(p, e.ring)) {
        // Slightly smaller than its boundary so the hatch wins over the parcel it fills.
        const a = Math.abs(signedArea(e.ring)) * 0.999;
        if (!area || a < area.a) area = { e, a };
      } else if (e.kind === 'polygon' && pointInPolygon(p, polygonRing(e))) {
        const a = Math.abs(signedArea(polygonRing(e)));
        if (!area || a < area.a) area = { e, a };
      } else if (e.kind === 'circle' && Math.hypot(p.x - e.c.x, p.y - e.c.y) < e.r) {
        const a = Math.PI * e.r * e.r;
        if (!area || a < area.a) area = { e, a };
      } else if (e.kind === 'ellipse' && isFullEllipse(e) && insideEllipse(e, p)) {
        const a = ellipseArea(e);
        if (!area || a < area.a) area = { e, a };
      }
    }
    return edge?.e ?? area?.e ?? null;
  }

  /** Edge-only pick (targets for trim, extend, offset and fillet). */
  hitEdge(p: Vec2, tol: number, filter?: (e: Entity) => boolean): Entity | null {
    let best: { e: Entity; d: number } | null = null;
    for (const e of this.near(p, tol)) {
      if (e.kind === 'point' || e.kind === 'text' || (filter && !filter(e))) continue;
      const d = edgeDistance(e, p);
      if (d <= tol && (!best || d < best.d)) best = { e, d };
    }
    return best?.e ?? null;
  }

  /**
   * Smallest visible closed shape (polygon, circle, closed spline) containing
   * `p`, as a ring — the boundary a hatch fills.
   */
  enclosing(p: Vec2): { entity: Entity; ring: Vec2[] } | null {
    let best: { entity: Entity; ring: Vec2[]; a: number } | null = null;
    for (const e of this.near(p, 0)) {
      let ring: Vec2[] | null = null;
      if (e.kind === 'polygon') ring = polygonRing(e);
      else if (e.kind === 'circle') ring = entityOutline(e, 96);
      else if (e.kind === 'ellipse' && isFullEllipse(e)) ring = tessellateEllipse(e, 256);
      else if (e.kind === 'spline' && e.closed) ring = entityOutline(e).slice(0, -1);
      if (!ring || !pointInPolygon(p, ring)) continue;
      const a = Math.abs(signedArea(ring));
      if (!best || a < best.a) best = { entity: e, ring, a };
    }
    return best ? { entity: best.entity, ring: best.ring } : null;
  }

  /** Edges of every visible entity overlapping `r` — boundaries for trim/extend. */
  edgesIn(r: Bounds, exceptId?: number): Edge[] {
    const out: Edge[] = [];
    for (const e of this.overlapping(r, exceptId)) for (const ed of entityEdges(e)) out.push(ed);
    return out;
  }

  snap(p: Vec2, tol: number, kinds: ReadonlySet<SnapKind>, from: Vec2 | null = null): SnapHit | null {
    let best: (SnapHit & { w: number }) | null = null;
    let nearest: (SnapHit & { d: number }) | null = null;
    const consider = (kind: SnapKind, q: Vec2, id: number) => {
      if (!kinds.has(kind)) return;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > tol) return;
      if (kind === 'nearest') {
        if (!nearest || d < nearest.d) nearest = { kind, point: q, entityId: id, d };
        return;
      }
      const w = d * SNAP_WEIGHT[kind];
      if (!best || w < best.w) best = { kind, point: q, entityId: id, w };
    };

    const nearby: { id: number; ed: Edge; ell?: EllipseGeom }[] = [];
    for (const e of this.near(p, tol)) {
      switch (e.kind) {
        case 'ellipse': {
          consider('center', e.c, e.id);
          for (const t of quadrantParams(e)) consider('quadrant', ellipsePoint(e, t), e.id);
          if (!isFullEllipse(e)) {
            consider('endpoint', ellipsePoint(e, e.t0), e.id);
            consider('endpoint', ellipsePoint(e, e.t1), e.id);
          }
          // Exact on the curve (its chords only serve crossings).
          consider('nearest', ellipsePoint(e, closestParam(e, p)), e.id);
          if (from) {
            consider('perpendicular', ellipsePoint(e, closestParam(e, from)), e.id);
            for (const t of ellipseTangentPoints(e, from)) consider('tangent', t, e.id);
          }
          for (const ed of entityEdges(e)) if (closestOnEdge(ed, p).d <= tol) nearby.push({ id: e.id, ed, ell: e });
          continue;
        }
        case 'point':
        case 'text':
          consider('node', e.p, e.id);
          continue;
        case 'circle':
          consider('center', e.c, e.id);
          for (const q of entityVertices(e).slice(1)) consider('quadrant', q, e.id);
          break;
        case 'arc':
          consider('center', e.c, e.id);
          consider('endpoint', arcStart(e), e.id);
          consider('endpoint', arcEnd(e), e.id);
          consider('midpoint', arcMid(e), e.id);
          break;
        case 'spline':
          e.pts.forEach((q, i) => consider(!e.closed && (i === 0 || i === e.pts.length - 1) ? 'endpoint' : 'node', q, e.id));
          break;
        case 'dimension': {
          consider('node', e.a, e.id);
          consider('node', e.b, e.id);
          const l = layoutDimension(e);
          if (l) {
            consider('endpoint', l.d1, e.id);
            consider('endpoint', l.d2, e.id);
          }
          break;
        }
        case 'hatch':
          continue; // its boundary is snapped through the outline entity itself
        default: {
          const pts = entityVertices(e);
          const bulges = e.kind === 'polyline' || e.kind === 'polygon' ? e.bulges : undefined;
          pts.forEach((q) => consider('endpoint', q, e.id));
          const n = e.kind === 'polygon' ? pts.length : pts.length - 1;
          for (let i = 0; i < n; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % pts.length];
            const bulge = bulgeAt(bulges, i);
            consider('midpoint', segmentMid(a, b, bulge), e.id);
            const arc = bulgeArc(a, b, bulge);
            if (arc) consider('center', arc.c, e.id);
          }
        }
      }
      for (const ed of entityEdges(e)) {
        const c = closestOnEdge(ed, p);
        if (c.d > tol) continue;
        nearby.push({ id: e.id, ed });
        consider('nearest', c.p, e.id);
        if (from) {
          const foot = perpendicularFoot(ed, from);
          if (foot) consider('perpendicular', foot, e.id);
          if (ed.kind === 'arc')
            for (const t of tangentPoints(from, ed.c, ed.r))
              if (onEdgeArc(ed, Math.atan2(t.y - ed.c.y, t.x - ed.c.x))) consider('tangent', t, e.id);
        }
      }
    }

    if (kinds.has('intersection')) {
      // Pairwise over edges near the cursor only — typically a handful.
      for (let i = 0; i < nearby.length; i++)
        for (let j = i + 1; j < nearby.length; j++) {
          if (nearby[i].id === nearby[j].id && sharesVertex(nearby[i].ed, nearby[j].ed)) continue;
          for (const h of intersectEdges(nearby[i].ed, nearby[j].ed)) consider('intersection', refineCrossing(h.p, nearby[i], nearby[j]), nearby[i].id);
        }
    }
    return best ?? nearest;
  }

  /** Window (fully inside) or crossing (touching) selection. */
  inRect(r: Bounds, crossing: boolean): number[] {
    const out: number[] = [];
    const layers = this.doc.layers;
    for (const e of this.doc.all()) {
      if (!layers.isVisible(e.layerId)) continue;
      const b = this.boundsOf(e);
      // Infinite lines are never "inside" a window (as in AutoCAD); a crossing box catches them.
      const infinite = e.kind === 'xline' || e.kind === 'ray';
      const inside = !infinite && b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY;
      if (inside) {
        out.push(e.id);
        continue;
      }
      if (!crossing) continue;
      const overlaps = infinite || (b.minX <= r.maxX && b.maxX >= r.minX && b.minY <= r.maxY && b.maxY >= r.minY);
      if (overlaps && touchesRect(e, r)) out.push(e.id);
    }
    return out;
  }
}

/**
 * A crossing found on an ellipse's chords, moved onto the true curves:
 * exactly for a straight partner, by alternating projection otherwise.
 */
function refineCrossing(p: Vec2, a: { ed: Edge; ell?: EllipseGeom }, b: { ed: Edge; ell?: EllipseGeom }): Vec2 {
  if (!a.ell && !b.ell) return p;
  const [e, other] = a.ell ? [a, b] : [b, a];
  const ell = e.ell!;
  if (!other.ell && other.ed.kind === 'seg') {
    const s = other.ed;
    let best: { q: Vec2; d: number } | null = null;
    for (const h of lineEllipse(ell, s.a, s.b)) {
      if (h.u < -1e-9 || h.u > 1 + 1e-9) continue;
      // Taken on the straight partner, so a horizontal line keeps its exact Y.
      const q = { x: s.a.x + (s.b.x - s.a.x) * h.u, y: s.a.y + (s.b.y - s.a.y) * h.u };
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (!best || d < best.d) best = { q, d };
    }
    return best?.q ?? p;
  }
  let q = p;
  for (let k = 0; k < 40; k++) {
    q = ellipsePoint(ell, closestParam(ell, q));
    q = other.ell ? ellipsePoint(other.ell, closestParam(other.ell, q)) : closestOnEdge(other.ed, q).p;
  }
  return q;
}

function sharesVertex(a: Edge, b: Edge): boolean {
  if (a.kind !== 'seg' || b.kind !== 'seg') return false;
  const eq = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  return eq(a.a, b.a) || eq(a.a, b.b) || eq(a.b, b.a) || eq(a.b, b.b);
}

function edgeDistance(e: Entity, p: Vec2): number {
  if (e.kind === 'point') return Math.hypot(p.x - e.p.x, p.y - e.p.y);
  if (e.kind === 'text') {
    // Anywhere on the text body counts as a hit.
    const box = textBox(e);
    if (pointInPolygon(p, box)) return 0;
    let d = Math.hypot(p.x - e.p.x, p.y - e.p.y);
    for (let i = 0; i < 4; i++) d = Math.min(d, closestOnEdge({ kind: 'seg', a: box[i], b: box[(i + 1) % 4] }, p).d);
    return d;
  }
  let d = Infinity;
  if (e.kind === 'dimension') {
    // The value text is part of the dimension: clicking it selects the dimension.
    const l = layoutDimension(e);
    if (l) d = Math.max(0, Math.hypot(p.x - l.textAt.x, p.y - l.textAt.y) - e.height);
  }
  for (const ed of entityEdges(e)) d = Math.min(d, closestOnEdge(ed, p).d);
  return d;
}

function touchesRect(e: Entity, r: Bounds): boolean {
  const pts = entityOutline(e, 32);
  const inR = (q: Vec2) => q.x >= r.minX && q.x <= r.maxX && q.y >= r.minY && q.y <= r.maxY;
  if (pts.some(inR)) return true;
  const ring = e.kind === 'polygon' ? polygonRing(e) : e.kind === 'hatch' ? e.ring : null;
  if (ring && pointInPolygon({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }, ring)) return true;
  const rect: Vec2[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  const closed = isClosedOutline(e);
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) if (segSeg(pts[i], pts[(i + 1) % pts.length], rect[j], rect[(j + 1) % 4])) return true;
  return false;
}
