import type { AppContext } from '../app/context';
import { Signal } from '../core/signal';
import { entityGeometry, type Entity, type NewEntity } from '../model/entities';
import { dist, type Vec2 } from '../model/geometry';
import { mirror, rotation, scaling, translation, type Affine } from '../model/geom/affine';
import { transformEntity } from '../model/ops/transform';
import type { ViewTransform } from '../viewport/Camera';
import { parseNumber } from './coordinateInput';
import { drawSelectionBox, drawTag, strokeGeometry, strokePath } from './preview';
import type { Tool, ToolPointer } from './Tool';
import { constrainPoint, drawTracking, pointFromText, type Tracking } from './tracking';

export const MAX_GHOSTS = 400;
const deg = (rad: number) => (rad * 180) / Math.PI;
const angleTo = (a: Vec2, b: Vec2) => Math.atan2(b.y - a.y, b.x - a.x);

// ── Selection-first tools (move, copy, rotate, scale, mirror, array) ───

/**
 * Pick objects (unless something is already selected), press Enter, then
 * answer the tool's stages. Results are applied as one undo step through
 * an affine transform, so every entity kind is supported uniformly.
 */
export abstract class SelectionFirstTool implements Tool {
  abstract readonly id: string;
  protected abstract readonly label: string;
  readonly prompt = new Signal('');
  readonly cursor = 'cross' as const;
  readonly snaps = true;
  protected picking = true;
  protected hover: Vec2 | null = null;
  private box: { a: Vec2; aw: Vec2; b: Vec2; bw: Vec2; dragging: boolean } | null = null;
  protected tracking: Tracking | null = null;
  protected readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  /** Reset stage state once the selection is confirmed. */
  protected abstract begin(): void;
  protected abstract stagePrompt(): string;
  protected abstract point(p: Vec2): void;
  /** Point used for ortho, polar tracking and perpendicular snaps. */
  protected anchor(): Vec2 | null {
    return null;
  }
  /** Transforms to preview as ghosts (one per copy). */
  protected previewTransforms(): Affine[] {
    return [];
  }
  protected previewTag(): string[] {
    return [];
  }

  activate(): void {
    this.picking = this.ctx.selection.size === 0;
    if (!this.picking) this.begin();
    this.refresh();
  }

  deactivate(): void {
    this.ctx.selection.hover.set(null);
  }

  snapFrom(): Vec2 | null {
    return this.picking ? null : this.anchor();
  }

  /** Extra text shown while picking, e.g. a typed option. */
  protected pickHint(): string {
    return '';
  }

  protected refresh(): void {
    const n = this.ctx.selection.size;
    const hint = this.pickHint();
    const picking = `nesnelere tıklayın ya da pencereyle seçin, bitince sağ tıklayın (${n} seçili)${hint ? ` ${hint}` : ''}`;
    this.prompt.set(`${this.label}: ${this.picking ? picking : this.stagePrompt()}`);
    this.ctx.view.requestOverlay();
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (this.picking) {
      // Click toggles one object; dragging draws a window/crossing box (on pointerup).
      this.box = { a: p.screen, aw: p.raw, b: p.screen, bw: p.raw, dragging: false };
      return;
    }
    this.point(this.constrain(p));
    this.refresh();
  }

  pointerMove(p: ToolPointer): void {
    if (this.picking) {
      if (this.box) {
        this.box.b = p.screen;
        this.box.bw = p.raw;
        if (!this.box.dragging && Math.hypot(p.screen.x - this.box.a.x, p.screen.y - this.box.a.y) > 4) {
          this.box.dragging = true;
          this.ctx.selection.hover.set(null);
        }
        if (this.box.dragging) this.ctx.view.requestOverlay();
        return;
      }
      this.ctx.selection.hover.set(this.ctx.view.pick(p.screen)?.id ?? null);
      return;
    }
    this.hover = this.constrain(p);
    this.ctx.view.requestOverlay();
  }

  pointerUp(p: ToolPointer): void {
    const box = this.box;
    if (!this.picking || !box) return;
    this.box = null;
    if (box.dragging) {
      const { aw, bw } = box;
      const r = { minX: Math.min(aw.x, bw.x), minY: Math.min(aw.y, bw.y), maxX: Math.max(aw.x, bw.x), maxY: Math.max(aw.y, bw.y) };
      this.ctx.selection.add(this.ctx.view.pickRect(r, box.b.x < box.a.x));
    } else {
      const hit = this.ctx.view.pick(p.screen);
      if (hit) this.ctx.selection.toggle(hit.id);
    }
    this.refresh();
  }

