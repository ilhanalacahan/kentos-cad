import type { CrosshairSize } from '../app/state';
import type { CadDocument } from '../model/document';
import { entityAnchor, entityVertices, type Entity } from '../model/entities';
import { entityGrips, midGripSegment } from '../model/ops/grips';
import type { Bounds, Vec2 } from '../model/geometry';
import { layoutDimension, type DimensionLayout } from '../model/geom/dimension';
import type { LabelStyle } from '../model/layers';
import { resolveColor, type CanvasPalette } from '../render/color';
import type { ToolCursor } from '../tools/Tool';
import type { Camera } from './Camera';
import type { TrackHit } from './objectTracking';
import { SNAP_LABEL, type SnapHit } from './picking';

/** Screen-space annotation layer drawn with Canvas2D above the GPU canvas. */

const FONT = 'Barlow, system-ui, sans-serif';

function haloText(g: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, halo: string): void {
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = halo;
  g.strokeText(text, x, y);
  g.fillStyle = fill;
  g.fillText(text, x, y);
}

const DEFAULT_LABELS: Partial<Record<Entity['kind'], LabelStyle>> = {
  polygon: { placement: 'center', size: 10, grow: 1, maxSize: 14, minFeaturePx: 26 },
  circle: { placement: 'center', size: 10, minFeaturePx: 26 },
  point: { placement: 'beside', size: 10.5, minScale: 2 },
  polyline: { placement: 'along', size: 10, minScale: 1.6 },
  line: { placement: 'along', size: 10, minScale: 1.6 },
};

/**
 * Entity labels and text. Placement, size and visibility come from the
 * layer's LabelStyle, so this function knows nothing about specific layers.
 */
