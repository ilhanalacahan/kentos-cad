import type { Entity, EntityGeometry } from '../entities';
import type { Vec2 } from '../geometry';
import { normAngle } from '../geom/arc';
import { bulgeArc, bulgeAt } from '../geom/bulge';
import { layoutDimension, type DimensionLayout } from '../geom/dimension';
import { hatchLines } from '../geom/hatch';
import { catmullRom } from '../geom/spline';

export type ExplodeResult = { pieces: EntityGeometry[] } | { error: string };

/**
 * Breaks a compound entity into simple ones:
 *   polyline / polygon → lines and arcs (one per segment, holes included)
 *   spline → polyline through its tessellated curve (so it can be trimmed)
 *   dimension → lines and the value text · patterned hatch → lines
 * `valueText` renders a dimension's measured value (project units).
 */
export function explodeEntity(e: Entity, valueText: (l: DimensionLayout) => string): ExplodeResult {
  switch (e.kind) {
    case 'polyline':
    case 'polygon': {
      const closed = e.kind === 'polygon';
      // A polygon's holes come apart too.
      const pieces = [e, ...(closed ? (e.holes ?? []) : [])].flatMap((r) => segmentPieces(r.pts, r.bulges, closed));
      return pieces.length ? { pieces } : { error: 'Patlatılacak bir kenar yok.' };
    }
    case 'spline': {
      const pts = catmullRom(e.pts, e.closed);
      if (e.closed) pts.pop(); // the tessellation repeats the first point
      return { pieces: [{ kind: e.closed ? 'polygon' : 'polyline', pts }] };
    }
    case 'dimension': {
      const l = layoutDimension(e);
      if (!l) return { error: 'Ölçü geometrisi geçersiz.' };
      const arc = l.pick[0]?.kind === 'arc' ? l.pick[0] : null;
      // An angular dimension's arc comes out as one arc, not as the chords it is drawn with.
      const onArc = (p: { x: number; y: number }) => !!arc && Math.abs(Math.hypot(p.x - arc.c.x, p.y - arc.c.y) - arc.r) < 1e-9 * Math.max(1, arc.r);
      const pieces: EntityGeometry[] = l.lines.filter(([a, b]) => !(onArc(a) && onArc(b))).map(([a, b]) => ({ kind: 'line', a, b }));
      if (arc) pieces.push({ kind: 'arc', c: arc.c, r: arc.r, a0: normAngle(arc.a0), a1: normAngle(arc.a0 + arc.sweep) });
      const text = e.text || valueText(l);
      // textAt is the text's centre; single-line text is anchored at its start.
      const r = (l.rotation * Math.PI) / 180;
      const half = text.length * e.height * 0.55 * 0.5;
      pieces.push({ kind: 'text', p: { x: l.textAt.x - Math.cos(r) * half, y: l.textAt.y - Math.sin(r) * half }, text, height: e.height, rotation: l.rotation });
      return { pieces };
    }
    case 'hatch': {
      if (e.pattern.type === 'solid') return { error: 'Dolu tarama patlatılamaz; sınır olarak taranan şekli kullanın.' };
      const segs = hatchLines(e.ring, e.pattern.angle, e.pattern.spacing, e.holes).segments;
      if (e.pattern.type === 'cross') segs.push(...hatchLines(e.ring, e.pattern.angle + 90, e.pattern.spacing, e.holes).segments);
      return { pieces: segs.map(([a, b]) => ({ kind: 'line', a, b })) };
    }
    case 'circle':
    case 'ellipse':
      return { error: `${e.kind === 'circle' ? 'Daire' : 'Elips'} patlatılamaz; parçalamak için Kır (B) kullanın.` };
    default:
      return { error: 'Bu nesne zaten temel bir nesne; patlatılacak bir şey yok.' };
  }
}

/** Lines and counter-clockwise arcs, one per segment of a bulged path. */
function segmentPieces(pts: readonly Vec2[], bulges: readonly number[] | undefined, closed: boolean): EntityGeometry[] {
  const pieces: EntityGeometry[] = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-12) continue;
    const arc = bulgeArc(a, b, bulgeAt(bulges, i));
    if (!arc) pieces.push({ kind: 'line', a, b });
    else {
      // Arc entities are counter-clockwise; a clockwise segment swaps its ends.
      const end = arc.a0 + arc.sweep;
      const [a0, a1] = arc.sweep > 0 ? [arc.a0, end] : [end, arc.a0];
      pieces.push({ kind: 'arc', c: arc.c, r: arc.r, a0: normAngle(a0), a1: normAngle(a1) });
    }
  }
  return pieces;
}
