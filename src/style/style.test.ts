import { describe, expect, it } from 'vitest';
import type { Entity } from '../model/entities';
import type { Vec2 } from '../model/geometry';
import { compileSymbol, ExprCache, toDrawn, toWorld, type CompileEnv } from './compile';
import { exportStyles, importStyles, parseStyleFile, sanitizeSvg, svgAsset, validateSymbol } from './file';
import { hatchSymbolOf, symbolsOfLayerStyle } from './fromLayer';
import { geometryClassOf, interiorPoint, MAX_MARKERS_PER_PATH, placeAlong, styledGeometry } from './geometry';
import { StyleLibrary } from './library';
import { PrimitiveList } from './primitives';
import { resolveRenderer } from './resolve';
import type { FillSymbol, LayerRenderer, LibraryItem, LineSymbol, MarkerSymbol } from '../model/style';

const v = (x: number, y: number): Vec2 => ({ x, y });
const env = (plotScale = 1000): CompileEnv => ({ plotScale, exprs: new ExprCache(), layerName: (id) => ({ a: 'Parseller' })[id] ?? id });
const polygon = (pts: Vec2[], attrs: Record<string, string> = {}, holes?: Vec2[][]): Entity => ({ id: 1, kind: 'polygon', layerId: 'a', pts, attrs, holes: holes?.map((h) => ({ pts: h })) });
const line = (pts: Vec2[], attrs: Record<string, string> = {}): Entity => ({ id: 2, kind: 'polyline', layerId: 'a', pts, attrs });
const square = (s: number) => [v(0, 0), v(s, 0), v(s, s), v(0, s)];
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

describe('units', () => {
  it('turns paper mm into metres at the plot scale; px stays px for drawn sizes', () => {
    expect(toWorld(1, 'mm', env(1000))).toBe(1);
    expect(toWorld(2, 'mm', env(500))).toBe(1);
    expect(toWorld(3, 'm', env(1000))).toBe(3);
    expect(toWorld(96, 'px', env(1000))).toBeCloseTo(25.4, 9);
    expect(toDrawn(4, 'px', env())).toEqual({ v: 4, unit: 'px' });
    expect(toDrawn(0.5, undefined, env(2000))).toEqual({ v: 1, unit: 'world' });
  });
});

describe('geometry for styles', () => {
  it('classes objects and orients area rings: outer counter-clockwise, holes clockwise', () => {
    const cw = [v(0, 0), v(0, 10), v(10, 10), v(10, 0)];
    const hole = [v(2, 2), v(4, 2), v(4, 4), v(2, 4)]; // counter-clockwise
    const g = styledGeometry(polygon(cw, {}, [hole]));
    expect(g?.cls).toBe('fill');
    if (g?.cls !== 'fill') return;
    const area = (r: readonly Vec2[]) => r.reduce((s, p, i) => s + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0) / 2;
    expect(area(g.rings[0])).toBeGreaterThan(0);
    expect(area(g.rings[1])).toBeLessThan(0);
    expect(geometryClassOf({ id: 3, kind: 'circle', layerId: 'a', c: v(0, 0), r: 1, attrs: {} })).toBe('line');
    expect(geometryClassOf({ id: 4, kind: 'text', layerId: 'a', p: v(0, 0), text: 'x', height: 1, rotation: 0, attrs: {} })).toBeNull();
  });
  it('places markers at intervals, vertices, ends and centres', () => {
    const path = [v(0, 0), v(10, 0), v(10, 10)];
    expect(placeAlong(path, false, 'interval', 5).map((p) => [p.at.x, p.at.y])).toEqual([
      [0, 0],
      [5, 0],
      [10, 0],
      [10, 5],
      [10, 10],
    ]);
    expect(placeAlong(path, false, 'interval', 5, 2.5).map((p) => p.at.x + p.at.y)).toEqual([2.5, 7.5, 12.5, 17.5]);
    // A closed square does not repeat its start.
    expect(placeAlong(square(10), true, 'interval', 10)).toHaveLength(4);
    const corners = placeAlong(path, false, 'vertex');
    expect(corners).toHaveLength(3);
    expect(close(corners[1].angle, Math.PI / 4)).toBe(true);
    expect(placeAlong(path, false, 'innerVertex').map((p) => p.at)).toEqual([v(10, 0)]);
    expect(placeAlong(path, false, 'center')[0].at).toEqual(v(10, 0));
    expect(placeAlong(path, false, 'segmentCenter').map((p) => p.at)).toEqual([v(5, 0), v(10, 5)]);
    expect(close(placeAlong(path, false, 'last')[0].angle, Math.PI / 2)).toBe(true);
    expect(placeAlong(path, false, 'interval', 1e-9)).toHaveLength(MAX_MARKERS_PER_PATH);
  });
  it('finds a point inside any area, never in a hole', () => {
    expect(interiorPoint([square(10)])).toEqual(v(5, 5));
    const u = [v(0, 0), v(30, 0), v(30, 30), v(20, 30), v(20, 10), v(10, 10), v(10, 30), v(0, 30)];
    const p = interiorPoint([u])!;
    const inU = (q: Vec2) => (q.y < 10 && q.x > 0 && q.x < 30) || (q.x < 10 && q.x > 0) || (q.x > 20 && q.x < 30);
    expect(inU(p)).toBe(true);
    const donut = interiorPoint([square(10), [v(3, 3), v(3, 7), v(7, 7), v(7, 3)]])!;
    expect(donut.x > 3 && donut.x < 7 && donut.y > 3 && donut.y < 7).toBe(false);
  });
});

