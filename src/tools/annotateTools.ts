import type { AppContext } from '../app/context';
import { Signal } from '../core/signal';
import { HATCH_PATTERN_LABEL, type HatchPattern } from '../model/entities';
import { dist, signedArea, type Vec2 } from '../model/geometry';
import { layoutDimension, signedOffset } from '../model/geom/dimension';
import { hatchLines } from '../model/geom/hatch';
import type { ViewTransform } from '../viewport/Camera';
import { parseNumber } from './coordinateInput';
import { PointInputTool } from './drawTools';
import { drawTag, strokePath } from './preview';
import type { Tool, ToolPointer } from './Tool';

/** Paper sizes (mm) converted to world metres at the project's plot scale. */
const paper = (ctx: AppContext, mm: number) => (mm / 1000) * ctx.doc.settings.plotScale.value;

// ── Yazı ────────────────────────────────────────────────────────────────

/**
 * Single-line text: click where it starts and type right there — a field
 * opens in place (the drawing never sees the keystrokes). Height (Y, paper
 * mm) and angle (A: typed degrees, or two clicks along an edge) are set
 * before the click and kept for the next texts. Enter adds the text and
 * waits for the next one; Esc drops the field.
 */
export class TextTool extends PointInputTool {
  readonly id = 'text';
  protected readonly label = 'Yazı';
  private static heightMm = 2.5;
  private static angle = 0;
  private stage: 'pos' | 'height' | 'angle' | 'typing' = 'pos';
  private at: Vec2 | null = null;
  /** First of the two clicks that give the angle. */
  private angleFrom: Vec2 | null = null;

  protected promptFor(): string {
    switch (this.stage) {
      case 'height':
        return 'kâğıt üzerindeki yazı yüksekliğini mm olarak yazın';
      case 'angle':
        return this.angleFrom ? 'doğrultunun ikinci noktasına tıklayın' : 'açıyı yazın (derece) ya da doğrultu için iki noktaya tıklayın';
      case 'typing':
        return 'yazıyı tıkladığınız yere yazın; Enter ekler, Esc vazgeçer';
      default:
        return `yazının başlangıcına tıklayın [Yükseklik (Y): ${TextTool.heightMm} mm / Açı (A): ${+TextTool.angle.toFixed(4)}°]`;
    }
  }

  override snapFrom(): Vec2 | null {
    return this.angleFrom ?? this.at;
  }

  protected override get last(): Vec2 | null {
    return this.stage === 'angle' ? this.angleFrom : null;
  }

  protected override option(key: string): boolean {
    if (this.stage !== 'pos' || (key !== 'Y' && key !== 'A')) return false;
    this.stage = key === 'Y' ? 'height' : 'angle';
    this.angleFrom = null;
    this.refreshPrompt();
    return true;
  }

  protected onPoint(p: Vec2): void {
    if (this.stage === 'angle') {
      if (!this.angleFrom) return void (this.angleFrom = p);
      if (dist(this.angleFrom, p) < 1e-9) return;
      let a = (Math.atan2(p.y - this.angleFrom.y, p.x - this.angleFrom.x) * 180) / Math.PI;
      // Keep text readable: a direction pointing left is turned around.
      if (a > 90) a -= 180;
      else if (a <= -90) a += 180;
      TextTool.angle = a;
      this.angleFrom = null;
      this.stage = 'pos';
      return;
    }
    if (this.stage !== 'pos') return;
    this.at = p;
    this.stage = 'typing';
    const height = paper(this.ctx, TextTool.heightMm);
    this.ctx.view.requestTextInput({
      at: p,
      height,
      rotation: TextTool.angle,
      commit: (text) => {
        this.create({ kind: 'text', p, text, height, rotation: TextTool.angle });
        this.ctx.log.success(`Yazı eklendi: “${text}”`);
        this.afterTyping();
      },
      cancel: () => this.afterTyping(),
    });
  }

  private afterTyping(): void {
    this.at = null;
    this.stage = 'pos';
    this.refreshPrompt();
    this.ctx.view.requestOverlay();
    this.ctx.view.focus();
  }

  override input(text: string): boolean {
    const t = text.trim();
    if (this.option(t.toLocaleUpperCase('tr-TR'))) return true;
    const n = parseNumber(t);
    if (this.stage === 'height') {
      if (n === null || n <= 0) return false;
      TextTool.heightMm = n;
      this.stage = 'pos';
      this.refreshPrompt();
      return true;
    }
    if (this.stage === 'angle') {
      if (n === null) return false;
      TextTool.angle = n;
      this.angleFrom = null;
      this.stage = 'pos';
      this.refreshPrompt();
      return true;
    }
    return super.input(text);
  }

  override confirm(): void {
    if (this.stage === 'pos') return this.ctx.tools.exit();
    this.afterTyping();
  }

  protected override reset(): void {
    this.stage = 'pos';
    this.at = null;
    this.angleFrom = null;
    super.reset();
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    if (this.stage === 'angle' && this.angleFrom && this.hover) {
      strokePath(g, view, [this.angleFrom, this.hover], { color: pal.accent, dash: [3, 3] });
      drawTag(g, view.worldToScreen(this.hover), [`Açı ${((Math.atan2(this.hover.y - this.angleFrom.y, this.hover.x - this.angleFrom.x) * 180) / Math.PI).toFixed(2)}°`], pal.accent, pal.labelHalo);
      return;
    }
    // Where the text will sit: a box of its height along its angle.
    const at = this.stage === 'pos' ? this.hover : null;
    if (!at) return;
    const s = view.worldToScreen(at);
    const px = Math.max(8, paper(this.ctx, TextTool.heightMm) * view.scale);
    g.save();
    g.translate(s.x, s.y);
    g.rotate((-TextTool.angle * Math.PI) / 180);
    g.strokeStyle = pal.accent;
    g.setLineDash([3, 3]);
    g.strokeRect(0, -px, px * 4, px);
    g.restore();
  }
}

