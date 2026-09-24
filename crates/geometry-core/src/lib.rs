//! Pure analytic CAD geometry, shared by the browser (through `kentos-wasm`)
//! and the server. It is a faithful port of the TypeScript core in
//! `src/model/geom` and `src/model/geometry.ts`: same formulas, same order of
//! operations, same tolerances, so both sides agree on the golden fixtures in
//! `fixtures/geometry/`. Coordinates are float64 world units (metres);
//! nothing here knows pixels, documents or I/O.
#![forbid(unsafe_code)]
// User data must never crash the core (a panic traps the WASM module): outside
// tests every failure is a value (docs/adr/0008).
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]
// A faithful port keeps the TypeScript's comparisons and index loops: `t < lo
// || t > hi` lets NaN through where `!(lo..=hi).contains(&t)` would not.
#![allow(clippy::manual_range_contains, clippy::needless_range_loop)]

pub mod api;
pub mod ewkb;
pub mod geom;
pub mod geometry;
pub mod jsmath;
pub mod measure;
pub mod numeric;
pub mod tessellate;
pub mod vec2;

pub use vec2::Vec2;
