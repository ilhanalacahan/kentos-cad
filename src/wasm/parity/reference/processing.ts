import type { CadDocument } from '../../../model/document';
import { entityBounds, type Entity, type NewEntity } from '../../../model/entities';
import { toText, truthy } from '../../../model/expression/expressionLib';
import { signedArea, type Bounds, type Vec2 } from '../../../model/geometry';
import { edgeLabels } from '../../../model/ops/edgeLabels';
import { formatNumber, parseNumber, type Direction, type NumberedCorner, type NumberingInput, type NumberingOptions, type StartCorner } from '../../../processing/builtin/numbering';
import type { CompiledExpression } from '../../../model/expression/expression';
import type { DefaultsContext, FeatureSet, RunResult, TargetLayer } from '../../../processing/types';

/**
 * The processing tools' geometry as the TypeScript computed it before the
 * geometry store (docs/adr/0008, S4): corner numbering (walking order, the
 * grid that merges shared corners, the outward direction), the text beside
 * a numbered corner, edge-length labels with their shared-edge keys, the
 * "visible" scope's box test, and the tools' `run` bodies that used them.
 * Expressions here read their geometry values from the object (no
 * `measured`). The parity test holds the core to them until S3.
 */

// ── Corner numbering (processing/builtin/numbering.ts) ─────────────────

/** How strongly a vertex is "the start": larger wins. */
function startKey(start: StartCorner, point: Vec2 | null): (p: Vec2, i: number) => number {
  switch (start) {
    case 'northwest':
      // Nearest the north-west: highest northing minus easting (ties go north).
      return (p) => p.y - p.x + p.y * 1e-12;
    case 'north':
      return (p) => p.y - p.x * 1e-12;
    case 'point':
      return (p) => (point ? -Math.hypot(p.x - point.x, p.y - point.y) : 0);
    default:
      return (_p, i) => -i;
  }
}

export function tsRingOrder(pts: readonly Vec2[], closed: boolean, dir: Direction, start: StartCorner, point: Vec2 | null = null): number[] {
  const n = pts.length;
  const idx = [...Array(n).keys()];
  // An empty ring has no corners, whichever way it would be walked.
  if (!n) return idx;
  const key = startKey(start, point);
  if (!closed) {
    if (n < 2) return idx;
    return key(pts[n - 1], n - 1) > key(pts[0], 0) && start !== 'first' ? idx.reverse() : idx;
  }
  const ccw = signedArea(pts) > 0;
  const walk = ccw === (dir === 'ccw') ? idx : [idx[0], ...idx.slice(1).reverse()];
  let best = 0;
  for (let k = 1; k < walk.length; k++) if (key(pts[walk[k]], walk[k]) > key(pts[walk[best]], walk[best])) best = k;
  return [...walk.slice(best), ...walk.slice(0, best)];
}

/** Spatial hash of named points, merging within the tolerance. */
class PointIndex {
  private readonly cell: number;
  private readonly grid = new Map<string, { p: Vec2; name: string }[]>();
  constructor(tolerance: number) {
    this.cell = Math.max(tolerance, 1e-9);
  }
  private key(x: number, y: number) {
    return `${x},${y}`;
  }
  find(p: Vec2): string | null {
    const gx = Math.floor(p.x / this.cell);
    const gy = Math.floor(p.y / this.cell);
    // The neighbouring cells by offset: counting from gx − 1 up to gx + 1 never ended beyond 2^53, where gx + 1 is gx.
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const q of this.grid.get(this.key(gx + di, gy + dj)) ?? []) if (Math.hypot(q.p.x - p.x, q.p.y - p.y) <= this.cell) return q.name;
    return null;
  }
  add(p: Vec2, name: string): void {
    const k = this.key(Math.floor(p.x / this.cell), Math.floor(p.y / this.cell));
    const list = this.grid.get(k);
    if (list) list.push({ p, name });
    else this.grid.set(k, [{ p, name }]);
  }
}

/** Outward unit direction at corner i of a ring (bisector of the two edge normals). */
function outward(pts: readonly Vec2[], i: number, closed: boolean): Vec2 {
  const n = pts.length;
  const ccw = closed && signedArea(pts) > 0;
  const normal = (a: Vec2, b: Vec2) => {
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Right of travel is outside a counter-clockwise ring.
    const s = !closed || ccw ? 1 : -1;
    return { x: ((b.y - a.y) / l) * s, y: (-(b.x - a.x) / l) * s };
  };
  const prev = i > 0 ? normal(pts[i - 1], pts[i]) : closed ? normal(pts[n - 1], pts[0]) : null;
  const next = i < n - 1 ? normal(pts[i], pts[i + 1]) : closed ? normal(pts[n - 1], pts[0]) : null;
  const sx = (prev?.x ?? 0) + (next?.x ?? 0);
  const sy = (prev?.y ?? 0) + (next?.y ?? 0);
  const l = Math.hypot(sx, sy);
  return l > 1e-12 ? { x: sx / l, y: sy / l } : { x: 0, y: 1 };
}

