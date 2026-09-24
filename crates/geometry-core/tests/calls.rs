//! The frozen call fixtures (`fixtures/geometry/v1/calls-*.json`, recorded
//! from the TypeScript core, docs/adr/0008) through the core's call table,
//! natively. The WASM build runs the same files through the app's path
//! (`src/wasm/calls.wasm.test.ts`).

// Test harness code, not the core: the std float methods are fine here.
#![allow(clippy::disallowed_methods)]

use std::path::PathBuf;

use kentos_geometry_core::api::run_named;
use serde_json::Value;

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/geometry/v1")
}

/// Numbers within |a − e| ≤ abs + rel·max(|a|, |e|); strings (and the "#NaN"
/// / "#Inf" markers), booleans, nulls, lengths and keys exactly.
fn same(actual: &Value, expected: &Value, abs: f64, rel: f64, path: &str) -> Result<(), String> {
    match (actual, expected) {
        (Value::Number(a), Value::Number(e)) => {
            let (a, e) = (
                a.as_f64().unwrap_or(f64::NAN),
                e.as_f64().unwrap_or(f64::NAN),
            );
            let d = (a - e).abs();
            if d <= abs + rel * a.abs().max(e.abs()) {
                Ok(())
            } else {
                Err(format!("{path}: {a} ≠ {e} (fark {d})"))
            }
        }
        (Value::Array(a), Value::Array(e)) => {
            if a.len() != e.len() {
                return Err(format!("{path}: {} öğe ≠ {} öğe", a.len(), e.len()));
            }
            for (i, (x, y)) in a.iter().zip(e).enumerate() {
                same(x, y, abs, rel, &format!("{path}[{i}]"))?;
            }
            Ok(())
        }
        (Value::Object(a), Value::Object(e)) => {
            for k in a.keys().chain(e.keys()) {
                match (a.get(k), e.get(k)) {
                    (Some(x), Some(y)) => same(x, y, abs, rel, &format!("{path}.{k}"))?,
                    (None, _) => return Err(format!("{path}.{k}: eksik")),
                    (_, None) => return Err(format!("{path}.{k}: fazla")),
                }
            }
            Ok(())
        }
        _ if actual == expected => Ok(()),
        _ => Err(format!("{path}: {actual} ≠ {expected}")),
    }
}

#[test]
fn every_call_fixture_matches_the_typescript_reference() {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir())
        .expect("fixture directory")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("calls-") && n.ends_with(".json"))
        })
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no call fixtures");
    let mut failures = Vec::new();
    let mut count = 0;
    for path in &files {
        let file: Value =
            serde_json::from_str(&std::fs::read_to_string(path).expect("fixture file"))
                .expect("fixture JSON");
        assert_eq!(
            file["format"],
            "kentos.geometry-calls",
            "{}",
            path.display()
        );
        assert_eq!(file["version"], 1);
        assert_eq!(file["crs"]["unit"], "metre");
        let abs = file["tolerance"]["abs"].as_f64().unwrap();
        let rel = file["tolerance"]["rel"].as_f64().unwrap();
        for c in file["cases"].as_array().expect("cases") {
            count += 1;
            let label = format!(
                "{}: {}",
                c["fn"].as_str().unwrap(),
                c["name"].as_str().unwrap()
            );
            let args = serde_json::to_string(&c["args"]).unwrap();
            let got = run_named(c["fn"].as_str().unwrap(), &args).and_then(|out| {
                serde_json::from_str::<Value>(&out).map_err(|e| format!("çıktı JSON değil: {e}"))
            });
            match got {
                Ok(v) => {
                    if let Err(e) = same(&v, &c["expect"], abs, rel, &label) {
                        failures.push(e);
                    }
                }
                Err(e) => failures.push(format!("{label}: {e}")),
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {count} call(s) differ:\n{}",
        failures.len(),
        failures
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}