  private constrain(p: ToolPointer): Vec2 {
    const r = constrainPoint(this.ctx, this.anchor(), p);
    this.tracking = r.tracking;
    return r.point;
  }

  input(text: string): boolean {
    if (this.picking) return false;
    const pt = pointFromText(this.ctx, text, this.anchor(), this.hover);
    if (!pt) return false;
    this.point(pt);
    this.refresh();
    return true;
  }

  acceptPoint(p: Vec2): boolean {
    if (this.picking) return false;
    this.point(p);
    this.refresh();
    return true;
  }

  confirm(): void {
    if (this.picking && this.ctx.selection.size) {
      this.picking = false;
      this.ctx.selection.hover.set(null);
      this.begin();
      return this.refresh();
    }
    this.ctx.tools.exit();
  }

  protected targets(): Entity[] {
    return [...this.ctx.selection.ids.value].map((id) => this.ctx.doc.get(id)).filter((e): e is Entity => !!e);
  }

  /** Applies `ms` to the selection: copies when `copy`, otherwise edits in place. */
  protected applyTransforms(label: string, ms: Affine[], copy: boolean): number {
    const { doc, log } = this.ctx;
    const ents = this.targets();
    const editable = copy ? ents : ents.filter((e) => !doc.layers.isLocked(e.layerId));
    if (editable.length < ents.length) log.warn(`${ents.length - editable.length} nesne kilitli katmanda olduğu için atlandı.`);
    const created: number[] = [];
    doc.transact(label, () => {
      for (const m of ms)
        for (const e of editable) {
          const t = transformEntity(e, m);
          if (copy) {
            const { id: _id, ...rest } = t;
            created.push(doc.add(rest as NewEntity).id);
          } else doc.update(e.id, t);
        }
    });
    return copy ? created.length : editable.length;
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (this.picking) {
      if (this.box?.dragging) drawSelectionBox(g, this.box.a, this.box.b, this.ctx.view.palette.snap);
      return;
    }
    const pal = this.ctx.view.palette;
    const ms = this.previewTransforms();
    let drawn = 0;
    for (const m of ms)
      for (const e of this.targets()) {
        if (drawn++ > MAX_GHOSTS) break;
        strokeGeometry(g, view, entityGeometry(transformEntity(e, m)), { color: pal.accent, dash: [4, 3] });
      }
    const a = this.anchor();
    if (a && this.hover) strokePath(g, view, [a, this.hover], { color: pal.accent });
    const tag = this.previewTag();
    if (tag.length && this.hover) drawTag(g, view.worldToScreen(this.hover), tag, pal.accent, pal.labelHalo);
    if (this.tracking && this.hover) drawTracking(g, view, this.tracking, this.hover, pal.accent, pal.labelHalo);
  }
}

export class MoveTool extends SelectionFirstTool {
  readonly id: string;
  protected readonly label: string;
  private readonly copy: boolean;
  private base: Vec2 | null = null;

  constructor(ctx: AppContext, opts: { id: string; label: string; copy: boolean }) {
    super(ctx);
    this.id = opts.id;
    this.label = opts.label;
    this.copy = opts.copy;
  }

  protected begin(): void {
    this.base = null;
  }
  protected override anchor(): Vec2 | null {
    return this.base;
  }
  protected stagePrompt(): string {
    const n = this.ctx.selection.size;
    if (!this.base) return `${n} nesne için temel noktayı belirtin`;
    return this.copy ? 'kopyanın yerini belirtin ya da @dY,dX yazın [Bitir (Enter)]' : 'hedef noktayı belirtin ya da @dY,dX yazın';
  }
  protected point(p: Vec2): void {
    if (!this.base) {
      this.base = p;
      return;
    }
    const dx = p.x - this.base.x;
    const dy = p.y - this.base.y;
    const n = this.applyTransforms(this.label, [translation(dx, dy)], this.copy);
    const f = this.ctx.format;
    this.ctx.log.success(`${n} nesne ${this.copy ? 'kopyalandı' : 'taşındı'}: ΔY ${f.length(dx, false)}  ΔX ${f.length(dy, false)}`);
    if (!this.copy) this.ctx.tools.exit();
  }
  protected override previewTransforms(): Affine[] {
    return this.base && this.hover ? [translation(this.hover.x - this.base.x, this.hover.y - this.base.y)] : [];
  }
  protected override previewTag(): string[] {
    return this.base && this.hover ? [this.ctx.format.length(dist(this.base, this.hover))] : [];
  }
}

