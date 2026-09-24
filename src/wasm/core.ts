import { callOp, GeometryStore, initSync, opId, triangulateMany as wasmTriangulateMany } from './pkg/kentos_wasm.js';
import wasmUrl from './pkg/kentos_wasm_bg.wasm?url';

/**
 * The Rust geometry core in this page (crates/wasm, docs/adr/0008). It is
 * compiled once before the app starts (`initCore`), after which every call
 * is synchronous: snapping, drawing and tools run inside pointer events and
 * animation frames. The processing worker gets the compiled module with its
 * first job (`initCoreFrom`), so the file is not fetched twice.
 *
 * Calls go through `op(name)`: the arguments cross as a JSON array, the
 * result comes back as JSON with NaN and ±∞ kept as "#NaN" / "#Inf" /
 * "#-Inf" (api/json.rs). Hot paths have typed entry points instead.
 */

let compiled: WebAssembly.Module | null = null;
let faulted = false;
let onFault: ((err: Error) => void) | null = null;

/** Fetches, compiles and starts the core (the page, before the app mounts). */
export async function initCore(): Promise<void> {
  if (compiled) return;
  const res = await fetch(wasmUrl);
  if (!res.ok) throw new Error(`Geometri çekirdeği indirilemedi (${res.status}).`);
  // compileStreaming needs the application/wasm type; a server that sends another falls back to bytes.
  const module = await WebAssembly.compileStreaming(res.clone()).catch(async () => WebAssembly.compile(await res.arrayBuffer()));
  initCoreFrom(module);
}

/** Starts the core from a compiled module (the worker, the tests). */
export function initCoreFrom(module: WebAssembly.Module): void {
  if (compiled) return;
  initSync({ module });
  compiled = module;
}

/** The compiled module, for a worker to start its own copy of the core. */
export function coreModule(): WebAssembly.Module | null {
  return compiled;
}

/**
 * Called once if the core stops with a trap (a bug in the core: it never
 * fails on user data by design). The page cannot start a second copy, so
 * the app tells the user to save and reload.
 */
export function onCoreFault(handler: (err: Error) => void): void {
  onFault = handler;
}

/** A trap stops the core for good: the app hears of it once. */
function fault(err: unknown): void {
  if (err instanceof WebAssembly.RuntimeError && !faulted) {
    faulted = true;
    onFault?.(err);
  }
}

/** Runs a typed entry point (a hot path), reporting a trap as `op` does. */
function typed<T>(run: () => T): T {
  if (!compiled) throw new Error('Geometri çekirdeği henüz başlatılmadı.');
  try {
    return run();
  } catch (err) {
    fault(err);
    throw err;
  }
}

const SPECIAL = new Map<string, number>([
  ['#NaN', NaN],
  ['#Inf', Infinity],
  ['#-Inf', -Infinity],
]);
const revive = (_key: string, v: unknown) => (typeof v === 'string' && v.charCodeAt(0) === 35 && SPECIAL.has(v) ? SPECIAL.get(v) : v);

/** A core result read back: the special numbers are strings starting with "#". */
export function readResult(text: string): unknown {
  return text.includes('"#') ? JSON.parse(text, revive) : JSON.parse(text);
}

/**
 * A caller for the core operation `name`. `undef`: the TypeScript function
 * returned `undefined` (not `null`) for "nothing".
 */
export function op<F extends (...args: never[]) => unknown>(name: string, undef = false): F {
  let id = -1;
  const call = (...args: unknown[]): unknown => {
    if (id < 0) {
      if (!compiled) throw new Error('Geometri çekirdeği henüz başlatılmadı.');
      id = opId(name);
      if (id < 0) throw new Error(`Geometri çekirdeğinde “${name}” işlemi yok; WASM paketi eski olabilir (pnpm wasm).`);
    }
    let text: string;
    try {
      text = callOp(id, JSON.stringify(args));
    } catch (err) {
      fault(err);
      throw err;
    }
    const v = readResult(text);
    return undef && v === null ? undefined : v;
  };
  return call as unknown as F;
}

/** Runs an operation by name on already-built JSON arguments (the golden fixtures). */
export function callNamed(name: string, args: unknown[]): unknown {
  return op(name)(...(args as never[]));
}

