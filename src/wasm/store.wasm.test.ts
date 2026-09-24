import { describe, expect, it } from 'vitest';
import { CoreStore } from './core';
import { sameResult, toJson, type Tolerance } from './parity/harness';

/**
 * The frozen store fixture (fixtures/geometry/v1/store-v1.json: the
 * TypeScript PickIndex's answers on a fixed scene) through the app's path
 * into the WASM geometry store; Rust runs the same file natively
 * (crates/geometry-core/tests/store.rs). It stays after the TypeScript
 * reference is deleted (docs/adr/0008, S1).
 */

interface StoreFile {
  format: 'kentos.geometry-store';
  version: 1;
  tolerance: Tolerance;
  layers: unknown[];
  entities: unknown[];
  cases: { name: string; op: string; args: unknown[]; expect: unknown }[];
}

const files = import.meta.glob<string>('../../fixtures/geometry/v1/store-*.json', { query: '?raw', import: 'default', eager: true });
const KINDS = ['endpoint', 'midpoint', 'center', 'node', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'nearest'];

type Rect = { minX: number; minY: number; maxX: number; maxY: number };

function edges(f: Float64Array): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < f.length; ) {
    if (f[i] === 0) {
      out.push({ kind: 'seg', a: { x: f[i + 1], y: f[i + 2] }, b: { x: f[i + 3], y: f[i + 4] } });
      i += 5;
    } else {
      out.push({ kind: 'arc', c: { x: f[i + 1], y: f[i + 2] }, r: f[i + 3], a0: f[i + 4], sweep: f[i + 5] });
      i += 6;
    }
  }
  return out;
}

function answer(s: CoreStore, op: string, a: unknown[]): unknown {
  const n = (i: number) => a[i] as number;
  const r = a[0] as Rect;
  const except = (a[1] as number | null) ?? undefined;
  switch (op) {
    case 'hit':
      return s.hit(n(0), n(1), n(2)) ?? null;
    case 'hitEdge': {
      const h = s.hitEdge(n(0), n(1), n(2));
      return h.length ? h[0] : null;
    }
    case 'snap': {
      let mask = 0;
      for (const k of a[3] as string[]) mask |= 1 << KINDS.indexOf(k);
      const h = s.snap(n(0), n(1), n(2), mask, a[4] as { x: number; y: number } | null);
      return h.length ? { kind: KINDS[h[0]], point: { x: h[1], y: h[2] }, entityId: h[3] } : null;
    }
    case 'enclosing': {
      const e = s.enclosing(n(0), n(1));
      if (!e.length) return null;
      const ring = [];
      for (let i = 1; i + 1 < e.length; i += 2) ring.push({ x: e[i], y: e[i + 1] });
      return { id: e[0], ring };
    }
    case 'inRect':
      return Array.from(s.inRect(r.minX, r.minY, r.maxX, r.maxY, a[1] as boolean));
    case 'overlapping':
      return Array.from(s.overlapping(r.minX, r.minY, r.maxX, r.maxY, except));
    case 'edgesIn':
      return edges(s.edgesIn(r.minX, r.minY, r.maxX, r.maxY, except));
  }
  throw new Error(`bilinmeyen sorgu: ${op}`);
}

for (const [path, text] of Object.entries(files)) {
  const file = JSON.parse(text) as StoreFile;
  describe(`WASM: ${path.split('/').pop()}`, () => {
    it('is a store fixture for projected metres', () => {
      expect(file.format).toBe('kentos.geometry-store');
      expect(file.version).toBe(1);
      expect(file.cases.length).toBeGreaterThan(500);
    });
    it('every answer matches', () => {
      const s = new CoreStore();
      s.put(JSON.stringify(file.entities));
      s.setLayers(JSON.stringify(file.layers));
      const failures = file.cases.map((c) => sameResult(toJson(answer(s, c.op, c.args)), c.expect, file.tolerance, `${c.op} ${c.name}`)).filter(Boolean);
      s.dispose();
      expect(failures.slice(0, 5).join('\n')).toBe('');
    });
  });
}