export class RotateTool extends SelectionFirstTool {
  readonly id = 'rotate';
  protected readonly label = 'Döndür';
  private base: Vec2 | null = null;
  private copy = false;

  protected begin(): void {
    this.base = null;
  }
  protected override anchor(): Vec2 | null {
    return this.base;
  }
  protected stagePrompt(): string {
    if (!this.base) return 'dönme merkezini belirtin';
    return `açıyı yazın (derece, saat yönü tersine) ya da bir nokta gösterin [Kopya (K): ${this.copy ? 'açık' : 'kapalı'}]`;
  }
  protected point(p: Vec2): void {
    if (!this.base) {
      this.base = p;
      return;
    }
    if (dist(this.base, p) < 1e-9) return;
    this.rotate(angleTo(this.base, p));
  }
  override input(text: string): boolean {
    const t = text.trim().toLocaleUpperCase('tr-TR');
    if (this.base && t === 'K') {
      this.copy = !this.copy;
      this.refresh();
      return true;
    }
    const n = parseNumber(text);
    if (this.base && n !== null && !/[,;@<]/.test(text)) {
      this.rotate((n * Math.PI) / 180);
      return true;
    }
    return super.input(text);
  }
  private rotate(angle: number): void {
    const n = this.applyTransforms(this.label, [rotation(angle, this.base!)], this.copy);
    this.ctx.log.success(`${n} nesne ${deg(angle).toFixed(4)}° döndürüldü${this.copy ? ' (kopya)' : ''}.`);
    this.ctx.tools.exit();
  }
  protected override previewTransforms(): Affine[] {
    return this.base && this.hover && dist(this.base, this.hover) > 1e-9 ? [rotation(angleTo(this.base, this.hover), this.base)] : [];
  }
  protected override previewTag(): string[] {
    return this.base && this.hover ? [`Açı ${deg(angleTo(this.base, this.hover)).toFixed(2)}°`] : [];
  }
}

export class ScaleTool extends SelectionFirstTool {
  readonly id = 'scale';
  protected readonly label = 'Ölçekle';
  private base: Vec2 | null = null;
  private ref: Vec2 | null = null;

  protected begin(): void {
    this.base = this.ref = null;
  }
  protected override anchor(): Vec2 | null {
    return this.base;
  }
  protected stagePrompt(): string {
    if (!this.base) return 'temel noktayı belirtin';
    if (!this.ref) return 'ölçek faktörünü yazın ya da referans uzunluk için bir nokta gösterin';
    return 'yeni uzunluğu gösterin ya da faktör yazın';
  }
  protected point(p: Vec2): void {
    if (!this.base) {
      this.base = p;
      return;
    }
    if (!this.ref) {
      if (dist(this.base, p) > 1e-9) this.ref = p;
      return;
    }
    this.scale(dist(this.base, p) / dist(this.base, this.ref));
  }
  override input(text: string): boolean {
    const n = parseNumber(text);
    if (this.base && n !== null && !/[,;@<]/.test(text)) {
      if (n <= 0) {
        this.ctx.log.warn('Ölçek faktörü sıfırdan büyük olmalı.');
        return true;
      }
      this.scale(n);
      return true;
    }
    return super.input(text);
  }
  private scale(f: number): void {
    if (!(f > 0) || !Number.isFinite(f)) return;
    const n = this.applyTransforms(this.label, [scaling(f, this.base!)], false);
    this.ctx.log.success(`${n} nesne ${f.toFixed(4)} faktörüyle ölçeklendi.`);
    this.ctx.tools.exit();
  }
  private factor(): number | null {
    return this.base && this.ref && this.hover ? dist(this.base, this.hover) / dist(this.base, this.ref) : null;
  }
  protected override previewTransforms(): Affine[] {
    const f = this.factor();
    return f && f > 0 ? [scaling(f, this.base!)] : [];
  }
  protected override previewTag(): string[] {
    const f = this.factor();
    return f ? [`Faktör ${f.toFixed(4)}`] : [];
  }
}

export class MirrorTool extends SelectionFirstTool {
  readonly id = 'mirror';
  protected readonly label = 'Aynala';
  private p1: Vec2 | null = null;
  private eraseSource = false;