describe('compiling symbols', () => {
  it('offsets and dashes lines in paper mm', () => {
    const sym: LineSymbol = { type: 'line', layers: [{ id: 'a', type: 'simpleLine', color: '#E06C75', width: 0.35, dash: [4, 1], offset: 1, cap: 'round' }] };
    const out = new PrimitiveList();
    compileSymbol(sym, styledGeometry(line([v(0, 0), v(10, 0)]))!, { entity: line([]), index: 1 }, env(1000), out);
    expect(out.strokes).toHaveLength(1);
    const s = out.strokes[0];
    expect(s.path).toEqual([v(0, 1), v(10, 1)]);
    expect(s.style).toMatchObject({ width: 0.35, unit: 'world', dash: [4, 1], cap: 'round', color: '#E06C75' });
  });
  it('alternates two marker layers along a boundary (hollow, filled, hollow …)', () => {
    const dot = (fill: string | null): MarkerSymbol => ({ type: 'marker', layers: [{ id: 'm', type: 'shape', shape: 'circle', size: 1.2, fill, stroke: '#1565C0', strokeWidth: 0.2 }] });
    const sym: LineSymbol = {
      type: 'line',
      layers: [
        { id: 'l', type: 'simpleLine', color: '#1565C0', width: 0.25 },
        { id: 'h', type: 'markerLine', marker: dot(null), placement: 'interval', interval: 8, offsetAlong: 0 },
        { id: 'f', type: 'markerLine', marker: dot('#1565C0'), placement: 'interval', interval: 8, offsetAlong: 4 },
      ],
    };
    const out = new PrimitiveList();
    compileSymbol(sym, styledGeometry(line([v(0, 0), v(24, 0)]))!, { entity: line([]), index: 1 }, env(1000), out);
    const xs = out.markers.map((m) => [m.at.x, m.style.kind === 'shape' ? m.style.fill : 'x']);
    expect(xs).toEqual([
      [0, null],
      [8, null],
      [16, null],
      [24, null],
      [4, '#1565C0'],
      [12, '#1565C0'],
      [20, '#1565C0'],
    ]);
    expect(out.markers.every((m) => m.style.common.level === (m.style.kind === 'shape' && m.style.fill ? 2 : 1))).toBe(true);
  });
  it('draws area edges into the area, fills, hatches and a text from attributes', () => {
    const sym: FillSymbol = {
      type: 'fill',
      layers: [
        { id: 'f', type: 'simpleFill', color: '#FFFA26' },
        { id: 'h', type: 'hatchFill', angle: 45, spacing: 2, width: 0.1, color: '#8C541A' },
        { id: 'e', type: 'simpleLine', color: '#000000', width: 0.5, offset: 1 },
        { id: 't', type: 'centroidMarker', marker: { type: 'marker', layers: [{ id: 'x', type: 'text', text: { expr: "'T-' || Parsel" }, size: 3, color: '#000000' }] } },
      ],
    };
    const cw = [v(0, 0), v(0, 20), v(20, 20), v(20, 0)];
    const e = polygon(cw, { Parsel: '12' });
    const out = new PrimitiveList();
    compileSymbol(sym, styledGeometry(e)!, { entity: e, index: 1 }, env(1000), out);
    expect(out.fills.map((f) => f.paint.kind)).toEqual(['solid', 'hatch']);
    const hatch = out.fills[1].paint;
    expect(hatch.kind === 'hatch' && [hatch.spacing, hatch.width, close(hatch.angle, Math.PI / 4)]).toEqual([2, 0.1, true]);
    // The edge moved 1 m inside the square.
    const xs = out.strokes[0].path.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...xs)).toBeCloseTo(19, 9);
    const text = out.markers[0];
    expect(text.style.kind === 'text' && text.style.text).toBe('T-12');
    expect(text.at).toEqual(v(10, 10));
  });
  it('evaluates data-defined size, rotation, colour and visibility per object', () => {
    const sym: MarkerSymbol = {
      type: 'marker',
      layers: [
        { id: 'a', type: 'shape', shape: 'triangle', size: { expr: 'Boy', fallback: 1 }, rotation: { expr: 'Aci' }, fill: { expr: "eğer(Tur = 'A', '#FF0000', '#0000FF')" }, unit: 'px' },
        { id: 'b', type: 'shape', shape: 'circle', size: 2, enabled: { expr: 'Tur = "B"' } },
      ],
    };
    const pt = (attrs: Record<string, string>): Entity => ({ id: 5, kind: 'point', layerId: 'a', p: v(1, 2), attrs });
    const out = new PrimitiveList();
    compileSymbol(sym, styledGeometry(pt({ Boy: '9', Aci: '90', Tur: 'A' }))!, { entity: pt({ Boy: '9', Aci: '90', Tur: 'A' }), index: 1 }, env(), out);
    expect(out.markers).toHaveLength(1);
    const m = out.markers[0].style;
    expect(m.kind === 'shape' && [m.size, m.common.unit, m.fill, close(m.common.rotation, Math.PI / 2)]).toEqual([9, 'px', '#FF0000', true]);
    const out2 = new PrimitiveList();
    compileSymbol(sym, styledGeometry(pt({ Tur: 'B' }))!, { entity: pt({ Tur: 'B' }), index: 1 }, env(), out2);
    expect(out2.markers.map((x) => (x.style.kind === 'shape' ? [x.style.size, x.style.fill] : null))).toEqual([
      [1, '#0000FF'],
      [2, null],
    ]);
  });
  it('turns a marker pattern into a tile and an image fill keeps the asset proportions', () => {
    const sym: FillSymbol = {
      type: 'fill',
      layers: [
        { id: 'p', type: 'patternFill', marker: { type: 'marker', layers: [{ id: 'd', type: 'shape', shape: 'cross', size: 1, stroke: '#2E7D32' }] }, spacingX: 4, spacingY: 3, stagger: true },
        { id: 'i', type: 'imageFill', asset: 'a1', tileSize: 5 },
      ],
    };
    const e = polygon(square(10));
    const out = new PrimitiveList();
    compileSymbol(sym, styledGeometry(e)!, { entity: e, index: 1 }, { ...env(500), assetAspect: () => 0.5 }, out);
    const [p, i] = out.fills.map((f) => f.paint);
    expect(p.kind === 'tile' && [p.size, p.tile.kind === 'markers' && p.tile.stagger]).toEqual([[2, 1.5], true]);
    expect(i.kind === 'tile' && i.size).toEqual([2.5, 1.25]);
  });
});

