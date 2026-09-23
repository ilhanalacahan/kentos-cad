//! `kentosd`: the KentOS server (CLAUDE.md §14, §18). `serve` runs the API
//! on 127.0.0.1 (`KENTOS_API_PORT`, default 8787); the other subcommands set
//! up the database and administer tenants and accounts (see `cli::USAGE`).
//! Without a database configured, `serve` answers `/v1/health` only, so the
//! drawing app keeps working as before.

mod cli;
mod config;
mod http;
mod oidc;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use kentos_postgres::Db;

use crate::config::Config;
use crate::http::AppState;

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn serve(config: Config) -> Result<(), String> {
    let database = match &config.database_url {
        Some(url) => {
            let db = Db::connect(url, 16, Duration::from_secs(5))
                .await
                .map_err(|e| format!("Veritabanına bağlanılamadı: {e}"))?;
            if !db
                .schema_ready()
                .await
                .map_err(|e| format!("Şema denetlenemedi: {e}"))?
            {
                return Err(
                    "Veritabanı şeması bu sürüme göre eski; önce `kentosd migrate` çalıştırın."
                        .into(),
                );
            }
            Some(db)
        }
        None => {
            tracing::warn!(
                "KENTOS_DATABASE_URL yok: yalnızca /v1/health yanıt verir (`kentosd db-setup` ile kurun)"
            );
            None
        }
    };
    let ip: std::net::IpAddr = config
        .bind
        .parse()
        .map_err(|_| format!("KENTOS_API_BIND geçersiz: {}", config.bind))?;
    let addr = SocketAddr::from((ip, config.port));
    let oidc = match &config.oidc {
        Some(settings) => Some(Arc::new(oidc::Oidc::new(
            settings.clone(),
            &config.public_url,
        )?)),
        None => None,
    };
    let state = AppState {
        config: Arc::new(config),
        database,
        oidc,
    };
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("KentOS API {addr} adresini açamadı: {e}"))?;
    println!("KentOS API: http://{addr}/v1/health");
    axum::serve(listener, http::router(state))
        .with_graceful_shutdown(shutdown())
        .await
        .map_err(|e| format!("KentOS API durdu: {e}"))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("KENTOS_LOG")
                .unwrap_or_else(|_| "info,sqlx=warn,tower_http=info".into()),
        )
        .with_target(false)
        .init();
    let result = async {
        let args = cli::Args::parse(std::env::args().skip(1))?;
        let config = Config::load()?;
        if args.words.is_empty() || args.words == ["serve"] {
            serve(config).await
        } else {
            cli::run(&config, &args).await
        }
    }
    .await;
    if let Err(message) = result {
        eprintln!("{message}");
        std::process::exit(1);
    }
}
