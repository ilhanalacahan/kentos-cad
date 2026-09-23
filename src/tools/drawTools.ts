import type { AppContext } from '../app/context';
import { Signal } from '../core/signal';
import type { Entity, EntityGeometry, NewEntity } from '../model/entities';
import { bearingGrad, dist, type Vec2 } from '../model/geometry';
import { bulgeArc, bulgePathLength, bulgePathOutline, bulgeRingArea, bulgeThrough, hasBulges, segmentTangent, tangentBulge } from '../model/geom/bulge';
import type { ViewTransform } from '../viewport/Camera';
import { parseNumber } from './coordinateInput';
import { drawTag, strokePath } from './preview';
import type { Tool, ToolPointer } from './Tool';
import { constrainPoint, drawTracking, pointFromText, type Tracking } from './tracking';

/**
 * Base for tools driven by a sequence of points (click or typed). Handles
 * ortho, typed coordinates, previews and writing to the active layer.
 * Enter finishes the current object; Esc (handled by ToolManager) leaves.
 */
export abstract class PointInputTool implements Tool {
  abstract readonly id: string;
  protected abstract readonly label: string;
  readonly prompt = new Signal('');
  readonly cursor = 'cross' as const;
  protected pts: Vec2[] = [];
  protected hover: Vec2 | null = null;
  protected tracking: Tracking | null = null;
  protected readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  get snaps(): boolean {
    return true;
  }

  snapFrom(): Vec2 | null {
    return this.last;
  }

  protected abstract promptFor(count: number): string;
  protected abstract onPoint(p: Vec2): void;

  activate(): void {
    this.refreshPrompt();
  }

  protected get last(): Vec2 | null {
    return this.pts.at(-1) ?? null;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button === 0) this.accept(this.constrain(p));
  }

  pointerMove(p: ToolPointer): void {
    this.hover = this.constrain(p);
    this.ctx.view.requestOverlay();
  }

  input(text: string): boolean {
    if (this.option(text.trim().toLocaleUpperCase('tr-TR'))) return true;
    const pt = pointFromText(this.ctx, text, this.last, this.hover);
    if (!pt) return false;
    this.accept(pt);
    return true;
  }

  /** Letter options such as "K" (kapat) or "G" (geri). */
  protected option(_key: string): boolean {
    return false;
  }

  confirm(): void {
    if (!this.pts.length) this.ctx.tools.exit();
    else this.finish();
  }

  /** Commit what is pending and start over. */
  protected finish(): void {
    this.reset();
  }

  protected reset(): void {
    this.pts = [];
    this.refreshPrompt();
    this.ctx.view.requestOverlay();
  }

  acceptPoint(p: Vec2): boolean {
    this.accept(p);
    return true;
  }

  protected accept(p: Vec2): void {
    this.ctx.log.info(`  ${this.ctx.format.point(p)}`);
    this.onPoint(p);
    this.refreshPrompt();
    this.ctx.view.requestOverlay();
  }

  protected constrain(p: ToolPointer): Vec2 {
    const { point, tracking } = constrainPoint(this.ctx, this.last, p);
    this.tracking = tracking;
    return point;
  }

  protected refreshPrompt(): void {
    this.prompt.set(`${this.label}: ${this.promptFor(this.pts.length)}`);
  }

  /** Target layer for new entities, or null (with a message) when not writable. */
  protected targetLayer(preferred?: string): string | null {
    const layers = this.ctx.doc.layers;
    const id = preferred ?? layers.active.value;
    const node = layers.get(id);
    if (!node) return null;
    if (layers.isLocked(id)) {
      this.ctx.log.warn(`“${node.name}” katmanı kilitli. Kilidi Katmanlar panelinden açın ya da başka bir katmanı etkinleştirin.`);
      return null;
    }
    if (!layers.isVisible(id)) this.ctx.log.warn(`“${node.name}” katmanı gizli; çizilen nesne görünmeyecek.`);
    return id;
  }

  protected create(geom: EntityGeometry, extra: { attrs?: Record<string, string>; label?: string; layerId?: string } = {}): Entity | null {
    const layerId = this.targetLayer(extra.layerId);
    if (!layerId) return null;
    const color = this.ctx.settings.color.value ?? undefined;
    return this.ctx.doc.add({ ...geom, layerId, color, attrs: extra.attrs ?? {}, label: extra.label } as NewEntity);
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    const chain = this.hover ? [...this.pts, this.hover] : this.pts;
    strokePath(g, view, chain, { color: pal.accent });
    const last = this.last;
    if (last && this.hover) {
      const s = view.worldToScreen(this.hover);
      drawTag(g, s, [this.ctx.format.length(dist(last, this.hover)), `Semt ${this.ctx.format.bearing(bearingGrad(last, this.hover))}`], pal.accent, pal.labelHalo);
    }
    this.drawTracking(g, view);
  }

  protected drawTracking(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (this.tracking && this.hover) drawTracking(g, view, this.tracking, this.hover, this.ctx.view.palette.accent, this.ctx.view.palette.labelHalo);
  }
}

