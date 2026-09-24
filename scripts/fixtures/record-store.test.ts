// Records the TypeScript PickIndex's answers on a fixed scene into
// fixtures/geometry/v1/store-v1.json (docs/adr/0008, S1), and the tool
// previews and totals as the TypeScript computed them (trim, extend,
// ghosts, stretch ghosts, selection totals): the Rust geometry store must
// give them natively (crates/geometry-core/tests/store.rs) and through the
// WASM build (src/wasm/store.wasm.test.ts) after the TypeScript is gone.
// Runs only on purpose, while the reference still exists:
//   GOLDEN_WRITE=1 npx vitest run scripts/fixtures/record-store.test.ts
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { Entity } from '../../src/model/entities';
import { mirror, rotation, scaling, translation, type Affine } from '../../src/model/geom/affine';
import type { Vec2 } from '../../src/model/geometry';
import { layerTable } from '../../src/viewport/picking';
import { DEFAULT_LABELS, labelRule } from '../../src/viewport/storeRecords';
import { Gen, TOLERANCE, toJson } from '../../src/wasm/parity/harness';
import { tsGrips, tsLabels } from '../../src/wasm/parity/reference/overlay';
import { TsPickIndex } from '../../src/wasm/parity/reference/picking';
import { tsExtend, tsGhosts, tsMeasure, tsStretchGhosts, tsTrim } from '../../src/wasm/parity/reference/tools';
import { SCENE_SCALES, SCENE_TOLERANCES, sceneCursor, sceneDocument, sceneKinds, sceneRect } from '../../src/wasm/parity/sets/store-scene';

/** Cursor positions and tool rounds recorded, and the largest answer kept (a window over the whole scene lists every edge). */
const CURSORS = 160;
const TOOL_ROUNDS = 80;
const MAX_ANSWER = 6_000;

