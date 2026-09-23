import { describe, expect, it } from 'vitest';
import type { Entity } from '../model/entities';
import { classesPresent, classLabel, equalCount, equalInterval, numericValues, plainSymbols, rampColors, uniqueValues, valuesOf } from './classify';

const poly = (attrs: Record<string, string>, id = 1): Entity => ({ id, kind: 'polygon', layerId: 'a', attrs, pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] });
const scope = { layerName: () => 'Parseller' };

describe('classify', () => {
  it('reads an expression per object and lists distinct values with counts in natural order', () => {
    const list = [poly({ Nitelik: 'Tarla' }), poly({ Nitelik: 'Arsa' }), poly({ Nitelik: 'Arsa' }), poly({}), poly({ Nitelik: 'Bağ' })];
    const { values, error } = valuesOf(list, 'Nitelik', scope);
    expect(error).toBeUndefined();
    expect(uniqueValues(values)).toEqual([
      { value: 'Arsa', count: 2 },
      { value: 'Bağ', count: 1 },
      { value: 'Tarla', count: 1 },
    ]);
    expect(uniqueValues(['10', '9', '100'])).toEqual([
      { value: '9', count: 1 },
      { value: '10', count: 1 },
      { value: '100', count: 1 },
    ]);
    expect(valuesOf(list, 'Nitelik +', scope).error).toBeTruthy();
  });

  it('makes equal-interval and equal-count classes', () => {
    const v = [0, 1, 2, 3, 4, 5, 6, 7, 8, 100];
    expect(equalInterval(v, 4).map((c) => [c.min, c.max])).toEqual([
      [0, 25],
      [25, 50],
      [50, 75],
      [75, 100],
    ]);
    const q = equalCount(v, 2);
    expect(q.map((c) => [c.min, c.max])).toEqual([
      [0, 5],
      [5, 100],
    ]);
    expect(equalInterval([3, 3], 5)).toEqual([{ min: 3, max: 3 }]);
    expect(equalCount([], 3)).toEqual([]);
    expect(numericValues(['12.5', 'abc', null, '7'])).toEqual([12.5, 7]);
    expect(classLabel({ min: 1.234, max: 5 })).toBe('1.23 – 5');
  });

  it('spreads colours along a ramp and makes plain symbols for the geometries present', () => {
    expect(rampColors(['#000000', '#FFFFFF'], 3)).toEqual(['#000000', '#808080', '#FFFFFF']);
    const present = classesPresent([poly({})]);
    expect(present).toEqual({ fill: 1, line: 0, marker: 0 });
    expect(Object.keys(plainSymbols('#FF0000', present))).toEqual(['fill']);
    expect(Object.keys(plainSymbols('#FF0000', { fill: 0, line: 0, marker: 0 })).sort()).toEqual(['fill', 'line', 'marker']);
  });
});
