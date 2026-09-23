//! The geometry core in the browser. The boundary is kept narrow and cheap:
//! coordinates cross as flat `Float64Array`s (x0, y0, x1, y1, …) and results
//! come back as numbers or small arrays, never as objects to walk. The
//! authoritative checks still run on the server before a commit
//! (CLAUDE.md §14); this is for a responsive interface.

use kentos_geometry_core::Vec2;
use kentos_geometry_core::bulge::{bulge_arc, bulge_path_length, bulge_ring_area};
use kentos_geometry_core::measure::{Ring, polygon_area};
use kentos_geometry_core::polygon::{point_in_polygon, signed_area};
use wasm_bindgen::prelude::*;

fn points(xy: &[f64]) -> Vec<Vec2> {
    xy.chunks_exact(2).map(|c| Vec2::new(c[0], c[1])).collect()
}

/// Version of the core, to tell a stale WASM build from the app.
#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// `[cx, cy, r, a0, sweep]` of a bulged segment, or `undefined` when straight.
#[wasm_bindgen(js_name = bulgeArc)]
pub fn bulge_arc_js(ax: f64, ay: f64, bx: f64, by: f64, bulge: f64) -> Option<Box<[f64]>> {
    bulge_arc(Vec2::new(ax, ay), Vec2::new(bx, by), bulge)
        .map(|a| vec![a.c.x, a.c.y, a.r, a.a0, a.sweep].into_boxed_slice())
}

#[wasm_bindgen(js_name = bulgePathLength)]
pub fn bulge_path_length_js(xy: &[f64], bulges: Option<Box<[f64]>>, closed: bool) -> f64 {
    bulge_path_length(&points(xy), bulges.as_deref(), closed)
}

#[wasm_bindgen(js_name = bulgeRingArea)]
pub fn bulge_ring_area_js(xy: &[f64], bulges: Option<Box<[f64]>>) -> f64 {
    bulge_ring_area(&points(xy), bulges.as_deref())
}

#[wasm_bindgen(js_name = signedArea)]
pub fn signed_area_js(xy: &[f64]) -> f64 {
    signed_area(&points(xy))
}

#[wasm_bindgen(js_name = pointInPolygon)]
pub fn point_in_polygon_js(px: f64, py: f64, xy: &[f64]) -> bool {
    point_in_polygon(Vec2::new(px, py), &points(xy))
}

/// Net area of a polygon with straight holes: `holes` is every hole's
/// coordinates one after another, `hole_sizes` the vertex count of each.
#[wasm_bindgen(js_name = polygonArea)]
pub fn polygon_area_js(
    xy: &[f64],
    bulges: Option<Box<[f64]>>,
    holes: &[f64],
    hole_sizes: &[u32],
) -> f64 {
    let outer = Ring {
        pts: points(xy),
        bulges: bulges.map(|b| b.into_vec()),
    };
    let mut rings = Vec::with_capacity(hole_sizes.len());
    let mut at = 0usize;
    for &n in hole_sizes {
        let end = (at + 2 * n as usize).min(holes.len());
        rings.push(Ring {
            pts: points(&holes[at..end]),
            bulges: None,
        });
        at = end;
    }
    polygon_area(&outer, &rings)
}