export function tsNumberCorners(inputs: readonly NumberingInput[], o: NumberingOptions): NumberedCorner[] {
  const index = new PointIndex(o.tolerance);
  let next = o.first;
  for (const e of o.existing) {
    // A point without a name is not a numbered point: a corner there gets a number of its own.
    if (o.shared && e.name) index.add(e.p, e.name);
    const n = parseNumber(e.name, o.format);
    if (n !== null && n + o.step > next) next = n + o.step;
  }
  const key = startKey(o.start, o.point);
  const ordered = inputs
    .map((input, i) => {
      const r = input.rings[0];
      const order = r ? tsRingOrder(r.pts, r.closed, o.dir, o.start, o.point) : [];
      return { input, i, score: r && order.length ? key(r.pts[order[0]], o.start === 'first' ? i : order[0]) : -Infinity };
    })
    .sort((a, b) => (o.start === 'first' ? a.i - b.i : b.score - a.score));
  const out: NumberedCorner[] = [];
  for (const { input } of ordered)
    for (const ring of input.rings) {
      const order = tsRingOrder(ring.pts, ring.closed, o.dir, o.start, o.point);
      for (const i of order) {
        const p = ring.pts[i];
        const known = o.shared ? index.find(p) : null;
        const name = known ?? formatNumber(next, o.format);
        if (!known) {
          next += o.step;
          index.add(p, name);
        }
        out.push({ p, name, out: outward(ring.pts, i, ring.closed), created: !known });
      }
    }
  return out;
}

/** Where the text beside a numbered corner went: outside the corner, centred on its bisector. */
export function tsCornerTextAt(c: { p: Vec2; out: Vec2 }, chars: number, height: number): Vec2 {
  const w = chars * height * 0.55;
  return { x: c.p.x + c.out.x * height * 1.2 - (c.out.x < 0 ? w : 0), y: c.p.y + c.out.y * height * 1.2 - (c.out.y < 0 ? height : 0) };
}

// ── Edge lengths (processing/builtin/edgeLengths.ts) ───────────────────

export interface TsEdgeLabel {
  id: number;
  p: Vec2;
  rotation: number;
  length: number;
}

/** Every edge's label of lines, polylines and polygons in order; an edge shared by two shapes once when `shared`. */
export function tsEdgeLengthLabels(entities: readonly Entity[], height: number, minLength: number, side: 'outside' | 'inside', shared: boolean): { labels: TsEdgeLabel[]; skipped: number } {
  const seen = new Set<string>();
  // One key per edge, whichever way it runs (1 mm grid: parcels share exact corners).
  const q = (p: Vec2) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const edgeKey = (a: Vec2, b: Vec2, length: number) => {
    const [k1, k2] = [q(a), q(b)].sort();
    return `${k1}|${k2}|${Math.round(length * 1000)}`;
  };
  const labels: TsEdgeLabel[] = [];
  let skipped = 0;
  for (const e of entities) {
    const path = e.kind === 'line' ? { pts: [e.a, e.b], closed: false, bulges: undefined } : e.kind === 'polygon' || e.kind === 'polyline' ? { pts: e.pts, closed: e.kind === 'polygon', bulges: e.bulges } : null;
    if (!path) continue;
    const found = edgeLabels(path.pts, path.closed, height, minLength, path.bulges, side);
    const n = path.pts.length;
    for (const l of found) {
      if (shared) {
        const k = edgeKey(path.pts[l.index], path.pts[(l.index + 1) % n], l.length);
        if (seen.has(k)) {
          skipped++;
          continue;
        }
        seen.add(k);
      }
      labels.push({ id: e.id, p: l.p, rotation: l.rotation, length: l.length });
    }
  }
  return { labels, skipped };
}

// ── The "visible" scope (processing/features.ts) ───────────────────────

