import type { AppContext } from '../../app/context';
import type { LibraryAsset } from '../../model/style';
import { resolveColor } from '../../render/color';
import { sanitizeSvg, svgAsset } from '../../style/file';
import { svgText } from '../../style/svg/exportSvg';
import { importSummary } from '../../style/svg/importSvg';
import { newDoc, shapeId, transformShape, translate, type SvgDoc, type SvgShape } from '../../style/svg/svgModel';
import { h, replaceChildren } from '../dom';
import { icon } from '../icons';
import { Dialog } from '../widgets/Dialog';
import { readSvg } from './readSvg';
import { SvgCanvas, type CanvasHost, type CanvasOptions, type ToolId } from './svgCanvas';
import { SvgFiles, type FileHost } from './svgFile';
import { actionMatrix, renderProps, type ActionName, type PropsHost } from './svgProps';

/**
 * KentOS's own SVG editor (docs/STYLE.md §7) for the drawings symbols use:
 * pictograms of markers and motifs of pattern fills. Tools on the left with
 * the shape list, the drawing in the middle, the chosen shape's properties
 * on the right. Its own undo; Kaydet writes the drawing to the library as
 * an SVG asset (a system drawing is saved as the user's copy).
 */

export interface SvgEditorOptions {
  /** An SVG asset of the library to open; a new drawing when absent. */
  id?: string;
  path?: readonly string[];
  onSaved?(id: string): void;
}

const TOOLS: { id: ToolId; label: string; key: string; icon: string; hint: string }[] = [
  { id: 'select', label: 'Seç', key: 'V', icon: 'select', hint: 'Tıkla, sürükle, köşelerden boyutlandır, üstteki düğmeden döndür' },
  { id: 'node', label: 'Düğüm', key: 'A', icon: 'vertex', hint: 'Yolun düğümlerini ve kollarını düzenler (yola çift tık da açar)' },
  { id: 'rect', label: 'Dikdörtgen', key: 'R', icon: 'rectangle', hint: 'Sürükleyin; Shift kare, Alt merkezden' },
  { id: 'ellipse', label: 'Elips', key: 'E', icon: 'ellipse', hint: 'Sürükleyin; Shift daire, Alt merkezden' },
  { id: 'polygon', label: 'Çokgen', key: 'P', icon: 'regularPolygon', hint: 'Merkezden sürükleyin; kenar sayısı ve yıldız sağda' },
  { id: 'line', label: 'Kırık çizgi', key: 'L', icon: 'polyline', hint: 'Tıklayarak noktalar; çift tık ya da Enter bitirir, ilk noktaya tık kapatır' },
  { id: 'pen', label: 'Kalem', key: 'B', icon: 'spline', hint: 'Tık köşe, sürükle eğri düğümü; ilk düğüme tık kapatır, Enter bitirir' },
  { id: 'text', label: 'Yazı', key: 'T', icon: 'text', hint: 'Tıklayın, metni sağdan yazın' },
];

const KIND: Record<SvgShape['kind'], string> = { rect: 'Dikdörtgen', ellipse: 'Elips', path: 'Yol', text: 'Yazı' };

export function openSvgEditor(ctx: AppContext, opts: SvgEditorOptions = {}): void {
  const lib = ctx.styles.library;
  const asset = opts.id ? lib.get(opts.id) : undefined;
  let doc = newDoc(100, 100);
  let skipped: string[] = [];
  if (asset) {
    if (asset.kind !== 'asset' || asset.format !== 'svg') {
      ctx.log.warn('Yalnızca SVG çizimleri düzenlenebilir; görüntüler (PNG, JPEG) değişmez.');
      return;
    }
    const read = readSvg(asset.data);
    if ('error' in read) {
      ctx.log.error(`“${asset.name}” açılamadı: ${read.error}`);
      return;
    }
    doc = read.doc;
    skipped = importSummary(read.report).lost;
  }
  new SvgEditor(ctx, doc, asset?.kind === 'asset' ? asset : null, opts, skipped);
}

class SvgEditor implements CanvasHost, PropsHost, FileHost {
  readonly ctx: AppContext;
  doc: SvgDoc;
  selection = new Set<string>();
  tool: ToolId = 'select';
  nodeEdit: string | null = null;
  options: CanvasOptions;
  original: LibraryAsset | null;
  private editable: boolean;
  private readonly opts: SvgEditorOptions;
  private readonly dialog: Dialog;
  readonly canvas: SvgCanvas;
  private readonly files: SvgFiles;
  private readonly toolsEl: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly propsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly zoomEl: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly pathInput: HTMLInputElement;
  private readonly past: string[] = [];
  private readonly future: string[] = [];
  private pending: string | null = null;
  private lastKey = { key: '', at: 0 };
  private savedJson: string;

