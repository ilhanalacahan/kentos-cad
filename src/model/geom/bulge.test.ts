import { describe, expect, it } from 'vitest';
import { bulgeArc, bulgePathOutline, bulgeThrough, cleanBulgePath, reverseBulgePath, segmentMid, segmentTangent, tangentBulge } from './bulge';
import { tangentTangentRadius } from './tangentCircle';

const v = (x: number, y: number) => ({ x, y });

describe('bulge helpers', () => {
  it('finds centre and radius of a bulged segment', () => {
    const a = bulgeArc(v(0, 0), v(10, 0), 1)!;
    expect(a.c.x).toBeCloseTo(5);
    expect(a.c.y).toBeCloseTo(0);
    expect(a.r).toBeCloseTo(5);
    expect(a.sweep).toBeCloseTo(Math.PI);
  });
  it('puts the mid point on the arc (right of travel for CCW)', () => {
    const m = segmentMid(v(0, 0), v(10, 0), 1);
    expect(m.x).toBeCloseTo(5);
    expect(m.y).toBeCloseTo(-5);
  });
  it('recovers the bulge from three points', () => {
    expect(bulgeThrough(v(0, 0), v(5, -5), v(10, 0))).toBeCloseTo(1);
    expect(bulgeThrough(v(0, 0), v(5, 5), v(10, 0))).toBeCloseTo(-1);
    expect(bulgeThrough(v(0, 0), v(5, 0), v(10, 0))).toBe(0);
  });
  it('continues tangentially and reports end tangents', () => {
    // Leaving (0,0) eastwards and ending at (10,10) is a CCW quarter circle.
    const b = tangentBulge(v(0, 0), v(1, 0), v(10, 10))!;
    expect(b).toBeCloseTo(Math.tan(Math.PI / 8));
    const t = segmentTangent(v(0, 0), v(10, 10), b, true);
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(1);
    expect(tangentBulge(v(0, 0), v(1, 0), v(-5, 0))).toBeNull();
  });
  it('reverses a ring and keeps each arc on its segment', () => {
    const r = reverseBulgePath([v(0, 0), v(10, 0), v(10, 10)], [0.5, 0, 0.2], true);
    expect(r.pts).toEqual([v(10, 10), v(10, 0), v(0, 0)]);
    // Segments: (10,10)→(10,0) was (10,0)→(10,10) [0]; (10,0)→(0,0) was [0.5]; closing (0,0)→(10,10) was [0.2].
    expect(r.bulges).toEqual([-0, -0.5, -0.2]);
  });
  it('drops duplicate vertices and keeps the surviving bulge', () => {
    const c = cleanBulgePath([v(0, 0), v(1, 0), v(1, 0), v(2, 0)], [0, 0, 0.3, 0], false);
    expect(c.pts).toHaveLength(3);
    expect(c.bulges).toEqual([0, 0.3, 0]);
  });
  it('tessellates without repeating the ring start', () => {
    const o = bulgePathOutline([v(0, 0), v(10, 0)], [1, 1], true);
    expect(o[0]).toEqual(v(0, 0));
    expect(Math.hypot(o.at(-1)!.x, o.at(-1)!.y)).toBeGreaterThan(1e-6);
  });
});

describe('tangentTangentRadius', () => {
  it('fits a circle into the corner of two lines', () => {
    const c = tangentTangentRadius({ kind: 'seg', a: v(0, 0), b: v(10, 0) }, v(3, 0), { kind: 'seg', a: v(0, 0), b: v(0, 10) }, v(0, 3), 2)!;
    expect(c.c.x).toBeCloseTo(2);
    expect(c.c.y).toBeCloseTo(2);
  });
  it('touches a line and a circle', () => {
    const circle = { kind: 'arc' as const, c: v(0, 5), r: 2, a0: 0, sweep: Math.PI * 2 };
    // Gap between line and circle is 3, so a radius-2 circle fits outside both.
    const c = tangentTangentRadius({ kind: 'seg', a: v(-10, 0), b: v(10, 0) }, v(3, 0), circle, v(1, 4), 2)!;
    expect(c.c.y).toBeCloseTo(2);
    expect(Math.hypot(c.c.x, c.c.y - 5)).toBeCloseTo(4);
    expect(c.c.x).toBeGreaterThan(0);
  });
  it('returns null when no circle of that radius fits', () => {
    expect(tangentTangentRadius({ kind: 'seg', a: v(0, 0), b: v(10, 0) }, v(1, 0), { kind: 'seg', a: v(0, 1), b: v(10, 1) }, v(1, 1), 5)).toBeNull();
  });
});