  protected begin(): void {
    this.p1 = null;
  }
  protected override anchor(): Vec2 | null {
    return this.p1;
  }
  protected stagePrompt(): string {
    const mode = `[Kaynağı sil (S): ${this.eraseSource ? 'evet' : 'hayır'}]`;
    return this.p1 ? `simetri ekseninin ikinci noktasını belirtin ${mode}` : `simetri ekseninin ilk noktasını belirtin ${mode}`;
  }
  protected point(p: Vec2): void {
    if (!this.p1) {
      this.p1 = p;
      return;
    }
    if (dist(this.p1, p) < 1e-9) return;
    const n = this.applyTransforms(this.label, [mirror(this.p1, p)], !this.eraseSource);
    this.ctx.log.success(`${n} nesnenin simetriği ${this.eraseSource ? 'alındı; kaynaklar yerinde değiştirildi' : 'kopya olarak oluşturuldu'}.`);
    this.ctx.tools.exit();
  }
  override input(text: string): boolean {
    if (!this.picking && text.trim().toLocaleUpperCase('tr-TR') === 'S') {
      this.eraseSource = !this.eraseSource;
      this.refresh();
      return true;
    }
    return super.input(text);
  }
  protected override previewTransforms(): Affine[] {
    return this.p1 && this.hover && dist(this.p1, this.hover) > 1e-9 ? [mirror(this.p1, this.hover)] : [];
  }
}

/** Rectangular array: rows × columns with dY (column) and dX (row) spacing. */
export class ArrayTool extends SelectionFirstTool {
  readonly id = 'array';
  protected readonly label = 'Dizi';
  private static last = { rows: 2, cols: 3, dx: 10, dy: 10 };
  private rows = ArrayTool.last.rows;
  private cols = ArrayTool.last.cols;
  private stage: 'count' | 'spacing' = 'count';
  private base: Vec2 | null = null;

  protected begin(): void {
    this.stage = 'count';
    this.base = null;
  }
  protected override anchor(): Vec2 | null {
    return this.base;
  }
  protected stagePrompt(): string {
    const l = ArrayTool.last;
    if (this.stage === 'count') return `satır ve sütun sayısını yazın, ör. ${l.rows},${l.cols} (Enter: ${l.rows},${l.cols})`;
    return this.base ? 'aralık için ikinci noktayı gösterin' : `sütun ve satır aralığını yazın dY,dX (Enter: ${l.dx},${l.dy}) ya da iki nokta gösterin`;
  }
  protected point(p: Vec2): void {
    if (this.stage !== 'spacing') return;
    if (!this.base) {
      this.base = p;
      return;
    }
    this.build(p.x - this.base.x, p.y - this.base.y);
  }
  override input(text: string): boolean {
    if (this.picking) return false;
    const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return false;
    if (this.stage === 'count') {
      const r = Math.round(+m[1]);
      const c = Math.round(+m[2]);
      if (r < 1 || c < 1 || r * c < 2 || r * c > 10_000) {
        this.ctx.log.warn('Satır × sütun 2 ile 10 000 arasında olmalı.');
        return true;
      }
      this.rows = r;
      this.cols = c;
      this.stage = 'spacing';
    } else this.build(+m[1], +m[2]);
    this.refresh();
    return true;
  }
  override confirm(): void {
    if (this.picking) return super.confirm();
    if (this.stage === 'count') {
      this.stage = 'spacing';
      return this.refresh();
    }
    this.build(ArrayTool.last.dx, ArrayTool.last.dy);
  }
  private offsets(dx: number, dy: number): Affine[] {
    const out: Affine[] = [];
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) if (i || j) out.push(translation(j * dx, i * dy));
    return out;
  }
  private build(dx: number, dy: number): void {
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return;
    ArrayTool.last = { rows: this.rows, cols: this.cols, dx, dy };
    const n = this.applyTransforms(this.label, this.offsets(dx, dy), true);
    this.ctx.log.success(`${this.rows} × ${this.cols} dizi oluşturuldu: ${n} yeni nesne.`);
    this.ctx.tools.exit();
  }
  protected override previewTransforms(): Affine[] {
    if (this.stage !== 'spacing') return [];
    if (this.base && this.hover) return this.offsets(this.hover.x - this.base.x, this.hover.y - this.base.y);
    return this.offsets(ArrayTool.last.dx, ArrayTool.last.dy);
  }
}
