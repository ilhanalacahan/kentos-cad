import { entityBounds, type Entity } from '../model/entities';
import { dist, emptyBounds, type Vec2 } from '../model/geometry';
import { apply, compose, rotation, scaling, translation, type Affine } from '../model/geom/affine';
import { parseNumber } from './coordinateInput';
import { SelectionFirstTool } from './modifyTools';

/**
 * Polar array and align: selection-first tools that place copies or move
 * the selection by one similarity transform (so every entity kind works),
 * with ghosts previewing the result.
 */

/** Middle of the selection's bounds: the point a non-rotating polar copy is placed by. */
function centreOf(list: readonly Entity[]): Vec2 {
  const b = emptyBounds();
  for (const e of list) {
    const eb = entityBounds(e);
    b.minX = Math.min(b.minX, eb.minX);
    b.minY = Math.min(b.minY, eb.minY);
    b.maxX = Math.max(b.maxX, eb.maxX);
    b.maxY = Math.max(b.maxY, eb.maxY);
  }
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

// ── Kutupsal dizi ──────────────────────────────────────────────────────

/** Copies around a centre: count, fill angle (360 = full turn, minus = clockwise), items turning or not. */
export class PolarArrayTool extends SelectionFirstTool {
  readonly id = 'arrayPolar';
  protected readonly label = 'Kutupsal dizi';
  private static last = { count: 6, fill: 360, rotate: true };
  private centre: Vec2 | null = null;
  private ask: 'count' | 'fill' | null = null;

  protected begin(): void {
    this.centre = null;
    this.ask = null;
  }

  protected stagePrompt(): string {
    const l = PolarArrayTool.last;
    if (!this.centre) return 'dizinin merkezini gösterin';
    if (this.ask === 'count') return 'toplam adedi yazın (seçilen dahil, 2 ile 1000 arası)';
    if (this.ask === 'fill') return 'doldurma açısını derece olarak yazın (360 tam tur; eksi saat yönünde)';
    return `uygulamak için sağ tıklayın [Adet (N): ${l.count} / Açı (A): ${l.fill}° / Nesneleri döndür (D): ${l.rotate ? 'evet' : 'hayır'}]`;
  }

  protected point(p: Vec2): void {
    if (!this.centre) this.centre = p;
  }

  override input(text: string): boolean {
    if (this.picking || !this.centre) return super.input(text);
    const t = text.trim().toLocaleUpperCase('tr-TR');
    const l = PolarArrayTool.last;
    if (t === 'N' || t === 'A') this.ask = t === 'N' ? 'count' : 'fill';
    else if (t === 'D') l.rotate = !l.rotate;
    else {
      const n = parseNumber(text);
      if (n === null) return false;
      if (this.ask === 'fill') {
        if (Math.abs(n) < 1e-9 || Math.abs(n) > 360) {
          this.ctx.log.warn('Doldurma açısı 0 ile ±360 derece arasında olmalı.');
          return true;
        }
        l.fill = n;
      } else {
        if (!Number.isInteger(n) || n < 2 || n > 1000) {
          this.ctx.log.warn('Adet 2 ile 1000 arasında bir tam sayı olmalı.');
          return true;
        }
        l.count = n;
      }
      this.ask = null;
    }
    this.refresh();
    return true;
  }

  override confirm(): void {
    if (this.picking) return super.confirm();
    if (this.ask) {
      this.ask = null;
      return this.refresh();
    }
    if (!this.centre) return this.ctx.tools.exit();
    const n = this.applyTransforms(this.label, this.transforms(), true);
    const l = PolarArrayTool.last;
    this.ctx.log.success(`Kutupsal dizi: ${l.count} adet, ${l.fill}° içinde, ${n} yeni nesne.`);
    this.ctx.tools.exit();
  }

  private transforms(): Affine[] {
    const c = this.centre;
    if (!c) return [];
    const { count, fill, rotate } = PolarArrayTool.last;
    // A full turn shares the circle out; a partial fill puts the last copy on the end angle.
    const step = Math.abs(Math.abs(fill) - 360) < 1e-9 ? fill / count : fill / (count - 1);
    const ref = centreOf(this.targets());
    const out: Affine[] = [];
    for (let k = 1; k < count; k++) {
      const r = rotation((step * k * Math.PI) / 180, c);
      if (rotate) out.push(r);
      else {
        const to = apply(r, ref);
        out.push(translation(to.x - ref.x, to.y - ref.y));
      }
    }
    return out;
  }

  protected override previewTransforms(): Affine[] {
    return this.transforms();
  }

  protected override previewTag(): string[] {
    const l = PolarArrayTool.last;
    return this.centre ? [`${l.count} adet · ${l.fill}°`] : [];
  }
}

// ── Hizala ─────────────────────────────────────────────────────────────

/**
 * AutoCAD ALIGN: the first source point goes onto the first destination;
 * with a second pair the selection turns so the source direction lies on
 * the destination direction, and optionally scales to fit.
 */
export class AlignTool extends SelectionFirstTool {
  readonly id = 'align';
  protected readonly label = 'Hizala';
  private static scale = false;
  private pts: Vec2[] = [];

  protected begin(): void {
    this.pts = [];
  }

  protected override anchor(): Vec2 | null {
    return this.pts.length % 2 === 1 ? this.pts[this.pts.length - 1] : null;
  }

  protected stagePrompt(): string {
    const scale = `Ölçekle (Ö): ${AlignTool.scale ? 'evet' : 'hayır'}`;
    switch (this.pts.length) {
      case 0:
        return 'birinci kaynak noktasını gösterin';
      case 1:
        return 'birinci hedef noktasını gösterin';
      case 2:
        return `ikinci kaynak noktasını gösterin ya da yalnızca taşımak için sağ tıklayın [${scale}]`;
      default:
        return `ikinci hedef noktasını gösterin [${scale}]`;
    }
  }

  protected point(p: Vec2): void {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, p) < 1e-9 && this.pts.length % 2 === 0) return;
    this.pts.push(p);
    if (this.pts.length === 4) this.finish();
  }

  override input(text: string): boolean {
    const t = text.trim().toLocaleUpperCase('tr-TR');
    if (!this.picking && (t === 'Ö' || t === 'O')) {
      AlignTool.scale = !AlignTool.scale;
      this.refresh();
      return true;
    }
    return super.input(text);
  }

  override confirm(): void {
    if (this.picking) return super.confirm();
    if (this.pts.length === 2) return this.finish();
    this.ctx.tools.exit();
  }

  private transform(pts: readonly Vec2[]): Affine | null {
    const [s1, d1, s2, d2] = pts;
    if (!s1 || !d1) return null;
    if (!s2 || !d2) return translation(d1.x - s1.x, d1.y - s1.y);
    const ls = dist(s1, s2);
    const ld = dist(d1, d2);
    if (ls < 1e-9 || ld < 1e-9) return null;
    const turn = Math.atan2(d2.y - d1.y, d2.x - d1.x) - Math.atan2(s2.y - s1.y, s2.x - s1.x);
    const k = AlignTool.scale ? ld / ls : 1;
    // Around s1: scale, turn, then carry s1 onto d1.
    return compose(translation(d1.x - s1.x, d1.y - s1.y), compose(rotation(turn, s1), scaling(k, s1)));
  }

  private finish(): void {
    const m = this.transform(this.pts);
    if (!m) {
      this.ctx.log.warn('Kaynak ya da hedef noktaları çakışıyor; hizalama yapılamaz.');
      this.pts = this.pts.slice(0, 2);
      return this.refresh();
    }
    const n = this.applyTransforms(this.label, [m], false);
    this.ctx.log.success(`${n} nesne hizalandı${this.pts.length === 4 && AlignTool.scale ? ' ve ölçeklendi' : ''}.`);
    this.ctx.tools.exit();
  }

  protected override previewTransforms(): Affine[] {
    if (!this.hover) return [];
    const pts = this.pts.length === 1 || this.pts.length === 3 ? [...this.pts, this.hover] : this.pts;
    const m = this.transform(pts);
    return m ? [m] : [];
  }
}
