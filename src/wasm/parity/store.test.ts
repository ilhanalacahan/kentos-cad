import { describe, expect, it } from 'vitest';
import type { CadDocument } from '../../model/document';
import type { Entity } from '../../model/entities';
import { mirror, rotation, scaling, translation, type Affine } from '../../model/geom/affine';
import { transformEntity } from '../../model/ops/transform';
import { createSampleProject } from '../../model/sampleProject';
import { PickIndex } from '../../viewport/picking';
import { readGrips } from '../../viewport/storeRecords';
import { Gen, sameResult, TOLERANCE, toJson } from './harness';
import { tsGrips, tsLabels } from './reference/overlay';
import { tsExtend, tsGhosts, tsMeasure, tsStretchGhosts, tsTrim } from './reference/tools';
import { TsPickIndex } from './reference/picking';
import { SCENE_LAYER_IDS, SCENE_SCALES, SCENE_TOLERANCES, sceneCursor, sceneDocument, sceneEntity, sceneKinds, sceneRect } from './sets/store-scene';

/**
 * The Rust geometry store against the TypeScript PickIndex it replaced
 * (docs/adr/0008, S1): the same document, the same seeded cursor
 * positions, tolerances, snap kinds and rectangles, and the same answers.
 * Between rounds the document is edited (adds, moves, removals, undo and
 * redo, transactions, another editor's changes, layer visibility and
 * locks, reloads) and the store must keep the document's order.
 * PARITY_CASES raises the number of rounds for a deep run.
 */

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ROUNDS = Number(env.PARITY_CASES ?? 200);

/** Every query at one cursor; returns the first difference. */
function compare(g: Gen, doc: CadDocument, ts: TsPickIndex, rs: PickIndex): string | null {
  const p = sceneCursor(g, doc);
  const tol = g.pick(SCENE_TOLERANCES);
  const same = (what: string, got: unknown, want: unknown) => {
    const r = sameResult(toJson(got), toJson(want), TOLERANCE, what);
    return r ? `${r}\n    imleç ${JSON.stringify(p)}, tol ${tol}` : null;
  };
  const unlocked = (e: Entity) => !doc.layers.isLocked(e.layerId);
  const kinds = sceneKinds(g);
  const from = g.chance(0.5) ? sceneCursor(g, doc) : null;
  const tsSnap = ts.snap(p, tol, kinds, from);
  const r = sceneRect(g, p);
  const ids = [...doc.all()].map((e) => e.id);
  const except = ids.length && g.chance(0.5) ? g.pick(ids) : undefined;
  const enc = (x: { entity: Entity; ring: unknown } | null) => x && { id: x.entity.id, ring: x.ring };
  return (
    same('hit', rs.hit(p, tol)?.id ?? null, ts.hit(p, tol)?.id ?? null) ??
    same('hitEdge', rs.hitEdge(p, tol)?.id ?? null, ts.hitEdge(p, tol)?.id ?? null) ??
    same('hitEdge (kilitsiz)', rs.hitEdge(p, tol, unlocked)?.id ?? null, ts.hitEdge(p, tol, unlocked)?.id ?? null) ??
    same(`snap ${[...kinds].join(',')}${from ? ' from' : ''}`, rs.snap(p, tol, kinds, from), tsSnap && { kind: tsSnap.kind, point: tsSnap.point, entityId: tsSnap.entityId }) ??
    same('inRect (pencere)', rs.inRect(r, false), ts.inRect(r, false)) ??
    same('inRect (kesişim)', rs.inRect(r, true), ts.inRect(r, true)) ??
    same('enclosing', enc(rs.enclosing(p)), enc(ts.enclosing(p))) ??
    same('overlapping', rs.overlapping(r, except).map((e) => e.id), [...ts.overlapping(r, except)].map((e) => e.id)) ??
    same('edgesIn', rs.edgesIn(r, except), ts.edgesIn(r, except))
  );
}

/** What the overlay draws in a random view at a random scale, and the grips of a random selection. */
function compareOverlay(g: Gen, doc: CadDocument, rs: PickIndex): string | null {
  const view = sceneRect(g, sceneCursor(g, doc), [20, 200, 5000]);
  const scale = g.pick(SCENE_SCALES);
  const ids = [...doc.all()].map((e) => e.id);
  const editing = ids.length && g.chance(0.2) ? g.pick(ids) : null;
  const selected = [...ids.filter(() => g.chance(0.05)), ...(g.chance(0.2) ? [999_999] : [])];
  const same = (what: string, got: unknown, want: unknown) => {
    const r = sameResult(toJson(got), toJson(want), TOLERANCE, what);
    return r ? `${r}\n    görünüm ${JSON.stringify(view)}, ölçek ${scale}` : null;
  };
  return same('labels', Array.from(rs.labels(view, scale, editing)), tsLabels(doc, view, scale, editing)) ?? same('grips', rs.grips(selected), readGrips(Float64Array.from(tsGrips(doc, selected))));
}

