import { rotation, shapeBox, shapesBox, transformShape, translate, type Paint, type SvgDoc, type SvgShape } from '../../style/svg/svgModel';
import type { Matrix } from '../../style/svg/pathData';
import { h, type Child } from '../dom';
import { icon } from '../icons';
import { checkbox, numberInput, pair, row, select, textInput } from '../style/designerFields';
import type { CanvasOptions, ToolId } from './svgCanvas';

/**
 * The SVG editor's right column: with nothing selected, the canvas (size,
 * grid, snapping, tile preview, polygon sides, preview colours); with a
 * selection, its paint, stroke, opacity and geometry, and the arrange,
 * align, flip, group and delete actions.
 */

export interface PropsHost {
  readonly doc: SvgDoc;
  readonly selection: ReadonlySet<string>;
  readonly options: CanvasOptions;
  readonly tool: ToolId;
  /** One undo step (typing into one field within a second coalesces). */
  change(key: string, fn: () => void): void;
  setOption(patch: Partial<CanvasOptions>): void;
  select(ids: string[]): void;
  editNodes(id: string | null): void;
  action(name: ActionName): void;
}

export type ActionName = 'front' | 'back' | 'raise' | 'lower' | 'group' | 'ungroup' | 'duplicate' | 'delete' | 'flipH' | 'flipV' | 'rot90' | 'alignL' | 'alignC' | 'alignR' | 'alignT' | 'alignM' | 'alignB';

const PAINTS: { value: string; label: string }[] = [
  { value: 'none', label: 'Yok' },
  { value: 'fill', label: 'Sembol rengi' },
  { value: 'stroke', label: 'İkinci renk' },
  { value: 'fixed', label: 'Sabit renk' },
];

function paintField(label: string, value: Paint | null, onChange: (p: Paint) => void): HTMLElement {
  const kind = value === null ? 'none' : value === 'none' || value === 'fill' || value === 'stroke' ? value : 'fixed';
  const host = h('div', { class: 'svgp__paint' });
  const render = (k: string, color: string) => {
    const sel = select(k, PAINTS, (v) => {
      if (v === 'fixed') {
        onChange(color);
        render('fixed', color);
      } else {
        onChange(v);
        render(v, color);
      }
    }, label);
    const picker = h('input', { type: 'color', class: 'svgp__color', value: color.slice(0, 7), 'aria-label': `${label} rengi` });
    picker.addEventListener('input', () => onChange(picker.value.toUpperCase()));
    host.replaceChildren(sel, ...(k === 'fixed' ? [picker] : []));
  };
  render(kind, kind === 'fixed' && value ? value : '#E0457B');
  return row(label, host, value === null ? 'Seçilenlerde farklı' : undefined);
}

const same = <T>(list: readonly T[]): T | null => (list.length && list.every((v) => v === list[0]) ? list[0] : null);

export function renderProps(host: PropsHost): HTMLElement {
  const sel = host.doc.shapes.filter((s) => host.selection.has(s.id));
  const body = sel.length ? selectionProps(host, sel) : canvasProps(host);
  // The polygon tool's own settings stay on top while it is chosen.
  return host.tool === 'polygon' ? h('div', { class: 'sdf__form' }, polygonOptions(host), body) : body;
}

function polygonOptions(host: PropsHost): HTMLElement {
  const o = host.options;
  return h(
    'div',
    { class: 'svgp__group svgp__group--tool' },
    h('div', { class: 'sdf__grouptitle' }, 'Çokgen aracı'),
    pair(row('Kenar sayısı', numberInput(o.sides, (v) => host.setOption({ sides: Math.max(3, Math.round(v)) }), { label: 'Kenar sayısı', min: 3, max: 24, step: 1 })), row('Biçim', checkbox(o.star, (v) => host.setOption({ star: v }), 'Yıldız'))),
  );
}