describe('renderers', () => {
  const red: LineSymbol = { type: 'line', layers: [{ id: 'r', type: 'simpleLine', color: '#FF0000', width: 0.3 }] };
  const blue: LineSymbol = { type: 'line', layers: [{ id: 'b', type: 'simpleLine', color: '#0000FF', width: 0.3 }] };
  const renv = () => ({ exprs: new ExprCache(), layerName: (id: string) => id });
  const e = (attrs: Record<string, string>) => line([v(0, 0), v(1, 0)], attrs);
  it('categorized, graduated and single', () => {
    const cat: LayerRenderer = { type: 'categorized', expr: 'Tur', categories: [{ value: 'yol', label: 'Yol', symbols: { line: red } }], other: { line: blue } };
    expect(resolveRenderer(cat, e({ Tur: 'yol' }), 1, renv())[0].symbols.line).toBe(red);
    expect(resolveRenderer(cat, e({ Tur: 'dere' }), 1, renv())[0].symbols.line).toBe(blue);
    const grad: LayerRenderer = { type: 'graduated', expr: '$uzunluk * 10', classes: [{ min: 0, max: 5, label: 'kısa', symbols: { line: red } }, { min: 5, max: 10, label: 'uzun', symbols: { line: blue } }] };
    expect(resolveRenderer(grad, e({}), 1, renv())[0].symbols.line).toBe(blue); // 10 is in the last class, max included
    expect(resolveRenderer({ type: 'single', symbols: { line: red } }, e({}), 1, renv())).toHaveLength(1);
  });
  it('rules: every match draws, children narrow the scale range, else catches the rest', () => {
    const r: LayerRenderer = {
      type: 'rules',
      rules: [
        { id: '1', label: 'Anayol', filter: "Tur = 'ana'", symbols: { line: red }, maxScale: 5000, children: [{ id: '1a', label: 'Yakın', minScale: 100, maxScale: 2000, symbols: { line: blue } }] },
        { id: '2', label: 'Hepsi', symbols: { line: blue } },
        { id: '3', label: 'Diğer', isElse: true, symbols: { line: red } },
      ],
    };
    const ana = resolveRenderer(r, e({ Tur: 'ana' }), 1, renv());
    expect(ana.map((x) => [x.symbols.line === red ? 'red' : 'blue', x.minScale, x.maxScale])).toEqual([
      ['red', undefined, 5000],
      ['blue', 100, 2000],
      ['blue', undefined, undefined],
    ]);
    const elseOnly: LayerRenderer = { type: 'rules', rules: [{ id: 'x', label: 'x', filter: 'yanlış', symbols: { line: blue } }, { id: 'y', label: 'y', isElse: true, symbols: { line: red } }] };
    expect(resolveRenderer(elseOnly, e({}), 1, renv()).map((x) => x.symbols.line)).toEqual([red]);
  });
  it('turns a layer’s simple look and a hatch object into symbols', () => {
    const set = symbolsOfLayerStyle({ color: 'fg-dim', lineType: 'dashed', lineWeight: 0.18, fill: '#7FB2E52E' });
    expect(set.line && 'layers' in set.line && set.line.layers[0]).toMatchObject({ type: 'simpleLine', width: 0.18, dash: [3, 1.5], unit: 'mm' });
    expect(set.fill && 'layers' in set.fill && set.fill.layers.map((l) => l.type)).toEqual(['simpleFill', 'simpleLine']);
    const h = hatchSymbolOf({ id: 9, kind: 'hatch', layerId: 'a', ring: square(4), pattern: { type: 'cross', angle: 30, spacing: 1.5 }, attrs: {} }, '#FF0000');
    expect(h.layers.map((l) => (l.type === 'hatchFill' ? [l.angle, l.spacing, l.unit] : l.type))).toEqual([
      [30, 1.5, 'm'],
      [120, 1.5, 'm'],
    ]);
  });
});

