import { describe, expect, it } from 'vitest';
import { CadDocument } from '../model/document';
import type { Entity } from '../model/entities';
import type { Vec2 } from '../model/geometry';
import { LayerStore } from '../model/layers';
import { BUILTIN_TOOLS } from './builtin';
import { calculateField } from './builtin/calculateField';
import { edgeLengths } from './builtin/edgeLengths';
import { selectByExpression } from './builtin/selectByExpression';
import { formatNumber, numberCorners, parseNumber, ringOrder, type NumberingOptions } from './builtin/numbering';
import { vertexNumbering } from './builtin/vertexNumbering';
import { orderSteps, checkModel, type ProcessingModel } from './model';
import { defaultValues, restoreValues, validateValues } from './parameters';
import { ProcessingRegistry } from './registry';
import { ProcessingRunner } from './runner';
import { defineTool, type DefaultsContext, type Shown } from './types';

const v = (x: number, y: number): Vec2 => ({ x, y });
/** Counter-clockwise square with its first vertex at the south-west corner. */
const square = (x: number, y: number, s: number) => [v(x, y), v(x + s, y), v(x + s, y + s), v(x, y + s)];
const ctx: DefaultsContext = { lengthDecimals: 3, areaDecimals: 2, angleUnit: 'grad', plotScale: 1000, activeLayer: 'a' };

describe('numbering format', () => {
  const f = { prefix: 'P', length: 6, pad: '0' };
  it('pads between the prefix and the digits to the total length', () => {
    expect(formatNumber(1, f)).toBe('P00001');
    expect(formatNumber(12345, f)).toBe('P12345');
    expect(formatNumber(1234567, f)).toBe('P1234567');
    expect(formatNumber(7, { prefix: '', length: 3, pad: '' })).toBe('7');
  });
  it('reads a number back from a name in the same format', () => {
    expect(parseNumber('P00017', f)).toBe(17);
    expect(parseNumber('K00017', f)).toBeNull();
    expect(parseNumber('P0001A', f)).toBeNull();
  });
});

describe('corner order', () => {
  // Corners: 0 SW, 1 SE, 2 NE, 3 NW (counter-clockwise).
  const sq = square(0, 0, 10);
  it('clockwise from the north-west corner', () => {
    expect(ringOrder(sq, true, 'cw', 'northwest')).toEqual([3, 2, 1, 0]);
  });
  it('counter-clockwise from the north-west corner', () => {
    expect(ringOrder(sq, true, 'ccw', 'northwest')).toEqual([3, 0, 1, 2]);
  });
  it('clockwise input is turned the same way', () => {
    const cw = [...sq].reverse(); // NW, NE, SE, SW
    expect(ringOrder(cw, true, 'cw', 'northwest')).toEqual([0, 1, 2, 3]);
  });
  it('from the first vertex, or the one nearest a point', () => {
    expect(ringOrder(sq, true, 'cw', 'first')).toEqual([0, 3, 2, 1]);
    expect(ringOrder(sq, true, 'cw', 'point', v(11, -1))).toEqual([1, 0, 3, 2]);
  });
  it('an open path starts at its better end', () => {
    expect(ringOrder([v(0, 0), v(10, 0), v(10, 10)], false, 'cw', 'north')).toEqual([2, 1, 0]);
  });
});

describe('numbering corners of many shapes', () => {
  const base: NumberingOptions = { dir: 'cw', start: 'northwest', point: null, format: { prefix: 'P', length: 6, pad: '0' }, first: 1, step: 1, tolerance: 0.001, shared: true, existing: [] };
  const two = [{ rings: [{ pts: square(0, 0, 10), closed: true }] }, { rings: [{ pts: square(10, 0, 10), closed: true }] }];
  it('neighbours share their common corners', () => {
    const c = numberCorners(two, base);
    const created = c.filter((x) => x.created);
    expect(created.map((x) => x.name)).toEqual(['P00001', 'P00002', 'P00003', 'P00004', 'P00005', 'P00006']);
    // The west square comes first (north-west); its NE corner is the east square's NW corner.
    expect(c.find((x) => x.p.x === 10 && x.p.y === 10)!.name).toBe('P00002');
    expect(c.filter((x) => x.p.x === 10 && x.p.y === 10 && !x.created)).toHaveLength(1);
  });
  it('without sharing every corner gets its own number', () => {
    expect(numberCorners(two, { ...base, shared: false }).filter((x) => x.created)).toHaveLength(8);
  });
  it('existing points keep their names and numbering continues after them', () => {
    const c = numberCorners([two[0]], { ...base, existing: [{ p: v(0, 10), name: 'P00041' }] });
    expect(c.map((x) => x.name)).toEqual(['P00041', 'P00042', 'P00043', 'P00044']);
    expect(c[0].created).toBe(false);
  });
  it('the step and the first number', () => {
    expect(numberCorners([two[0]], { ...base, first: 100, step: 10 }).map((x) => x.name)).toEqual(['P00100', 'P00110', 'P00120', 'P00130']);
  });
});

