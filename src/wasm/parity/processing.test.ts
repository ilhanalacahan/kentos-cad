import { describe, expect, it } from 'vitest';
import type { CadDocument } from '../../model/document';
import { compileExpression, previewExpression } from '../../model/expression/expression';
import { translation } from '../../model/geom/affine';
import { transformEntity } from '../../model/ops/transform';
import { createSampleProject } from '../../model/sampleProject';
import { BUILTIN_TOOLS } from '../../processing/builtin';
import { resolveFeatures, type FeatureHost } from '../../processing/features';
import { materialize, runJob, type RunJob } from '../../processing/job';
import type { DefaultsContext, Feedback, RunResult, TargetLayer } from '../../processing/types';
import { handleJob } from '../../processing/worker/handleJob';
import type { WorkerReply } from '../../processing/worker/protocol';
import { PickIndex } from '../../viewport/picking';
import { Gen, sameResult, TOLERANCE, toJson } from './harness';
import { tsCalculateField, tsEdgeLengths, tsSelectByExpression, tsVertexNumbering, tsVisible, type TsRunContext } from './reference/processing';
import { SCENE_LAYER_IDS, sceneCursor, sceneDocument, sceneEntity, sceneRect } from './sets/store-scene';

/**
 * The processing tools on the geometry store against the TypeScript they
 * replaced (docs/adr/0008, S4). On the sample project (TM parcels sharing
 * corners and edges) and on seeded scenes (every kind, holes, arcs, bad
 * objects, hidden and locked layers), through edits: the "visible" scope
 * from the viewport's store and from a store of its own, the dialog's
 * expression preview, and whole runs of every built-in tool, in the page
 * (`runJob`) and through the worker's job handler, against the old runs.
 * The page and the worker must agree exactly. PARITY_CASES raises the
 * number of rounds for a deep run.
 */

const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ROUNDS = Number(env.PARITY_CASES ?? 200);
const TOOLS = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]));

const feedback: Feedback = { progress: () => {}, info: () => {}, warn: () => {}, canceled: false, yield: () => Promise.resolve() };

/** Geometry values in every place an expression can use them; `$y`/`$x` only where an empty path gives null either way. */
const VALUES = ['metin($alan, 2)', 'yuvarla($uzunluk, 3)', '$y + $x', 'metin($x, 1)', "Parsel || '/' || metin($alan, 0)", '$alan', '$uzunluk * 2', "eğer($alan > 100, 'büyük', 'küçük')", '$köşe', '$tür'];
const CONDITIONS = ['$alan > 100', '$uzunluk < 40', "$katman = 'A'", '$y > 0', 'boş(Parsel)', '$alan > 50 ve $uzunluk > 20', '$x < 0'];

/** A run's job as the runner makes it: features as ids, a target layer, the rest as entered. */
function job(toolId: string, values: Record<string, unknown>, doc: CadDocument, units: DefaultsContext, selection: number[]): RunJob {
  return { toolId, values, units, selection, layers: doc.layers.leaves().map((l) => [l.id, l.name] as const) };
}

/** The same job through the worker's job handler, on copies of the objects. */
async function inWorker(j: RunJob, doc: CadDocument): Promise<RunResult | string> {
  let reply: WorkerReply | null = null;
  await handleJob({ type: 'run', id: 1, job: structuredClone(j), entities: structuredClone([...doc.all()]) }, (r) => r.type === 'done' || r.type === 'error' ? (reply = r) : null, (id) => TOOLS.get(id));
  const r = reply as WorkerReply | null;
  return r?.type === 'done' ? r.result : `worker: ${r?.type === 'error' ? r.message : 'yanıt yok'}`;
}

