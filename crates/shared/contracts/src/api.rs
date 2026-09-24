//! API responses (`/v1/...`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// `GET /v1/health`: the server is up, and which build and contracts it speaks.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Health {
    #[ts(type = "\"ok\"")]
    pub status: String,
    pub service: String,
    pub version: String,
    /// Git commit the server was built from, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub commit: Option<String>,
    /// `CONTRACTS_VERSION` of this build.
    pub contracts: u32,
}
