import type { Vec2 } from '../geometry';
import { TAU } from './arc';
import { closestOnEdge, intersectEdges, pointAt, type Edge } from './intersect';

/**
 * Planar arrangement of straight and circular edges: steps 1–3 of the
 * overlay (see overlay.ts).
 *
 *   1. Every edge is cut where it meets another (crossings, touches,
 *      overlaps), giving pieces that only meet at their ends.
 *   2. Pieces lying on top of each other (shared parcel boundaries) are
 *      merged into one, remembering which source ran along it and in which
 *      direction.
 *   3. A rule decides, from the winding numbers of the area sources on
 *      either side, whether a piece bounds the result.
 */

/** Closed boundary as vertices with DXF bulges (same form as a polygon entity). */
export interface Ring {
  pts: Vec2[];
  bulges?: number[];
}

/** One area: a counter-clockwise outer ring and clockwise holes. */
export interface Area {
  outer: Ring;
  holes: Ring[];
}

/** Overlay input: an area's oriented boundary (interior on the left) or cut lines. */
export interface Source {
  edges: Edge[];
  /**
   * Exact input vertices. Edge ends near them take these coordinates, so
   * the output repeats input corners bit for bit (arc ends recomputed from
   * a centre would drift in the last digits).
   */
  points?: Vec2[];
  /** Cut lines take no part in inside tests; a cut inside the result splits it. */
  cut?: boolean;
}

/** Points closer than this (metres) are one vertex. */
export const TOL = 1e-6;

// ── Vertices ──────────────────────────────────────────────────────────

/** Vertex clusters on a hash grid; input vertices win as representatives. */
export class Vertices {
  readonly pos: Vec2[] = [];
  /** Exact input coordinates (absolute) for vertices that came from input. */
  readonly input: (Vec2 | null)[] = [];
  private readonly grid = new Map<string, number[]>();

  add(p: Vec2, input: Vec2 | null): number {
    const gx = Math.floor(p.x / (2 * TOL));
    const gy = Math.floor(p.y / (2 * TOL));
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gy - 1; j <= gy + 1; j++)
        for (const id of this.grid.get(`${i},${j}`) ?? []) {
          const q = this.pos[id];
          if (Math.abs(q.x - p.x) <= TOL && Math.abs(q.y - p.y) <= TOL) {
            if (input && !this.input[id]) {
              this.pos[id] = p;
              this.input[id] = input;
            }
            return id;
          }
        }
    const id = this.pos.length;
    this.pos.push(p);
    this.input.push(input);
    const key = `${gx},${gy}`;
    const cell = this.grid.get(key);
    if (cell) cell.push(id);
    else this.grid.set(key, [id]);
    return id;
  }
}

// ── Edge helpers ──────────────────────────────────────────────────────

export const edgeLen = (e: Edge) => (e.kind === 'seg' ? Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) : e.r * Math.abs(e.sweep));

export function subEdge(e: Edge, t0: number, t1: number): Edge {
  if (e.kind === 'seg') return { kind: 'seg', a: pointAt(e, t0), b: pointAt(e, t1) };
  return { kind: 'arc', c: e.c, r: e.r, a0: e.a0 + e.sweep * t0, sweep: e.sweep * (t1 - t0) };
}

export function reverseEdge(e: Edge): Edge {
  return e.kind === 'seg' ? { kind: 'seg', a: e.b, b: e.a } : { kind: 'arc', c: e.c, r: e.r, a0: e.a0 + e.sweep, sweep: -e.sweep };
}

export function translateEdge(e: Edge, dx: number, dy: number): Edge {
  if (e.kind === 'seg') return { kind: 'seg', a: { x: e.a.x + dx, y: e.a.y + dy }, b: { x: e.b.x + dx, y: e.b.y + dy } };
  return { ...e, c: { x: e.c.x + dx, y: e.c.y + dy } };
}

