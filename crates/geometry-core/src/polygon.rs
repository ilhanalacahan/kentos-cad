//! Rings and paths of straight segments (`src/model/geometry.ts`).

use crate::api::Op;
use crate::op;
use crate::vec2::{Vec2, dist};

/// Signed shoelace area, positive for counter-clockwise rings. Coordinates
/// are taken relative to the first vertex: products of raw TM coordinates
/// (4.4·10⁶ m) would cancel away the fourth decimal of a parcel area.
pub fn signed_area(pts: &[Vec2]) -> f64 {
    if pts.len() < 3 {
        return 0.0;
    }
    let ox = pts[0].x;
    let oy = pts[0].y;
    let mut a = 0.0;
    let mut j = pts.len() - 1;
    for i in 0..pts.len() {
        a += (pts[j].x - ox) * (pts[i].y - oy) - (pts[i].x - ox) * (pts[j].y - oy);
        j = i;
    }
    a / 2.0
}

/// Length along the vertices; a closed path adds the closing segment.
pub fn path_length(pts: &[Vec2], closed: bool) -> f64 {
    let mut l = 0.0;
    for i in 1..pts.len() {
        l += dist(pts[i - 1], pts[i]);
    }
    if closed && pts.len() > 2 {
        l += dist(pts[pts.len() - 1], pts[0]);
    }
    l
}

/// Even-odd point in ring test (a point exactly on an edge may fall either way).
pub fn point_in_polygon(p: Vec2, pts: &[Vec2]) -> bool {
    let mut inside = false;
    if pts.is_empty() {
        return false;
    }
    let mut j = pts.len() - 1;
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[j];
        if (a.y > p.y) != (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}

pub(crate) static OPS: &[Op] = &[
    op!("signedArea", |(pts,): (Vec<Vec2>,)| signed_area(&pts)),
    op!("pointInPolygon", |(p, pts): (Vec2, Vec<Vec2>)| {
        point_in_polygon(p, &pts)
    }),
];