// ── Ölçü ────────────────────────────────────────────────────────────────

/** Aligned dimension: two measured points, then the dimension-line position. */
export class DimensionTool extends PointInputTool {
  readonly id = 'dimension';
  protected readonly label = 'Ölçü';

  protected promptFor(n: number): string {
    return n === 0 ? 'ilk ölçü noktasını belirtin' : n === 1 ? 'ikinci ölçü noktasını belirtin' : 'ölçü çizgisinin yerini gösterin ya da mesafe yazın';
  }

  private height(): number {
    return paper(this.ctx, 2.5);
  }

  protected onPoint(p: Vec2): void {
    if (this.pts.length < 2) {
      if (!this.last || dist(this.last, p) > 1e-9) this.pts.push(p);
      return;
    }
    this.commit(signedOffset(this.pts[0], this.pts[1], p));
  }

  override input(text: string): boolean {
    const n = parseNumber(text);
    if (this.pts.length === 2 && n !== null && !/[,;@<]/.test(text)) {
      this.commit(n);
      return true;
    }
    return super.input(text);
  }

  private commit(offset: number): void {
    const [a, b] = this.pts;
    const e = this.create({ kind: 'dimension', a, b, offset, height: this.height() });
    if (e) this.ctx.log.success(`Ölçü eklendi: ${this.ctx.format.length(dist(a, b))}`);
    this.pts = [];
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    if (this.pts.length === 2 && this.hover) {
      const l = layoutDimension({ a: this.pts[0], b: this.pts[1], offset: signedOffset(this.pts[0], this.pts[1], this.hover), height: this.height() });
      if (l) {
        for (const [p, q] of l.lines) strokePath(g, view, [p, q], { color: pal.accent });
        drawTag(g, view.worldToScreen(this.hover), [this.ctx.format.length(l.length)], pal.accent, pal.labelHalo);
      }
      return;
    }
    super.draw(g, view);
  }
}

// ── Tarama ──────────────────────────────────────────────────────────────

const PRESETS: { name: string; type: HatchPattern['type']; angle: number; mm: number }[] = [
  { name: 'Çizgili 45°', type: 'lines', angle: 45, mm: 3 },
  { name: 'Çapraz 45°', type: 'cross', angle: 45, mm: 3 },
  { name: 'Yatay çizgili', type: 'lines', angle: 0, mm: 2 },
  { name: 'Dolu', type: 'solid', angle: 0, mm: 3 },
];

/** Click inside a closed shape; the hatch copies its boundary (not associative). */
export class HatchTool implements Tool {
  readonly id = 'hatch';
  readonly prompt = new Signal('');
  readonly cursor = 'pick' as const;
  readonly snaps = false;
  private static preset = 0;
  private hover: { ring: Vec2[] } | null = null;
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  activate(): void {
    this.refresh();
  }

  private refresh(): void {
    this.prompt.set(`Tarama: taranacak kapalı alanın içine tıklayın [Desen (D): ${PRESETS[HatchTool.preset].name}]`);
    this.ctx.view.requestOverlay();
  }

  private pattern(): HatchPattern {
    const p = PRESETS[HatchTool.preset];
    return { type: p.type, angle: p.angle, spacing: paper(this.ctx, p.mm) };
  }

  pointerMove(p: ToolPointer): void {
    const r = this.ctx.view.enclosingRing(p.raw);
    this.hover = r ? { ring: r.ring } : null;
    this.ctx.view.requestOverlay();
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const r = this.ctx.view.enclosingRing(p.raw);
    if (!r) return this.ctx.log.warn('Tıklanan noktayı çevreleyen kapalı bir alan, daire ya da kapalı eğri yok.');
    const pattern = this.pattern();
    if (pattern.type !== 'solid' && hatchLines(r.ring, pattern.angle, pattern.spacing).capped) {
      return this.ctx.log.warn('Desen bu alan için çok sık; çizim ölçeğini büyütün ya da başka bir desen seçin.');
    }
    const layers = this.ctx.doc.layers;
    const layerId = layers.active.value;
    if (layers.isLocked(layerId)) return this.ctx.log.warn(`“${layers.get(layerId)?.name}” katmanı kilitli.`);
    this.ctx.doc.add({
      kind: 'hatch',
      ring: r.ring.map((q) => ({ ...q })),
      pattern,
      layerId,
      color: this.ctx.settings.color.value ?? undefined,
      attrs: {},
    });
    this.ctx.log.success(`${HATCH_PATTERN_LABEL[pattern.type]} tarama eklendi: ${this.ctx.format.area(Math.abs(signedArea(r.ring)))}`);
  }

  input(text: string): boolean {
    if (text.trim().toLocaleUpperCase('tr-TR') !== 'D') return false;
    HatchTool.preset = (HatchTool.preset + 1) % PRESETS.length;
    this.refresh();
    return true;
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (!this.hover) return;
    const pal = this.ctx.view.palette;
    strokePath(g, view, this.hover.ring, { color: pal.accent, closed: true, dash: [4, 3], width: 1.5 });
    const pat = this.pattern();
    if (pat.type === 'solid') {
      strokePath(g, view, this.hover.ring, { color: pal.accent, closed: true, fill: 'rgba(242,182,50,0.25)' });
      return;
    }
    const { segments } = hatchLines(this.hover.ring, pat.angle, pat.spacing);
    if (segments.length > 3000) return; // preview only; the real hatch is drawn on the GPU
    g.save();
    g.globalAlpha = 0.6;
    for (const [a, b] of segments) strokePath(g, view, [a, b], { color: pal.accent });
    g.restore();
  }
}