/** Full circles become two halves: a piece must run between two distinct points. */
function splitFullCircles(edges: readonly Edge[]): Edge[] {
  const out: Edge[] = [];
  for (const e of edges) {
    if (e.kind === 'arc' && Math.abs(e.sweep) >= TAU - 1e-9) out.push(subEdge(e, 0, 0.5), subEdge(e, 0.5, 1));
    else out.push(e);
  }
  return out;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function edgeBox(e: Edge): Box {
  if (e.kind === 'seg') return { minX: Math.min(e.a.x, e.b.x), minY: Math.min(e.a.y, e.b.y), maxX: Math.max(e.a.x, e.b.x), maxY: Math.max(e.a.y, e.b.y) };
  return { minX: e.c.x - e.r, minY: e.c.y - e.r, maxX: e.c.x + e.r, maxY: e.c.y + e.r };
}

/** Unit direction leaving `e` at its start (or arriving back along it from its end), bent by curvature. */
export function leaveAngle(e: Edge, atEnd: boolean): number {
  const from = pointAt(e, atEnd ? 1 : 0);
  // A point a little along the edge: the chord carries the curvature, which
  // separates a tangent arc from a straight edge leaving the same way.
  const q = pointAt(e, atEnd ? 1 - 1e-4 : 1e-4);
  return Math.atan2(q.y - from.y, q.x - from.x);
}

/**
 * Winding number of the closed edge set around `p` (angle summation).
 * An arc subtends its chord's angle plus a full turn when `p` lies in the
 * circular segment between chord and arc.
 */
export function winding(edges: readonly Edge[], p: Vec2): number {
  let total = 0;
  for (const e of edges) {
    if (e.kind === 'seg') {
      total += subtended(e.a, e.b, p);
      continue;
    }
    const a = pointAt(e, 0);
    const b = pointAt(e, 1);
    const inDisk = Math.hypot(p.x - e.c.x, p.y - e.c.y) < e.r;
    if (Math.abs(e.sweep) >= TAU - 1e-12) {
      if (inDisk) total += Math.sign(e.sweep) * TAU;
      continue;
    }
    total += subtended(a, b, p);
    if (!inDisk) continue;
    // A counter-clockwise arc bulges to the right of its chord a→b.
    const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (e.sweep > 0 ? side < 0 : side > 0) total += Math.sign(e.sweep) * TAU;
  }
  return Math.round(total / TAU);
}

function subtended(a: Vec2, b: Vec2, p: Vec2): number {
  const ax = a.x - p.x;
  const ay = a.y - p.y;
  const bx = b.x - p.x;
  const by = b.y - p.y;
  return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

// ── Pieces ────────────────────────────────────────────────────────────

/** A maximal piece of the overlay: edges of several sources may run along it. */
interface Piece {
  edge: Edge;
  from: number;
  to: number;
  /** Net count of area-source edges running along the piece (+1 same direction, −1 opposite). */
  delta: Map<number, number>;
  cut: boolean;
}

/** A piece used in one direction by the result. */
export interface DirPiece {
  piece: number;
  fwd: boolean;
  from: number;
  to: number;
  edge: Edge;
}

export interface Built {
  verts: Vertices;
  pieces: Piece[];
}

/**
 * Steps 1 and 2: cut edges at every meeting point and merge coincident
 * pieces. `local` is the input moved near the origin, `abs` the same input
 * in true coordinates (for the exact vertices).
 */
export function build(local: readonly Source[], abs: readonly Source[], o: Vec2): Built {
  const verts = new Vertices();
  for (const s of abs) for (const p of s.points ?? []) verts.add({ x: p.x - o.x, y: p.y - o.y }, p);
  const edges: { e: Edge; src: number; box: Box }[] = [];
  local.forEach((s, src) => {
    const absEdges = splitFullCircles(abs[src].edges);
    splitFullCircles(s.edges).forEach((e, k) => {
      if (edgeLen(e) <= TOL) return;
      edges.push({ e, src, box: edgeBox(e) });
      // Edge ends are input corners too (a line's end is a real point).
      verts.add(pointAt(e, 0), pointAt(absEdges[k], 0));
      verts.add(pointAt(e, 1), pointAt(absEdges[k], 1));
    });
  });
  const cuts: number[][] = edges.map(() => []);
  const addCut = (i: number, t: number) => {
    const { e } = edges[i];
    const len = edgeLen(e);
    // Meeting points at an end are just shared vertices, not cuts.
    if (t * len > TOL && (1 - t) * len > TOL) cuts[i].push(t);
  };
  // Sweep over x so only edges with overlapping boxes are tested.
  const order = edges.map((_, i) => i).sort((i, j) => edges[i].box.minX - edges[j].box.minX);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const bi = edges[i].box;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      const bj = edges[j].box;
      if (bj.minX > bi.maxX + TOL) break;
      if (bj.minY > bi.maxY + TOL || bj.maxY < bi.minY - TOL) continue;
      const ei = edges[i].e;
      const ej = edges[j].e;
      for (const h of intersectEdges(ei, ej)) {
        addCut(i, h.t);
        addCut(j, h.u);
      }
      // Touching ends and overlaps (parallel lines, same circle) meet at an end point.
      for (const [x, other] of [
        [i, ej],
        [j, ei],
      ] as const) {
        for (const q of [pointAt(other, 0), pointAt(other, 1)]) {
          const c = closestOnEdge(edges[x].e, q);
          if (c.d <= TOL) addCut(x, c.t);
        }
      }
    }
  }

  const pieces: Piece[] = [];
  const index = new Map<string, number[]>();
  edges.forEach(({ e, src }, i) => {
    const ts = [0, ...cuts[i].sort((a, b) => a - b), 1];
    let last = 0;
    for (let k = 1; k < ts.length; k++) {
      const t = ts[k];
      if (k < ts.length - 1 && (t - last) * edgeLen(e) <= TOL) continue;
      const sub = subEdge(e, last, t);
      last = t;
      const from = verts.add(pointAt(sub, 0), null);
      const to = verts.add(pointAt(sub, 1), null);
      if (from === to) continue;
      const mid = pointAt(sub, 0.5);
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const same = index.get(key)?.find((pi) => {
        const m = pointAt(pieces[pi].edge, 0.5);
        return Math.hypot(m.x - mid.x, m.y - mid.y) <= 10 * TOL;
      });
      const cut = !!local[src].cut;
      if (same === undefined) {
        const p: Piece = { edge: sub, from, to, delta: new Map(), cut };
        if (!cut) p.delta.set(src, 1);
        index.set(key, [...(index.get(key) ?? []), pieces.length]);
        pieces.push(p);
      } else {
        const p = pieces[same];
        p.cut ||= cut;
        if (!cut) p.delta.set(src, (p.delta.get(src) ?? 0) + (p.from === from ? 1 : -1));
      }
    }
  });
  return { verts, pieces };
}

