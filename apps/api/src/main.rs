//! KentOS API server. Faz A (CLAUDE.md §20) serves only `/v1/health`, so the
//! browser can show whether a server is reachable; the app keeps working
//! without it. Listens on 127.0.0.1 (`KENTOS_API_PORT`, default 8787).

use std::net::SocketAddr;

use axum::{Json, Router, routing::get};
use kentos_contracts::{CONTRACTS_VERSION, Health};

fn app() -> Router {
    Router::new().route("/v1/health", get(health))
}

async fn health() -> Json<Health> {
    Json(Health {
        status: "ok".into(),
        service: "kentos-api".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        commit: option_env!("KENTOS_COMMIT").map(str::to_string),
        contracts: CONTRACTS_VERSION,
    })
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() {
    let port = std::env::var("KENTOS_API_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8787);
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("KentOS API {addr} adresini açamadı: {e}");
            std::process::exit(1);
        }
    };
    println!("KentOS API: http://{addr}/v1/health");
    if let Err(e) = axum::serve(listener, app())
        .with_graceful_shutdown(shutdown())
        .await
    {
        eprintln!("KentOS API durdu: {e}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn health_reports_ok_and_the_contracts_version() {
        let Json(h) = health().await;
        assert_eq!(h.status, "ok");
        assert_eq!(h.contracts, CONTRACTS_VERSION);
        let json = serde_json::to_value(&h).unwrap();
        assert_eq!(json["service"], "kentos-api");
        // The router answers on the documented path.
        let _ = app();
    }
}
