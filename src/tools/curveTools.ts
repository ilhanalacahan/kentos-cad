import { entityLength, tessellateCircle, type Entity } from '../model/entities';
import { dist, type Vec2 } from '../model/geometry';
import { arcThrough, circleThrough, normAngle, tessellateArc, type ArcGeom } from '../model/geom/arc';
import { closestOnEdge, type Edge } from '../model/geom/intersect';
import { catmullRom } from '../model/geom/spline';
import { tangentTangentRadius } from '../model/geom/tangentCircle';
import { entityEdges } from '../model/ops/edges';
import type { ViewTransform } from '../viewport/Camera';
import { parseNumber } from './coordinateInput';
import { PointInputTool } from './drawTools';
import { drawTag, strokePath } from './preview';
import type { ToolPointer } from './Tool';

const deg = (rad: number) => (rad * 180) / Math.PI;
const angleOf = (c: Vec2, p: Vec2) => Math.atan2(p.y - c.y, p.x - c.x);

// ── Yay ────────────────────────────────────────────────────────────────

/**
 * Arc: start, a point on the arc, end (default), or with M: centre, start,
 * end direction — counter-clockwise, or a typed included angle.
 */
export class ArcTool extends PointInputTool {
  readonly id = 'arc';
  protected readonly label = 'Yay';
  private mode: 'three' | 'center' = 'three';

  protected promptFor(n: number): string {
    if (this.mode === 'center') {
      return n === 0 ? 'yayın merkezini belirtin' : n === 1 ? 'başlangıç noktasını belirtin' : 'bitiş doğrultusunu gösterin ya da yay açısını yazın (derece, saat yönü tersine)';
    }
    return n === 0 ? 'başlangıç noktasını belirtin [Merkezden (M)]' : n === 1 ? 'yay üzerinde ikinci bir nokta belirtin' : 'bitiş noktasını belirtin';
  }

  protected override option(key: string): boolean {
    if (key !== 'M' || this.pts.length) return false;
    this.mode = 'center';
    this.refreshPrompt();
    return true;
  }

  /** Centre mode: arc from the start point sweeping to the direction of p. */
  private centerArc(p: Vec2): ArcGeom | null {
    const [c, s] = this.pts;
    const r = dist(c, s);
    if (r < 1e-9 || dist(c, p) < 1e-9) return null;
    return { c, r, a0: normAngle(angleOf(c, s)), a1: normAngle(angleOf(c, p)) };
  }

  protected onPoint(p: Vec2): void {
    const last = this.last;
    if (last && dist(last, p) < 1e-9) return;
    if (this.mode === 'center' && this.pts.length === 2) return this.commit(this.centerArc(p));
    this.pts.push(p);
    if (this.mode === 'center' || this.pts.length < 3) return;
    const g = arcThrough(this.pts[0], this.pts[1], this.pts[2]);
    if (!g) {
      this.ctx.log.warn('Üç nokta aynı doğru üzerinde; yay çizilemez.');
      this.pts = [];
      return;
    }
    this.commit(g);
  }

  override input(text: string): boolean {
    const n = parseNumber(text);
    if (this.mode === 'center' && this.pts.length === 2 && n !== null && !/[,;@<]/.test(text)) {
      if (Math.abs(n) < 1e-9 || Math.abs(n) >= 360) {
        this.ctx.log.warn('Yay açısı 0 ile 360 derece arasında olmalı.');
        return true;
      }
      const [c, s] = this.pts;
      const a0 = angleOf(c, s);
      const a1 = a0 + (n * Math.PI) / 180;
      // A negative angle runs clockwise: the same arc stored counter-clockwise.
      this.commit({ c, r: dist(c, s), a0: normAngle(n > 0 ? a0 : a1), a1: normAngle(n > 0 ? a1 : a0) });
      this.refreshPrompt();
      return true;
    }
    return super.input(text);
  }

  private commit(g: ArcGeom | null): void {
    if (g && this.create({ kind: 'arc', ...g })) this.ctx.log.success(`Yay eklendi: r = ${this.ctx.format.length(g.r)}`);
    this.pts = [];
    this.mode = 'three';
    this.ctx.view.requestOverlay();
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    if (this.pts.length === 2 && this.hover) {
      const arc = this.mode === 'center' ? this.centerArc(this.hover) : arcThrough(this.pts[0], this.pts[1], this.hover);
      if (arc) {
        strokePath(g, view, tessellateArc(arc), { color: pal.accent });
        if (this.mode === 'center') strokePath(g, view, [this.pts[0], this.hover], { color: pal.accent, dash: [3, 3] });
        const sweepDeg = deg(normAngle(arc.a1 - arc.a0));
        drawTag(g, view.worldToScreen(this.hover), [`r ${this.ctx.format.length(arc.r)}`, `Açı ${sweepDeg.toFixed(2)}°`], pal.accent, pal.labelHalo);
        return;
      }
    }
    if (this.mode === 'center' && this.pts.length === 1 && this.hover) {
      strokePath(g, view, tessellateCircle(this.pts[0], dist(this.pts[0], this.hover), 96), { color: pal.accent, closed: true, dash: [2, 4] });
    }
    super.draw(g, view);
  }
}

