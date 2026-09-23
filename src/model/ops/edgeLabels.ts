import type { Vec2 } from '../geometry';
import { bulgeArc, bulgeAt, bulgeRingArea, segmentMid } from '../geom/bulge';

export interface EdgeLabel {
  /** Text anchor (baseline centre). */
  p: Vec2;
  /** Degrees CCW from east, always readable (−90° < r ≤ 90°). */
  rotation: number;
  /** Edge length in metres. */
  length: number;
}

/**
 * Placement of edge-length labels ("kenar ölçüleri") for a parcel or
 * polyline: centred on each edge, lifted to the outside of a closed ring
 * (to the left of an open path) by a gap proportional to text height.
 * Arc segments are labelled with their arc length at the arc's midpoint.
 */
export function edgeLabels(pts: readonly Vec2[], closed: boolean, height: number, minLength = 0, bulges?: readonly number[]): EdgeLabel[] {
  const n = pts.length;
  const count = closed ? n : n - 1;
  // For a CCW ring the outside is to the right of travel.
  const outside = closed ? (bulgeRingArea(pts, bulges) > 0 ? -1 : 1) : 1;
  const out: EdgeLabel[] = [];
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const chord = Math.hypot(dx, dy);
    const arc = bulgeArc(a, b, bulgeAt(bulges, i));
    const length = arc ? arc.r * Math.abs(arc.sweep) : chord;
    if (length < Math.max(minLength, 1e-9) || chord < 1e-12) continue;
    const nx = (-dy / chord) * outside;
    const ny = (dx / chord) * outside;
    // The tangent at an arc's midpoint is parallel to its chord.
    const mid = segmentMid(a, b, bulgeAt(bulges, i));
    let rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (rotation > 90) rotation -= 180;
    else if (rotation <= -90) rotation += 180;
    // Text grows from its baseline towards "up" (rotation + 90°). When up points
    // away from the edge the baseline sits a small gap outside; otherwise it
    // must clear a full text height so the glyphs stay off the line.
    const r = (rotation * Math.PI) / 180;
    const growsOutward = nx * -Math.sin(r) + ny * Math.cos(r) > 0;
    const lift = growsOutward ? height * 0.4 : height * 1.4;
    out.push({ p: { x: mid.x + nx * lift, y: mid.y + ny * lift }, rotation, length });
  }
  return out;
}
