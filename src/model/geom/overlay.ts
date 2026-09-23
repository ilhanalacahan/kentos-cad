import type { Vec2 } from '../geometry';
import { bulgeOfSweep, bulgeRingArea } from './bulge';
import { pointAt, type Edge } from './intersect';
import { normAngle, TAU } from './arc';
import { build, classify, edgeBox, edgeLen, leaveAngle, TOL, translateEdge, winding, type Area, type Box, type DirPiece, type Ring, type Source, type Vertices } from './arrangement';

/**
 * Planar overlay of straight and circular edges — the engine behind area
 * booleans, splitting and "click inside to make an area". The arrangement
 * (arrangement.ts) cuts and classifies the pieces; this file chains the
 * kept pieces into rings, always turning so the result stays on the left,
 * splits rings touching at a point and sorts holes into their outer rings.
 *
 * Arcs stay arcs throughout, and an input vertex keeps its exact input
 * coordinates, so a boolean never moves a surveyed corner.
 */

export type { Area, Ring, Source };
export { winding };

// ── Rings ─────────────────────────────────────────────────────────────

/**
 * Step 4: chains directed pieces into closed walks. Arriving at a vertex,
 * the walk leaves by the first piece clockwise from the way it came, which
 * keeps the region on its left and never crosses itself. Around every
 * vertex kept pieces alternate in and out, so this "next" rule is a
 * permutation and each walk returns to its start.
 */
function trace(dps: readonly DirPiece[]): DirPiece[][] {
  const outgoing = new Map<number, number[]>();
  dps.forEach((d, i) => {
    const list = outgoing.get(d.from);
    if (list) list.push(i);
    else outgoing.set(d.from, [i]);
  });
  const leave = dps.map((d) => leaveAngle(d.edge, false));
  const back = dps.map((d) => leaveAngle(d.edge, true));
  const next = (cur: number): number => {
    let best = -1;
    let bestAngle = Infinity;
    for (const o of outgoing.get(dps[cur].to) ?? []) {
      let cw = normAngle(back[cur] - leave[o]);
      // Straight back along the same piece is the last resort (a dead end).
      if (cw < 1e-12) cw = TAU;
      if (cw < bestAngle) {
        bestAngle = cw;
        best = o;
      }
    }
    return best;
  };
  const used = new Uint8Array(dps.length);
  const cycles: DirPiece[][] = [];
  for (let s = 0; s < dps.length; s++) {
    if (used[s]) continue;
    const cycle: DirPiece[] = [];
    for (let cur = s; cur >= 0 && !used[cur]; cur = next(cur)) {
      used[cur] = 1;
      cycle.push(dps[cur]);
    }
    cycles.push(cycle);
  }
  return cycles;
}

/** Drops back-and-forth runs (dangling cut lines, isolated line work). */
function removeSpikes(cycle: DirPiece[]): DirPiece[] {
  const st: DirPiece[] = [];
  const twin = (a: DirPiece, b: DirPiece) => a.piece === b.piece && a.fwd !== b.fwd;
  for (const d of cycle) {
    if (st.length && twin(st[st.length - 1], d)) st.pop();
    else st.push(d);
  }
  while (st.length >= 2 && twin(st[0], st[st.length - 1])) {
    st.shift();
    st.pop();
  }
  return st;
}

/** Splits a walk that passes a vertex twice into simple rings. */
function splitAtRepeats(cycle: DirPiece[]): DirPiece[][] {
  const seen = new Map<number, number>();
  for (let i = 0; i < cycle.length; i++) {
    const v = cycle[i].from;
    const j = seen.get(v);
    if (j !== undefined) {
      const loop = cycle.slice(j, i);
      const rest = [...cycle.slice(0, j), ...cycle.slice(i)];
      return [...splitAtRepeats(loop), ...splitAtRepeats(rest)];
    }
    seen.set(v, i);
  }
  return [cycle];
}

/** Joins pieces split at a point that was not an input vertex and does not turn. */
function mergeStraight(cycle: DirPiece[], verts: Vertices): { edges: Edge[]; from: number[] } {
  const edges = cycle.map((d) => d.edge);
  const from = cycle.map((d) => d.from);
  for (let i = 0; i < edges.length && edges.length > 2; ) {
    const j = (i + 1) % edges.length;
    const m = verts.input[from[j]] ? null : joinable(edges[i], edges[j]);
    if (!m) {
      i++;
      continue;
    }
    edges[i] = m;
    edges.splice(j, 1);
    from.splice(j, 1);
    if (j < i) i--;
  }
  return { edges, from };
}

function joinable(a: Edge, b: Edge): Edge | null {
  if (a.kind === 'seg' && b.kind === 'seg') {
    const ux = a.b.x - a.a.x;
    const uy = a.b.y - a.a.y;
    const vx = b.b.x - b.a.x;
    const vy = b.b.y - b.a.y;
    const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    return Math.abs(ux * vy - uy * vx) <= 1e-12 * l && ux * vx + uy * vy > 0 ? { kind: 'seg', a: a.a, b: b.b } : null;
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    const same = Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) <= TOL && Math.abs(a.r - b.r) <= TOL && Math.sign(a.sweep) === Math.sign(b.sweep);
    return same && Math.abs(a.sweep + b.sweep) < TAU - 1e-6 ? { kind: 'arc', c: a.c, r: a.r, a0: a.a0, sweep: a.sweep + b.sweep } : null;
  }
  return null;
}

