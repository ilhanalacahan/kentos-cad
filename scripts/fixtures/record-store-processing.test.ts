// Records what the processing tools asked of their objects' geometry as the
// TypeScript computed it (docs/adr/0008, S4) into
// fixtures/geometry/v1/store-processing.json: the "visible" scope's box
// test, corner numbering and edge-length labels, by id, on a fixed scene of
// grid parcels (origin and TM) and objects of every kind. The Rust geometry
// store must give them natively (crates/geometry-core/tests/store.rs) and
// through the WASM build (src/wasm/store.wasm.test.ts) after the
// TypeScript is gone. Runs only on purpose, while the reference exists:
//   GOLDEN_WRITE=1 npx vitest run scripts/fixtures/record-store-processing.test.ts
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import type { Entity, NewEntity } from '../../src/model/entities';
import type { Vec2 } from '../../src/model/geometry';
import type { NumberingInput } from '../../src/processing/builtin/numbering';
import type { CornerWalk } from '../../src/processing/geometry';
import { layerTable } from '../../src/viewport/picking';
import { DEFAULT_LABELS, labelRule } from '../../src/viewport/storeRecords';
import { Gen, TOLERANCE, toJson } from '../../src/wasm/parity/harness';
import { tsCoreCorners, tsEdgeLengthLabels, tsInBox } from '../../src/wasm/parity/reference/processing';
import { sceneCursor, sceneDocument, sceneRect } from '../../src/wasm/parity/sets/store-scene';

/** Rounds per query, and the largest answer kept. */
const ROUNDS = 180;
const MAX_ANSWER = 6_000;
const E = 486512.34;
const N = 4420187.52;

const v = (x: number, y: number): Vec2 => ({ x, y });
const square = (x: number, y: number, s: number) => [v(x, y), v(x + s, y), v(x + s, y + s), v(x, y + s)];

/** The rings the store numbers for an object (polygons: outer ring, then holes; polylines open). */
function numberingInput(e: Entity): NumberingInput | null {
  if (e.kind === 'polygon') return { rings: [{ pts: e.pts, closed: true }, ...(e.holes ?? []).map((h) => ({ pts: h.pts, closed: true }))] };
  if (e.kind === 'polyline') return { rings: [{ pts: e.pts, closed: false }] };
  return null;
}

it.runIf(!!process.env.GOLDEN_WRITE)('records the processing tools’ geometry into the store fixture', () => {
  const g = new Gen(2025);
  const doc = sceneDocument(g, 220);
  // A TM parcel grid (shared corners and edges), paths along it and points on its corners.
  const extra: NewEntity[] = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 3; j++) {
      const ring = square(E + 10 * i, N + 10 * j, 10);
      extra.push({ kind: 'polygon', layerId: 'a', attrs: {}, pts: (i + j) % 2 ? ring.reverse() : ring, ...(i === 1 && j === 1 ? { holes: [{ pts: square(E + 13, N + 13, 3) }] } : {}), ...(i === 2 && j === 0 ? { bulges: [0, 0.4, 0, 0] } : {}) });
    }
  extra.push({ kind: 'polyline', layerId: 'b', attrs: {}, pts: [v(E, N + 30), v(E + 10, N + 30), v(E + 10, N + 40)] });
  extra.push({ kind: 'line', layerId: 'a', attrs: {}, a: v(E + 10, N + 10), b: v(E + 10, N) });
  extra.push({ kind: 'point', layerId: 'a', attrs: {}, p: v(E + 20, N + 20), label: 'P00007' });
  const cluster = extra.map((e) => doc.add(e).id);
  const all = [...doc.all()];
  const ids = all.map((e) => e.id);
  const byId = new Map(all.map((e) => [e.id, e]));
  const cases: { name: string; op: string; args: unknown[]; expect: unknown }[] = [];
  const add = (name: string, op: string, args: unknown[], expect: unknown) => {
    const e = toJson(expect);
    if (JSON.stringify(e).length <= MAX_ANSWER) cases.push({ name, op, args: toJson(args) as unknown[], expect: e });
  };
  /** A few objects: often neighbours from the TM grid (shared corners and edges), else areas and paths of the scene, now and then anything. */
  const shapes = all.filter((e) => e.kind === 'polygon' || e.kind === 'polyline' || e.kind === 'line');
  const some = () => {
    const n = g.int(1, 6);
    const list = g.chance(0.4) ? Array.from({ length: n }, () => g.pick(cluster)) : Array.from({ length: n }, () => (g.chance(0.8) ? g.pick(shapes) : g.pick(all)).id);
    return list.concat(g.chance(0.1) ? [999_999] : []);
  };
  const corners = all.flatMap((e) => (e.kind === 'polygon' || e.kind === 'polyline' ? e.pts : []));
  for (let i = 1; i <= ROUNDS; i++) {
    const r = sceneRect(g, sceneCursor(g, doc), [0.1, 3, 20, 200, 5000]);
    add(`kutu ${i}`, 'inBox', [r], tsInBox(all, r));
    const chosen = some();
    const walk: CornerWalk = { dir: g.pick(['cw', 'ccw']), start: g.pick(['northwest', 'north', 'first', 'point']), point: g.chance(0.8) ? sceneCursor(g, doc) : null, tolerance: g.pick([0, 0.001, 0.001, 0.5]), shared: g.chance(0.8) };
    const existing = Array.from({ length: g.int(0, 3) }, () => {
      const p = g.pick(corners);
      const j = g.pick([0, 0, 0.0004, 0.3]);
      return v(p.x + g.num(-j, j), p.y + g.num(-j, j));
    });
    const inputs = chosen.flatMap((id) => {
      const e = byId.get(id);
      const input = e && numberingInput(e);
      return input ? [input] : [];
    });
    add(`köşeler ${i}`, 'numberCorners', [chosen, walk, existing], tsCoreCorners(inputs, walk, existing));
    const labelled = some();
    const height = g.pick([2, 0.5, 5]);
    const minLength = g.pick([0, 0, 5, 12]);
    const side = g.pick(['outside', 'inside'] as const);
    const shared = g.chance(0.8);
    const objects = labelled.flatMap((id) => byId.get(id) ?? []);
    add(`kenarlar ${i}`, 'edgeLengths', [labelled, height, minLength, side, shared], tsEdgeLengthLabels(objects, height, minLength, side, shared));
  }
  const file = {
    format: 'kentos.geometry-store',
    version: 1,
    tolerance: TOLERANCE,
    crs: { kind: 'projected', unit: 'metre', note: 'Koordinatlar metre cinsinden bir projeksiyon düzlemindedir; tolerans bu birim içindir (fixtures/geometry/v1/cases.json ile aynı).' },
    layers: layerTable(doc.layers),
    labelDefaults: Object.fromEntries(Object.entries(DEFAULT_LABELS).map(([kind, st]) => [kind, labelRule(st)])),
    entities: ids.map((id) => byId.get(id)),
    cases,
  };
  const { entities, cases: cs, ...head } = file;
  const text = `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "entities": [\n${entities.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ],\n  "cases": [\n${cs.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
  writeFileSync(new URL('../../fixtures/geometry/v1/store-processing.json', import.meta.url), text);
});
