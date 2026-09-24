//! The per-module operation tables, joined in this order by `api::all`.

use super::Op;

pub(super) static TABLES: &[&[Op]] = &[
    crate::geometry::OPS,
    crate::geom::affine::OPS,
    crate::geom::arc::OPS,
    crate::geom::intersect::OPS,
    crate::geom::bulge::OPS,
];