describe('parameters', () => {
  const tool = defineTool({
    id: 'test.tool',
    label: 'Deneme',
    category: 'points',
    description: '',
    targets: ['client'],
    parameters: [
      { name: 'count', label: 'Adet', type: 'number', integer: true, min: 1, default: (c: DefaultsContext) => c.lengthDecimals },
      { name: 'mode', label: 'Kip', type: 'enum', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], default: 'a' },
      { name: 'where', label: 'Yer', type: 'point', visibleWhen: (x: Shown) => x.mode === 'b' },
      { name: 'layer', label: 'Katman', type: 'layer' },
      { name: 'note', label: 'Not', type: 'string', optional: true },
    ] as const,
    run: () => ({}),
  });
  const env = { layerExists: (id: string) => id === 'a' || id === 'kilit', layerLocked: (id: string) => id === 'kilit' };
  it('defaults may come from the project', () => {
    expect(defaultValues(tool, ctx)).toEqual({ count: 3, mode: 'a', where: null, layer: { layerId: 'a' }, note: '' });
  });
  it('validation names the parameter and says what is wrong', () => {
    const ok = defaultValues(tool, ctx);
    expect(validateValues(tool, ok, env)).toEqual([]);
    expect(validateValues(tool, { ...ok, count: 1.5 }, env)[0]).toEqual({ param: 'count', message: '“Adet” bir tam sayı olmalı.' });
    expect(validateValues(tool, { ...ok, count: 0 }, env)[0].message).toContain('en az 1');
    expect(validateValues(tool, { ...ok, layer: { layerId: 'kilit' } }, env)[0].message).toContain('kilitli');
    // A hidden parameter is not checked; shown, the empty point is.
    expect(validateValues(tool, { ...ok, mode: 'b' }, env)[0]).toEqual({ param: 'where', message: '“Yer” boş bırakılamaz.' });
    expect(validateValues(tool, { ...ok, note: null }, env)).toEqual([]);
  });
  it('stored values are restored only when they still fit', () => {
    expect(restoreValues(tool, { count: 7, mode: 'z', layer: 5 }, ctx)).toMatchObject({ count: 7, mode: 'a', layer: { layerId: 'a' } });
  });
});

describe('registry', () => {
  it('registers tools, rejects duplicates and unknown categories, builds the tree, searches in Turkish', () => {
    const r = new ProcessingRegistry();
    for (const t of BUILTIN_TOOLS) r.register(t);
    expect(() => r.register(vertexNumbering)).toThrow();
    expect(() => r.register({ ...edgeLengths, id: 'x.y', category: 'nope' })).toThrow();
    const tree = r.tree();
    expect(tree.map((n) => n.category.id)).toEqual(['points', 'annotation', 'attributes', 'selection']);
    expect(r.search('kose numara').map((t) => t.id)).toEqual(['points.numberVertices']);
    expect(r.search('KENAR').map((t) => t.id)).toEqual(['annotation.edgeLengths']);
    expect(r.categoryPath('points')).toBe('Nokta işlemleri');
  });
});

