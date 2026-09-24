// Records the TypeScript PickIndex's answers on a fixed scene into
// fixtures/geometry/v1/store-v1.json (docs/adr/0008, S1): the Rust geometry
// store must give them natively (crates/geometry-core/tests/store.rs) and
// through the WASM build (src/wasm/store.wasm.test.ts) after the TypeScript
// is gone. Runs only on purpose, while the reference still exists:
//   GOLDEN_WRITE=1 npx vitest run scripts/fixtures/record-store.test.ts
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { layerTable } from '../../src/viewport/picking';
import { DEFAULT_LABELS, labelRule } from '../../src/viewport/storeRecords';
import { Gen, TOLERANCE, toJson } from '../../src/wasm/parity/harness';
import { tsGrips, tsLabels } from '../../src/wasm/parity/reference/overlay';
import { TsPickIndex } from '../../src/wasm/parity/reference/picking';
import { SCENE_SCALES, SCENE_TOLERANCES, sceneCursor, sceneDocument, sceneKinds, sceneRect } from '../../src/wasm/parity/sets/store-scene';

/** Cursor positions recorded, and the largest answer kept (a window over the whole scene lists every edge). */
const CURSORS = 160;
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
