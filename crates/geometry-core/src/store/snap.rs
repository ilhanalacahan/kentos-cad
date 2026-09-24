//! Object snap on the store (`PickIndex.snap`, `src/viewport/picking.ts`):
//! endpoints, midpoints, centres, nodes, quadrants, intersections,
//! perpendicular and tangent points from the last point, nearest. At equal
//! distance the more meaningful kind wins; "nearest" only when nothing else
//! does. Candidates come in the document's order, as the TypeScript's did.

use super::Store;
use crate::entity::{Shape, dimension_geom, ellipse_geom, entity_vertices};
use crate::geom::arc::{ArcGeom, arc_end, arc_mid, arc_start};
use crate::geom::bulge::{bulge_arc, bulge_at, segment_mid};
use crate::geom::dimension::layout_dimension;
use crate::geom::ellipse::{
    EllipseGeom, closest_param, ellipse_point, ellipse_tangent_points, is_full_ellipse,
    line_ellipse, quadrant_params,
};
use crate::geom::intersect::{
    Edge, closest_on_edge, intersect_edges, on_edge_arc, perpendicular_foot, tangent_points,
};
use crate::jsmath::{atan2, js_hypot};
use crate::ops::edges::entity_edges;
use crate::vec2::Vec2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SnapKind {
    Endpoint,
    Midpoint,
    Center,
    Node,
    Quadrant,
    Intersection,
    Perpendicular,
    Tangent,
    Nearest,
}

impl SnapKind {
    /// Kinds in bit order: the TypeScript names them, the bits carry a set across the boundary.
    pub const ALL: [SnapKind; 9] = [
        SnapKind::Endpoint,
        SnapKind::Midpoint,
        SnapKind::Center,
        SnapKind::Node,
        SnapKind::Quadrant,
        SnapKind::Intersection,
        SnapKind::Perpendicular,
        SnapKind::Tangent,
        SnapKind::Nearest,
    ];

    pub fn bit(self) -> u32 {
        1 << (self as u32)
    }