describe('runner on a document', () => {
  const setup = () => {
    const doc = new CadDocument({ name: 't.kcad', layers: new LayerStore([{ id: 'a', name: 'Parseller' }], 'a'), origin: v(0, 0) });
    const e1 = doc.add({ kind: 'polygon', pts: square(0, 0, 10), layerId: 'a', attrs: {} });
    const e2 = doc.add({ kind: 'polygon', pts: square(10, 0, 10), layerId: 'a', attrs: {} });
    let selected: number[] = [e1.id, e2.id];
    const runner = new ProcessingRunner({ doc, selectedIds: () => selected, visibleBounds: () => null });
    return { doc, runner, e1, e2, setSelection: (ids: number[]) => (selected = ids) };
  };
  it('numbers the corners of the selection into a new layer, in one undo step', async () => {
    const { doc, runner } = setup();
    const values = defaultValues(vertexNumbering, runner.defaults());
    const out = await runner.run(vertexNumbering, values);
    expect(out.status).toBe('ok');
    const layer = doc.layers.leaves().find((l) => l.name === 'Köşe noktaları')!;
    expect(layer).toBeDefined();
    const pts = doc.byLayer(layer.id) as Extract<Entity, { kind: 'point' }>[];
    expect(pts.map((p) => p.label)).toEqual(['P00001', 'P00002', 'P00003', 'P00004', 'P00005', 'P00006']);
    expect(pts[0].p).toEqual(v(0, 10));
    expect(runner.history.value[0].summary).toContain('6 köşe numaralandı');
    doc.undo();
    expect(doc.byLayer(layer.id)).toHaveLength(0);
  });
  it('a second run reuses the layer and adds nothing new', async () => {
    const { doc, runner } = setup();
    const values = defaultValues(vertexNumbering, runner.defaults());
    await runner.run(vertexNumbering, values);
    const out = await runner.run(vertexNumbering, values);
    expect(out.status === 'ok' && out.added).toEqual([]);
    expect(doc.layers.leaves().filter((l) => l.name === 'Köşe noktaları')).toHaveLength(1);
  });
  it('writes each shared edge once', async () => {
    const { doc, runner } = setup();
    const out = await runner.run(edgeLengths, defaultValues(edgeLengths, runner.defaults()));
    expect(out.status === 'ok' && out.added.length).toBe(7);
    const texts = [...doc.all()].filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(texts.every((t) => t === '10.000')).toBe(true);
  });
  it('invalid values do not run; an empty selection is stopped with a hint', async () => {
    const { runner, setSelection } = setup();
    const bad = { ...defaultValues(vertexNumbering, runner.defaults()), length: 0 };
    expect((await runner.run(vertexNumbering, bad)).status).toBe('invalid');
    setSelection([]);
    const values = defaultValues(vertexNumbering, runner.defaults());
    expect(runner.describeInputs(vertexNumbering, values).input.count).toBe(0);
    const out = await runner.run(vertexNumbering, values);
    expect(out.status).toBe('invalid');
    expect(out.status === 'invalid' && out.issues[0]).toMatchObject({ param: 'input' });
    expect(runner.history.value).toHaveLength(0);
    // An empty result handed along a model still runs.
    const chained = await runner.run(vertexNumbering, { ...values, input: { scope: 'ids', ids: [] } });
    expect(chained.status === 'ok' && chained.record.summary).toBe('Numaralanacak alan yok.');
  });
});