  constructor(ctx: AppContext, doc: SvgDoc, original: LibraryAsset | null, opts: SvgEditorOptions, skipped: string[]) {
    this.ctx = ctx;
    this.doc = doc;
    this.original = original;
    this.opts = opts;
    this.editable = !!original && ctx.styles.library.canEdit(original.id);
    const pal = ctx.view.palette;
    this.options = { grid: Math.max(1, Math.round(doc.width / 20)), snapGrid: true, snapObjects: true, tile: false, sides: 6, star: false, ink: resolveColor('ink', pal), second: '#2B83BA', paper: resolveColor('paper', pal) };
    this.savedJson = original ? JSON.stringify(doc) : '';
    this.canvas = new SvgCanvas(this);
    this.canvas.el.dataset.escape = 'local';
    this.files = new SvgFiles(this);
    this.toolsEl = h('div', { class: 'svge__tools' });
    this.listEl = h('div', { class: 'svge__list' });
    this.propsEl = h('div', { class: 'svge__props' });
    this.statusEl = h('div', { class: 'sdes__status', role: 'status' });
    this.zoomEl = h('span', { class: 'sdes__zoom num' });
    const name = original ? (this.editable ? original.name : `${original.name} (kopya)`) : 'Yeni çizim';
    this.nameInput = h('input', { class: 'field', value: name, 'aria-label': 'Çizim adı', spellcheck: 'false' });
    this.pathInput = h('input', { class: 'field', value: (this.editable && original ? original.path : (opts.path ?? ['Çizimlerim'])).join(' / '), 'aria-label': 'Kategori', spellcheck: 'false' });
    const bar = (label: string, text: string, run: () => void) => {
      const b = h('button', { class: 'ibtn', type: 'button', title: label, 'aria-label': label }, text);
      b.addEventListener('click', run);
      return b;
    };
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Vazgeç');
    cancel.addEventListener('click', () => this.dialog.request());
    const save = h('button', { class: 'btn btn--primary', type: 'button' }, icon('check', 16), 'Kaydet');
    save.addEventListener('click', () => this.save(false));
    const root = h(
      'div',
      { class: 'svge' },
      h('aside', { class: 'svge__left' }, this.toolsEl, h('div', { class: 'sdes__title svge__ltitle' }, 'Şekiller (öndeki üstte)'), this.listEl),
      h(
        'section',
        { class: 'svge__center' },
        h('div', { class: 'sdes__pbar svge__pbar' }, ...this.files.buttons, h('div', { class: 'dialog__foot-spacer' }), bar('Uzaklaş', '−', () => this.canvas.zoomBy(1 / 1.25)), this.zoomEl, bar('Yakınlaş', '+', () => this.canvas.zoomBy(1.25)), bar('Tuvale sığdır (0)', '⤢', () => this.canvas.fit())),
        this.files.reference.bar,
        this.canvas.el,
        this.files.source.el,
      ),
      h('aside', { class: 'svge__right' }, this.propsEl),
    );
    root.addEventListener('keydown', (e) => this.key(e));
    this.files.attach(root);
    this.dialog = new Dialog({
      title: 'SVG çizim düzenleyicisi',
      width: 1320,
      className: 'dialog--sdesign dialog--svge',
      content: [root],
      footer: [h('label', { class: 'sdes__flabel' }, 'Ad', this.nameInput), h('label', { class: 'sdes__flabel sdes__flabel--path' }, 'Kategori', this.pathInput), this.statusEl, h('div', { class: 'dialog__foot-spacer' }), cancel, this.files.saveAsButton, save],
      beforeClose: () => this.confirmClose(),
      stack: true,
    });
    if (skipped.length) this.status(`Açılırken: ${skipped.join(', ')}.`, 'warn');
    else if (original && !this.editable) this.status('Sistem çizimi: kaydedince Kitaplığım\'a kopyası yazılır.');
    this.refresh();
    queueMicrotask(() => this.canvas.el.focus());
  }

  // ── Host interfaces ──────────────────────────────────────────────────

  begin(): void {
    this.pending ??= JSON.stringify(this.doc);
  }