function selectionProps(host: PropsHost, sel: SvgShape[]): HTMLElement {
  const set = (key: string, fn: (s: SvgShape) => SvgShape) =>
    host.change(key, () => {
      host.doc.shapes = host.doc.shapes.map((s) => (host.selection.has(s.id) ? fn(s) : s));
    });
  const parts: Child[] = [
    h('div', { class: 'svgp__title' }, sel.length === 1 ? KIND[sel[0].kind] : `${sel.length} şekil`),
    paintField('Dolgu', same(sel.map((s) => s.fill)), (p) => set('fill', (s) => ({ ...s, fill: p }))),
    paintField('Çizgi', same(sel.map((s) => s.stroke)), (p) => set('stroke', (s) => ({ ...s, stroke: p }))),
    pair(
      row('Çizgi kalınlığı', numberInput(same(sel.map((s) => s.strokeWidth)) ?? sel[0].strokeWidth, (v) => set('sw', (s) => ({ ...s, strokeWidth: Math.max(0, v) })), { label: 'Çizgi kalınlığı', min: 0, step: 0.5 })),
      row('Saydamlık', numberInput(Math.round((1 - (same(sel.map((s) => s.opacity ?? 1)) ?? 1)) * 100), (v) => set('op', (s) => ({ ...s, opacity: v > 0 ? 1 - Math.min(100, v) / 100 : undefined })), { label: 'Saydamlık', unit: '%', min: 0, max: 100, step: 5 })),
    ),
  ];
  if (sel.length === 1) parts.push(geometry(sel[0], (key, s) => host.change(key, () => (host.doc.shapes = host.doc.shapes.map((x) => (x.id === s.id ? s : x))))));
  const b = (name: ActionName, label: string, text: Child) => {
    const el = h('button', { class: 'ibtn svgp__act', type: 'button', title: label, 'aria-label': label }, text);
    el.addEventListener('click', () => host.action(name));
    return el;
  };
  const box = shapesBox(sel)!;
  parts.push(
    h('div', { class: 'svgp__group' }, h('div', { class: 'sdf__grouptitle' }, 'Konum'), h('div', { class: 'svgp__acts' }, b('alignL', 'Sola hizala', '⇤'), b('alignC', 'Yatay ortala', '↔'), b('alignR', 'Sağa hizala', '⇥'), b('alignT', 'Üste hizala', '⤒'), b('alignM', 'Dikey ortala', '↕'), b('alignB', 'Alta hizala', '⤓')), h('div', { class: 'sdf__hint' }, sel.length > 1 ? 'Birden çok şekil birbirine, tek şekil tuvale hizalanır.' : 'Tek şekil tuvale hizalanır.')),
    h(
      'div',
      { class: 'svgp__group' },
      h('div', { class: 'sdf__grouptitle' }, 'Düzen'),
      h(
        'div',
        { class: 'svgp__acts' },
        b('front', 'En öne getir', '⇈'),
        b('raise', 'Bir öne', '↑'),
        b('lower', 'Bir arkaya', '↓'),
        b('back', 'En arkaya gönder', '⇊'),
        b('flipH', 'Yatay çevir', '⇋'),
        b('flipV', 'Dikey çevir', '⥮'),
        b('rot90', '90° döndür', '⟳'),
      ),
      h(
        'div',
        { class: 'svgp__acts' },
        b('group', 'Grupla (Ctrl+G)', 'Grupla'),
        b('ungroup', 'Grubu çöz (Ctrl+Shift+G)', 'Çöz'),
        b('duplicate', 'Çoğalt (Ctrl+D)', icon('copy', 15)),
        b('delete', 'Sil (Delete)', icon('trash', 15)),
      ),
    ),
    h('div', { class: 'sdf__hint' }, `Kutu: ${fmt(box.minX)}, ${fmt(box.minY)} · ${fmt(box.maxX - box.minX)} × ${fmt(box.maxY - box.minY)}`),
  );
  if (sel.length === 1 && sel[0].kind === 'path') {
    const edit = h('button', { class: 'btn btn--small', type: 'button' }, icon('vertex', 14), 'Düğümleri düzenle');
    edit.addEventListener('click', () => host.editNodes(sel[0].id));
    parts.push(edit);
  }
  return h('div', { class: 'sdf__form' }, parts);
}