// ── Daire ──────────────────────────────────────────────────────────────

type CircleMode = 'center' | 'two' | 'three' | 'ttr';
interface TangentPick {
  edge: Edge;
  pick: Vec2;
}

/**
 * Circle by centre and radius (default), 2N (diameter ends), 3N (three
 * points on it) or TTY (tangent to two objects with a radius).
 */
export class CircleTool extends PointInputTool {
  readonly id = 'circle';
  protected readonly label = 'Daire';
  private static lastRadius = 0;
  private mode: CircleMode = 'center';
  private tangents: TangentPick[] = [];

  protected promptFor(n: number): string {
    switch (this.mode) {
      case 'two':
        return n === 0 ? 'çapın ilk ucunu belirtin' : 'çapın ikinci ucunu belirtin';
      case 'three':
        return ['ilk noktayı belirtin', 'ikinci noktayı belirtin', 'üçüncü noktayı belirtin'][n] ?? '';
      case 'ttr': {
        const r = CircleTool.lastRadius > 0 ? ` (Enter: ${this.ctx.format.length(CircleTool.lastRadius)})` : '';
        return ['ilk teğet çizgi, yay ya da daireyi seçin', 'ikinci teğet nesneyi seçin', `yarıçapı yazın${r}`][this.tangents.length];
      }
      default:
        return n === 0 ? 'merkez noktasını belirtin [2 nokta (2N) / 3 nokta (3N) / Teğet-teğet-yarıçap (TTY)]' : 'yarıçapı belirtin ya da yazın';
    }
  }

  override get snaps(): boolean {
    return this.mode !== 'ttr';
  }

  protected override option(key: string): boolean {
    const modes: Record<string, CircleMode> = { '2N': 'two', '3N': 'three', TTY: 'ttr', M: 'center' };
    if (!modes[key] || this.pts.length) return false;
    this.mode = modes[key];
    this.tangents = [];
    this.refreshPrompt();
    this.ctx.view.requestOverlay();
    return true;
  }

  override pointerDown(p: ToolPointer): void {
    if (this.mode !== 'ttr') return super.pointerDown(p);
    if (p.button !== 0 || this.tangents.length >= 2) return;
    const e = this.ctx.view.pickEdge(p.screen, (x) => x.kind === 'line' || x.kind === 'polyline' || x.kind === 'polygon' || x.kind === 'arc' || x.kind === 'circle');
    if (!e) return this.ctx.log.warn('Teğet olunacak bir çizgi, çoklu çizgi, yay ya da daireye tıklayın.');
    const edge = nearestEdge(e, p.raw);
    if (!edge) return;
    this.tangents.push({ edge, pick: p.raw });
    this.refreshPrompt();
    this.ctx.view.requestOverlay();
  }

