//! KentOS use cases (CLAUDE.md §14, §18): one implementation for every
//! entry point. HTTP, the admin CLI and later MCP and the worker call these
//! functions; none of them re-implements a rule. The actor always comes from
//! a verified session or token, never from the request body.

pub mod admin;
pub mod error;
pub mod identity;
pub mod tenancy;

pub use error::{AppError, AppResult};
