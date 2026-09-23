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
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A real HTTP request through the router on an ephemeral port.
    async fn get(path: &str) -> (u16, String) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app()).await.unwrap() });
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let request = format!("GET {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        let status = response[9..12].parse().unwrap();
        let body = response
            .split_once("\r\n\r\n")
            .map(|(_, b)| b.to_string())
            .unwrap_or_default();
        (status, body)
    }

    #[tokio::test]
    async fn health_answers_on_its_path_with_the_contract() {
        let (status, body) = get("/v1/health").await;
        assert_eq!(status, 200);
        let h: Health = serde_json::from_str(&body).unwrap();
        assert_eq!(h.status, "ok");
        assert_eq!(h.service, "kentos-api");
        assert_eq!(h.contracts, CONTRACTS_VERSION);
    }

    #[tokio::test]
    async fn other_paths_are_not_found() {
        assert_eq!(get("/v1/nothing").await.0, 404);
    }
}