  protected onPoint(p: Vec2): void {
    const last = this.last;
    if (last && dist(last, p) < 1e-9) return;
    this.pts.push(p);
    const [a, b, c] = this.pts;
    if (this.mode === 'center' && b) return this.commit(a, dist(a, b));
    if (this.mode === 'two' && b) return this.commit({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist(a, b) / 2);
    if (this.mode === 'three' && c) {
      const circle = circleThrough(a, b, c);
      if (!circle) {
        this.ctx.log.warn('Üç nokta aynı doğru üzerinde; daire çizilemez.');
        this.pts = [];
        return;
      }
      this.commit(circle.c, circle.r);
    }
  }

  override input(text: string): boolean {
    const r = parseNumber(text);
    const radiusTyped = r !== null && r > 0 && !/[,;@<]/.test(text);
    if (this.mode === 'ttr' && this.tangents.length === 2) {
      if (!radiusTyped) return false;
      this.commitTangent(r!);
      return true;
    }
    if (this.mode === 'center' && this.last && radiusTyped) {
      this.commit(this.last, r!);
      this.refreshPrompt();
      return true;
    }
    return super.input(text);
  }

  override confirm(): void {
    if (this.mode === 'ttr' && this.tangents.length === 2 && CircleTool.lastRadius > 0) return this.commitTangent(CircleTool.lastRadius);
    if (this.mode === 'ttr' && this.tangents.length) {
      this.tangents = [];
      return this.refreshPrompt();
    }
    super.confirm();
  }

  private ttrCircle(r: number) {
    const [t1, t2] = this.tangents;
    return tangentTangentRadius(t1.edge, t1.pick, t2.edge, t2.pick, r);
  }

  private commitTangent(r: number): void {
    const c = this.ttrCircle(r);
    if (!c) {
      this.ctx.log.warn('Bu yarıçapla iki nesneye birden teğet bir daire yok.');
      return;
    }
    this.tangents = [];
    this.commit(c.c, c.r);
    this.refreshPrompt();
  }

  private commit(c: Vec2, r: number): void {
    if (r > 1e-9 && this.create({ kind: 'circle', c, r })) {
      CircleTool.lastRadius = r;
      this.ctx.log.success(`Daire eklendi: r = ${this.ctx.format.length(r)}`);
    }
    this.pts = [];
    this.ctx.view.requestOverlay();
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    if (this.mode === 'ttr') {
      for (const t of this.tangents) {
        const s = view.worldToScreen(t.pick);
        g.save();
        g.strokeStyle = pal.accent;
        g.strokeRect(Math.round(s.x) - 4.5, Math.round(s.y) - 4.5, 9, 9);
        g.restore();
      }
      const c = this.tangents.length === 2 && CircleTool.lastRadius > 0 ? this.ttrCircle(CircleTool.lastRadius) : null;
      if (c) strokePath(g, view, tessellateCircle(c.c, c.r, 96), { color: pal.accent, closed: true, dash: [4, 3] });
      return;
    }
    const h = this.hover;
    if (!h || !this.pts.length) return super.draw(g, view);
    const [a, b] = this.pts;
    let circle: { c: Vec2; r: number } | null = null;
    if (this.mode === 'center') circle = { c: a, r: dist(a, h) };
    else if (this.mode === 'two') circle = { c: { x: (a.x + h.x) / 2, y: (a.y + h.y) / 2 }, r: dist(a, h) / 2 };
    else if (b) circle = circleThrough(a, b, h);
    if (!circle) return super.draw(g, view);
    strokePath(g, view, tessellateCircle(circle.c, circle.r, 96), { color: pal.accent, closed: true });
    strokePath(g, view, [this.mode === 'center' ? a : circle.c, h], { color: pal.accent, dash: [3, 3] });
    drawTag(g, view.worldToScreen(h), [`r ${this.ctx.format.length(circle.r)}`], pal.accent, pal.labelHalo);
  }
}

/** The edge of `e` nearest to p (a polyline's clicked segment, a circle itself). */
function nearestEdge(e: Entity, p: Vec2): Edge | null {
  let best: { edge: Edge; d: number } | null = null;
  for (const edge of entityEdges(e)) {
    const d = closestOnEdge(edge, p).d;
    if (!best || d < best.d) best = { edge, d };
  }
  return best?.edge ?? null;
}

// ── Eğri ───────────────────────────────────────────────────────────────

/** Smooth curve through clicked points; Enter finishes, K closes it. */
export class SplineTool extends PointInputTool {
  readonly id = 'spline';
  protected readonly label = 'Eğri';

  protected promptFor(n: number): string {
    if (n === 0) return 'ilk noktayı belirtin';
    return n < 2 ? 'sonraki noktayı belirtin' : 'sonraki noktayı belirtin [Kapat (K) / Geri (G) / Bitir (Enter)]';
  }

  protected onPoint(p: Vec2): void {
    const last = this.last;
    if (!last || dist(last, p) > 1e-9) this.pts.push(p);
  }

  protected override option(key: string): boolean {
    if (key === 'G' && this.pts.length) {
      this.pts.pop();
      this.refreshPrompt();
      this.ctx.view.requestOverlay();
      return true;
    }
    if (key === 'K' && this.pts.length >= 3) {
      this.commit(true);
      return true;
    }
    return false;
  }

  protected override finish(): void {
    if (this.pts.length >= 2) this.commit(false);
    else super.finish();
  }

  private commit(closed: boolean): void {
    const e = this.create({ kind: 'spline', pts: [...this.pts], closed });
    if (e) this.ctx.log.success(`${closed ? 'Kapalı eğri' : 'Eğri'} eklendi: ${this.pts.length} nokta, ${this.ctx.format.length(entityLength(e)!)}`);
    this.reset();
  }

  override draw(g: CanvasRenderingContext2D, view: ViewTransform): void {
    const pal = this.ctx.view.palette;
    const chain = this.hover ? [...this.pts, this.hover] : this.pts;
    if (chain.length >= 2) strokePath(g, view, catmullRom(chain, false), { color: pal.accent });
    strokePath(g, view, chain, { color: pal.accent, dash: [2, 4] });
    this.drawTracking(g, view);
  }
}