  commit(label: string): void {
    const before = this.pending;
    this.pending = null;
    if (before && label && before !== JSON.stringify(this.doc)) {
      this.past.push(before);
      if (this.past.length > 100) this.past.shift();
      this.future.length = 0;
      this.lastKey = { key: '', at: 0 };
    }
    this.refresh();
  }

  changed(): void {
    this.canvas.render();
  }

  change(key: string, fn: () => void): void {
    const now = performance.now();
    if (key !== this.lastKey.key || now - this.lastKey.at > 1000) {
      this.past.push(JSON.stringify(this.doc));
      if (this.past.length > 100) this.past.shift();
      this.future.length = 0;
    }
    this.lastKey = { key, at: now };
    fn();
    this.canvas.render();
    this.renderList();
    this.renderTitle();
    this.files.refresh();
  }

  setOption(patch: Partial<CanvasOptions>): void {
    this.options = { ...this.options, ...patch };
    if ('tile' in patch) this.canvas.fit();
    this.refresh();
  }

  select(ids: string[]): void {
    this.selection = new Set(ids);
    if (this.nodeEdit && !this.selection.has(this.nodeEdit)) this.nodeEdit = null;
    this.refresh();
  }

  setTool(t: ToolId): void {
    this.canvas.cancelDraft();
    this.tool = t;
    if (t !== 'node') this.nodeEdit = null;
    else if (!this.nodeEdit) {
      const path = this.doc.shapes.find((s) => this.selection.has(s.id) && s.kind === 'path');
      this.nodeEdit = path?.id ?? null;
      if (!path) this.status('Düğüm düzenlemek için bir yol seçin ya da yola çift tıklayın.');
    }
    this.refresh();
  }

  editNodes(id: string | null): void {
    this.nodeEdit = id;
    this.tool = id ? 'node' : 'select';
    if (id) this.selection = new Set([id]);
    this.refresh();
  }

  status(text: string, kind: 'ok' | 'warn' = 'ok'): void {
    this.statusEl.textContent = text;
    this.statusEl.dataset.kind = kind;
  }

  action(name: ActionName): void {
    const sel = this.doc.shapes.filter((s) => this.selection.has(s.id));
    if (!sel.length) return;
    const ids = this.selection;
    const shapes = this.doc.shapes;
    this.change(`act:${name}`, () => {
      switch (name) {
        case 'delete':
          this.doc.shapes = shapes.filter((s) => !ids.has(s.id));
          this.selection = new Set();
          this.nodeEdit = null;
          return;
        case 'duplicate': {
          const group = new Map<string, string>();
          const copies = sel.map((s) => {
            const g = s.group ? (group.get(s.group) ?? group.set(s.group, shapeId()).get(s.group)) : undefined;
            return { ...transformShape(structuredClone(s), translate(this.options.grid || 2, this.options.grid || 2)), id: shapeId(), group: g };
          });
          this.doc.shapes = [...shapes, ...copies];
          this.selection = new Set(copies.map((c) => c.id));
          return;
        }
        case 'front':
        case 'back': {
          const rest = shapes.filter((s) => !ids.has(s.id));
          this.doc.shapes = name === 'front' ? [...rest, ...sel] : [...sel, ...rest];
          return;
        }
        case 'raise':
        case 'lower': {
          const list = [...shapes];
          const order = name === 'raise' ? [...list.keys()].reverse() : [...list.keys()];
          for (const i of order) {
            const j = name === 'raise' ? i + 1 : i - 1;
            if (ids.has(list[i].id) && j >= 0 && j < list.length && !ids.has(list[j].id)) [list[i], list[j]] = [list[j], list[i]];
          }
          this.doc.shapes = list;
          return;
        }
        case 'group': {
          const g = shapeId();
          this.doc.shapes = shapes.map((s) => (ids.has(s.id) ? { ...s, group: g } : s));
          // Group members sit together in the stack (the file writes them in one <g>).
          const members = this.doc.shapes.filter((s) => ids.has(s.id));
          const at = this.doc.shapes.findIndex((s) => ids.has(s.id));
          const rest = this.doc.shapes.filter((s) => !ids.has(s.id));
          rest.splice(at, 0, ...members);
          this.doc.shapes = rest;
          return;
        }
        case 'ungroup':
          this.doc.shapes = shapes.map((s) => (ids.has(s.id) ? { ...s, group: undefined } : s));
          return;
        default: {
          const matrix = actionMatrix(name, sel, this.doc);
          this.doc.shapes = shapes.map((s) => {
            if (!ids.has(s.id)) return s;
            const m = matrix(s);
            return m ? transformShape(s, m) : s;
          });
        }
      }
    });
    this.refresh();
  }

