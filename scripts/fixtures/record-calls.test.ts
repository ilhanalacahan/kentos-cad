// Records the TypeScript reference results of every call set into
// fixtures/geometry/v1/calls-*.json (docs/adr/0008). Runs only on purpose,
// while the TypeScript implementation of a set still exists:
//   GOLDEN_WRITE=1 npx vitest run scripts/fixtures/record-calls.test.ts
// Outside src/ so the app's type check does not need Node's types.
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { callNamed } from '../../src/wasm/core';
import { callsOf, sameResult, TOLERANCE, toJson, type CallFile } from '../../src/wasm/parity/harness';
import { SETS } from '../../src/wasm/parity/sets';

/** Random calls kept per operation in the frozen file (the parity test runs more). */
const KEEP = 25;

it.runIf(!!process.env.GOLDEN_WRITE)('records the TypeScript reference into the call fixtures', () => {
  for (const set of SETS) {
    const file: CallFile = {
      format: 'kentos.geometry-calls',
      version: 1,
      tolerance: TOLERANCE,
      crs: { kind: 'projected', unit: 'metre', note: 'Koordinatlar metre cinsinden bir projeksiyon düzlemindedir; tolerans bu birim içindir (fixtures/geometry/v1/cases.json ile aynı).' },
      cases: callsOf(set, KEEP).flatMap((c) => {
        const ts = set.fns[c.fn] as ((...a: unknown[]) => unknown) | undefined;
        if (!ts) throw new Error(`${set.file}: “${c.fn}” için TypeScript işlevi yok`);
        const tol = set.tolerance?.[c.fn];
        const expect = toJson(ts(...c.args));
        // A case the core matches only up to a reordering of ties is not frozen (the parity test accepts it).
        if (sameResult(toJson(callNamed(c.fn, c.args)), expect, tol ?? TOLERANCE) !== null) return [];
        return [{ ...c, args: toJson(c.args) as unknown[], expect, ...(tol ? { tol } : {}) }];
      }),
    };
    // One case per line: small files, readable diffs.
    const { cases, ...head } = file;
    const text = `${JSON.stringify(head, null, 2).slice(0, -2)},\n  "cases": [\n${cases.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
    writeFileSync(new URL(`../../fixtures/geometry/v1/${set.file}`, import.meta.url), text);
  }
});
