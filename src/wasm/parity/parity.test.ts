import { describe, expect, it } from 'vitest';
import { callNamed } from '../core';
import { callsOf, sameResult, sameUpToTies, TOLERANCE, toJson } from './harness';
import { SETS } from './sets';

/**
 * TypeScript and the Rust core side by side (docs/adr/0008): every call of
 * every set, with 200 random calls per operation (PARITY_CASES raises it
 * for a deep run before a module's TypeScript is deleted).
 */
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const N = Number(env.PARITY_CASES ?? 200);

for (const set of SETS)
  describe(`TS ↔ Rust: ${set.file}`, () => {
    let calls: ReturnType<typeof callsOf> | null = null;
    for (const [fn, ts] of Object.entries(set.fns))
      it(fn, () => {
        const failures: string[] = [];
        calls ??= callsOf(set, N);
        for (const c of calls.filter((c) => c.fn === fn)) {
          const want = toJson((ts as (...a: unknown[]) => unknown)(...c.args));
          const got = toJson(callNamed(c.fn, c.args));
          const tol = set.tolerance?.[fn] ?? TOLERANCE;
          const r = sameResult(got, want, tol, c.name);
          const tie = set.ties?.[fn];
          if (r && tie && sameUpToTies(got, want, tol, tie)) continue;
          if (r) failures.push(`${r}\n    girdi: ${JSON.stringify(c.args).slice(0, 400)}`);
        }
        expect(failures.slice(0, 5).join('\n')).toBe('');
      }, N > 1000 ? 600_000 : undefined);
  });
