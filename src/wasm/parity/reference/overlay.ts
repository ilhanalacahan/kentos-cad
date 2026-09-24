import type { CadDocument } from '../../../model/document';
import { entityAnchor, entityBounds, entityVertices, type Entity } from '../../../model/entities';
import type { Bounds } from '../../../model/geometry';
import { layoutDimension } from '../../../model/geom/dimension';
import { entityGrips, midGripSegment } from '../../../model/ops/grips';
import { DEFAULT_LABELS, DIMENSION_PREFIX, LABEL } from '../../../viewport/storeRecords';

/**
 * The overlay's decisions as the TypeScript made them before the geometry
 * store (docs/adr/0008, S1): `drawLabels` walked every object and decided
 * which texts, dimensions and labels to draw and where; `drawGrips` took
 * each selected object's grips. These return the same records the store
 * returns (viewport/storeRecords.ts) so the parity test can hold the store
 * to them until the TypeScript geometry is deleted (S3). The tests are the
 * old ones line for line; only the drawing is left out.
 */
export function tsLabels(doc: CadDocument, view: Bounds, scale: number, editingId: number | null): number[] {
  const out: number[] = [];
  const layers = doc.layers;
  for (const e of doc.all()) {
    if (!layers.isVisible(e.layerId)) continue;
    const b = entityBounds(e);
    if (b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY) continue;
    if (e.id === editingId) continue;
    if (e.kind === 'dimension') {
      const px = e.height * scale;
      const l = layoutDimension(e);
      if (!l || px < 5 || px > 240) continue;
      out.push(e.id, LABEL.dimension, l.textAt.x, l.textAt.y, l.rotation, l.value, l.unit === 'angle' ? 1 : 0, DIMENSION_PREFIX.indexOf(l.prefix as (typeof DIMENSION_PREFIX)[number]));
      continue;
    }
    if (e.kind === 'text') {
      const px = e.height * scale;
      if (px < 5 || px > 240) continue;
      out.push(e.id, LABEL.text, e.p.x, e.p.y, e.rotation, 0, 0, 0);
      continue;
    }
    if (!e.label) continue;
    const st = layers.get(e.layerId)?.style.label ?? DEFAULT_LABELS[e.kind];
    if (!st) continue;
    if (st.minScale !== undefined && scale < st.minScale) continue;
    if (st.maxScale !== undefined && scale > st.maxScale) continue;
    if (st.minFeaturePx !== undefined && Math.min(b.maxX - b.minX, b.maxY - b.minY) * scale < st.minFeaturePx) continue;
    switch (st.placement) {
      case 'center':
      case 'beside': {
        const a = entityAnchor(e);
        if (a) out.push(e.id, st.placement === 'center' ? LABEL.center : LABEL.beside, a.x, a.y, 0, 0, 0, 0);
        break;
      }
      case 'corner':
        out.push(e.id, LABEL.corner, b.minX, b.maxY, 0, 0, 0, 0);
        break;
      case 'along': {
        const pts = entityVertices(e);
        if (pts.length < 2) break;
        const i = Math.min(Math.floor(pts.length * 0.35), pts.length - 2);
        out.push(e.id, LABEL.along, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, 0, 0);
        break;
      }
    }
  }
  return out;
}

/** `id, count, vertices`, then `x, y, segment` per grip, as the store lists them. */
export function tsGrips(doc: CadDocument, ids: Iterable<number>): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const e: Entity | undefined = doc.get(id);
    if (!e) continue;
    const grips = entityGrips(e);
    out.push(id, grips.length, e.kind === 'polyline' || e.kind === 'polygon' ? e.pts.length : 0);
    grips.forEach((g, i) => out.push(g.x, g.y, midGripSegment(e, i) ?? -1));
  }
  return out;
}
