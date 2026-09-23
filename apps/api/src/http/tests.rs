//! The router end to end (middleware included), with a throwaway database.

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use kentos_application::admin;
use kentos_contracts::{ApiError, Health, Me, TenantRole};
use kentos_postgres::testing::TestDb;
use tower::ServiceExt;

use super::*;
use crate::config::Config;

fn config() -> Config {
    Config {
        env_file: ".env.test".into(),
        vars: Default::default(),
        database_url: None,
        owner_url: None,
        bind: "127.0.0.1".into(),
        port: 0,
        public_url: "http://app.test".into(),
        cookie_secure: false,
        local_login: true,
        oidc: None,
    }
}

fn app(database: Option<Db>) -> Router {
    router(AppState {
        config: Arc::new(config()),
        database,
        oidc: None,
    })
}

async fn send(app: &Router, req: Request<Body>) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let res = app.clone().oneshot(req).await.unwrap();
    let (parts, body) = res.into_parts();
    (
        parts.status,
        parts.headers,
        axum::body::to_bytes(body, usize::MAX)
            .await
            .unwrap()
            .to_vec(),
    )
}

fn login_request(login: &str, password: &str, client_header: bool) -> Request<Body> {
    let mut b = Request::post("/v1/auth/login").header(header::CONTENT_TYPE, "application/json");
    if client_header {
        b = b.header("x-kentos-client", "web");
    }
    b.body(Body::from(
        serde_json::json!({ "login": login, "password": password }).to_string(),
    ))
    .unwrap()
}

#[tokio::test]
async fn health_answers_without_a_database_and_carries_a_request_id() {
    let app = app(None);
    let (status, headers, body) = send(
        &app,
        Request::get("/v1/health").body(Body::empty()).unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let h: Health = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        (h.status.as_str(), h.contracts),
        ("ok", kentos_contracts::CONTRACTS_VERSION)
    );
    assert!(headers.contains_key("x-request-id"));
    // Everything else says the database is missing, as JSON.
    let (status, _, body) = send(&app, Request::get("/v1/me").body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        serde_json::from_slice::<ApiError>(&body).unwrap().error,
        "unavailable"
    );
    let (status, _, _) = send(&app, Request::get("/v1/yok").body(Body::empty()).unwrap()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn local_sign_in_with_a_session_cookie() {
    let Some(db) = TestDb::create().await else {
        return;
    };
    admin::create_tenant(&db.owner, "buro", "Harita Bürosu", 3)
        .await
        .unwrap();
    admin::create_local_user(&db.owner, "ayse", "Ayşe Yılmaz", None, "dogru-parola-1")
        .await
        .unwrap();
    admin::set_membership(&db.owner, "buro", "ayse", TenantRole::Editor, true)
        .await
        .unwrap();
    let app = app(Some(db.app.clone()));

    // Without the app's header the request is refused (cross-site request forgery).
    let (status, _, _) = send(&app, login_request("ayse", "dogru-parola-1", false)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, body) = send(&app, login_request("ayse", "yanlis-parola", true)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let err: ApiError = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        (err.error.as_str(), err.message.as_str()),
        ("unauthenticated", "Giriş adı ya da parola yanlış.")
    );
    assert!(err.request_id.is_some());
    let (status, _, body) = send(
        &app,
        Request::post("/v1/auth/login")
            .header("x-kentos-client", "web")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("{bozuk"))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        serde_json::from_slice::<ApiError>(&body).unwrap().error,
        "invalid"
    );

    let (status, headers, body) = send(&app, login_request("ayse", "dogru-parola-1", true)).await;
    assert_eq!(status, StatusCode::OK);
    let set = headers
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(
        set.starts_with("kentos_session=")
            && set.contains("HttpOnly")
            && set.contains("SameSite=Strict")
    );
    let me: Me = serde_json::from_slice(&body).unwrap();
    assert_eq!(me.user.display_name, "Ayşe Yılmaz");
    assert_eq!(me.memberships[0].tenant_slug, "buro");
    let cookie = set.split(';').next().unwrap().to_string();

    let (status, _, body) = send(
        &app,
        Request::get("/v1/me")
            .header(header::COOKIE, &cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Me>(&body).unwrap().user.id,
        me.user.id
    );

    // Signing out also needs the header; afterwards the cookie is worthless.
    let (status, _, _) = send(
        &app,
        Request::post("/v1/auth/logout")
            .header(header::COOKIE, &cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, headers, _) = send(
        &app,
        Request::post("/v1/auth/logout")
            .header(header::COOKIE, &cookie)
            .header("x-kentos-client", "web")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        headers
            .get(header::SET_COOKIE)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("Max-Age=0")
    );
    let (status, _, _) = send(
        &app,
        Request::get("/v1/me")
            .header(header::COOKIE, &cookie)
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    db.close().await;
}
