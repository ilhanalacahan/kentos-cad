import { apply, applyLinear, isReflection, lengthScale, translation, type Affine } from '../geom/affine';
import { arcEnd, arcStart, normAngle } from '../geom/arc';
import { isFullEllipse } from '../geom/ellipse';
import type { Entity } from '../entities';

const angleOf = (c: { x: number; y: number }, p: { x: number; y: number }) => normAngle(Math.atan2(p.y - c.y, p.x - c.x));

/**
 * Applies a similarity transform (move, rotate, uniform scale, mirror) to
 * any entity. Returns a copy with the same id; callers decide whether to
 * update the original or add the copy.
 */
export function transformEntity<E extends Entity>(e: E, m: Affine): E {
  const s = lengthScale(m);
  switch (e.kind) {
    case 'point':
      return { ...e, p: apply(m, e.p) };
    case 'line':
      return { ...e, a: apply(m, e.a), b: apply(m, e.b) };
    case 'polyline':
    case 'polygon':
      // A reflection turns every arc segment the other way.
      return { ...e, pts: e.pts.map((p) => apply(m, p)), ...(e.bulges && { bulges: isReflection(m) ? e.bulges.map((b) => -b) : [...e.bulges] }) };
    case 'circle':
      return { ...e, c: apply(m, e.c), r: e.r * s };
    case 'arc': {
      const c = apply(m, e.c);
      const start = apply(m, arcStart(e));
      const end = apply(m, arcEnd(e));
      // A reflection reverses orientation; swap so the arc stays CCW.
      return isReflection(m)
        ? { ...e, c, r: e.r * s, a0: angleOf(c, end), a1: angleOf(c, start) }
        : { ...e, c, r: e.r * s, a0: angleOf(c, start), a1: angleOf(c, end) };
    }
    case 'ellipse': {
      const major = applyLinear(m, e.major);
      // A reflection runs the parameter the other way: t → −t keeps the arc counter-clockwise.
      if (!isReflection(m) || isFullEllipse(e)) return { ...e, c: apply(m, e.c), major };
      return { ...e, c: apply(m, e.c), major, t0: normAngle(-e.t1), t1: normAngle(-e.t0) };
    }
    case 'xline':
    case 'ray': {
      const d = applyLinear(m, e.dir);
      const l = Math.hypot(d.x, d.y) || 1;
      return { ...e, p: apply(m, e.p), dir: { x: d.x / l, y: d.y / l } };
    }
    case 'spline':
      return { ...e, pts: e.pts.map((p) => apply(m, p)) };
    case 'dimension':
      // A reflection swaps left and right of a→b, so the offset changes sign.
      return { ...e, a: apply(m, e.a), b: apply(m, e.b), offset: e.offset * s * (isReflection(m) ? -1 : 1), height: e.height * s };
    case 'hatch': {
      const rad = (e.pattern.angle * Math.PI) / 180;
      const dir = applyLinear(m, { x: Math.cos(rad), y: Math.sin(rad) });
      const angle = ((((Math.atan2(dir.y, dir.x) * 180) / Math.PI) % 180) + 180) % 180;
      return { ...e, ring: e.ring.map((p) => apply(m, p)), pattern: { ...e.pattern, angle, spacing: e.pattern.spacing * s } };
    }
    case 'text': {
      const rad = (e.rotation * Math.PI) / 180;
      const dir = applyLinear(m, { x: Math.cos(rad), y: Math.sin(rad) });
      let rot = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      // Mirrored text stays readable (like AutoCAD MIRRTEXT = 0).
      if (isReflection(m)) rot += 180;
      rot = ((rot % 360) + 360) % 360;
      return { ...e, p: apply(m, e.p), rotation: rot, height: e.height * s };
    }
  }
}

export const translateEntity = <E extends Entity>(e: E, dx: number, dy: number): E => transformEntity(e, translation(dx, dy));