describe('library', () => {
  const sym = (id: string, path: string[], extra: Partial<LibraryItem> = {}): LibraryItem => ({ kind: 'symbol', id, name: id.toUpperCase(), path, symbol: { type: 'line', layers: [{ id: 'l', type: 'simpleLine', color: '#000000', width: 0.2 }] }, ...extra }) as LibraryItem;
  const make = () =>
    new StyleLibrary({
      items: [sym('mpyy.koy', ['MPYY', 'Uygulama', 'Sınırlar']), sym('mpyy.mahalle', ['MPYY', 'Uygulama', 'Sınırlar']), sym('cad.kesik', ['CAD'])],
      categories: [
        { path: ['MPYY'], order: 1 },
        { path: ['CAD'], order: 2 },
        { path: ['MPYY', 'Uygulama', 'Alanlar'], order: 2 },
        { path: ['MPYY', 'Uygulama', 'Sınırlar'], order: 1 },
      ],
    });
  it('keeps system items read-only; copies get new ids and can be changed', () => {
    const lib = make();
    expect(() => lib.remove('mpyy.koy')).toThrow('sistem öğesidir');
    expect(() => lib.rename('mpyy.koy', 'x')).toThrow();
    const changes: string[] = [];
    lib.events.on('changed', ({ source }) => changes.push(source));
    const c = lib.copy('mpyy.koy', 'user', { path: ['Benim'] });
    expect(c.id).not.toBe('mpyy.koy');
    expect(c.name).toBe('MPYY.KOY (kopya)');
    lib.rename(c.id, 'Köy sınırı (kalın)');
    expect(lib.get(c.id)).toMatchObject({ name: 'Köy sınırı (kalın)', source: 'user' });
    lib.remove(c.id);
    expect(lib.get(c.id)).toBeUndefined();
    expect(changes).toEqual(['user', 'user', 'user']);
  });
  it('builds an ordered category tree of any depth, with empty categories and search', () => {
    const lib = make();
    const tree = lib.tree();
    expect(tree.map((n) => n.name)).toEqual(['MPYY', 'CAD']);
    expect(tree[0].children[0].children.map((n) => [n.name, n.items.length])).toEqual([
      ['Sınırlar', 2],
      ['Alanlar', 0],
    ]);
    const found = lib.tree({ query: 'mahalle' });
    expect(found.map((n) => n.name)).toEqual(['MPYY']);
    expect(found[0].children[0].children.map((n) => n.name)).toEqual(['Sınırlar']);
  });
  it('a symbol copied into the project takes its user assets along; dump and load round-trip', () => {
    const lib = make();
    const asset = svgAsset('Cami', ['Benim'], '<svg viewBox="0 0 24 24"><path d="M0 0h24v24z"/></svg>', 'a-cami');
    lib.add('user', asset);
    lib.add('user', { kind: 'symbol', id: 'u-cami', name: 'Cami', path: ['Benim'], symbol: { type: 'marker', layers: [{ id: 's', type: 'svg', asset: 'a-cami', size: 4 }] } });
    expect(lib.usersOf('a-cami').map((i) => i.id)).toEqual(['u-cami']);
    const p = lib.copy('u-cami', 'project');
    expect(lib.items('project').map((i) => i.id).sort()).toEqual(['a-cami', p.id].sort());
    const saved = lib.dump('project');
    const other = make();
    other.load('project', saved.items, saved.categories);
    expect(other.symbol(p.id)?.type).toBe('marker');
  });
});