const KIND: Record<SvgShape['kind'], string> = { rect: 'Dikdörtgen', ellipse: 'Elips', path: 'Yol', text: 'Yazı' };
const fmt = (v: number) => String(Math.round(v * 100) / 100);

function geometry(s: SvgShape, put: (key: string, s: SvgShape) => void): HTMLElement {
  const num = (label: string, value: number, key: string, apply: (v: number) => SvgShape, opts: { min?: number; unit?: string } = {}) =>
    row(label, numberInput(value, (v) => put(key, apply(v)), { label, min: opts.min, unit: opts.unit, step: 1 }));
  const parts: Child[] = [];
  switch (s.kind) {
    case 'rect':
      parts.push(
        pair(num('X', s.x, 'x', (v) => ({ ...s, x: v })), num('Y', s.y, 'y', (v) => ({ ...s, y: v }))),
        pair(num('Genişlik', s.w, 'w', (v) => ({ ...s, w: Math.max(0.01, v) }), { min: 0.01 }), num('Yükseklik', s.h, 'h', (v) => ({ ...s, h: Math.max(0.01, v) }), { min: 0.01 })),
        pair(num('Köşe yarıçapı', s.r ?? 0, 'r', (v) => ({ ...s, r: v > 0 ? v : undefined }), { min: 0 }), num('Döndürme', s.rotate ?? 0, 'rot', (v) => ({ ...s, rotate: v || undefined }), { unit: '°' })),
      );
      break;
    case 'ellipse':
      parts.push(
        pair(num('Merkez X', s.cx, 'cx', (v) => ({ ...s, cx: v })), num('Merkez Y', s.cy, 'cy', (v) => ({ ...s, cy: v }))),
        pair(num('Yarıçap X', s.rx, 'rx', (v) => ({ ...s, rx: Math.max(0.01, v) }), { min: 0.01 }), num('Yarıçap Y', s.ry, 'ry', (v) => ({ ...s, ry: Math.max(0.01, v) }), { min: 0.01 })),
        num('Döndürme', s.rotate ?? 0, 'rot', (v) => ({ ...s, rotate: v || undefined }), { unit: '°' }),
      );
      break;
    case 'text':
      parts.push(
        row('Metin', textInput(s.text, (v) => put('text', { ...s, text: v }), { label: 'Metin' })),
        pair(num('X', s.x, 'x', (v) => ({ ...s, x: v })), num('Y (taban çizgisi)', s.y, 'y', (v) => ({ ...s, y: v }))),
        pair(num('Boyut', s.size, 'size', (v) => ({ ...s, size: Math.max(0.1, v) }), { min: 0.1 }), num('Döndürme', s.rotate ?? 0, 'rot', (v) => ({ ...s, rotate: v || undefined }), { unit: '°' })),
        pair(
          row('Yazı tipi', select(s.font, [{ value: 'sans', label: 'Arial' }, { value: 'serif', label: 'Times' }], (v) => put('font', { ...s, font: v }), 'Yazı tipi')),
          row('Kalınlık', select(String(s.weight), [{ value: '400', label: 'Normal' }, { value: '700', label: 'Kalın' }, { value: '900', label: 'Siyah' }], (v) => put('weight', { ...s, weight: Number(v) as 400 | 700 | 900 }), 'Kalınlık')),
        ),
        row('Hizalama', select(s.anchor, [{ value: 'start', label: 'Soldan' }, { value: 'middle', label: 'Ortadan' }, { value: 'end', label: 'Sağdan' }], (v) => put('anchor', { ...s, anchor: v }), 'Hizalama')),
      );
      break;
    case 'path': {
      const nodes = s.subs.reduce((n, sp) => n + sp.nodes.length, 0);
      parts.push(h('div', { class: 'sdf__hint' }, `${s.subs.length} parça, ${nodes} düğüm. Çift tık ya da “Düğümleri düzenle” ile düğümler sürüklenir.`));
      if (s.subs.length === 1) parts.push(row('Uçlar', checkbox(s.subs[0].closed, (v) => put('closed', { ...s, subs: [{ ...s.subs[0], closed: v }] }), 'Kapalı şekil')));
      break;
    }
  }
  return h('div', { class: 'svgp__group' }, h('div', { class: 'sdf__grouptitle' }, 'Geometri'), parts);
}