/** Every built-in tool once, on random objects and values: the core's run in the page and in the worker, and the old run. */
async function compareTools(g: Gen, doc: CadDocument): Promise<string | null> {
  const all = [...doc.all()];
  if (!all.length) return null;
  const share = g.pick([0.05, 0.3, 1]);
  const ids = all.filter(() => g.chance(share)).map((e) => e.id);
  const input = { ids, description: '' };
  const units: DefaultsContext = { lengthDecimals: 3, areaDecimals: 2, angleUnit: 'grad', plotScale: g.pick([500, 1000, 5000]), activeLayer: 'a' };
  const selection = all.filter(() => g.chance(0.1)).map((e) => e.id);
  const leaves = doc.layers.leaves();
  const existingLayer = leaves.length ? g.pick(leaves) : null;
  const layer: TargetLayer = existingLayer && g.chance(0.6) ? { id: existingLayer.id, name: existingLayer.name, isNew: false } : { id: 'islem-yeni', name: 'Yeni', isNew: true };
  const ctx: TsRunContext = { doc, units, selection, layerName: (id) => doc.layers.get(id)?.name ?? id };
  const prefix = g.pick(['P', '', 'K-']);
  const pad = g.pick(['0', '0', '', ' ', '*']);
  const shared = g.chance(0.8);
  const runs: [string, Record<string, unknown>, (v: never) => RunResult][] = [
    [
      'points.numberVertices',
      {
        input,
        direction: g.pick(['cw', 'ccw']),
        start: g.pick(['northwest', 'north', 'first', 'point']),
        startPoint: g.chance(0.8) ? sceneCursor(g, doc) : null,
        prefix,
        length: g.pick([6, 8, prefix.length + 1]),
        pad,
        first: g.pick([1, 0, 100]),
        step: g.pick([1, 2, 10]),
        shared,
        tolerance: shared ? g.pick([0.001, 0, 0.5, 5]) : null,
        output: g.pick(['points', 'text', 'both']),
        textHeight: g.pick([2, 0.5, null]),
        layer,
      },
      (v) => tsVertexNumbering(v, ctx),
    ],
    [
      'annotation.edgeLengths',
      { input, decimals: g.pick([0, 2, 3]), side: g.pick(['outside', 'inside']), textHeight: g.pick([2, 0.7]), prefix: g.pick(['', 'L=']), suffix: g.pick(['', ' m']), minLength: g.pick([0, 0, 5, 12]), shared: g.chance(0.8), layer },
      (v) => tsEdgeLengths(v, ctx),
    ],
    [
      'attributes.calculate',
      { input, field: g.pick(['Hesap alanı', 'Parsel', 'Not']), value: g.pick(VALUES), where: g.chance(0.4) ? g.pick(CONDITIONS) : null, empty: g.pick(['keep', 'clear']), label: g.chance(0.5) },
      (v) => tsCalculateField(v, ctx),
    ],
    ['selection.byExpression', { input, condition: g.pick(CONDITIONS), mode: g.pick(['new', 'add', 'remove', 'within']) }, (v) => tsSelectByExpression(v, ctx)],
  ];
  for (const [toolId, values, old] of runs) {
    const tool = TOOLS.get(toolId)!;
    const j = job(toolId, values, doc, units, selection);
    const page = await runJob(tool, j, doc, feedback);
    const worker = await inWorker(j, doc);
    const want = old(materialize(tool, j.values, doc) as never);
    const where = `\n    ${toolId} ${JSON.stringify({ ...values, input: `${ids.length} nesne` }).slice(0, 400)}`;
    if (typeof worker === 'string') return `${worker}${where}`;
    if (JSON.stringify(toJson(worker)) !== JSON.stringify(toJson(page))) return `sayfa ile worker ayrıştı${where}`;
    const r = sameResult(toJson(page), toJson(want), TOLERANCE, toolId);
    if (r) return `${r}${where}`;
  }
  return null;
}