describe('style files', () => {
  const lib = () => {
    const l = new StyleLibrary();
    l.add('user', svgAsset('Bayrak', ['Semboller'], '<svg width="20" height="10"><rect width="20" height="10"/></svg>', 'a-flag'));
    l.add('user', { kind: 'symbol', id: 'u-flag', name: 'Bayrak', path: ['Semboller'], symbol: { type: 'marker', layers: [{ id: 's', type: 'svg', asset: 'a-flag', size: 5 }] } });
    return l;
  };
  it('exports a symbol with the assets it uses and imports it back', () => {
    const file = exportStyles(lib(), ['u-flag']);
    expect(file.items.map((i) => i.id).sort()).toEqual(['a-flag', 'u-flag']);
    const parsed = parseStyleFile(JSON.stringify(file));
    expect(parsed.issues).toEqual([]);
    const target = new StyleLibrary();
    expect(importStyles(target, parsed.file!, 'user', 'copy')).toMatchObject({ added: 2, replaced: 0, skipped: 0 });
    // Importing again as copies renames both and the symbol follows its asset.
    const again = importStyles(target, parsed.file!, 'user', 'copy');
    expect(again.added).toBe(2);
    const newAsset = again.renamed['a-flag'];
    const copy = target.get(again.renamed['u-flag']);
    expect(copy?.kind === 'symbol' && copy.symbol.layers[0].type === 'svg' && copy.symbol.layers[0].asset).toBe(newAsset);
    expect(importStyles(target, parsed.file!, 'user', 'skip')).toMatchObject({ added: 0, skipped: 2 });
    expect(importStyles(target, parsed.file!, 'user', 'replace')).toMatchObject({ replaced: 2 });
  });
  it('rejects broken files with reasons and cleans SVG drawings', () => {
    expect(parseStyleFile('{').issues[0]).toContain('JSON değil');
    expect(parseStyleFile('{"format":"x"}').issues[0]).toContain('stil dosyası');
    const bad = { format: 'kentos-style', version: 1, exported: '', items: [{ kind: 'symbol', id: 's', name: 'S', path: [], symbol: { type: 'line', layers: [{ id: 'a', type: 'simpleFill', color: 'kırmızı' }] } }] };
    expect(parseStyleFile(JSON.stringify(bad)).issues[0]).toContain('“line” sembolünde “simpleFill” katmanı olamaz');
    expect(validateSymbol({ type: 'line', layers: [{ id: 'a', type: 'simpleLine', color: 'kırmızı', width: 1, dash: [0, 0] }] })).toEqual([
      'sembol › katman 1: renk geçerli bir renk değil (#RRGGBB, #RRGGBBAA, ink, fg, fg-dim)',
      'sembol › katman 1: kesik deseninin toplamı sıfır olamaz',
    ]);
    const svg = sanitizeSvg('<?xml version="1.0"?><svg onload="alert(1)"><script>alert(2)</script><image href="http://x.test/a.png"/><rect fill="url(http://x.test/p)" onclick=\'x()\'/><use href="#k"/></svg>');
    expect(svg).toBe('<svg><image/><rect fill="none"/><use href="#k"/></svg>');
  });
});
