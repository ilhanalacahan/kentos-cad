//! The per-module operation tables, joined in this order by `api::all`.

use super::Op;

pub(super) static TABLES: &[&[Op]] = &[crate::vec2::OPS, crate::polygon::OPS];