  // ── Rendering ────────────────────────────────────────────────────────

  private refresh(): void {
    this.canvas.render();
    this.renderTools();
    this.renderList();
    replaceChildren(this.propsEl, renderProps(this));
    this.zoomed(this.canvas.scale);
    this.renderTitle();
    this.files.refresh();
  }

  private renderTitle(): void {
    this.dialog?.el.querySelector('.dialog__title')?.replaceChildren(`SVG çizim düzenleyicisi${this.dirty ? ' •' : ''}`);
  }

  private renderTools(): void {
    replaceChildren(
      this.toolsEl,
      TOOLS.map((t) => {
        const b = h('button', { class: 'svge__tool', type: 'button', 'aria-pressed': String(this.tool === t.id), title: `${t.label} (${t.key}): ${t.hint}` }, icon(t.icon, 18), h('span', null, t.label), h('kbd', null, t.key));
        b.addEventListener('click', () => this.setTool(t.id));
        return b;
      }),
    );
  }

  private renderList(): void {
    const rows = [...this.doc.shapes].reverse().map((s) => {
      const eye = h('button', { class: 'ibtn', type: 'button', 'aria-label': s.hidden ? 'Göster' : 'Gizle', title: s.hidden ? 'Göster' : 'Gizle' }, icon(s.hidden ? 'eyeOff' : 'eye', 14));
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        this.change('hide', () => (this.doc.shapes = this.doc.shapes.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden || undefined } : x))));
      });
      const r = h('div', { class: 'svge__row', 'aria-selected': String(this.selection.has(s.id)) }, eye, h('span', null, s.name ?? (s.kind === 'text' ? `Yazı “${s.text}”` : KIND[s.kind])), s.group ? h('span', { class: 'svge__grp', title: 'Grupta' }, '▣') : null);
      r.addEventListener('click', (e) => {
        if ((e as MouseEvent).shiftKey) {
          const next = new Set(this.selection);
          next.has(s.id) ? next.delete(s.id) : next.add(s.id);
          this.select([...next]);
        } else this.select([s.id]);
      });
      return r;
    });
    replaceChildren(this.listEl, rows.length ? rows : h('p', { class: 'sdes__note' }, 'Henüz şekil yok: soldaki araçlarla çizin ya da bir SVG dosyası ekleyin.'));
  }

  // ── Keys, history, files ─────────────────────────────────────────────

  private key(e: KeyboardEvent): void {
    const inField = !!(e.target as HTMLElement).closest('input, textarea, select');
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (k === 'Escape' && !inField) {
      e.preventDefault();
      if (this.canvas.cancelDraft()) return;
      if (this.nodeEdit) return this.editNodes(null);
      if (this.selection.size) return this.select([]);
      this.dialog.request();
      return;
    }
    if (inField) return;
    if (ctrl && k.toLowerCase() === 'z') {
      e.preventDefault();
      return e.shiftKey ? this.redo() : this.undo();
    }
    if (ctrl && k.toLowerCase() === 'y') return (e.preventDefault(), this.redo());
    if (ctrl && k.toLowerCase() === 'd') return (e.preventDefault(), this.action('duplicate'));
    if (ctrl && k.toLowerCase() === 'g') return (e.preventDefault(), this.action(e.shiftKey ? 'ungroup' : 'group'));
    if (ctrl && k.toLowerCase() === 'a') return (e.preventDefault(), this.select(this.doc.shapes.filter((s) => !s.hidden).map((s) => s.id)));
    if (ctrl) return;
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      if (this.nodeEdit && this.canvas.deleteNode()) return;
      return this.action('delete');
    }
    if (k === 'Enter') return (e.preventDefault(), this.canvas.finishDraft(false));
    if (k.startsWith('Arrow') && this.selection.size) {
      e.preventDefault();
      const step = (this.options.grid || 1) * (e.shiftKey ? 5 : 1);
      const d: [number, number] = k === 'ArrowLeft' ? [-step, 0] : k === 'ArrowRight' ? [step, 0] : k === 'ArrowUp' ? [0, -step] : [0, step];
      return this.change('nudge', () => (this.doc.shapes = this.doc.shapes.map((s) => (this.selection.has(s.id) ? transformShape(s, translate(d[0], d[1])) : s))));
    }
    if (k === '0') return this.canvas.fit();
    if (k === '+' || k === '=') return this.canvas.zoomBy(1.25);
    if (k === '-') return this.canvas.zoomBy(1 / 1.25);
    const tool = TOOLS.find((t) => t.key === k.toLocaleUpperCase('tr').replace('İ', 'I'));
    if (tool) this.setTool(tool.id);
  }

  get dirty(): boolean {
    return JSON.stringify(this.doc) !== this.savedJson;
  }

  private restore(json: string): void {
    this.doc = JSON.parse(json) as SvgDoc;
    this.selection = new Set([...this.selection].filter((id) => this.doc.shapes.some((s) => s.id === id)));
    if (this.nodeEdit && !this.doc.shapes.some((s) => s.id === this.nodeEdit)) this.nodeEdit = null;
    this.lastKey = { key: '', at: 0 };
    this.refresh();
  }

  private undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(JSON.stringify(this.doc));
    this.restore(prev);
  }

  private redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(JSON.stringify(this.doc));
    this.restore(next);
  }

  // ── Files (svgFile.ts) ───────────────────────────────────────────────

  get name(): string {
    return this.nameInput.value.trim() || 'Adsız çizim';
  }

  get path(): string[] {
    return this.pathInput.value.split('/').map((s) => s.trim()).filter(Boolean);
  }

  zoomed(scale: number): void {
    this.zoomEl.textContent = `%${Math.round(scale * 100)}`;
  }

  underlay(world: SVGGElement): void {
    // The canvas may draw before the files are set up.
    this.files?.underlay(world);
  }

  /** Another drawing in the window: a file opened as new, or a library drawing; history starts anew. */
  open(doc: SvgDoc, asset: LibraryAsset | null, name: string): void {
    this.doc = doc;
    this.past.length = 0;
    this.future.length = 0;
    this.pending = null;
    this.lastKey = { key: '', at: 0 };
    this.original = asset;
    this.editable = !!asset && this.ctx.styles.library.canEdit(asset.id);
    this.nameInput.value = name;
    if (asset) this.pathInput.value = asset.path.join(' / ');
    this.savedJson = asset ? JSON.stringify(doc) : '';
    this.selection = new Set();
    this.nodeEdit = null;
    this.options = { ...this.options, grid: Math.max(1, Math.round(doc.width / 20)) };
    this.refresh();
    this.canvas.fit();
  }

  /** The drawing was saved as this library item (Farklı kaydet). */
  adopt(asset: LibraryAsset): void {
    this.original = asset;
    this.editable = true;
    this.nameInput.value = asset.name;
    this.pathInput.value = asset.path.join(' / ');
    this.savedJson = JSON.stringify(this.doc);
    this.renderTitle();
    this.opts.onSaved?.(asset.id);
  }

  private save(thenClose: boolean): boolean {
    const lib = this.ctx.styles.library;
    if (!this.doc.shapes.some((s) => !s.hidden)) {
      this.status('Boş çizim kaydedilmez: önce bir şekil çizin.', 'warn');
      return false;
    }
    const svg = sanitizeSvg(svgText(this.doc, { reference: this.files.keptReference() }));
    const name = this.nameInput.value.trim() || 'Adsız çizim';
    const path = this.pathInput.value.split('/').map((s) => s.trim()).filter(Boolean);
    let id: string;
    if (this.original && this.editable) {
      lib.update(this.original.id, { name, path: path.length ? path : ['Çizimlerim'], data: svg, width: this.doc.width, height: this.doc.height });
      id = this.original.id;
    } else {
      const asset = svgAsset(name, path.length ? path : ['Çizimlerim'], svg);
      lib.add('user', asset);
      id = asset.id;
      this.original = asset;
      this.editable = true;
    }
    this.savedJson = JSON.stringify(this.doc);
    this.renderTitle();
    this.status(`“${name}” kaydedildi.`);
    this.opts.onSaved?.(id);
    if (thenClose) this.dialog.close();
    return true;
  }

  private confirmClose(): boolean {
    if (!this.dirty) return true;
    const leave = h('button', { class: 'btn btn--small', type: 'button' }, 'Kaydetmeden kapat');
    const stay = h('button', { class: 'btn btn--small', type: 'button' }, 'Vazgeç');
    const both = h('button', { class: 'btn btn--small btn--primary', type: 'button' }, 'Kaydet ve kapat');
    leave.addEventListener('click', () => this.dialog.close());
    stay.addEventListener('click', () => this.status(''));
    both.addEventListener('click', () => this.save(true));
    this.statusEl.dataset.kind = 'warn';
    replaceChildren(this.statusEl, h('span', null, 'Kaydedilmemiş değişiklikler var.'), leave, stay, both);
    return false;
  }
}