const overlaps = (a: Bounds, b: Bounds) => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Objects on visible layers whose box overlaps the view, construction lines left out, in the document's order. */
export function tsVisible(doc: CadDocument, view: Bounds): Entity[] {
  return [...doc.all()].filter((e) => doc.layers.isVisible(e.layerId) && e.kind !== 'xline' && e.kind !== 'ray' && overlaps(entityBounds(e), view));
}

/** The box test alone, on every layer and kind: what the store's `inBox` answers. */
export function tsInBox(entities: Iterable<Entity>, view: Bounds): number[] {
  return [...entities].filter((e) => overlaps(entityBounds(e), view)).map((e) => e.id);
}

/**
 * The corners as the core gives them (`{ p, out, ref }`): the old
 * numbering run with `existing` named "E0", "E1" … so every corner says
 * whose number it took (k-th new one, or existing point j as −1 − j).
 */
export function tsCoreCorners(inputs: readonly NumberingInput[], walk: { dir: Direction; start: StartCorner; point: Vec2 | null; tolerance: number; shared: boolean }, existing: readonly Vec2[]): { p: Vec2; out: Vec2; ref: number }[] {
  const named = existing.map((p, j) => ({ p, name: `E${j}` }));
  const corners = tsNumberCorners(inputs, { ...walk, format: { prefix: 'P', length: 6, pad: '0' }, first: 1, step: 1, existing: named });
  const made: string[] = [];
  return corners.map((c) => {
    if (c.created) made.push(c.name);
    const ref = c.created ? made.length - 1 : c.name.startsWith('E') ? -1 - Number(c.name.slice(1)) : made.indexOf(c.name);
    return { p: c.p, out: c.out, ref };
  });
}

// ── The tools' runs ────────────────────────────────────────────────────

/** What the old runs read of their context. */
export interface TsRunContext {
  doc: { byLayer(layerId: string): readonly Entity[] };
  units: DefaultsContext;
  layerName(id: string): string;
  selection: readonly number[];
}

export interface TsNumberingValues {
  input: FeatureSet;
  direction: Direction;
  start: StartCorner;
  startPoint: Vec2 | null;
  prefix: string;
  length: number;
  pad: string;
  first: number;
  step: number;
  shared: boolean;
  tolerance: number | null;
  output: 'points' | 'text' | 'both';
  textHeight: number | null;
  layer: TargetLayer;
}

/** Köşe noktalarını numarala, as it ran. */
export function tsVertexNumbering(v: TsNumberingValues, ctx: TsRunContext): RunResult {
  const format = { prefix: v.prefix, length: v.length, pad: v.pad };
  const inputs: NumberingInput[] = [];
  for (const e of v.input.entities) {
    if (e.kind === 'polygon') inputs.push({ rings: [{ pts: e.pts, closed: true }, ...(e.holes ?? []).map((h) => ({ pts: h.pts, closed: true }))] });
    else if (e.kind === 'polyline') inputs.push({ rings: [{ pts: e.pts, closed: false }] });
  }
  if (!inputs.length) return { summary: 'Numaralanacak alan yok.' };
  const layer = v.layer;
  const existing = v.shared || !layer.isNew ? ctx.doc.byLayer(layer.id).flatMap((e) => (e.kind === 'point' ? [{ p: e.p, name: e.label ?? e.attrs.Nokta ?? '' }] : [])) : [];
  const corners = tsNumberCorners(inputs, {
    dir: v.direction,
    start: v.start,
    point: v.startPoint ?? null,
    format,
    first: v.first,
    step: v.step,
    tolerance: v.tolerance ?? 0.001,
    shared: v.shared,
    existing,
  });
  const created = corners.filter((c) => c.created);
  const height = ((v.textHeight ?? 2) / 1000) * ctx.units.plotScale;
  const add: NewEntity[] = [];
  for (const c of created) {
    const attrs = { Nokta: c.name, Tür: 'Köşe noktası' };
    if (v.output !== 'text') add.push({ kind: 'point', layerId: layer.id, p: { ...c.p }, label: c.name, attrs });
    if (v.output !== 'points') add.push({ kind: 'text', layerId: layer.id, p: tsCornerTextAt(c, c.name.length, height), text: c.name, height, rotation: 0, attrs });
  }
  const first = created[0]?.name;
  const last = created[created.length - 1]?.name;
  // Reused numbers: from points already on the layer, or from a neighbour numbered in this run.
  const before = new Set(existing.map((e) => e.name));
  const kept = new Set(corners.filter((c) => !c.created && before.has(c.name)).map((c) => c.name)).size;
  const shared = new Set(corners.filter((c) => !c.created && !before.has(c.name)).map((c) => c.name)).size;
  const notes = [shared ? `${shared} ortak köşe komşularıyla tek numara aldı` : '', kept ? `${kept} köşe mevcut numarasını korudu` : ''].filter(Boolean);
  return {
    changes: { add },
    outputs: { count: created.length },
    summary: created.length
      ? `${inputs.length} nesnede ${created.length} köşe numaralandı: ${first} – ${last}${notes.length ? `; ${notes.join('; ')}` : ''}.`
      : 'Yeni numara gerekmedi: bütün köşelerin numarası zaten var.',
  };
}

