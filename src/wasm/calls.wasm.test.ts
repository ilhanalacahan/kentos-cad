import { describe, expect, it } from 'vitest';
import { callNamed } from './core';
import { sameResult, toJson, type CallFile } from './parity/harness';

/**
 * The frozen call fixtures (fixtures/geometry/v1/calls-*.json) through the
 * app's own path into the WASM core; Rust runs the same files natively
 * (crates/geometry-core/tests/calls.rs). They stay after the TypeScript
 * reference is deleted (docs/adr/0008).
 */
const files = import.meta.glob<string>('../../fixtures/geometry/v1/calls-*.json', { query: '?raw', import: 'default', eager: true });

for (const [path, text] of Object.entries(files)) {
  const file = JSON.parse(text) as CallFile;
  describe(`WASM: ${path.split('/').pop()}`, () => {
    it('is a call fixture for projected metres', () => {
      expect(file.format).toBe('kentos.geometry-calls');
      expect(file.version).toBe(1);
      expect(file.crs.unit).toBe('metre');
      expect(file.cases.length).toBeGreaterThan(0);
    });
    it('every case matches', () => {
      const failures = file.cases.map((c) => sameResult(toJson(callNamed(c.fn, c.args)), c.expect, file.tolerance, `${c.fn}: ${c.name}`)).filter(Boolean);
      expect(failures.slice(0, 5).join('\n')).toBe('');
    });
  });
}
