//! Server settings, from the environment first and `.env.local` second
//! (`KENTOS_ENV_FILE` names another file). Secrets are never logged.

use std::collections::BTreeMap;
use std::path::PathBuf;

use kentos_postgres::env;
use kentos_postgres::setup::{DATABASE_URL, OWNER_URL};

#[derive(Clone, Debug)]
pub struct OidcSettings {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: Option<String>,
    /// Accepted `aud` of bearer access tokens (default: the client id).
    pub audience: String,
    /// Button text on the sign-in page.
    pub label: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub env_file: PathBuf,
    pub vars: BTreeMap<String, String>,
    pub database_url: Option<String>,
    pub owner_url: Option<String>,
    pub bind: String,
    pub port: u16,
    /// Where the browser reaches the app (`http://localhost:5173` in development).
    pub public_url: String,
    pub cookie_secure: bool,
    pub local_login: bool,
    pub oidc: Option<OidcSettings>,
}

impl Config {
    pub fn load() -> Result<Self, String> {
        let env_file =
            PathBuf::from(std::env::var("KENTOS_ENV_FILE").unwrap_or_else(|_| ".env.local".into()));
        let vars = env::read_file(&env_file)?;
        let get = |k: &str| env::lookup(&vars, k);
        let flag = |k: &str, default: bool| {
            get(k)
                .map(|v| matches!(v.as_str(), "1" | "true" | "yes"))
                .unwrap_or(default)
        };
        let port = match get("KENTOS_API_PORT") {
            Some(p) => p
                .parse()
                .map_err(|_| format!("KENTOS_API_PORT geçersiz: {p}"))?,
            None => 8787,
        };
        let oidc = match (get("KENTOS_OIDC_ISSUER"), get("KENTOS_OIDC_CLIENT_ID")) {
            (Some(issuer), Some(client_id)) => Some(OidcSettings {
                issuer: issuer.trim_end_matches('/').to_string(),
                audience: get("KENTOS_OIDC_AUDIENCE").unwrap_or_else(|| client_id.clone()),
                client_id,
                client_secret: get("KENTOS_OIDC_CLIENT_SECRET"),
                label: get("KENTOS_OIDC_LABEL").unwrap_or_else(|| "Kurum hesabıyla giriş".into()),
            }),
            (None, None) => None,
            _ => {
                return Err(
                    "OpenID için KENTOS_OIDC_ISSUER ile KENTOS_OIDC_CLIENT_ID birlikte verilmeli."
                        .into(),
                );
            }
        };
        Ok(Self {
            database_url: get(DATABASE_URL),
            owner_url: get(OWNER_URL),
            bind: get("KENTOS_API_BIND").unwrap_or_else(|| "127.0.0.1".into()),
            port,
            public_url: get("KENTOS_PUBLIC_URL")
                .unwrap_or_else(|| "http://localhost:5173".into())
                .trim_end_matches('/')
                .to_string(),
            cookie_secure: flag("KENTOS_COOKIE_SECURE", false),
            local_login: flag("KENTOS_LOCAL_LOGIN", true),
            oidc,
            env_file,
            vars,
        })
    }
}