/** A finished ring in local coordinates plus a point just inside its left side. */
interface LocalRing {
  ring: Ring;
  edges: Edge[];
  area: number;
  probe: Vec2;
}

function toRing(edges: Edge[], cycleFrom: number[], verts: Vertices, origin: Vec2): LocalRing {
  const pts: Vec2[] = [];
  const bulges: number[] = [];
  const local: Vec2[] = [];
  edges.forEach((e, i) => {
    const v = cycleFrom[i];
    const input = verts.input[v];
    const p = verts.pos[v];
    local.push(p);
    pts.push(input ? { x: input.x, y: input.y } : { x: p.x + origin.x, y: p.y + origin.y });
    bulges.push(e.kind === 'arc' ? bulgeOfSweep(e.sweep) : 0);
  });
  const ring: Ring = bulges.some((b) => b !== 0) ? { pts, bulges } : { pts };
  const area = bulgeRingArea(local, bulges);
  // Probe: a hair to the left of the longest edge's middle.
  let best = 0;
  edges.forEach((e, i) => {
    if (edgeLen(e) > edgeLen(edges[best])) best = i;
  });
  const e = edges[best];
  const m = pointAt(e, 0.5);
  const q = pointAt(e, 0.5 + 1e-6);
  const l = Math.hypot(q.x - m.x, q.y - m.y) || 1;
  const eps = Math.min(edgeLen(e) * 1e-4, 1e-4);
  return { ring, edges, area, probe: { x: m.x - ((q.y - m.y) / l) * eps, y: m.y + ((q.x - m.x) / l) * eps } };
}

/** Walks → simple local rings. */
function rings(dps: DirPiece[], verts: Vertices, origin: Vec2): LocalRing[] {
  const out: LocalRing[] = [];
  for (const walk of trace(dps)) {
    for (const cycle of splitAtRepeats(removeSpikes(walk))) {
      if (cycle.length < 2) continue;
      const { edges, from } = mergeStraight(cycle, verts);
      if (edges.length < 2) continue;
      const r = toRing(edges, from, verts, origin);
      const perimeter = edges.reduce((s, e) => s + edgeLen(e), 0);
      // Slivers thinner than the tolerance are numerical dust.
      if (Math.abs(r.area) <= perimeter * TOL) continue;
      out.push(r);
    }
  }
  return out;
}

/** Holes go to the smallest outer ring around them. */
function assemble(local: LocalRing[]): Area[] {
  const outers = local.filter((r) => r.area > 0).sort((a, b) => a.area - b.area);
  const parts = outers.map((o) => ({ outer: o, holes: [] as Ring[] }));
  for (const h of local.filter((r) => r.area < 0)) {
    const host = parts.find((p) => winding(p.outer.edges, h.probe) !== 0);
    host?.holes.push(h.ring);
  }
  return parts.map((p) => ({ outer: p.outer.ring, holes: p.holes }));
}

// ── Entry points ──────────────────────────────────────────────────────

function originOf(sources: readonly Source[]): Vec2 {
  for (const s of sources) for (const e of s.edges) return pointAt(e, 0);
  return { x: 0, y: 0 };
}

/** Moves everything near the origin: intersections are computed on small numbers. */
function localize(sources: readonly Source[], o: Vec2): Source[] {
  return sources.map((s) => ({ ...s, edges: s.edges.map((e) => translateEdge(e, -o.x, -o.y)) }));
}

/** Runs the overlay and returns the areas where `rule` holds. */
export function overlay(sources: readonly Source[], rule: (inside: boolean[]) => boolean): Area[] {
  const o = originOf(sources);
  const local = localize(sources, o);
  const built = build(local, sources, o);
  return assemble(rings(classify(local, built, rule), built.verts, o));
}

/** A closed walk of the line work: a bounded face (area > 0) or the outline of a connected group (< 0). */
export interface FaceRing {
  ring: Ring;
  area: number;
  /** Winding test in true coordinates. */
  contains: (p: Vec2) => boolean;
  /** A point just off the ring on its left (inside a face, outside a group). */
  probe: Vec2;
  /** Bounding box in true coordinates (quick reject before `contains`). */
  box: Box;
}

/** Every closed walk formed by the line work. */
export function faceRings(sources: readonly Source[]): FaceRing[] {
  const cuts = sources.map((s) => ({ ...s, cut: true }));
  const o = originOf(cuts);
  const local = localize(cuts, o);
  const built = build(local, cuts, o);
  return rings(classify(local, built, () => true), built.verts, o).map((r) => ({
    ring: r.ring,
    area: r.area,
    contains: (p: Vec2) => winding(r.edges, { x: p.x - o.x, y: p.y - o.y }) !== 0,
    probe: { x: r.probe.x + o.x, y: r.probe.y + o.y },
    box: r.edges.map(edgeBox).reduce(
      (b, e) => ({ minX: Math.min(b.minX, e.minX + o.x), minY: Math.min(b.minY, e.minY + o.y), maxX: Math.max(b.maxX, e.maxX + o.x), maxY: Math.max(b.maxY, e.maxY + o.y) }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    ),
  }));
}
