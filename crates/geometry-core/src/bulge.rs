//! Polyline arc segments in the DXF "bulge" form (`src/model/geom/bulge.ts`):
//! the segment pts[i] → pts[i+1] carries bulge = tan(θ/4), θ its included
//! angle, positive counter-clockwise; 0 is a straight segment.

use crate::polygon::{path_length, signed_area};
use crate::vec2::Vec2;

const EPS: f64 = 1e-12;

/// Bulge of segment `i`; missing entries are straight.
pub fn bulge_at(bulges: Option<&[f64]>, i: usize) -> f64 {
    bulges.and_then(|b| b.get(i).copied()).unwrap_or(0.0)
}

pub fn is_arc_bulge(b: f64) -> bool {
    b.abs() > EPS
}

pub fn has_bulges(bulges: Option<&[f64]>) -> bool {
    bulges.is_some_and(|b| b.iter().any(|&v| is_arc_bulge(v)))
}

/// Circle, start angle and signed sweep of an arc segment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BulgeArc {
    pub c: Vec2,
    pub r: f64,
    pub a0: f64,
    pub sweep: f64,
}

/// The arc of a bulged segment; `None` when straight or degenerate.
pub fn bulge_arc(a: Vec2, b: Vec2, bulge: f64) -> Option<BulgeArc> {
    if !is_arc_bulge(bulge) {
        return None;
    }
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let chord = dx.hypot(dy);
    if chord < EPS {
        return None;
    }
    // Centre sits on the chord's left normal at chord·(1−b²)/(4b); r = chord·(1+b²)/(4|b|).
    let k = (1.0 - bulge * bulge) / (4.0 * bulge);
    let c = Vec2::new((a.x + b.x) / 2.0 - dy * k, (a.y + b.y) / 2.0 + dx * k);
    let r = (chord * (1.0 + bulge * bulge)) / (4.0 * bulge.abs());
    Some(BulgeArc {
        c,
        r,
        a0: (a.y - c.y).atan2(a.x - c.x),
        sweep: 4.0 * bulge.atan(),
    })
}

fn seg_count(n: usize, closed: bool) -> usize {
    if closed { n } else { n.saturating_sub(1) }
}

/// Length along the path, arcs measured exactly.
pub fn bulge_path_length(pts: &[Vec2], bulges: Option<&[f64]>, closed: bool) -> f64 {
    if !has_bulges(bulges) {
        return path_length(pts, closed);
    }
    let n = pts.len();
    let mut l = 0.0;
    for i in 0..seg_count(n, closed) {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        l += match bulge_arc(a, b, bulge_at(bulges, i)) {
            Some(arc) => arc.r * arc.sweep.abs(),
            None => (b.x - a.x).hypot(b.y - a.y),
        };
    }
    l
}

/// Signed area of a closed bulged ring: shoelace plus each arc's circular segment.
pub fn bulge_ring_area(pts: &[Vec2], bulges: Option<&[f64]>) -> f64 {
    let mut area = signed_area(pts);
    if !has_bulges(bulges) {
        return area;
    }
    let n = pts.len();
    for i in 0..n {
        if let Some(arc) = bulge_arc(pts[i], pts[(i + 1) % n], bulge_at(bulges, i)) {
            area += ((arc.r * arc.r) / 2.0) * (arc.sweep - arc.sweep.sin());
        }
    }
    area
}