/**
 * Fill triangles of many polygons in one call (a layer's fills): `xy` holds
 * every ring's points one after another, `ringSizes` each ring's vertex
 * count and `polyRings` each polygon's ring count (its outer ring, then its
 * holes). Three vertex indices (into the points of `xy`) per triangle come
 * back, polygon after polygon; a renderer takes the coordinates from `xy`.
 */
export function triangulateMany(xy: Float64Array, ringSizes: Uint32Array, polyRings: Uint32Array): Uint32Array {
  return typed(() => wasmTriangulateMany(xy, ringSizes, polyRings));
}

/**
 * The Rust geometry store (docs/adr/0008, S1): a copy of the drawing's
 * objects that picking, snapping and selection query on every pointer move.
 * `src/viewport/picking.ts` keeps one in step with the document. Objects go
 * in as JSON; queries take numbers and give flat arrays (ids are numbers).
 * Every call reports a trap as `op` does.
 */
export class CoreStore {
  private readonly raw: GeometryStore;

  constructor() {
    this.raw = typed(() => new GeometryStore());
  }

  get size(): number {
    return typed(() => this.raw.size);
  }

  /** Adds or replaces objects (a JSON array of entities): new ids go last, known ones keep their place. */
  put(entitiesJson: string): void {
    typed(() => this.raw.put(entitiesJson));
  }

  /** Adds or replaces packed objects (./pack.ts), as `put`. */
  putPacked(nums: Float64Array, strings: string): void {
    typed(() => this.raw.putPacked(nums, strings));
  }

  remove(ids: Float64Array): void {
    typed(() => this.raw.remove(ids));
  }

  clear(): void {
    typed(() => this.raw.clear());
  }

  /** `[{ id, visible, locked, pickInterior }]` for every layer node, ancestors resolved. */
  setLayers(json: string): void {
    typed(() => this.raw.setLayers(json));
  }

  /** Ids in the document's order. */
  ids(): Float64Array {
    return typed(() => this.raw.ids());
  }

  /** An object as the store holds it (id, layer, label flag, geometry), as JSON; for tests. */
  itemJson(id: number): string | undefined {
    return typed(() => this.raw.itemJson(id));
  }

  /** `[minX, minY, maxX, maxY]`, or empty for an unknown id. */
  bounds(id: number): Float64Array {
    return typed(() => this.raw.bounds(id));
  }

  hit(x: number, y: number, tol: number): number | undefined {
    return typed(() => this.raw.hit(x, y, tol));
  }

  /** `id, distance` pairs, nearest first. */
  hitEdge(x: number, y: number, tol: number): Float64Array {
    return typed(() => this.raw.hitEdge(x, y, tol));
  }

  /** `[kind bit number, x, y, id]` or empty; `from` is the command's last point. */
  snap(x: number, y: number, tol: number, kinds: number, from: { x: number; y: number } | null): Float64Array {
    return typed(() => this.raw.snap(x, y, tol, kinds, !!from, from?.x ?? 0, from?.y ?? 0));
  }

  near(x: number, y: number, tol: number): Float64Array {
    return typed(() => this.raw.near(x, y, tol));
  }

  overlapping(minX: number, minY: number, maxX: number, maxY: number, except?: number): Float64Array {
    return typed(() => this.raw.overlapping(minX, minY, maxX, maxY, except !== undefined, except ?? 0));
  }

  inRect(minX: number, minY: number, maxX: number, maxY: number, crossing: boolean): Float64Array {
    return typed(() => this.raw.inRect(minX, minY, maxX, maxY, crossing));
  }

  /** `[id, x0, y0, x1, y1, …]` or empty. */
  enclosing(x: number, y: number): Float64Array {
    return typed(() => this.raw.enclosing(x, y));
  }

  /** Packed edges: `0, ax, ay, bx, by` (segment) or `1, cx, cy, r, a0, sweep` (arc). */
  edgesIn(minX: number, minY: number, maxX: number, maxY: number, except?: number): Float64Array {
    return typed(() => this.raw.edgesIn(minX, minY, maxX, maxY, except !== undefined, except ?? 0));
  }

  /** Frees the Rust side; the store must not be used afterwards. */
  dispose(): void {
    this.raw.free();
  }
}
