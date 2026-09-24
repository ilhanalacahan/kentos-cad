import type { CadDocument } from '../../../model/document';
import { entityArea, entityLength, entityOutline, polygonRing, type Entity, type EntityGeometry } from '../../../model/entities';
import type { Bounds, Vec2 } from '../../../model/geometry';
import type { Affine } from '../../../model/geom/affine';
import { layoutDimension } from '../../../model/geom/dimension';
import type { Edge } from '../../../model/geom/intersect';
import { entityEdges } from '../../../model/ops/edges';
import { stretchEntity } from '../../../model/ops/stretch';
import { transformEntity } from '../../../model/ops/transform';
import { extendEntity, trimEntity, type ExtendResult, type TrimResult } from '../../../model/ops/trim';
import type { TsPickIndex } from './picking';

/**
 * The tool previews and totals as the TypeScript computed them before the
 * geometry store (docs/adr/0008, S1c): trim and extend against every
 * boundary edge the tool gathered, ghosts as `strokeGeometry` outlined
 * them, the properties panel's totals. They return what the store returns
 * so the parity test can hold it to them until S3.
 */

/** The trim and extend tools' boundaries: the chosen objects' edges, or every visible edge in view; the target left out. */
function boundaries(doc: CadDocument, ts: TsPickIndex, targetId: number, view: Bounds, chosen: ReadonlySet<number> | null): Edge[] {
  if (!chosen) return ts.edgesIn(view, targetId);
  const out: Edge[] = [];
  for (const id of chosen) {
    const e = id === targetId ? null : doc.get(id);
    if (e) out.push(...entityEdges(e));
  }
  return out;
}

export function tsTrim(doc: CadDocument, ts: TsPickIndex, target: Entity, at: Vec2, view: Bounds, chosen: ReadonlySet<number> | null): TrimResult {
  return trimEntity(target, at, boundaries(doc, ts, target.id, view, chosen));
}

export function tsExtend(doc: CadDocument, ts: TsPickIndex, target: Entity, at: Vec2, view: Bounds, chosen: ReadonlySet<number> | null): ExtendResult {
  return extendEntity(target, at, boundaries(doc, ts, target.id, view, chosen));
}

/** Paths as `strokeGeometry` strokes them: `flags, n, x0, y0, …` (0 open, 1 closed, 2 a marker). */
function outlinePaths(geom: EntityGeometry, out: number[]): void {
  const path = (flags: number, pts: readonly Vec2[]) => {
    out.push(flags, pts.length);
    for (const p of pts) out.push(p.x, p.y);
  };
  if (geom.kind === 'point' || geom.kind === 'text') return path(2, [geom.p]);
  if (geom.kind === 'dimension') {
    for (const [a, b] of layoutDimension(geom)?.lines ?? []) path(0, [a, b]);
    return;
  }
  path(geom.kind === 'polygon' || geom.kind === 'circle' ? 1 : 0, entityOutline(geom, 64));
  if (geom.kind === 'polygon') for (const h of geom.holes ?? []) path(1, polygonRing(h));
}

/** Ghosts of the modify tools: at most `limit` + 1, counted as `SelectionFirstTool.draw` counted them. */
export function tsGhosts(doc: CadDocument, ids: readonly number[], affines: readonly Affine[], limit: number): number[] {
  const out: number[] = [];
  const targets = ids.map((id) => doc.get(id)).filter((e): e is Entity => !!e);
  let drawn = 0;
  for (const m of affines)
    for (const e of targets) {
      if (drawn++ > limit) break;
      outlinePaths(transformEntity(e, m), out);
    }
  return out;
}

export function tsStretchGhosts(doc: CadDocument, ids: readonly number[], w: Bounds, dx: number, dy: number): number[] {
  const out: number[] = [];
  for (const id of ids) {
    const e = doc.get(id);
    const geom = e && stretchEntity(e, w, dx, dy);
    if (geom) outlinePaths(geom, out);
  }
  return out;
}

/** The properties panel's totals over the selection. */
export function tsMeasure(doc: CadDocument, ids: readonly number[]): { length: number; area: number } {
  const ents = ids.map((id) => doc.get(id)).filter((e): e is Entity => !!e);
  return {
    length: ents.reduce((s, e) => s + (e.kind === 'polygon' ? 0 : (entityLength(e) ?? 0)), 0),
    area: ents.reduce((s, e) => s + (entityArea(e) ?? 0), 0),
  };
}
