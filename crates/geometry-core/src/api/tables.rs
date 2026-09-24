//! The per-module operation tables, joined in this order by `api::all`.

use super::Op;

pub(super) static TABLES: &[&[Op]] = &[
    crate::geometry::OPS,
    crate::geom::affine::OPS,
    crate::geom::arc::OPS,
    crate::geom::intersect::OPS,
    crate::geom::bulge::OPS,
    crate::geom::ellipse::OPS,
    crate::geom::spline::OPS,
    crate::geom::shapes::OPS,
    crate::geom::survey::OPS,
    crate::geom::tangent_circle::OPS,
    crate::geom::offset::OPS,
    crate::geom::dimension::OPS,
    crate::geom::hatch::OPS,
    crate::ops::edge_labels::OPS,
];
