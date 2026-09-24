import { callOp, initSync, opId } from './pkg/kentos_wasm.js';
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
      if (err instanceof WebAssembly.RuntimeError && !faulted) {
        faulted = true;
        onFault?.(err);
      }
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
