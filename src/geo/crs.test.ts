import { describe, expect, it } from 'vitest';
import text from '../../fixtures/crs/v1/registry.json?raw';
import { CRS_REGISTRY, crsBySrid, DEFAULT_SRID, searchCrs, turefZoneFor } from './crs';
import { crsFixture } from './crsFixture';

const file = JSON.parse(text) as ReturnType<typeof crsFixture>;

describe('CRS registry', () => {
  it('is the file shared with Rust (re-record after a deliberate change)', () => {
    expect(file).toEqual(JSON.parse(JSON.stringify(crsFixture(CRS_REGISTRY, DEFAULT_SRID))));
  });

  it('has one entry per SRID and knows the default', () => {
    expect(new Set(CRS_REGISTRY.map((c) => c.srid)).size).toBe(CRS_REGISTRY.length);
    expect(crsBySrid(DEFAULT_SRID)?.name).toBe('TUREF / TM36');
    expect(crsBySrid(1234)).toBeUndefined();
  });

  it('suggests the nearest TUREF zone, the western one on a boundary', () => {
    expect(turefZoneFor(32.85)?.srid).toBe(5255);
    expect(turefZoneFor(28.5)?.srid).toBe(5253);
    expect(turefZoneFor(28.5001)?.srid).toBe(5254);
    expect(turefZoneFor(50)?.srid).toBe(5259);
  });

  it('is searched by SRID, name or area, with Turkish case folding', () => {
    expect(searchCrs('EPSG:5256').map((c) => c.srid)).toEqual([5256]);
    expect(searchCrs('ed50 / tm').every((c) => c.datum === 'ED50')).toBe(true);
    expect(searchCrs('DÜNYA').map((c) => c.srid)).toEqual([4326]);
    expect(searchCrs('  ')).toHaveLength(CRS_REGISTRY.length);
  });
});
