import type { AppContext } from '../app/context';
import { Signal } from '../core/signal';
import { entityGeometry, type Entity, type EntityGeometry, type NewEntity } from '../model/entities';
import type { Vec2 } from '../model/geometry';
import { offsetEntity } from '../model/ops/offset';
import { extendEntity, trimEntity } from '../model/ops/trim';
import type { ViewTransform } from '../viewport/Camera';
import { parseNumber } from './coordinateInput';
import { strokeGeometry } from './preview';
import type { Tool, ToolPointer } from './Tool';

/**
 * Tools that act on the edge under the cursor rather than on a selection.
 * This file holds the base and offset, trim, extend; corner tools live in
 * ./cornerTools, break/divide/vertex in ./pathEditTools.
 */
export abstract class EdgePickTool implements Tool {
  abstract readonly id: string;
  readonly prompt = new Signal('');
  readonly cursor = 'pick' as const;
  readonly snaps: boolean = false;
  protected hover: { entity: Entity; world: Vec2 } | null = null;
  protected readonly ctx: AppContext;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  protected editable = (e: Entity) => !this.ctx.doc.layers.isLocked(e.layerId);

  activate(): void {
    this.refresh();
  }

  deactivate(): void {
    this.ctx.selection.hover.set(null);
  }

  protected abstract refresh(): void;

  pointerMove(p: ToolPointer): void {
    const e = this.ctx.view.pickEdge(p.screen, this.editable);
    this.hover = e ? { entity: e, world: p.raw } : null;
    this.ctx.selection.hover.set(e?.id ?? null);
    this.ctx.view.requestOverlay();
  }

  /** Common attributes carried over to pieces of an edited entity. */
  protected inherit(e: Entity, geom: EntityGeometry, keepData: boolean): NewEntity {
    return { ...geom, layerId: e.layerId, color: e.color, attrs: keepData ? { ...e.attrs } : {}, label: keepData ? e.label : undefined } as NewEntity;
  }

  /** Replaces `e` by `pieces` in one undo step (attributes survive a single piece). */
  protected replace(label: string, e: Entity, pieces: EntityGeometry[]): void {
    const { doc } = this.ctx;
    const keep = pieces.length === 1 && e.kind !== 'polygon';
    doc.transact(label, () => {
      doc.remove([e.id]);
      for (const piece of pieces) doc.add(this.inherit(e, piece, keep));
    });
    this.ctx.selection.retain((id) => !!doc.get(id));
    this.hover = null;
    this.ctx.selection.hover.set(null);
  }
}

// ── Ötele, buda, uzat ──────────────────────────────────────────────────

export class OffsetTool extends EdgePickTool {
  readonly id = 'offset';
  private static distance = 1;
  private target: Entity | null = null;
  private side: Vec2 | null = null;

  protected refresh(): void {
    const d = this.ctx.format.length(OffsetTool.distance);
    this.prompt.set(this.target ? 'Ötele: hangi tarafa? bir nokta gösterin' : `Ötele: ötelenecek nesneyi seçin [mesafe ${d}; yeni mesafe için sayı yazın]`);
  }

  override pointerMove(p: ToolPointer): void {
    if (this.target) {
      this.side = p.raw;
      return this.ctx.view.requestOverlay();
    }
    super.pointerMove(p);
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    if (!this.target) {
      const e = this.ctx.view.pickEdge(p.screen, this.editable);
      if (!e) return this.ctx.log.warn('Düzenlenebilir bir çizgi, çoklu çizgi, daire ya da yaya tıklayın.');
      this.target = e;
      this.side = p.raw;
      this.ctx.selection.hover.set(null);
      return this.refresh();
    }
    const r = offsetEntity(this.target, OffsetTool.distance, p.raw);
    if ('error' in r) this.ctx.log.warn(r.error);
    else {
      this.ctx.doc.add(this.inherit(this.target, r.geometry, false));
      this.ctx.log.success(`${this.ctx.format.length(OffsetTool.distance)} ötelenmiş kopya eklendi.`);
    }
    this.target = null;
    this.refresh();
    this.ctx.view.requestOverlay();
  }

  input(text: string): boolean {
    const n = parseNumber(text);
    if (n === null || n <= 0) return false;
    OffsetTool.distance = n;
    this.refresh();
    this.ctx.view.requestOverlay();
    return true;
  }

  confirm(): void {
    if (this.target) {
      this.target = null;
      return this.refresh();
    }
    this.ctx.tools.exit();
  }

  cancel(): boolean {
    if (!this.target) return false;
    this.target = null;
    this.refresh();
    this.ctx.view.requestOverlay();
    return true;
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (!this.target || !this.side) return;
    const r = offsetEntity(this.target, OffsetTool.distance, this.side);
    if ('geometry' in r) strokeGeometry(g, view, r.geometry, { color: this.ctx.view.palette.accent, dash: [4, 3] });
    strokeGeometry(g, view, entityGeometry(this.target), { color: this.ctx.view.palette.accent });
  }
}

export class TrimTool extends EdgePickTool {
  readonly id = 'trim';

  protected refresh(): void {
    this.prompt.set('Buda: silinecek parçaya tıklayın; diğer tüm görünen kenarlar sınırdır. Çıkmak için Esc');
  }

  private result(e: Entity, at: Vec2) {
    return trimEntity(e, at, this.ctx.view.edgesIn(this.ctx.view.camera.visibleBounds(), e.id));
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const e = this.ctx.view.pickEdge(p.screen, this.editable);
    if (!e) return this.ctx.log.warn('Budanacak düzenlenebilir bir kenara tıklayın.');
    const r = this.result(e, p.raw);
    if ('error' in r) return this.ctx.log.warn(r.error);
    this.replace('Buda', e, r.pieces);
    this.ctx.log.success(`Budandı: ${r.pieces.length} parça kaldı.`);
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (!this.hover) return;
    const pal = this.ctx.view.palette;
    const r = this.result(this.hover.entity, this.hover.world);
    if ('error' in r) return;
    // The whole object dashed red, kept pieces solid on top: what remains red is what goes.
    strokeGeometry(g, view, entityGeometry(this.hover.entity), { color: pal.danger, dash: [5, 3], width: 2 });
    for (const piece of r.pieces) strokeGeometry(g, view, piece, { color: pal.accent, width: 1.5 });
  }
}

export class ExtendTool extends EdgePickTool {
  readonly id = 'extend';

  protected refresh(): void {
    this.prompt.set('Uzat: uzatılacak ucun yakınına tıklayın; görünen kenarlar sınırdır. Çıkmak için Esc');
  }

  private result(e: Entity, at: Vec2) {
    return extendEntity(e, at, this.ctx.view.edgesIn(this.ctx.view.camera.visibleBounds(), e.id));
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const e = this.ctx.view.pickEdge(p.screen, this.editable);
    if (!e) return this.ctx.log.warn('Uzatılacak düzenlenebilir bir çizgi ya da yaya tıklayın.');
    const r = this.result(e, p.raw);
    if ('error' in r) return this.ctx.log.warn(r.error);
    this.ctx.doc.update(e.id, r.geometry as Partial<Entity>);
    this.ctx.log.success('Uzatıldı.');
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    if (!this.hover) return;
    const r = this.result(this.hover.entity, this.hover.world);
    if ('geometry' in r) strokeGeometry(g, view, r.geometry, { color: this.ctx.view.palette.accent, dash: [4, 3], width: 1.5 });
  }
}
