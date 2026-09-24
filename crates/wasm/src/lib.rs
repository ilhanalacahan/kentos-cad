//! The geometry core in the browser. The boundary is kept narrow and cheap:
//! coordinates cross as flat `Float64Array`s (x0, y0, x1, y1, …) and results
//! come back as numbers or small arrays, never as objects to walk. The
//! authoritative checks still run on the server before a commit
//! (CLAUDE.md §14); this is for a responsive interface.

use kentos_geometry_core::Vec2;
use kentos_geometry_core::bulge::{bulge_arc, bulge_path_length, bulge_ring_area};
use kentos_geometry_core::measure::{Ring, polygon_area, polygon_perimeter};
use kentos_geometry_core::polygon::{point_in_polygon, signed_area};
use wasm_bindgen::prelude::*;

fn points(xy: &[f64]) -> Vec<Vec2> {
    xy.chunks_exact(2).map(|c| Vec2::new(c[0], c[1])).collect()
}

/// The id of a core operation by its TypeScript name (`src/wasm/core.ts`
/// asks once per operation), or −1 when this build has no such operation.
#[wasm_bindgen(js_name = opId)]
pub fn op_id(name: &str) -> i32 {
    kentos_geometry_core::api::find(name).map_or(-1, |i| i as i32)
}

/// Runs a core operation on a JSON array of arguments; the result is JSON
/// (docs/adr/0008). Unreadable arguments throw.
#[wasm_bindgen(js_name = callOp)]
pub fn call_op(id: u32, args: &str) -> Result<String, JsError> {
    kentos_geometry_core::api::run(id as usize, args).map_err(|e| JsError::new(&e))
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

/// Rings of a polygon across the boundary: the outer ring, then every hole's
/// coordinates one after another with `hole_sizes` giving each hole's vertex
/// count. `hole_bulges`, when given, has one bulge per hole vertex (0 for a
/// straight edge, which the core treats exactly like no bulges).
fn rings(
    xy: &[f64],
    bulges: Option<Box<[f64]>>,
    holes: &[f64],
    hole_bulges: Option<Box<[f64]>>,
    hole_sizes: &[u32],
) -> (Ring, Vec<Ring>) {
    let outer = Ring {
        pts: points(xy),
        bulges: bulges.map(|b| b.into_vec()),
    };
    let mut inner = Vec::with_capacity(hole_sizes.len());
    let mut at = 0usize;
    for &n in hole_sizes {
        let start = at.min(holes.len() / 2);
        let end = (start + n as usize).min(holes.len() / 2);
        inner.push(Ring {
            pts: points(&holes[2 * start..2 * end]),
            bulges: hole_bulges
                .as_deref()
                .map(|b| b[start.min(b.len())..end.min(b.len())].to_vec()),
        });
        at = end;
    }
    (outer, inner)
}

/// Net area of a polygon with holes (rings as in [`rings`]).
#[wasm_bindgen(js_name = polygonArea)]
pub fn polygon_area_js(
    xy: &[f64],
    bulges: Option<Box<[f64]>>,
    holes: &[f64],
    hole_bulges: Option<Box<[f64]>>,
    hole_sizes: &[u32],
) -> f64 {
    let (outer, inner) = rings(xy, bulges, holes, hole_bulges, hole_sizes);
    polygon_area(&outer, &inner)
}

/// Perimeter of a polygon, holes included (rings as in [`rings`]).
#[wasm_bindgen(js_name = polygonPerimeter)]
pub fn polygon_perimeter_js(
    xy: &[f64],
    bulges: Option<Box<[f64]>>,
    holes: &[f64],
    hole_bulges: Option<Box<[f64]>>,
    hole_sizes: &[u32],
) -> f64 {
    let (outer, inner) = rings(xy, bulges, holes, hole_bulges, hole_sizes);
    polygon_perimeter(&outer, &inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_holes_and_their_bulges() {
        let holes = [
            0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 5.0, 5.0, 6.0, 5.0, 6.0, 6.0, 5.0, 6.0,
        ];
        let b = Some(vec![0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 1.0].into_boxed_slice());
        let (_, inner) = rings(&[0.0, 0.0], None, &holes, b, &[3, 4]);
        assert_eq!(inner.len(), 2);
        assert_eq!(inner[0].pts.len(), 3);
        assert_eq!(inner[0].bulges.as_deref(), Some(&[0.0, 0.5, 0.0][..]));
        assert_eq!(inner[1].pts[0], Vec2::new(5.0, 5.0));
        assert_eq!(inner[1].bulges.as_deref(), Some(&[0.0, 0.0, 0.0, 1.0][..]));
    }

    #[test]
    fn sizes_beyond_the_data_are_clamped_not_a_panic() {
        let (_, inner) = rings(
            &[],
            None,
            &[0.0, 0.0, 1.0],
            Some(vec![0.0].into_boxed_slice()),
            &[5, 2],
        );
        assert_eq!(inner[0].pts.len(), 1);
        assert!(inner[1].pts.is_empty());
    }
}
