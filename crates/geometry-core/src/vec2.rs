//! A point or vector in world units (x = east, y = north; CLAUDE.md §5).

use serde::{Deserialize, Serialize};

use crate::api::Op;
use crate::jsmath::js_hypot;
use crate::op;

#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

/// Distance between two points (`dist` in `src/model/geometry.ts`).
pub fn dist(a: Vec2, b: Vec2) -> f64 {
    js_hypot(b.x - a.x, b.y - a.y)
}

pub(crate) static OPS: &[Op] = &[op!("dist", |(a, b): (Vec2, Vec2)| dist(a, b))];