export class LineTool extends PointInputTool {
  readonly id = 'line';
  protected readonly label = 'Çizgi';
  /** Lines drawn in this chain, so G can take the last one back (AutoCAD LINE → Undo). */
  private created: number[] = [];

  protected promptFor(n: number): string {
    if (n === 0) return 'ilk noktayı belirtin';
    const opts = [this.created.length ? 'Geri (G)' : '', n >= 3 ? 'Kapat (K)' : '', 'Bitir (Enter)'].filter(Boolean).join(' / ');
    return `sonraki noktayı belirtin [${opts}]`;
  }

  protected onPoint(p: Vec2): void {
    const last = this.last;
    if (last && dist(last, p) <= 1e-9) return;
    if (last) {
      const e = this.create({ kind: 'line', a: last, b: p });
      if (!e) return;
      this.created.push(e.id);
    }
    this.pts.push(p);
  }

  protected override option(key: string): boolean {
    if (key === 'G' && this.created.length) {
      this.ctx.doc.remove([this.created.pop()!]);
      this.pts.pop();
      this.refreshPrompt();
      this.ctx.view.requestOverlay();
      return true;
    }
    if (key !== 'K' || this.pts.length < 3) return false;
    this.onPoint(this.pts[0]);
    this.finish();
    return true;
  }

  protected override finish(): void {
    if (this.created.length) this.ctx.log.success(`${this.created.length} çizgi eklendi.`);
    this.created = [];
    super.finish();
  }
}

/**
 * Open polyline, closed polygon, or a parcel polygon with cadastral
 * attributes. Y switches to arc segments that continue tangentially
 * (the first arc of a path needs a point on the arc), D back to lines.
 */
export class PathTool extends PointInputTool {
  readonly id: string;
  protected readonly label: string;
  private readonly closed: boolean;
  private readonly measureOnly: boolean;
  /** Set for parcel mode: target layer that also numbers new parcels. */
  private readonly parcelLayer?: string;
  /** One bulge per drawn segment (pts[i] → pts[i+1]). */
  private bulges: number[] = [];
  private arcMode = false;
  /** Point on the first arc of a path, which has no tangent to follow. */
  private arcVia: Vec2 | null = null;

  constructor(ctx: AppContext, opts: { id: string; label: string; closed: boolean; measureOnly?: boolean; parcelLayer?: string }) {
    super(ctx);
    this.id = opts.id;
    this.label = opts.label;
    this.closed = opts.closed;
    this.measureOnly = opts.measureOnly ?? false;
    this.parcelLayer = opts.parcelLayer;
  }

  protected promptFor(n: number): string {
    if (n === 0) return 'ilk noktayı belirtin';
    const min = this.closed ? 3 : 2;
    const done = n < min ? '' : ' / Bitir (Enter)';
    if (this.arcMode) {
      if (!this.tangent() && !this.arcVia) return `yayın üzerinden geçeceği bir nokta belirtin [Düz (D) / Geri (G)${done}]`;
      return `yayın bitiş noktasını belirtin [Düz (D) / Geri (G)${done}]`;
    }
    return `sonraki noktayı belirtin [Yay (Y) / Geri (G)${done}]`;
  }

  /** Travel direction at the last vertex (end tangent of the last segment). */
  private tangent(): Vec2 | null {
    const n = this.pts.length;
    return n >= 2 ? segmentTangent(this.pts[n - 2], this.pts[n - 1], this.bulges[n - 2] ?? 0, true) : null;
  }

  /** Bulge the next segment to `p` would get, or null if impossible. */
  private nextBulge(p: Vec2): number | null {
    const last = this.last;
    if (!last || !this.arcMode) return 0;
    const t = this.tangent();
    if (t) return tangentBulge(last, t, p);
    return this.arcVia ? bulgeThrough(last, this.arcVia, p) : null;
  }