/** The "visible" scope from the viewport's store and from a store of its own, and the dialog's preview of an expression. */
function compareScope(g: Gen, doc: CadDocument, rs: PickIndex): string | null {
  const view = sceneRect(g, sceneCursor(g, doc), [20, 200, 5000]);
  const want = tsVisible(doc, view).map((e) => e.id);
  const host = (geometry?: PickIndex): FeatureHost => ({ doc, selectedIds: () => [], visibleBounds: () => view, ...(geometry ? { geometry } : {}) });
  const seen = resolveFeatures({ scope: 'visible' }, {}, host(rs)).entities;
  const r = sameResult(seen.map((e) => e.id), want, TOLERANCE, 'görünen (görünümün deposu)');
  if (r) return `${r}\n    görünüm ${JSON.stringify(view)}`;
  if (g.chance(0.2)) {
    const own = resolveFeatures({ scope: 'visible' }, {}, host()).entities.map((e) => e.id);
    const r2 = sameResult(own, want, TOLERANCE, 'görünen (kendi deposu)');
    if (r2) return `${r2}\n    görünüm ${JSON.stringify(view)}`;
  }
  // Values previewed as values, conditions as conditions: a comparison with an empty path's `$y` is false in the
  // core, where the old TypeScript failed and left the whole value empty (docs/adr/0008, S2).
  const kind = g.pick(['condition', 'value'] as const);
  const c = compileExpression(g.pick(kind === 'value' ? VALUES : CONDITIONS));
  if (!c.ok) return `ifade: ${c.error}`;
  const layerName = (id: string) => doc.layers.get(id)?.name ?? id;
  const list = seen.length ? seen : [...doc.all()];
  const got = previewExpression(c.expr, list, kind, layerName, (l) => rs.measures(l.map((e) => e.id)));
  const old = previewExpression(c.expr, list, kind, layerName);
  return got === old ? null : `önizleme “${c.expr.source}”: ${got} ≠ ${old}`;
}

/** A random edit through the document's API (or its layers). */
function edit(g: Gen, doc: CadDocument): void {
  const ids = [...doc.all()].map((e) => e.id);
  const some = () => (ids.length ? g.pick(ids) : -1);
  switch (g.int(0, 6)) {
    case 0:
      doc.add(sceneEntity(g));
      break;
    case 1: {
      const e = doc.get(some());
      if (e) doc.update(e.id, transformEntity(e, translation(g.num(-5, 5), g.num(-5, 5))));
      break;
    }
    case 2:
      doc.remove(ids.filter(() => g.chance(0.03)));
      break;
    case 3:
      doc.undo();
      break;
    case 4:
      doc.redo();
      break;
    case 5: {
      const l = g.pick(SCENE_LAYER_IDS.filter((id) => doc.layers.get(id)));
      if (l) doc.layers.toggleVisible(l);
      break;
    }
    default:
      doc.add(sceneEntity(g));
  }
}

describe('processing on the geometry store ↔ the TypeScript it replaced', () => {
  it('runs every tool alike on the sample project', async () => {
    const doc = createSampleProject();
    const rs = new PickIndex(doc);
    const g = new Gen(20260925);
    const failures: string[] = [];
    for (let i = 0; i < Math.max(20, ROUNDS / 10) && failures.length < 5; i++) {
      const r = compareScope(g, doc, rs) ?? (await compareTools(g, doc));
      if (r) failures.push(r);
    }
    rs.dispose();
    expect(failures.join('\n')).toBe('');
  }, 600_000);

  it('runs every tool alike on random objects and layers, through edits', async () => {
    const g = new Gen(4242);
    const doc = sceneDocument(g, 300);
    const rs = new PickIndex(doc);
    const failures: string[] = [];
    for (let i = 0; i < ROUNDS && failures.length < 5; i++) {
      if (g.chance(0.5)) edit(g, doc);
      const r = compareScope(g, doc, rs) ?? (await compareTools(g, doc));
      if (r) failures.push(r);
    }
    rs.dispose();
    expect(failures.join('\n')).toBe('');
  }, 600_000);
});
