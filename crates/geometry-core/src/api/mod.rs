//! The core's call table (docs/adr/0008): every operation the browser uses,
//! by the name of its TypeScript counterpart. Arguments arrive as a JSON
//! array (positional, `undefined` written as `null`), the result leaves as
//! JSON (`json` keeps NaN and ±∞). The WASM crate exposes this table to
//! `src/wasm/core.ts`, and the golden fixtures run through it natively, so
//! both targets are checked on the very path the app takes. Hot paths
//! (snapping, picking, layer geometry) have typed entry points instead.

pub mod json;
mod tables;

use std::sync::OnceLock;

use serde::Serialize;
use serde::de::DeserializeOwned;

/// One operation: its name and a function from JSON arguments to a JSON result.
#[derive(Clone, Copy)]
pub struct Op {
    pub name: &'static str,
    pub run: fn(&str) -> Result<String, String>,
}

/// A call's positional arguments. They are read once into JSON values and
/// each is converted to its type on its own, so the code for a type is
/// shared by every operation that takes it (the WASM package stays small).
pub struct Args(std::vec::IntoIter<serde_json::Value>);

impl Args {
    pub fn parse(text: &str) -> Result<Args, String> {
        let list: Vec<serde_json::Value> = serde_json::from_str(text)
            .map_err(|e| format!("Geometri çekirdeği girdiyi okuyamadı: {e}"))?;
        Ok(Args(list.into_iter()))
    }

    /// The next argument; a missing one reads as `null` (an omitted optional argument).
    pub fn next<T: DeserializeOwned>(&mut self, name: &str) -> Result<T, String> {
        let v = self.0.next().unwrap_or(serde_json::Value::Null);
        T::deserialize(v).map_err(|e| format!("Geometri çekirdeği girdiyi okuyamadı ({name}): {e}"))
    }
}

/// Writes a result.
pub fn result<R: Serialize>(r: &R) -> Result<String, String> {
    json::to_string(r)
}

/// Declares an operation: `op!("name", |a: A, b: B| body)`.
#[macro_export]
macro_rules! op {
    ($name:literal, |$($a:ident : $t:ty),* $(,)?| $body:expr) => {
        $crate::api::Op {
            name: $name,
            run: |s| {
                #[allow(unused_mut)]
                let mut args = $crate::api::Args::parse(s)?;
                $(let $a: $t = args.next(stringify!($a))?;)*
                $crate::api::result(&$body)
            },
        }
    };
}

/// Every operation, in a fixed order (an id is its index).
pub fn all() -> &'static [Op] {
    static ALL: OnceLock<Vec<Op>> = OnceLock::new();
    ALL.get_or_init(|| {
        tables::TABLES
            .iter()
            .flat_map(|t| t.iter().copied())
            .collect()
    })
}

/// The id of an operation, or None when the core has no such operation.
pub fn find(name: &str) -> Option<usize> {
    all().iter().position(|o| o.name == name)
}

/// Runs operation `id` on JSON arguments.
pub fn run(id: usize, args: &str) -> Result<String, String> {
    match all().get(id) {
        Some(op) => (op.run)(args),
        None => Err(format!("Geometri çekirdeğinde {id} numaralı işlem yok.")),
    }
}

/// Runs an operation by name (the golden fixtures).
pub fn run_named(name: &str, args: &str) -> Result<String, String> {
    match find(name) {
        Some(id) => run(id, args),
        None => Err(format!("Geometri çekirdeğinde “{name}” işlemi yok.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for op in all() {
            assert!(seen.insert(op.name), "duplicate operation {}", op.name);
        }
    }

    #[test]
    fn a_call_reads_positional_arguments_and_reports_bad_input() {
        let out = run_named("dist", r#"[{"x":0,"y":0},{"x":3,"y":4}]"#).unwrap();
        assert_eq!(out, "5");
        let err = run_named("dist", r#"[{"x":0}]"#).unwrap_err();
        assert!(
            err.starts_with("Geometri çekirdeği girdiyi okuyamadı"),
            "{err}"
        );
        assert!(run_named("yok", "[]").is_err());
    }
}