  protected onPoint(p: Vec2): void {
    const last = this.last;
    if (last && dist(last, p) <= 1e-9) return;
    if (!last) return void this.pts.push(p);
    if (this.arcMode && !this.tangent() && !this.arcVia) {
      this.arcVia = p;
      return;
    }
    const bulge = this.nextBulge(p);
    if (bulge === null) return this.ctx.log.warn('Bu nokta yayın tam arkasında kalıyor; başka bir nokta seçin.');
    this.pts.push(p);
    this.bulges.push(bulge);
    this.arcVia = null;
  }

  protected override option(key: string): boolean {
    if (key === 'Y' || key === 'D') {
      this.arcMode = key === 'Y';
      this.arcVia = null;
    } else if (key === 'G' && this.arcVia) this.arcVia = null;
    else if (key === 'G' && this.pts.length) {
      this.pts.pop();
      this.bulges.pop();
    } else return false;
    this.refreshPrompt();
    this.ctx.view.requestOverlay();
    return true;
  }

  protected override reset(): void {
    this.bulges = [];
    this.arcVia = null;
    this.arcMode = false;
    super.reset();
  }

  /** Bulges for the finished shape (a polygon closes with a straight segment). */
  private fullBulges(): number[] | undefined {
    const all = [...this.bulges, 0];
    return hasBulges(all) ? all : undefined;
  }

  protected override finish(): void {
    const min = this.closed ? 3 : 2;
    if (this.pts.length < min) {
      this.ctx.log.warn(`${this.label} için en az ${min} nokta gerekir.`);
      return super.finish();
    }
    const pts = [...this.pts];
    const bulges = this.fullBulges();
    const f = this.ctx.format;
    const area = () => Math.abs(bulgeRingArea(pts, bulges));
    if (this.measureOnly) {
      if (this.closed) this.ctx.log.success(`Alan ${f.area(area())}   Çevre ${f.length(bulgePathLength(pts, bulges, true))}`);
      else this.ctx.log.success(`Toplam uzunluk ${f.length(bulgePathLength(pts, bulges, false))} (${pts.length - 1} kenar)`);
      return super.finish();
    }
    const geom = { kind: this.closed ? ('polygon' as const) : ('polyline' as const), pts, ...(bulges && { bulges }) };
    if (this.parcelLayer) this.createParcel(geom, this.parcelLayer);
    else if (this.create(geom)) {
      this.ctx.log.success(this.closed ? `Kapalı alan eklendi: ${f.area(area())}` : `Çoklu çizgi eklendi: ${f.length(bulgePathLength(pts, bulges, false))}`);
    }
    super.finish();
  }

  private createParcel(geom: { kind: 'polygon' | 'polyline'; pts: Vec2[]; bulges?: number[] }, layerId: string): void {
    const parcels = this.ctx.doc.byLayer(layerId);
    const next = parcels.reduce((m, e) => Math.max(m, parseInt(e.attrs.Parsel ?? '0', 10) || 0), 0) + 1;
    const area = Math.abs(bulgeRingArea(geom.pts, geom.bulges));
    const e = this.create(geom, {
      layerId,
      label: String(next),
      attrs: { Ada: '', Parsel: String(next), Mahalle: '', Nitelik: 'Arsa', 'Tapu alanı (m²)': area.toFixed(2), Pafta: '' },
    });
    if (e) {
      this.ctx.selection.set([e.id]);
      this.ctx.log.success(`Parsel ${next} oluşturuldu: ${this.ctx.format.area(area)}. Ada ve mahalle bilgisini Öznitelikler panelinden girin.`);
    }
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    const f = this.ctx.format;
    const pts = [...this.pts];
    const bulges = [...this.bulges];
    const hb = this.hover ? this.nextBulge(this.hover) : null;
    if (this.hover && hb !== null) {
      pts.push(this.hover);
      bulges.push(hb);
    }
    bulges.push(0);
    if (this.closed && pts.length >= 3) {
      strokePath(g, view, bulgePathOutline(pts, bulges, true), { color: pal.accent, closed: true, dash: [4, 4], fill: 'rgba(242,182,50,0.08)' });
    }
    strokePath(g, view, bulgePathOutline(pts, bulges, false), { color: pal.accent });
    // First arc of a path: show the via point and the straight rubber band to it.
    if (this.arcVia && this.last) strokePath(g, view, [this.last, this.arcVia], { color: pal.accent, dash: [2, 3] });
    else if (this.arcMode && this.last && this.hover && !this.tangent()) strokePath(g, view, [this.last, this.hover], { color: pal.accent, dash: [2, 3] });
    if (!this.hover || !this.last) return;
    const s = view.worldToScreen(this.hover);
    const arc = hb ? bulgeArc(this.last, this.hover, hb) : null;
    const lines = arc
      ? [`Yay r ${f.length(arc.r)}`, `Yay boyu ${f.length(arc.r * Math.abs(arc.sweep))}`]
      : [f.length(dist(this.last, this.hover)), `Semt ${f.bearing(bearingGrad(this.last, this.hover))}`];
    if (this.measureOnly && !this.closed) lines.push(`Toplam ${f.length(bulgePathLength(pts, bulges, false))}`);
    if (this.closed && pts.length >= 3) lines.push(`Alan ${f.area(Math.abs(bulgeRingArea(pts, bulges)))}`);
    drawTag(g, s, lines, pal.accent, pal.labelHalo);
    this.drawTracking(g, view);
  }
}

