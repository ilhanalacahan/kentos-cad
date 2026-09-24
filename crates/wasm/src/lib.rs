//! The geometry core in the browser. The boundary is kept narrow and cheap:
//! coordinates cross as flat `Float64Array`s (x0, y0, x1, y1, …) and results
//! come back as numbers or small arrays, never as objects to walk. The
//! authoritative checks still run on the server before a commit
//! (CLAUDE.md §14); this is for a responsive interface.

use kentos_geometry_core::Vec2;
use kentos_geometry_core::geom::bulge::{bulge_arc, bulge_path_length, bulge_ring_area};
use kentos_geometry_core::geom::hatch::hatch_lines;
use kentos_geometry_core::geom::offset::offset_path;
use kentos_geometry_core::geometry::{point_in_polygon, signed_area};
use kentos_geometry_core::measure::{Ring, polygon_area, polygon_perimeter};
use kentos_geometry_core::processing::numbering::corner_text_at;
use kentos_geometry_core::triangulate::triangulate_many;
use wasm_bindgen::prelude::*;

pub mod faces;
pub mod store;

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
    let inner = ranges(holes.len() / 2, hole_sizes)
        .into_iter()
        .map(|(start, end)| Ring {
            pts: points(&holes[2 * start..2 * end]),
            bulges: hole_bulges
                .as_deref()
                .map(|b| b[start.min(b.len())..end.min(b.len())].to_vec()),
        })
        .collect();
    (outer, inner)
}

/// Point ranges of rings laid one after another (`sizes`: vertex counts),
/// clamped to the `points` there are.
fn ranges(points: usize, sizes: &[u32]) -> Vec<(usize, usize)> {
    let mut out = Vec::with_capacity(sizes.len());
    let mut at = 0usize;
    for &n in sizes {
        let start = at.min(points);
        let end = (start + n as usize).min(points);
        out.push((start, end));
        at = end;
    }
    out
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

/// `offsetPath` on flat coordinates: the style engine offsets a path per
/// object and symbol layer while a layer is built (docs/adr/0008, S3).
#[wasm_bindgen(js_name = offsetPathXY)]
pub fn offset_path_xy(xy: &[f64], d: f64, closed: bool) -> Vec<f64> {
    flat(&offset_path(&points(xy), d, closed))
}

/// `hatchLines` on flat coordinates (the hatch tool's hover preview, every
/// frame): the ring, then every hole's points one after another with
/// `hole_sizes` giving each hole's vertex count. The first number is 1 when
/// the lines were capped, then `ax, ay, bx, by` per segment.
#[wasm_bindgen(js_name = hatchLinesXY)]
pub fn hatch_lines_xy(
    ring: &[f64],
    holes: &[f64],
    hole_sizes: &[u32],
    angle_deg: f64,
    spacing: f64,
) -> Vec<f64> {
    let inner: Vec<Vec<Vec2>> = ranges(holes.len() / 2, hole_sizes)
        .into_iter()
        .map(|(start, end)| points(&holes[2 * start..2 * end]))
        .collect();
    let h = hatch_lines(&points(ring), angle_deg, spacing, &inner);
    let mut out = Vec::with_capacity(1 + 4 * h.segments.len());
    out.push(if h.capped { 1.0 } else { 0.0 });
    for [a, b] in &h.segments {
        out.extend_from_slice(&[a.x, a.y, b.x, b.y]);
    }
    out
}

fn flat(pts: &[Vec2]) -> Vec<f64> {
    pts.iter().flat_map(|p| [p.x, p.y]).collect()
}

/// Fill triangles of many polygons in one call (a layer's fills,
/// docs/adr/0008): `xy` holds every ring's points one after another,
/// `ring_sizes` each ring's vertex count and `poly_rings` each polygon's ring
/// count (its outer ring, then its holes). Three vertex indices (into the
/// points of `xy`) per triangle come back, polygon after polygon.
#[wasm_bindgen(js_name = triangulateMany)]
pub fn triangulate_many_js(xy: &[f64], ring_sizes: &[u32], poly_rings: &[u32]) -> Vec<u32> {
    let sizes: Vec<usize> = ring_sizes.iter().map(|&n| n as usize).collect();
    let polys: Vec<usize> = poly_rings.iter().map(|&n| n as usize).collect();
    triangulate_many(&points(xy), &sizes, &polys)
}

/// Where the texts beside numbered corners go (`corner_text_at`): four
/// numbers per corner in `corners` (x, y, outward x and y), its text's
/// character count in `chars`; x, y per corner come back.
#[wasm_bindgen(js_name = cornerTexts)]
pub fn corner_texts_js(corners: &[f64], chars: &[f64], height: f64) -> Vec<f64> {
    corners
        .chunks_exact(4)
        .zip(chars)
        .flat_map(|(c, &n)| {
            let at = corner_text_at(Vec2::new(c[0], c[1]), Vec2::new(c[2], c[3]), n, height);
            [at.x, at.y]
        })
        .collect()
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
