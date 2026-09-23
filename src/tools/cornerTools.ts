import { entityGeometry, type Entity, type EntityGeometry, type LineEntity, type PolylineEntity } from '../model/entities';
import type { Vec2 } from '../model/geometry';
import { chamferLines, cornerOfPath, filletLines } from '../model/ops/fillet';
import { nearestSegment } from '../model/ops/vertex';
import type { ViewTransform } from '../viewport/Camera';
import { parseNumber } from './coordinateInput';
import { EdgePickTool } from './edgeTools';
import { strokeGeometry, strokePath } from './preview';
import type { ToolPointer } from './Tool';

// ── Köşe yuvarla, pah ──────────────────────────────────────────────────

type CornerEntity = LineEntity | PolylineEntity;
interface CornerPick {
  entity: CornerEntity;
  pick: Vec2;
  /** Segment of a polyline that was clicked. */
  seg: number;
}
type CornerPlan =
  | { kind: 'lines'; l1: { a: Vec2; b: Vec2 }; l2: { a: Vec2; b: Vec2 }; extra: EntityGeometry | null; label: string }
  | { kind: 'path'; geometry: EntityGeometry; label: string };

/**
 * Two picks make a corner: two lines, or two neighbouring segments of one
 * polyline/polygon (the vertex between them is rounded or cut).
 */
abstract class CornerTool extends EdgePickTool {
  protected first: CornerPick | null = null;
  protected override editable = (e: Entity) => (e.kind === 'line' || e.kind === 'polyline' || e.kind === 'polygon') && !this.ctx.doc.layers.isLocked(e.layerId);

  protected abstract settings(): string;
  protected abstract title(): string;
  protected abstract linesPlan(l1: LineEntity, p1: Vec2, l2: LineEntity, p2: Vec2): CornerPlan | { error: string };
  protected abstract cornerOp(): { radius: number } | { d1: number; d2: number };
  protected abstract doneMessage(): string;

  protected refresh(): void {
    const t = this.title();
    this.prompt.set(this.first ? `${t}: ikinci çizgiyi ya da aynı çoklu çizginin komşu kenarını seçin [${this.settings()}]` : `${t}: ilk çizgiyi ya da çoklu çizgi kenarını seçin [${this.settings()}]`);
  }

  private pickAt(p: ToolPointer): CornerPick | null {
    const e = this.ctx.view.pickEdge(p.screen, this.editable) as CornerEntity | null;
    return e ? { entity: e, pick: p.raw, seg: e.kind === 'line' ? 0 : nearestSegment(e, p.raw) } : null;
  }

  private plan(second: CornerPick): CornerPlan | { error: string } {
    const f = this.first!;
    const a = f.entity;
    const b = second.entity;
    if (a.kind === 'line' && b.kind === 'line') {
      if (a.id === b.id) return { error: 'İkinci çizgi ilkinden farklı olmalı.' };
      return this.linesPlan(a, f.pick, b, second.pick);
    }
    if (a.id !== b.id || a.kind === 'line') return { error: 'Çoklu çizgide köşe için aynı nesnenin iki komşu kenarını seçin.' };
    const e = a as PolylineEntity;
    const n = e.pts.length;
    const closed = e.kind === 'polygon';
    const [i, j] = [f.seg, second.seg];
    // Segments i and j meet at the vertex they share.
    let vertex = -1;
    if (j === i + 1) vertex = j;
    else if (i === j + 1) vertex = i;
    else if (closed && ((i === n - 1 && j === 0) || (j === n - 1 && i === 0))) vertex = 0;
    if (vertex < 0) return { error: 'Seçilen kenarlar komşu değil; aralarında ortak köşe olan iki kenar seçin.' };
    const r = cornerOfPath(e.pts, e.bulges, closed, vertex, this.cornerOp());
    if ('error' in r) return r;
    return { kind: 'path', geometry: { kind: e.kind, pts: r.pts, ...(r.bulges && { bulges: r.bulges }) }, label: this.title() };
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const pick = this.pickAt(p);
    if (!pick) return this.ctx.log.warn('Düzenlenebilir bir çizgiye ya da çoklu çizgi kenarına tıklayın.');
    if (!this.first) {
      this.first = pick;
      return this.refresh();
    }
    const plan = this.plan(pick);
    if ('error' in plan) return this.ctx.log.warn(plan.error);
    const { doc } = this.ctx;
    doc.transact(plan.label, () => {
      // The whole geometry is replaced: a shape without arcs must not keep old bulges.
      if (plan.kind === 'path') doc.update(pick.entity.id, { bulges: undefined, ...plan.geometry } as Partial<Entity>);
      else {
        const l1 = this.first!.entity;
        doc.update(l1.id, { a: plan.l1.a, b: plan.l1.b } as Partial<Entity>);
        doc.update(pick.entity.id, { a: plan.l2.a, b: plan.l2.b } as Partial<Entity>);
        if (plan.extra) doc.add(this.inherit(l1, plan.extra, false));
      }
    });
    this.ctx.log.success(this.doneMessage());
    this.first = null;
    this.refresh();
  }

