//! A point or vector in world units (x = east, y = north; CLAUDE.md §5).

#[derive(Clone, Copy, Debug, PartialEq, Default)]
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
    (b.x - a.x).hypot(b.y - a.y)
}
