import { describe, expect, it } from 'vitest';
import casesText from '../../fixtures/geometry/v1/cases.json?raw';
import referenceText from '../../fixtures/geometry/v1/reference.json?raw';
import cargoToml from '../../Cargo.toml?raw';
import { close, type Case, type GoldenFile } from '../model/geom/goldenCases';

/**
 * The same golden geometry cases and independent references as
 * src/model/geom/golden.test.ts and reference.test.ts, computed by the Rust
 * core's WASM build (crates/wasm, docs/adr/0002-contracts-fixtures.md). The
 * package is built by `pnpm rust:wasm` into src/wasm/pkg (not committed);
 * without it these tests are skipped, and `pnpm test:rust` builds and runs them.
 */

/** The generated package's exports this test uses (declared here so `tsc` passes before a WASM build). */
interface Wasm {
  initSync(o: { module: BufferSource }): unknown;
  coreVersion(): string;
  bulgeArc(ax: number, ay: number, bx: number, by: number, bulge: number): Float64Array | undefined;
  bulgePathLength(xy: Float64Array, bulges: Float64Array | undefined, closed: boolean): number;
  bulgeRingArea(xy: Float64Array, bulges: Float64Array | undefined): number;
  signedArea(xy: Float64Array): number;
  pointInPolygon(px: number, py: number, xy: Float64Array): boolean;
  polygonArea(xy: Float64Array, bulges: Float64Array | undefined, holes: Float64Array, holeBulges: Float64Array | undefined, holeSizes: Uint32Array): number;
  polygonPerimeter(xy: Float64Array, bulges: Float64Array | undefined, holes: Float64Array, holeBulges: Float64Array | undefined, holeSizes: Uint32Array): number;
}
type Pt = { x: number; y: number };
type Ring = { pts: Pt[]; bulges?: number[] };

const glue = import.meta.glob<Wasm>('./pkg/kentos_wasm.js');
const loader = Object.values(glue)[0];

let loaded: Wasm | undefined;
async function load(): Promise<Wasm> {
  if (loaded) return loaded;
  const wasm = await loader();
  // Node has no fetch for file URLs: the bytes are read directly and instantiated synchronously.
  const fs = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): { readFileSync(u: URL): Uint8Array<ArrayBuffer> } } }).process.getBuiltinModule('node:fs');
  wasm.initSync({ module: fs.readFileSync(new URL('./pkg/kentos_wasm_bg.wasm', import.meta.url)) });
  return (loaded = wasm);
}

const flat = (pts: Pt[]) => Float64Array.from(pts.flatMap((p) => [p.x, p.y]));
const bulges = (b?: number[]) => (b ? Float64Array.from(b) : undefined);

/** A polygon's rings in the boundary's flat form. */
function rings(outer: Ring, holes: Ring[]) {
  const withArcs = holes.some((h) => h.bulges);
  return [
    flat(outer.pts),
    bulges(outer.bulges),
    Float64Array.from(holes.flatMap((h) => h.pts.flatMap((p) => [p.x, p.y]))),
    withArcs ? Float64Array.from(holes.flatMap((h) => h.pts.map((_, i) => h.bulges?.[i] ?? 0))) : undefined,
    Uint32Array.from(holes.map((h) => h.pts.length)),
  ] as const;
}

function run(w: Wasm, c: Case): unknown {
  switch (c.op) {
    case 'bulgeArc': {
      const a = w.bulgeArc(c.input.a.x, c.input.a.y, c.input.b.x, c.input.b.y, c.input.bulge);
      return a ? { c: { x: a[0], y: a[1] }, r: a[2], a0: a[3], sweep: a[4] } : null;
    }
    case 'bulgePathLength':
      return w.bulgePathLength(flat(c.input.pts), bulges(c.input.bulges), c.input.closed);
    case 'bulgeRingArea':
      return w.bulgeRingArea(flat(c.input.pts), bulges(c.input.bulges));
    case 'signedArea':
      return w.signedArea(flat(c.input.pts));
    case 'pointInPolygon':
      return w.pointInPolygon(c.input.p.x, c.input.p.y, flat(c.input.pts));
    case 'polygonArea':
      return w.polygonArea(...rings(c.input.outer, c.input.holes));
    case 'polygonPerimeter':
      return w.polygonPerimeter(...rings(c.input.outer, c.input.holes));
  }
}

const golden = JSON.parse(casesText) as GoldenFile;
type RefRing = { pts: [string, string][]; bulges?: string[] };
const reference = JSON.parse(referenceText) as { cases: { name: string; op: 'polygonArea' | 'polygonPerimeter'; input: { outer: RefRing; holes: RefRing[] }; expected: string; bound: string }[] };
const refRing = (r: RefRing): Ring => ({ pts: r.pts.map(([x, y]) => ({ x: Number(x), y: Number(y) })), bulges: r.bulges?.map(Number) });

describe.skipIf(!loader)('golden geometry cases in the WASM build', () => {
  it('is built from this workspace version (a stale package fails here)', async () => {
    const version = /\[workspace\.package\][^[]*?\nversion = "([^"]+)"/.exec(cargoToml)?.[1];
    expect((await load()).coreVersion()).toBe(version);
  });
  for (const c of golden.cases)
    it(`${c.op}: ${c.name}`, async () => {
      expect(close(run(await load(), c), c.expected, golden.tolerance, c.name)).toBeNull();
    });
  for (const c of reference.cases)
    it(`independent reference, ${c.op}: ${c.name}`, async () => {
      const w = await load();
      const outer = refRing(c.input.outer);
      const holes = c.input.holes.map(refRing);
      const value = c.op === 'polygonArea' ? w.polygonArea(...rings(outer, holes)) : w.polygonPerimeter(...rings(outer, holes));
      expect(Math.abs(value - Number(c.expected))).toBeLessThanOrEqual(Number(c.bound));
    });
});