export interface TsEdgeLengthValues {
  input: FeatureSet;
  decimals: number;
  side: 'outside' | 'inside';
  textHeight: number;
  prefix: string;
  suffix: string;
  minLength: number;
  shared: boolean;
  layer: TargetLayer;
}

/** Kenar uzunluklarını yaz, as it ran. */
export function tsEdgeLengths(v: TsEdgeLengthValues, ctx: TsRunContext): RunResult {
  const height = (v.textHeight / 1000) * ctx.units.plotScale;
  const { labels, skipped } = tsEdgeLengthLabels(v.input.entities, height, v.minLength, v.side, v.shared);
  const add: NewEntity[] = labels.map((l) => ({
    kind: 'text',
    layerId: v.layer.id,
    p: l.p,
    text: `${v.prefix}${l.length.toFixed(v.decimals)}${v.suffix}`,
    height,
    rotation: l.rotation,
    attrs: { Tür: 'Kenar ölçüsü', 'Uzunluk (m)': l.length.toFixed(3) },
  }));
  return {
    changes: { add },
    outputs: { count: add.length },
    summary: `${v.input.entities.length} nesneye ${add.length} kenar uzunluğu yazıldı${skipped ? `; ${skipped} ortak kenar bir kez yazıldı` : ''}.`,
  };
}

/** Öznitelik hesapla, as it ran (geometry values from the object). */
export function tsCalculateField(v: { input: FeatureSet; field: string; value: CompiledExpression; where: CompiledExpression | null; empty: 'keep' | 'clear'; label: boolean }, ctx: TsRunContext): RunResult {
  const field = v.field;
  const update: { id: number; patch: Partial<Entity> }[] = [];
  let same = 0;
  let empty = 0;
  let filtered = 0;
  const list = v.input.entities;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    const scope = { entity: e, index: i + 1, layerName: ctx.layerName };
    if (v.where && !truthy(v.where.evaluate(scope))) {
      filtered++;
      continue;
    }
    const value = v.value.evaluate(scope);
    if (value === null && v.empty === 'keep') {
      empty++;
      continue;
    }
    const text = toText(value);
    const old = e.attrs[field];
    if (old === text) {
      same++;
      continue;
    }
    const patch: Partial<Entity> = { attrs: { ...e.attrs, [field]: text } };
    if (v.label && old !== undefined && e.label === old) patch.label = text;
    update.push({ id: e.id, patch });
  }
  const notes = [same ? `${same} nesnede değer zaten aynıydı` : '', empty ? `${empty} nesnede sonuç boş olduğu için dokunulmadı` : '', filtered ? `${filtered} nesne koşulu sağlamadı` : ''].filter(Boolean);
  return {
    changes: { update },
    outputs: { changed: update.map((u) => u.id), count: update.length },
    summary: `${update.length} nesnede “${field}” yazıldı${notes.length ? `; ${notes.join('; ')}` : ''}.`,
  };
}

/** İfadeyle seç, as it ran (geometry values from the object). */
export function tsSelectByExpression(v: { input: FeatureSet; condition: CompiledExpression; mode: 'new' | 'add' | 'remove' | 'within' }, ctx: TsRunContext): RunResult {
  const list = v.input.entities;
  const hits: number[] = [];
  for (let i = 0; i < list.length; i++) if (truthy(v.condition.evaluate({ entity: list[i], index: i + 1, layerName: ctx.layerName }))) hits.push(list[i].id);
  const current = ctx.selection;
  const hit = new Set(hits);
  const select = v.mode === 'new' ? hits : v.mode === 'add' ? [...current, ...hits] : v.mode === 'remove' ? current.filter((id) => !hit.has(id)) : current.filter((id) => hit.has(id));
  return {
    select,
    outputs: { matched: hits, count: hits.length },
    summary: `${hits.length} / ${list.length} nesne koşulu sağladı; seçimde ${new Set(select).size} nesne var.`,
  };
}
