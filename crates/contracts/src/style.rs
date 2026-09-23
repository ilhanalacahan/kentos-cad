//! The .kstil style file (`StyleFile` in `src/style/file.ts`), version 1.
//! Library items stay opaque here until the style core moves to Rust
//! (`crates/style-core`, CLAUDE.md §14); the TypeScript reader validates them.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const STYLE_FORMAT: &str = "kentos-style";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StyleFile {
    #[ts(type = "\"kentos-style\"")]
    pub format: String,
    pub version: u32,
    /// ISO 8601 time of export.
    pub exported: String,
    #[ts(type = "unknown[]")]
    pub items: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "unknown[]")]
    pub categories: Option<Vec<serde_json::Value>>,
}
