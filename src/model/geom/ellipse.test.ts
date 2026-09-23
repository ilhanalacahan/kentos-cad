import { describe, expect, it } from 'vitest';
import {
  closestParam,
  ellipseArea,
  ellipseFromAxis,
  ellipseFromCenter,
  ellipseLength,
  ellipsePoint,
  ellipseTangentPoints,
  lineEllipse,
  paramAtPolar,
  paramOfPoint,
  quadrantParams,
  tessellateEllipse,
  type EllipseGeom,
} from './ellipse';

const v = (x: number, y: number) => ({ x, y });
// 10 × 5 half-axes, major along +x.
const E: EllipseGeom = { c: v(0, 0), major: v(10, 0), ratio: 0.5, t0: 0, t1: 0 };

describe('ellipse', () => {
  it('evaluates points and parameters both ways', () => {
    expect(ellipsePoint(E, Math.PI / 2).y).toBeCloseTo(5, 12);
    expect(paramOfPoint(E, v(0, 5))).toBeCloseTo(Math.PI / 2, 12);
  });
  it('measures a circle exactly and an ellipse to Ramanujan precision', () => {
    expect(ellipseLength({ ...E, ratio: 1 })).toBeCloseTo(2 * Math.PI * 10, 9);
    const a = 10;
    const b = 5;
    const h = ((a - b) / (a + b)) ** 2;
    const ramanujan = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(ellipseLength(E)).toBeCloseTo(ramanujan, 6);
    expect(ellipseArea(E)).toBeCloseTo(Math.PI * 50, 12);
  });
  it('crosses a line exactly', () => {
    const hits = lineEllipse(E, v(-20, 0), v(20, 0));
    expect(hits.map((h) => ellipsePoint(E, h.t).x).sort((a, b) => a - b)).toEqual([-10, 10].map((x) => expect.closeTo(x, 12)));
    const diag = lineEllipse(E, v(0, 0), v(1, 1));
    for (const h of diag) {
      const p = ellipsePoint(E, h.t);
      expect(p.x).toBeCloseTo(p.y, 12);
      expect((p.x / 10) ** 2 + (p.y / 5) ** 2).toBeCloseTo(1, 12);
    }
  });
  it('finds the closest point with Newton steps', () => {
    const t = closestParam(E, v(3, 20));
    const p = ellipsePoint(E, t);
    // The residual from the true foot is orthogonal to the tangent.
    const d = { x: -10 * Math.sin(t), y: 5 * Math.cos(t) };
    expect((p.x - 3) * d.x + (p.y - 20) * d.y).toBeCloseTo(0, 9);
    expect(p.y).toBeGreaterThan(0);
  });
  it('limits an arc to its range', () => {
    const arc = { ...E, t0: 0, t1: Math.PI / 2 };
    expect(quadrantParams(arc)).toEqual([0, Math.PI / 2]);
    expect(lineEllipse(arc, v(-20, 0), v(20, 0))).toHaveLength(1);
    expect(tessellateEllipse(arc).at(-1)!.y).toBeCloseTo(5, 12);
  });
  it('gives exact tangent points from outside', () => {
    const pts = ellipseTangentPoints(E, v(20, 0));
    expect(pts).toHaveLength(2);
    for (const p of pts) {
      // Tangency: (p − P)·normal = 0 with normal (x/a², y/b²).
      expect((20 - p.x) * (p.x / 100) + (0 - p.y) * (p.y / 25)).toBeCloseTo(0, 9);
    }
  });
  it('maps a polar angle to its parameter', () => {
    const t = paramAtPolar(E, Math.PI / 4);
    const p = ellipsePoint(E, t);
    expect(p.x).toBeCloseTo(p.y, 12);
  });
  it('builds from an axis and makes the longer axis the major one', () => {
    const e = ellipseFromAxis(v(-4, 0), v(4, 0), 10)!;
    expect(Math.hypot(e.major.x, e.major.y)).toBeCloseTo(10, 12);
    expect(e.ratio).toBeCloseTo(0.4, 12);
    expect(ellipseFromCenter(v(0, 0), v(0, 0), 3)).toBeNull();
  });
});