function canvasProps(host: PropsHost): HTMLElement {
  const o = host.options;
  const doc = host.doc;
  const swatch = (label: string, value: string, key: 'ink' | 'second') => {
    const picker = h('input', { type: 'color', class: 'svgp__color', value, 'aria-label': label });
    picker.addEventListener('input', () => host.setOption({ [key]: picker.value }));
    return row(label, picker);
  };
  return h(
    'div',
    { class: 'sdf__form' },
    h('div', { class: 'svgp__title' }, 'Tuval'),
    pair(
      row('Genişlik', numberInput(doc.width, (v) => host.change('dw', () => (doc.width = Math.max(1, v))), { label: 'Genişlik', min: 1, step: 5 })),
      row('Yükseklik', numberInput(doc.height, (v) => host.change('dh', () => (doc.height = Math.max(1, v))), { label: 'Yükseklik', min: 1, step: 5 })),
    ),
    h('div', { class: 'sdf__hint' }, 'Birim çizimin kendi birimidir; semboldeki boyutu sembol belirler (genişlik = işaret boyu).'),
    row('Izgara aralığı', numberInput(o.grid, (v) => host.setOption({ grid: Math.max(0, v) }), { label: 'Izgara aralığı', min: 0, step: 1 })),
    checkbox(o.snapGrid, (v) => host.setOption({ snapGrid: v }), 'Izgaraya kenetle'),
    checkbox(o.snapObjects, (v) => host.setOption({ snapObjects: v }), 'Şekillerin köşe, orta ve düğümlerine kenetle'),
    checkbox(o.tile, (v) => host.setOption({ tile: v }), 'Döşeme önizlemesi (desen olarak yan yana)'),
    h(
      'div',
      { class: 'svgp__group' },
      h('div', { class: 'sdf__grouptitle' }, 'Önizleme renkleri'),
      pair(swatch('Sembol rengi', o.ink.startsWith('#') ? o.ink.slice(0, 7) : '#000000', 'ink'), swatch('İkinci renk', o.second.slice(0, 7), 'second')),
      h('div', { class: 'sdf__hint' }, 'Yalnızca burada denemek içindir: haritada sembol hangi rengi verirse o boyanır.'),
    ),
  );
}

/** The matrix of an alignment or flip action on the selection. */
export function actionMatrix(name: ActionName, shapes: readonly SvgShape[], doc: SvgDoc): (s: SvgShape) => Matrix | null {
  const all = shapesBox(shapes)!;
  const ref = shapes.length > 1 ? all : { minX: 0, minY: 0, maxX: doc.width, maxY: doc.height };
  const cx = (all.minX + all.maxX) / 2;
  const cy = (all.minY + all.maxY) / 2;
  switch (name) {
    case 'flipH':
      return () => [-1, 0, 0, 1, 2 * cx, 0];
    case 'flipV':
      return () => [1, 0, 0, -1, 0, 2 * cy];
    case 'rot90':
      return () => rotation(90, cx, cy);
    default: {
      // Alignment moves each shape (several) or the whole selection (one) against the reference box.
      const move = (b: { minX: number; minY: number; maxX: number; maxY: number }): Matrix | null => {
        switch (name) {
          case 'alignL':
            return translate(ref.minX - b.minX, 0);
          case 'alignR':
            return translate(ref.maxX - b.maxX, 0);
          case 'alignC':
            return translate((ref.minX + ref.maxX) / 2 - (b.minX + b.maxX) / 2, 0);
          case 'alignT':
            return translate(0, ref.minY - b.minY);
          case 'alignB':
            return translate(0, ref.maxY - b.maxY);
          case 'alignM':
            return translate(0, (ref.minY + ref.maxY) / 2 - (b.minY + b.maxY) / 2);
          default:
            return null;
        }
      };
      return shapes.length > 1 ? (s) => move(shapeBox(s)) : () => move(all);
    }
  }
}

export { transformShape };
