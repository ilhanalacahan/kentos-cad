import { describe, expect, it } from 'vitest';
import { Formatter } from '../app/format';
import { CadDocument } from './document';
import { LayerStore } from './layers';

const makeDoc = () =>
  new CadDocument({
    name: 't.kcad',
    layers: new LayerStore([{ id: 'g', name: 'G', children: [{ id: 'a', name: 'A' }] }], 'a'),
    origin: { x: 0, y: 0 },
  });

describe('CadDocument history', () => {
  it('undoes and redoes an add', () => {
    const doc = makeDoc();
    const e = doc.add({ kind: 'point', layerId: 'a', p: { x: 1, y: 2 }, attrs: {} });
    expect(doc.size).toBe(1);
    doc.undo();
    expect(doc.get(e.id)).toBeUndefined();
    doc.redo();
    expect(doc.get(e.id)).toBeDefined();
  });
  it('groups a transaction into one undo step', () => {
    const doc = makeDoc();
    doc.transact('iki', () => {
      doc.add({ kind: 'point', layerId: 'a', p: { x: 0, y: 0 }, attrs: {} });
      doc.add({ kind: 'point', layerId: 'a', p: { x: 1, y: 1 }, attrs: {} });
    });
    expect(doc.size).toBe(2);
    expect(doc.undo()).toBe('iki');
    expect(doc.size).toBe(0);
  });
  it('marks the project dirty when project settings change', () => {
    const doc = makeDoc();
    expect(doc.dirty.value).toBe(false);
    doc.settings.assign({ areaUnit: 'donum' });
    expect(doc.dirty.value).toBe(true);
  });
  it('rejects unknown SRIDs instead of guessing', () => {
    expect(() => makeDoc().settings.assign({ srid: 1 })).toThrow();
  });
});

describe('LayerStore', () => {
  it('inherits visibility and lock from groups', () => {
    const doc = makeDoc();
    doc.layers.setVisible('g', false);
    expect(doc.layers.isVisible('a')).toBe(false);
    doc.layers.toggleLocked('g');
    expect(doc.layers.isLocked('a')).toBe(true);
  });
});

describe('Formatter', () => {
  it('follows project unit settings', () => {
    const doc = makeDoc();
    const f = new Formatter(doc.settings);
    expect(f.area(12997.304)).toBe('12997.30 m²');
    doc.settings.assign({ areaUnit: 'donum', areaDecimals: 3 });
    expect(f.area(12997.304)).toBe('12.997 dönüm');
    doc.settings.assign({ angleUnit: 'deg' });
    expect(f.bearing(100)).toBe('90.0000°');
    expect(f.point({ x: 1.23456, y: 2 })).toBe('Y 1.235  X 2.000');
  });
});