/** Places points; with `askZ` it waits for an elevation after each click (kot noktası). */
export class PointTool extends PointInputTool {
  readonly id: string;
  protected readonly label: string;
  private readonly askZ: boolean;
  private readonly layerId?: string;
  private pendingZ: Vec2 | null = null;

  constructor(ctx: AppContext, opts: { id: string; label: string; askZ: boolean; layerId?: string }) {
    super(ctx);
    this.id = opts.id;
    this.label = opts.label;
    this.askZ = opts.askZ;
    this.layerId = opts.layerId;
  }

  protected promptFor(): string {
    return this.pendingZ ? 'kot değerini yazın (m)' : 'nokta konumunu belirtin';
  }

  protected onPoint(p: Vec2): void {
    if (this.askZ) {
      this.pendingZ = p;
      return;
    }
    this.create({ kind: 'point', p }, { layerId: this.layerId });
  }

  override input(text: string): boolean {
    if (this.pendingZ) {
      const z = parseNumber(text);
      if (z === null) return false;
      this.create({ kind: 'point', p: this.pendingZ, z }, { layerId: this.layerId, label: z.toFixed(2), attrs: { Tür: 'Kot noktası', 'Z (m)': z.toFixed(3) } });
      this.pendingZ = null;
      this.refreshPrompt();
      this.ctx.view.requestOverlay();
      return true;
    }
    return super.input(text);
  }

  override pointerDown(p: ToolPointer): void {
    if (!this.pendingZ) super.pointerDown(p);
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (!this.pendingZ) return;
    const s = view.worldToScreen(this.pendingZ);
    const pal = this.ctx.view.palette;
    drawTag(g, s, ['Kot?'], pal.accent, pal.labelHalo);
  }
}

export class EraseTool implements Tool {
  readonly id = 'erase';
  readonly prompt = new Signal('Sil: silinecek nesneye tıklayın');
  readonly cursor = 'pick' as const;
  readonly snaps = false;
  private readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  activate(): void {
    if (!this.ctx.selection.size) return;
    this.eraseIds([...this.ctx.selection.ids.value]);
    queueMicrotask(() => this.ctx.tools.exit());
  }

  pointerMove(p: ToolPointer): void {
    this.ctx.selection.hover.set(this.ctx.view.pick(p.screen)?.id ?? null);
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const hit = this.ctx.view.pick(p.screen);
    if (hit) this.eraseIds([hit.id]);
  }

  private eraseIds(ids: number[]): void {
    const { doc, log, selection } = this.ctx;
    const ok = ids.filter((id) => {
      const e = doc.get(id);
      return e && !doc.layers.isLocked(e.layerId);
    });
    if (ok.length < ids.length) log.warn(`${ids.length - ok.length} nesne kilitli katmanda olduğu için silinmedi.`);
    if (!ok.length) return;
    doc.remove(ok);
    selection.retain((id) => !!doc.get(id));
    selection.hover.set(null);
    log.success(`${ok.length} nesne silindi.`);
  }
}

/** Stand-in for tools whose behaviour is on the roadmap; keeps the UI honest. */
export class PendingTool implements Tool {
  readonly id: string;
  readonly prompt: Signal<string>;
  readonly cursor = 'cross' as const;
  readonly snaps = true;

  constructor(id: string, label: string) {
    this.id = id;
    this.prompt = new Signal(`${label}: bu araç henüz geliştirme aşamasında. Çıkmak için Esc`);
  }
}