export function drawLabels(
  g: CanvasRenderingContext2D,
  doc: CadDocument,
  cam: Camera,
  pal: CanvasPalette,
  boundsOf: (e: Entity) => Bounds,
  dimensionText: (l: DimensionLayout) => string,
  editingId: number | null = null,
): void {
  const view = cam.visibleBounds();
  const layers = doc.layers;
  const ink = { fg: pal.fg, 'fg-dim': pal.fgDim, label: pal.label } as const;
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const e of doc.all()) {
    if (!layers.isVisible(e.layerId)) continue;
    const b = boundsOf(e);
    if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;

    if (e.id === editingId) continue; // the inline editor draws it
    if (e.kind === 'dimension') {
      const px = e.height * cam.scale;
      const l = layoutDimension(e);
      if (!l || px < 5 || px > 240) continue;
      const s = cam.worldToScreen(l.textAt);
      g.save();
      g.translate(s.x, s.y);
      g.rotate((-l.rotation * Math.PI) / 180);
      g.font = `500 ${px.toFixed(1)}px ${FONT}`;
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      const color = e.color ?? layers.get(e.layerId)?.style.color;
      haloText(g, e.text || dimensionText(l), 0, 0, !color || color === 'fg' || color === 'fg-dim' ? pal.label : resolveColor(color, pal), pal.labelHalo);
      g.restore();
      continue;
    }
    if (e.kind === 'text') {
      const px = e.height * cam.scale;
      if (px < 5 || px > 240) continue;
      const s = cam.worldToScreen(e.p);
      g.save();
      g.translate(s.x, s.y);
      g.rotate((-e.rotation * Math.PI) / 180);
      g.font = `italic 400 ${px.toFixed(1)}px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      haloText(g, e.text, 0, 0, pal.label, pal.labelHalo);
      g.restore();
      continue;
    }
    if (!e.label) continue;
    const st = layers.get(e.layerId)?.style.label ?? DEFAULT_LABELS[e.kind];
    if (!st) continue;
    if (st.minScale !== undefined && cam.scale < st.minScale) continue;
    if (st.maxScale !== undefined && cam.scale > st.maxScale) continue;
    if (st.minFeaturePx !== undefined && Math.min(b.maxX - b.minX, b.maxY - b.minY) * cam.scale < st.minFeaturePx) continue;

    const size = Math.min(st.maxSize ?? st.size, st.size + (st.grow ?? 0) * cam.scale);
    const text = st.template ? st.template.replace('{label}', e.label) : e.label;
    const color = ink[st.ink ?? 'label'];
    g.font = `${st.weight ?? 500} ${size.toFixed(1)}px ${FONT}`;

    switch (st.placement) {
      case 'center': {
        const s = cam.worldToScreen(entityAnchor(e));
        haloText(g, text, s.x, s.y, color, pal.labelHalo);
        break;
      }
      case 'corner': {
        const tl = cam.worldToScreen({ x: b.minX, y: b.maxY });
        g.textAlign = 'left';
        haloText(g, text, tl.x + 8, tl.y + 14, color, pal.labelHalo);
        g.textAlign = 'center';
        break;
      }
      case 'beside': {
        const s = cam.worldToScreen(entityAnchor(e));
        g.textAlign = 'left';
        haloText(g, text, s.x + 7, s.y - 7, color, pal.labelHalo);
        g.textAlign = 'center';
        break;
      }
      case 'along': {
        // Placed a third of the way along, kept upright.
        const pts = entityVertices(e);
        if (pts.length < 2) break;
        const i = Math.min(Math.floor(pts.length * 0.35), pts.length - 2);
        const a = cam.worldToScreen(pts[i]);
        const c = cam.worldToScreen(pts[i + 1]);
        let ang = Math.atan2(c.y - a.y, c.x - a.x);
        if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
        g.save();
        g.translate((a.x + c.x) / 2, (a.y + c.y) / 2);
        g.rotate(ang);
        haloText(g, text, 0, 0, color, pal.labelHalo);
        g.restore();
        break;
      }
    }
  }
  g.restore();
}

/**
 * Grip squares on selected entities. Grips closer than 9 px on screen are
 * thinned so dense polylines (contours) stay readable.
 */
export function drawGrips(
  g: CanvasRenderingContext2D,
  entities: Entity[],
  cam: Camera,
  pal: CanvasPalette,
  hot: { id: number; index: number } | null = null,
): void {
  if (entities.length > 150) return;
  g.save();
  g.fillStyle = pal.accent;
  g.strokeStyle = pal.labelHalo;
  g.lineWidth = 1;
  for (const e of entities) {
    let last: Vec2 | null = null;
    const grips = entityGrips(e);
    for (const [i, p] of grips.entries()) {
      if (hot && hot.id === e.id && hot.index === i) continue;
      const s = cam.worldToScreen(p);
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      if (midGripSegment(e, i) !== null) {
        // Mid grips (add a vertex / bend an arc): small hollow diamonds, hidden on short segments.
        if (!midGripVisible(e, i, grips, cam)) continue;
        g.save();
        g.fillStyle = pal.labelHalo;
        g.strokeStyle = pal.accent;
        g.beginPath();
        g.moveTo(x, y - 4);
        g.lineTo(x + 4, y);
        g.lineTo(x, y + 4);
        g.lineTo(x - 4, y);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
        continue;
      }
      if (last && Math.abs(s.x - last.x) < 9 && Math.abs(s.y - last.y) < 9) continue;
      last = s;
      g.fillRect(x - 3, y - 3, 6, 6);
      g.strokeRect(x - 3.5, y - 3.5, 7, 7);
    }
  }
  // The grip being edited ("sıcak tutamaç") is drawn larger in ink colour.
  const he = hot && entities.find((e) => e.id === hot.id);
  const hp = he ? entityGrips(he)[hot!.index] : null;
  if (hp) {
    const s = cam.worldToScreen(hp);
    g.fillStyle = pal.fg;
    g.strokeStyle = pal.accent;
    g.lineWidth = 1.5;
    g.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 8, 8);
    g.strokeRect(Math.round(s.x) - 4.5, Math.round(s.y) - 4.5, 9, 9);
  }
  g.restore();
}

export function drawSnap(g: CanvasRenderingContext2D, hit: SnapHit, cam: Camera, pal: CanvasPalette): void {
  const s = cam.worldToScreen(hit.point);
  const x = Math.round(s.x) + 0.5;
  const y = Math.round(s.y) + 0.5;
  g.save();
  g.strokeStyle = pal.snap;
  g.lineWidth = 1.5;
  g.beginPath();
  switch (hit.kind) {
    case 'midpoint':
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y + 5);
      g.lineTo(x - 6, y + 5);
      g.closePath();
      break;
    case 'center':
    case 'node':
      g.arc(x, y, 5.5, 0, Math.PI * 2);
      break;
    case 'quadrant':
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 6, y);
      g.closePath();
      break;
    case 'intersection':
      g.moveTo(x - 5, y - 5);
      g.lineTo(x + 5, y + 5);
      g.moveTo(x + 5, y - 5);
      g.lineTo(x - 5, y + 5);
      break;
    case 'perpendicular':
      g.moveTo(x - 6, y - 6);
      g.lineTo(x - 6, y + 5);
      g.lineTo(x + 6, y + 5);
      g.moveTo(x - 6, y);
      g.lineTo(x, y);
      g.lineTo(x, y + 5);
      break;
    case 'tangent':
      g.arc(x, y + 1, 4.5, 0, Math.PI * 2);
      g.moveTo(x - 6.5, y - 4.5);
      g.lineTo(x + 6.5, y - 4.5);
      break;
    case 'nearest':
      g.moveTo(x - 5, y - 5);
      g.lineTo(x + 5, y - 5);
      g.lineTo(x - 5, y + 5);
      g.lineTo(x + 5, y + 5);
      g.closePath();
      break;
    default:
      g.rect(x - 5, y - 5, 10, 10);
  }
  g.stroke();
  g.font = `500 10.5px ${FONT}`;
  g.textBaseline = 'bottom';
  // Above-right, so it never collides with the tool's measurement tag (below-right).
  haloText(g, SNAP_LABEL[hit.kind], x + 9, y - 7, pal.snap, pal.labelHalo);
  g.restore();
}

const CROSSHAIR_ARM: Record<CrosshairSize, number> = { small: 16, medium: 40, full: 1e5 };

export function drawCrosshair(g: CanvasRenderingContext2D, at: Vec2, cursor: ToolCursor, pal: CanvasPalette, size: CrosshairSize): void {
  if (cursor === 'grab') return;
  const x = Math.round(at.x) + 0.5;
  const y = Math.round(at.y) + 0.5;
  const arm = size === 'full' ? CROSSHAIR_ARM.full : cursor === 'pick' ? Math.round(CROSSHAIR_ARM[size] * 0.55) : CROSSHAIR_ARM[size];
  const box = cursor === 'pick' ? 5 : 0;
  g.save();
  g.strokeStyle = pal.fg;
  g.globalAlpha = 0.85;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x - arm, y);
  g.lineTo(x - box, y);
  g.moveTo(x + box, y);
  g.lineTo(x + arm, y);
  g.moveTo(x, y - arm);
  g.lineTo(x, y - box);
  g.moveTo(x, y + box);
  g.lineTo(x, y + arm);
  if (box) g.rect(x - box, y - box, box * 2, box * 2);
  g.stroke();
  g.restore();
}

/** Alternating map scale bar, bottom-right (the toolbox usually sits left). */
export function drawScaleBar(g: CanvasRenderingContext2D, cam: Camera, pal: CanvasPalette): void {
  const targetPx = 120;
  const raw = targetPx / cam.scale;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const len = [1, 2, 5, 10].map((m) => m * p).reduce((best, v) => (Math.abs(v * cam.scale - targetPx) < Math.abs(best * cam.scale - targetPx) ? v : best));
  const px = len * cam.scale;
  const x0 = cam.width - 20 - px;
  const y0 = cam.height - 22;
  g.save();
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? pal.labelHalo : pal.fg;
    g.fillRect(x0 + (px / 4) * i, y0, px / 4, 4);
  }
  g.strokeStyle = pal.fg;
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, y0 + 0.5, px, 4);
  g.font = `500 10.5px ${FONT}`;
  g.textBaseline = 'bottom';
  g.textAlign = 'left';
  haloText(g, '0', x0, y0 - 3, pal.label, pal.labelHalo);
  g.textAlign = 'right';
  const unit = len >= 1000 ? `${len / 1000} km` : len >= 1 ? `${len} m` : `${(len * 100).toPrecision(2)} cm`;
  haloText(g, unit, x0 + px, y0 - 3, pal.label, pal.labelHalo);
  g.restore();
}

/** Grid-north arrow with Turkish "K" (Kuzey), top-right. */
export function drawNorthArrow(g: CanvasRenderingContext2D, cam: Camera, pal: CanvasPalette): void {
  const x = cam.width - 30;
  const y = 22;
  g.save();
  g.fillStyle = pal.fg;
  g.strokeStyle = pal.fg;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x, y + 6);
  g.lineTo(x + 6, y + 28);
  g.lineTo(x, y + 23);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(x, y + 6);
  g.lineTo(x - 6, y + 28);
  g.lineTo(x, y + 23);
  g.closePath();
  g.stroke();
  g.font = `600 11px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  haloText(g, 'K', x, y + 3, pal.fg, pal.labelHalo);
  g.restore();
}

/** A mid grip is offered only when its segment is long enough on screen to tell it from the vertices. */
export function midGripVisible(e: Entity, index: number, grips: readonly Vec2[], cam: Camera): boolean {
  const seg = midGripSegment(e, index);
  if (seg === null || (e.kind !== 'polyline' && e.kind !== 'polygon')) return true;
  const n = e.pts.length;
  const a = cam.worldToScreen(grips[seg]);
  const b = cam.worldToScreen(grips[(seg + 1) % n]);
  return Math.hypot(b.x - a.x, b.y - a.y) >= 28;
}

/**
 * Object tracking: acquired points as small crosses, the alignment line(s)
 * the cursor is locked to (dashed, through the whole view) and a tag with
 * the distance and angle from the tracked point.
 */
export function drawObjectTracking(g: CanvasRenderingContext2D, acquired: readonly Vec2[], track: TrackHit | null, cam: Camera, pal: CanvasPalette, formatLength: (m: number) => string): void {
  if (!acquired.length) return;
  g.save();
  g.strokeStyle = pal.snap;
  g.lineWidth = 1.5;
  for (const p of acquired) {
    const s = cam.worldToScreen(p);
    const x = Math.round(s.x) + 0.5;
    const y = Math.round(s.y) + 0.5;
    g.beginPath();
    g.moveTo(x - 5, y);
    g.lineTo(x + 5, y);
    g.moveTo(x, y - 5);
    g.lineTo(x, y + 5);
    g.stroke();
  }
  if (track) {
    g.lineWidth = 1;
    g.globalAlpha = 0.85;
    g.setLineDash([3, 4]);
    for (const l of track.lines) {
      const o = cam.worldToScreen(l.origin);
      const r = (l.angle * Math.PI) / 180;
      g.beginPath();
      g.moveTo(o.x, o.y);
      g.lineTo(o.x + Math.cos(r) * 1e4, o.y - Math.sin(r) * 1e4);
      g.stroke();
    }
    g.setLineDash([]);
    g.globalAlpha = 1;
    const at = cam.worldToScreen(track.point);
    const l = track.lines[0];
    const text = track.lines.length > 1 ? 'İzleme: kesişim' : `İzleme ${formatLength(Math.hypot(track.point.x - l.origin.x, track.point.y - l.origin.y))} < ${l.angle}°`;
    g.font = `500 10.5px ${FONT}`;
    g.textBaseline = 'bottom';
    haloText(g, text, Math.round(at.x) + 9, Math.round(at.y) - 7, pal.snap, pal.labelHalo);
  }
  g.restore();
}