it.runIf(!!process.env.GOLDEN_WRITE)('records the TypeScript PickIndex into the store fixture', () => {
  const g = new Gen(2609);
  const doc = sceneDocument(g, 300);
  // A hidden group and a locked leaf on top of the scene's own states.
  doc.layers.toggleVisible('g2');
  doc.layers.toggleLocked('g1');
  const ts = new TsPickIndex(doc);
  const cases: { name: string; op: string; args: unknown[]; expect: unknown }[] = [];
  const add = (name: string, op: string, args: unknown[], expect: unknown) => {
    const e = toJson(expect);
    if (JSON.stringify(e).length <= MAX_ANSWER) cases.push({ name, op, args: toJson(args) as unknown[], expect: e });
  };
  for (let i = 1; i <= CURSORS; i++) {
    const p = sceneCursor(g, doc);
    const tol = g.pick(SCENE_TOLERANCES);
    const kinds = sceneKinds(g);
    const from = g.chance(0.5) ? sceneCursor(g, doc) : null;
    const r = sceneRect(g, p, [0.1, 3, 20, 200]);
    const ids = [...doc.all()].map((e) => e.id);
    const except = g.chance(0.5) ? g.pick(ids) : null;
    const s = ts.snap(p, tol, kinds, from);
    const enc = ts.enclosing(p);
    add(`imleç ${i}`, 'hit', [p.x, p.y, tol], ts.hit(p, tol)?.id ?? null);
    add(`imleç ${i}`, 'hitEdge', [p.x, p.y, tol], ts.hitEdge(p, tol)?.id ?? null);
    add(`imleç ${i}`, 'snap', [p.x, p.y, tol, [...kinds], from], s && { kind: s.kind, point: s.point, entityId: s.entityId });
    add(`imleç ${i}`, 'enclosing', [p.x, p.y], enc && { id: enc.entity.id, ring: enc.ring });
    const crossing = g.chance(0.5);
    add(`kutu ${i}`, 'inRect', [r, crossing], ts.inRect(r, crossing));
    add(`kutu ${i}`, 'overlapping', [r, except], [...ts.overlapping(r, except ?? undefined)].map((e) => e.id));
    const small = sceneRect(g, p, [0.1, 3, 20]);
    add(`kutu ${i}`, 'edgesIn', [small, except], ts.edgesIn(small, except ?? undefined));
    const view = sceneRect(g, p, [20, 200]);
    const scale = g.pick(SCENE_SCALES);
    const editing = g.chance(0.2) ? g.pick(ids) : null;
    add(`görünüm ${i}`, 'labels', [view, scale, editing], tsLabels(doc, view, scale, editing));
    const selected = ids.filter(() => g.chance(0.02));
    add(`seçim ${i}`, 'grips', [selected], tsGrips(doc, selected));
  }
  // Tool previews and totals (S1c) after the queries, so the cases above stay as recorded.
  const all = [...doc.all()];
  const ids = all.map((e) => e.id);
  /** Mostly an object the tool accepts, so most answers are cuts and reaches rather than refusals. */
  const target = (kinds: string[]) => {
    const of = all.filter((e) => kinds.includes(e.kind));
    return g.chance(0.9) && of.length ? g.pick(of) : g.pick(all);
  };
  /** A pick near one of the object's vertices or anchors. */
  const near = (e: Entity): Vec2 => {
    const at = 'pts' in e && e.pts.length ? g.pick(e.pts) : e.kind === 'line' ? g.pick([e.a, e.b]) : 'c' in e && e.c ? e.c : sceneCursor(g, doc);
    return { x: at.x + g.num(-0.5, 0.5), y: at.y + g.num(-0.5, 0.5) };
  };
  for (let i = 1; i <= TOOL_ROUNDS; i++) {
    const chosen = g.chance(0.3) ? ids.filter(() => g.chance(0.1)) : null;
    const set = chosen && new Set(chosen);
    const cut = target(['line', 'polyline', 'polygon', 'circle', 'arc', 'ellipse', 'xline', 'ray']);
    const cutAt = near(cut);
    const view = sceneRect(g, cutAt, [20, 200, 5000]);
    add(`buda ${i}`, 'trim', [cut.id, cutAt, view, chosen], tsTrim(doc, ts, cut, cutAt, view, set));
    const grow = target(['line', 'polyline', 'arc', 'ellipse']);
    const growAt = near(grow);
    add(`uzat ${i}`, 'extend', [grow.id, growAt, view, chosen], tsExtend(doc, ts, grow, growAt, view, set));
    const c = sceneCursor(g, doc);
    const affines: Affine[] = Array.from({ length: g.int(1, 2) }, () => g.pick([translation(g.num(-50, 50), g.num(-50, 50)), rotation(g.num(-3, 3), c), scaling(g.num(0.2, 3), c), mirror(c, sceneCursor(g, doc))]));
    const selected = [...Array.from({ length: g.int(0, 3) }, () => g.pick(ids)), ...(g.chance(0.2) ? [999_999] : [])];
    const limit = g.pick([0, 1, 400]);
    add(`hayalet ${i}`, 'ghosts', [selected, affines, limit], tsGhosts(doc, selected, affines, limit));
    // The stretch window around a vertex of one of the selected objects, so it catches some.
    const first = doc.get(selected[0] ?? 0);
    const at = first ? near(first) : cutAt;
    const reach = g.pick([5, 50]);
    const w = { minX: at.x - g.num(0, reach), minY: at.y - g.num(0, reach), maxX: at.x + g.num(0, reach), maxY: at.y + g.num(0, reach) };
    const dx = g.num(-10, 10);
    const dy = g.num(-10, 10);
    add(`esnet ${i}`, 'stretchGhosts', [selected, w, dx, dy], tsStretchGhosts(doc, selected, w, dx, dy));
    const m = tsMeasure(doc, selected);
    add(`toplam ${i}`, 'measure', [selected], [m.length, m.area]);
  }
  const file = {
    format: 'kentos.geometry-store',
    version: 1,
    tolerance: TOLERANCE,
    crs: { kind: 'projected', unit: 'metre', note: 'Koordinatlar metre cinsinden bir projeksiyon düzlemindedir; tolerans bu birim içindir (fixtures/geometry/v1/cases.json ile aynı).' },
    layers: layerTable(doc.layers),
    labelDefaults: Object.fromEntries(Object.entries(DEFAULT_LABELS).map(([kind, st]) => [kind, labelRule(st)])),
    entities: [...doc.all()],
    cases,
  };
  const { entities, cases: cs, ...head } = file;
  const text = `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "entities": [\n${entities.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ],\n  "cases": [\n${cs.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
  writeFileSync(new URL('../../fixtures/geometry/v1/store-v1.json', import.meta.url), text);
});
