// Builds the Rust geometry core's WASM package (src/wasm/pkg) when its
// sources changed since the last build (docs/adr/0008). `pnpm dev`, `test`,
// `build`, `e2e` and the perf scripts run this first: the app cannot start
// without the core. The digest covers the crates the package is built from
// and the toolchain pins; the build itself is `pnpm rust:wasm`, run niced
// (one heavy process at a time, ADR 0001).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = new URL('../..', import.meta.url).pathname;
const PKG = join(ROOT, 'src/wasm/pkg');
const STAMP = join(PKG, '.stamp');
const SOURCES = ['crates/geometry-core', 'crates/wasm', 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo/config.toml'];
const OUTPUTS = ['kentos_wasm.js', 'kentos_wasm.d.ts', 'kentos_wasm_bg.wasm'];

function files(path) {
  const full = join(ROOT, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [full];
  return readdirSync(full, { recursive: true })
    .map((f) => join(full, f))
    .filter((f) => statSync(f).isFile())
    .sort();
}

function digest() {
  const h = createHash('sha256');
  for (const f of SOURCES.flatMap(files)) {
    h.update(relative(ROOT, f));
    h.update('\0');
    h.update(readFileSync(f));
    h.update('\0');
  }
  return h.digest('hex');
}

const want = digest();
const have = existsSync(STAMP) ? readFileSync(STAMP, 'utf8').trim() : '';
const complete = OUTPUTS.every((f) => existsSync(join(PKG, f)));
if (want === have && complete) process.exit(0);

console.log('Geometri çekirdeği (WASM) derleniyor…');
const r = spawnSync('nice', ['-n', '10', 'pnpm', '-s', 'rust:wasm'], { cwd: ROOT, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('WASM paketi derlenemedi. Rust araç zinciri kurulu mu? (rust-toolchain.toml, wasm-bindgen-cli 0.2.128; CLAUDE.md §2)');
  process.exit(r.status ?? 1);
}
writeFileSync(STAMP, `${want}\n`);