/** Tool previews and totals: trim and extend (all visible edges or chosen ones), ghosts, stretch ghosts, selection totals. */
function compareTools(g: Gen, doc: CadDocument, ts: TsPickIndex, rs: PickIndex): string | null {
  const all = [...doc.all()];
  if (!all.length) return null;
  const target = g.pick(all);
  const at = g.chance(0.7) && 'pts' in target && target.pts.length ? g.pick(target.pts) : sceneCursor(g, doc);
  const pick = { x: at.x + g.num(-0.5, 0.5), y: at.y + g.num(-0.5, 0.5) };
  const view = sceneRect(g, pick, [20, 200, 5000]);
  const ids = all.map((e) => e.id);
  const chosen = g.chance(0.3) ? new Set(ids.filter(() => g.chance(0.1))) : null;
  const c = sceneCursor(g, doc);
  const affines: Affine[] = Array.from({ length: g.int(1, 3) }, () => g.pick([translation(g.num(-50, 50), g.num(-50, 50)), rotation(g.num(-3, 3), c), scaling(g.num(0.2, 3), c), mirror(c, sceneCursor(g, doc))]));
  const selected = [...ids.filter(() => g.chance(0.05)), ...(g.chance(0.2) ? [999_999] : [])];
  const limit = g.pick([0, 3, 400]);
  const w = sceneRect(g, pick, [5, 50]);
  const dx = g.num(-10, 10);
  const dy = g.num(-10, 10);
  const same = (what: string, got: unknown, want: unknown) => {
    const r = sameResult(toJson(got), toJson(want), TOLERANCE, what);
    return r ? `${r}\n    hedef ${JSON.stringify(target).slice(0, 300)}, nokta ${JSON.stringify(pick)}` : null;
  };
  return (
    same('trim', rs.trim(target, pick, view, chosen), tsTrim(doc, ts, target, pick, view, chosen)) ??
    same('extend', rs.extend(target, pick, view, chosen), tsExtend(doc, ts, target, pick, view, chosen)) ??
    same('ghosts', Array.from(rs.ghosts(selected, affines, limit)), tsGhosts(doc, selected, affines, limit)) ??
    same('stretchGhosts', Array.from(rs.stretchGhosts(selected, w, dx, dy)), tsStretchGhosts(doc, selected, w, dx, dy)) ??
    same('measure', rs.measure(selected), tsMeasure(doc, selected))
  );
}

/** A random edit through the document's API (or its layers). */
function edit(g: Gen, doc: CadDocument): void {
  const ids = [...doc.all()].map((e) => e.id);
  const some = () => (ids.length ? g.pick(ids) : -1);
  const move = (id: number) => {
    const e = doc.get(id);
    if (e) doc.update(id, transformEntity(e, translation(g.num(-5, 5), g.num(-5, 5))));
  };
  switch (g.int(0, 10)) {
    case 0:
      doc.add(sceneEntity(g));
      break;
    case 1:
      move(some());
      break;
    case 2:
      doc.remove(ids.filter(() => g.chance(0.05)));
      break;
    case 3:
      doc.undo();
      break;
    case 4:
      doc.redo();
      break;
    case 5:
      doc.transact('Parity', () => {
        for (let i = g.int(1, 6); i > 0; i--) {
          const k = g.int(0, 2);
          if (k === 0) doc.add(sceneEntity(g));
          else if (k === 1) move(some());
          else doc.remove([some()]);
        }
      });
      break;
    case 6: {
      const l = g.pick(SCENE_LAYER_IDS);
      if (g.chance(0.5)) doc.layers.toggleVisible(l);
      else doc.layers.toggleLocked(l);
      break;
    }
    case 7: {
      const put: Entity[] = [];
      for (const id of ids.filter(() => g.chance(0.02))) {
        const e = doc.get(id);
        if (e) put.push(transformEntity(e, translation(1, -1)));
      }
      put.push({ ...sceneEntity(g), id: doc.allocateId() } as Entity);
      doc.applyExternal({ put, remove: ids.filter(() => g.chance(0.02)) });
      break;
    }
    case 8:
      doc.load(Array.from({ length: g.int(1, 5) }, () => sceneEntity(g)));
      break;
    case 9: {
      const id = some();
      if (doc.get(id)) doc.update(id, { attrs: { Not: String(g.int(0, 9)) } });
      break;
    }
    default:
      doc.remove([some()]);
  }
}

describe('Rust geometry store ↔ TypeScript PickIndex', () => {
  it('answers like it on the sample project', () => {
    const doc = createSampleProject();
    const ts = new TsPickIndex(doc);
    const rs = new PickIndex(doc);
    const g = new Gen(20260924);
    const failures: string[] = [];
    for (let i = 0; i < ROUNDS && failures.length < 5; i++) {
      const r = compare(g, doc, ts, rs) ?? compareOverlay(g, doc, rs) ?? compareTools(g, doc, ts, rs);
      if (r) failures.push(r);
    }
    rs.dispose();
    expect(failures.join('\n')).toBe('');
  }, 600_000);

  it('answers like it on random objects and layers, through edits', () => {
    const g = new Gen(81);
    const doc = sceneDocument(g, 400);
    const ts = new TsPickIndex(doc);
    const rs = new PickIndex(doc);
    const failures: string[] = [];
    for (let i = 0; i < ROUNDS && failures.length < 5; i++) {
      if (g.chance(0.5)) edit(g, doc);
      const order = [...doc.all()].map((e) => e.id);
      const got = rs.ids();
      if (JSON.stringify(got) !== JSON.stringify(order)) {
        failures.push(`sıra ${i}. turda ayrıldı: ${got.length} / ${order.length} nesne`);
        break;
      }
      const r = compare(g, doc, ts, rs) ?? compareOverlay(g, doc, rs) ?? compareTools(g, doc, ts, rs);
      if (r) failures.push(r);
    }
    rs.dispose();
    expect(failures.join('\n')).toBe('');
  }, 600_000);
});