/**
 * Step 3: keeps the pieces where the rule differs across them, oriented with
 * the rule's inside on the left. A cut piece with the inside on both sides
 * is kept both ways, so it splits the result.
 */
export function classify(sources: readonly Source[], built: Built, rule: (inside: boolean[]) => boolean): DirPiece[] {
  const { pieces } = built;
  const out: DirPiece[] = [];
  if (sources.every((s) => s.cut)) {
    // Line work only: every piece bounds a face on both sides.
    if (rule(sources.map(() => false))) pieces.forEach((p, i) => out.push(dir(p, i, true), dir(p, i, false)));
    return out;
  }
  pieces.forEach((piece, index) => {
    const e = piece.edge;
    const len = edgeLen(e);
    const m = pointAt(e, 0.5);
    // Left normal at the middle.
    let tx: number;
    let ty: number;
    if (e.kind === 'seg') {
      tx = (e.b.x - e.a.x) / len;
      ty = (e.b.y - e.a.y) / len;
    } else {
      const a = e.a0 + e.sweep / 2;
      const s = Math.sign(e.sweep);
      tx = -Math.sin(a) * s;
      ty = Math.cos(a) * s;
    }
    // Step off the piece by less than the distance to anything else.
    let near = len;
    for (let k = 0; k < pieces.length; k++) {
      if (k === index) continue;
      const b = pieces[k].edge;
      const box = edgeBox(b);
      if (box.minX > m.x + near || box.maxX < m.x - near || box.minY > m.y + near || box.maxY < m.y - near) continue;
      near = Math.min(near, closestOnEdge(b, m).d);
    }
    const eps = Math.max(near * 0.25, 1e-9);
    const q = { x: m.x - ty * eps, y: m.y + tx * eps };
    const left: boolean[] = [];
    const right: boolean[] = [];
    sources.forEach((src, k) => {
      if (src.cut) {
        left.push(false);
        right.push(false);
        return;
      }
      const w = winding(src.edges, q);
      left.push(w !== 0);
      right.push(w - (piece.delta.get(k) ?? 0) !== 0);
    });
    const L = rule(left);
    const R = rule(right);
    if (L && !R) out.push(dir(piece, index, true));
    else if (R && !L) out.push(dir(piece, index, false));
    else if (L && R && piece.cut) out.push(dir(piece, index, true), dir(piece, index, false));
  });
  return out;
}

function dir(p: Piece, index: number, fwd: boolean): DirPiece {
  return fwd ? { piece: index, fwd, from: p.from, to: p.to, edge: p.edge } : { piece: index, fwd, from: p.to, to: p.from, edge: reverseEdge(p.edge) };
}