describe('expressions, fields and selection in tools', () => {
  const setup = () => {
    const doc = new CadDocument({ name: 't.kcad', layers: new LayerStore([{ id: 'a', name: 'Parseller' }, { id: 'b', name: 'Yol' }], 'a'), origin: v(0, 0) });
    const small = doc.add({ kind: 'polygon', pts: square(0, 0, 10), layerId: 'a', label: '1', attrs: { Parsel: '1', Nitelik: 'Arsa' } });
    const big = doc.add({ kind: 'polygon', pts: square(20, 0, 30), layerId: 'a', label: '2', attrs: { Parsel: '2', Nitelik: 'Tarla' } });
    const road = doc.add({ kind: 'polyline', pts: [v(0, -5), v(60, -5)], layerId: 'b', attrs: {} });
    let selected: number[] = [small.id];
    const runner = new ProcessingRunner({ doc, selectedIds: () => selected, visibleBounds: () => null, select: (ids) => (selected = [...ids]) });
    return { doc, runner, small, big, road, selection: () => selected };
  };
  it('summarizes kinds and fields, and narrows to the kinds the user keeps', () => {
    const { runner } = setup();
    const values = { ...defaultValues(calculateField, runner.defaults()), input: { scope: 'all' } };
    const s = runner.describeInputs(calculateField, values).input;
    expect(s.count).toBe(3);
    expect(s.byKind).toEqual([
      { kind: 'polygon', count: 2 },
      { kind: 'polyline', count: 1 },
    ]);
    expect(s.fields.map((f) => f.name)).toEqual(['Nitelik', 'Parsel']);
    const only = runner.describeInputs(calculateField, { ...values, input: { scope: 'all', kinds: ['polyline'] } }).input;
    expect(only.count).toBe(1);
    expect(validateValues(calculateField, { ...values, input: { scope: 'all', kinds: [] } }, { layerExists: () => true, layerLocked: () => false })[0].message).toContain('en az bir nesne türü');
  });
  it('selects by expression in every mode and leaves nothing to undo', async () => {
    const { doc, runner, small, big, selection } = setup();
    const base = { input: { scope: 'all' }, condition: "$alan > 50 ve Nitelik = 'Tarla'" };
    let out = await runner.run(selectByExpression, { ...base, mode: 'new' });
    expect(out.status === 'ok' && out.touched).toEqual([big.id]);
    expect(selection()).toEqual([big.id]);
    expect(doc.canUndo.value).toBe(true); // from the setup adds only
    await runner.run(selectByExpression, { ...base, condition: 'Parsel = 1', mode: 'add' });
    expect(selection().sort()).toEqual([small.id, big.id].sort());
    await runner.run(selectByExpression, { ...base, condition: '$alan > 500', mode: 'remove' });
    expect(selection()).toEqual([small.id]);
    out = await runner.run(selectByExpression, { ...base, condition: 'boş(Parsel)', mode: 'within' });
    expect(selection()).toEqual([]);
    expect(out.status === 'ok' && out.record.summary).toBe('1 / 3 nesne koşulu sağladı; seçimde 0 nesne var.');
    const bad = await runner.run(selectByExpression, { ...base, condition: '$alan >', mode: 'new' });
    expect(bad.status === 'invalid' && bad.issues[0].message).toBe('“Koşul”: 8. karakterde: İfade yarım kalmış: sonunda bir değer eksik.');
  });
  it('calculates a field, follows the label, skips empty results, and undoes in one step', async () => {
    const { doc, runner, small, big, road } = setup();
    const values = { ...defaultValues(calculateField, runner.defaults()), input: { scope: 'all' }, field: 'Parsel', value: "Parsel + '/A'" };
    const out = await runner.run(calculateField, values);
    expect(out.status === 'ok' && out.record.summary).toBe('2 nesnede “Parsel” yazıldı; 1 nesnede sonuç boş olduğu için dokunulmadı.');
    expect(doc.get(small.id)!.attrs.Parsel).toBe('1/A');
    expect(doc.get(small.id)!.label).toBe('1/A');
    expect(doc.get(road.id)!.attrs.Parsel).toBeUndefined();
    doc.undo();
    expect(doc.get(big.id)!.attrs.Parsel).toBe('2');
    expect(doc.get(big.id)!.label).toBe('2');
    // Default: the computed area with the project's area decimals, into a new field.
    const area = await runner.run(calculateField, { ...defaultValues(calculateField, runner.defaults()), input: { scope: 'all', kinds: ['polygon'] }, where: "Nitelik = 'Tarla'" });
    expect(area.status === 'ok' && area.record.summary).toBe('1 nesnede “Hesap alanı” yazıldı; 1 nesne koşulu sağlamadı.');
    expect(doc.get(big.id)!.attrs['Hesap alanı']).toBe('900.00');
    expect(doc.get(big.id)!.label).toBe('2');
  });
});

describe('models', () => {
  const model = (steps: ProcessingModel['steps']): ProcessingModel => ({ id: 'm', label: 'M', category: 'points', description: '', inputs: [], steps, outputs: [] });
  it('orders steps after the ones they read from, and finds cycles', () => {
    const m = model([
      { id: 'b', tool: 'annotation.edgeLengths', values: { input: { kind: 'output', step: 'a', output: 'points' } } },
      { id: 'a', tool: 'points.numberVertices', values: {} },
    ]);
    expect(orderSteps(m)).toEqual(['a', 'b']);
    const cyc = model([
      { id: 'a', tool: 't', values: { x: { kind: 'output', step: 'b', output: 'o' } } },
      { id: 'b', tool: 't', values: { x: { kind: 'output', step: 'a', output: 'o' } } },
    ]);
    expect('error' in (orderSteps(cyc) as object)).toBe(true);
  });
  it('checks tools, outputs and inputs', () => {
    const r = new ProcessingRegistry();
    for (const t of BUILTIN_TOOLS) r.register(t);
    const m = model([
      { id: 'a', tool: 'points.numberVertices', values: {} },
      { id: 'b', tool: 'annotation.edgeLengths', values: { input: { kind: 'output', step: 'a', output: 'nope' } } },
      { id: 'c', tool: 'missing.tool', values: {} },
    ]);
    const issues = checkModel(m, (id) => r.get(id)).map((i) => i.message);
    expect(issues.some((s) => s.includes('olmayan bir çıktıya'))).toBe(true);
    expect(issues.some((s) => s.includes('Bilinmeyen işlem aracı'))).toBe(true);
  });
});