  cancel(): boolean {
    if (!this.first) return false;
    this.first = null;
    this.refresh();
    return true;
  }

  draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    if (this.first) strokeGeometry(g, view, entityGeometry(this.first.entity), { color: pal.accent, width: 1.5 });
    const h = this.hover;
    if (!this.first || !h) return;
    const e = h.entity as CornerEntity;
    const plan = this.plan({ entity: e, pick: h.world, seg: e.kind === 'line' ? 0 : nearestSegment(e, h.world) });
    if ('error' in plan) return;
    if (plan.kind === 'path') return strokeGeometry(g, view, plan.geometry, { color: pal.accent, dash: [4, 3] });
    strokePath(g, view, [plan.l1.a, plan.l1.b], { color: pal.accent, dash: [4, 3] });
    strokePath(g, view, [plan.l2.a, plan.l2.b], { color: pal.accent, dash: [4, 3] });
    if (plan.extra) strokeGeometry(g, view, plan.extra, { color: pal.accent, dash: [4, 3] });
  }
}

export class FilletTool extends CornerTool {
  readonly id = 'fillet';
  private static radius = 0;

  protected settings(): string {
    return `yarıçap ${this.ctx.format.length(FilletTool.radius)}; yeni yarıçap için sayı yazın`;
  }
  protected title(): string {
    return 'Köşe yuvarla';
  }
  protected cornerOp() {
    return { radius: FilletTool.radius };
  }
  protected doneMessage(): string {
    return FilletTool.radius > 0 ? `Köşe ${this.ctx.format.length(FilletTool.radius)} yarıçapla yuvarlandı.` : 'Köşe birleştirildi.';
  }
  protected linesPlan(l1: LineEntity, p1: Vec2, l2: LineEntity, p2: Vec2): CornerPlan | { error: string } {
    const r = filletLines(l1, p1, l2, p2, FilletTool.radius);
    if ('error' in r) return r;
    return { kind: 'lines', l1: r.line1, l2: r.line2, extra: r.arc && { kind: 'arc', ...r.arc }, label: 'Köşe yuvarla' };
  }

  input(text: string): boolean {
    const n = parseNumber(text);
    if (n === null || n < 0) return false;
    FilletTool.radius = n;
    this.refresh();
    this.ctx.view.requestOverlay();
    return true;
  }
}

export class ChamferTool extends CornerTool {
  readonly id = 'chamfer';
  private static d1 = 1;
  private static d2 = 1;

  protected settings(): string {
    const f = this.ctx.format;
    return `mesafeler ${f.length(ChamferTool.d1, false)} / ${f.length(ChamferTool.d2)}; değiştirmek için d ya da d1,d2 yazın`;
  }
  protected title(): string {
    return 'Pah';
  }
  protected cornerOp() {
    return { d1: ChamferTool.d1, d2: ChamferTool.d2 };
  }
  protected doneMessage(): string {
    return 'Pah kırıldı.';
  }
  protected linesPlan(l1: LineEntity, p1: Vec2, l2: LineEntity, p2: Vec2): CornerPlan | { error: string } {
    const r = chamferLines(l1, p1, l2, p2, ChamferTool.d1, ChamferTool.d2);
    if ('error' in r) return r;
    return { kind: 'lines', l1: r.line1, l2: r.line2, extra: r.cut && { kind: 'line', ...r.cut }, label: 'Pah' };
  }

  input(text: string): boolean {
    const m = text.trim().match(/^(\d+(?:\.\d+)?)(?:\s*[,;]\s*(\d+(?:\.\d+)?))?$/);
    if (!m) return false;
    ChamferTool.d1 = +m[1];
    ChamferTool.d2 = m[2] !== undefined ? +m[2] : +m[1];
    this.refresh();
    this.ctx.view.requestOverlay();
    return true;
  }
}