    /// Distance multiplier when several snaps compete: at equal distance the more meaningful point wins.
    fn weight(self) -> f64 {
        match self {
            SnapKind::Endpoint | SnapKind::Node => 1.0,
            SnapKind::Intersection => 1.02,
            SnapKind::Center => 1.08,
            SnapKind::Quadrant => 1.1,
            SnapKind::Midpoint => 1.15,
            SnapKind::Perpendicular => 1.25,
            SnapKind::Tangent => 1.2,
            SnapKind::Nearest => f64::INFINITY,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SnapHit {
    pub kind: SnapKind,
    pub point: Vec2,
    pub id: f64,
}

/// An edge near the cursor, for crossings; `ell` when it is one of an ellipse's chords.
struct Nearby {
    id: f64,
    ed: Edge,
    ell: Option<EllipseGeom>,
}

/// The running choice: the best weighted snap and the nearest point.
struct Choice {
    p: Vec2,
    tol: f64,
    kinds: u32,
    best: Option<(SnapHit, f64)>,
    nearest: Option<(SnapHit, f64)>,
}

impl Choice {
    fn consider(&mut self, kind: SnapKind, q: Vec2, id: f64) {
        if self.kinds & kind.bit() == 0 {
            return;
        }
        let d = js_hypot(q.x - self.p.x, q.y - self.p.y);
        if d > self.tol {
            return;
        }
        let hit = SnapHit { kind, point: q, id };
        if kind == SnapKind::Nearest {
            if self.nearest.is_none_or(|(_, n)| d < n) {
                self.nearest = Some((hit, d));
            }
            return;
        }
        let w = d * kind.weight();
        if self.best.is_none_or(|(_, b)| w < b) {
            self.best = Some((hit, w));
        }
    }
}

impl Store {
    /// The snap point near `p` among `kinds` (a set of `SnapKind::bit`s);
    /// `from` is the running command's last point (perpendicular, tangent).
    pub fn snap(&self, p: Vec2, tol: f64, kinds: u32, from: Option<Vec2>) -> Option<SnapHit> {
        let mut ch = Choice {
            p,
            tol,
            kinds,
            best: None,
            nearest: None,
        };
        let mut nearby: Vec<Nearby> = Vec::new();
        for it in self.near(p, tol) {
            let id = it.id;
            let e = &it.shape;
            match e {
                Shape::Ellipse {
                    c,
                    major,
                    ratio,
                    t0,
                    t1,
                } => {
                    let g = ellipse_geom(*c, *major, *ratio, *t0, *t1);
                    ch.consider(SnapKind::Center, *c, id);
                    for t in quadrant_params(&g) {
                        ch.consider(SnapKind::Quadrant, ellipse_point(&g, t), id);
                    }
                    if !is_full_ellipse(&g) {
                        ch.consider(SnapKind::Endpoint, ellipse_point(&g, *t0), id);
                        ch.consider(SnapKind::Endpoint, ellipse_point(&g, *t1), id);
                    }
                    // Exact on the curve (its chords only serve crossings).
                    ch.consider(
                        SnapKind::Nearest,
                        ellipse_point(&g, closest_param(&g, p)),
                        id,
                    );
                    if let Some(f) = from {
                        ch.consider(
                            SnapKind::Perpendicular,
                            ellipse_point(&g, closest_param(&g, f)),
                            id,
                        );
                        for t in ellipse_tangent_points(&g, f) {
                            ch.consider(SnapKind::Tangent, t, id);
                        }
                    }
                    for ed in entity_edges(e) {
                        if closest_on_edge(&ed, p).d <= tol {
                            nearby.push(Nearby {
                                id,
                                ed,
                                ell: Some(g),
                            });
                        }
                    }
                    continue;
                }
                Shape::Point { p: q, .. } | Shape::Text { p: q, .. } => {
                    ch.consider(SnapKind::Node, *q, id);
                    continue;
                }
                Shape::Circle { c, .. } => {
                    ch.consider(SnapKind::Center, *c, id);
                    for q in entity_vertices(e).into_iter().skip(1) {
                        ch.consider(SnapKind::Quadrant, q, id);
                    }
                }
                Shape::Arc { c, r, a0, a1 } => {
                    let g = ArcGeom {
                        c: *c,
                        r: *r,
                        a0: *a0,
                        a1: *a1,
                    };
                    ch.consider(SnapKind::Center, *c, id);
                    ch.consider(SnapKind::Endpoint, arc_start(&g), id);
                    ch.consider(SnapKind::Endpoint, arc_end(&g), id);
                    ch.consider(SnapKind::Midpoint, arc_mid(&g), id);
                }
                Shape::Spline { pts, closed } => {
                    for (i, q) in pts.iter().enumerate() {
                        let end = !closed && (i == 0 || i == pts.len() - 1);
                        ch.consider(
                            if end {
                                SnapKind::Endpoint
                            } else {
                                SnapKind::Node
                            },
                            *q,
                            id,
                        );
                    }
                }
                Shape::Dimension { a, b, c, .. } => {
                    ch.consider(SnapKind::Node, *a, id);
                    ch.consider(SnapKind::Node, *b, id);
                    if let Some(c) = c {
                        ch.consider(SnapKind::Node, *c, id);
                    }
                    if let Some(l) = dimension_geom(e).and_then(|g| layout_dimension(&g)) {
                        ch.consider(SnapKind::Endpoint, l.d1, id);
                        ch.consider(SnapKind::Endpoint, l.d2, id);
                    }
                }
                // Its boundary is snapped through the outline object itself.
                Shape::Hatch { .. } => continue,
                Shape::Line { .. }
                | Shape::Polyline { .. }
                | Shape::Polygon { .. }
                | Shape::Xline { .. }
                | Shape::Ray { .. } => {
                    let pts = entity_vertices(e);
                    let bulges = match e {
                        Shape::Polyline { bulges, .. } | Shape::Polygon { bulges, .. } => {
                            bulges.as_deref()
                        }
                        _ => None,
                    };
                    for q in &pts {
                        ch.consider(SnapKind::Endpoint, *q, id);
                    }
                    // A polygon's vertices include its holes', as the TypeScript walked them.
                    let n = if matches!(e, Shape::Polygon { .. }) {
                        pts.len()
                    } else {
                        pts.len().saturating_sub(1)
                    };
                    for i in 0..n {
                        let a = pts[i];
                        let b = pts[(i + 1) % pts.len()];
                        let bulge = bulge_at(bulges, i);
                        ch.consider(SnapKind::Midpoint, segment_mid(a, b, bulge), id);
                        if let Some(arc) = bulge_arc(a, b, bulge) {
                            ch.consider(SnapKind::Center, arc.c, id);
                        }
                    }
                }
            }
            for ed in entity_edges(e) {
                let c = closest_on_edge(&ed, p);
                if c.d > tol {
                    continue;
                }
                nearby.push(Nearby { id, ed, ell: None });
                ch.consider(SnapKind::Nearest, c.p, id);
                if let Some(f) = from {
                    if let Some(foot) = perpendicular_foot(&ed, f) {
                        ch.consider(SnapKind::Perpendicular, foot, id);
                    }
                    if let Edge::Arc { c, r, a0, sweep } = ed {
                        for t in tangent_points(f, c, r) {
                            if on_edge_arc(a0, sweep, atan2(t.y - c.y, t.x - c.x)) {
                                ch.consider(SnapKind::Tangent, t, id);
                            }
                        }
                    }
                }
            }
        }

        if kinds & SnapKind::Intersection.bit() != 0 {
            // Pairwise over edges near the cursor only: typically a handful.
            for i in 0..nearby.len() {
                for j in i + 1..nearby.len() {
                    let (a, b) = (&nearby[i], &nearby[j]);
                    if a.id == b.id && shares_vertex(&a.ed, &b.ed) {
                        continue;
                    }
                    for h in intersect_edges(&a.ed, &b.ed) {
                        ch.consider(SnapKind::Intersection, refine_crossing(h.p, a, b), a.id);
                    }
                }
            }
        }
        ch.best.or(ch.nearest).map(|(h, _)| h)
    }
}

/// A crossing found on an ellipse's chords, moved onto the true curves:
/// exactly for a straight partner, by alternating projection otherwise.
fn refine_crossing(p: Vec2, a: &Nearby, b: &Nearby) -> Vec2 {
    if a.ell.is_none() && b.ell.is_none() {
        return p;
    }
    let (e, other) = if a.ell.is_some() { (a, b) } else { (b, a) };
    let Some(ell) = e.ell else { return p };
    if let (None, Edge::Seg { a: sa, b: sb }) = (other.ell, other.ed) {
        let mut best: Option<(Vec2, f64)> = None;
        for h in line_ellipse(&ell, sa, sb) {
            if h.u < -1e-9 || h.u > 1.0 + 1e-9 {
                continue;
            }
            // Taken on the straight partner, so a horizontal line keeps its exact Y.
            let q = Vec2::new(sa.x + (sb.x - sa.x) * h.u, sa.y + (sb.y - sa.y) * h.u);
            let d = js_hypot(q.x - p.x, q.y - p.y);
            if best.is_none_or(|(_, bd)| d < bd) {
                best = Some((q, d));
            }
        }
        return best.map_or(p, |(q, _)| q);
    }
    let mut q = p;
    for _ in 0..40 {
        q = ellipse_point(&ell, closest_param(&ell, q));
        q = match other.ell {
            Some(o) => ellipse_point(&o, closest_param(&o, q)),
            None => closest_on_edge(&other.ed, q).p,
        };
    }
    q
}

fn shares_vertex(a: &Edge, b: &Edge) -> bool {
    let (Edge::Seg { a: a1, b: a2 }, Edge::Seg { a: b1, b: b2 }) = (a, b) else {
        return false;
    };
    let eq = |p: &Vec2, q: &Vec2| (p.x - q.x).abs() < 1e-9 && (p.y - q.y).abs() < 1e-9;
    eq(a1, b1) || eq(a1, b2) || eq(a2, b1) || eq(a2, b2)
}
