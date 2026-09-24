//! Projects, their objects, the edit command and the event log over HTTP.
//! Every route resolves the caller's access to the tenant in the path first
//! (membership, seat, active tenant); the use cases check the rights. A
//! deleted project answers 410 (`project_deleted`) to opening and writing.

use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use kentos_application::tenancy::{self, Access};
use kentos_application::{AppError, changes, events, lifecycle, projects};
use kentos_contracts::{
    CommandEnvelope, CommitResult, EventPage, FeaturePage, ProjectCreate, ProjectInfo, ProjectList,
};
use serde::Deserialize;
use uuid::Uuid;

use super::AppState;
use super::auth::Caller;
use super::error::{Body, Failure, request_id};

fn uuid(text: &str, what: &str) -> Result<Uuid, AppError> {
    Uuid::parse_str(text).map_err(|_| AppError::not_found(format!("{what} bulunamadı.")))
}

async fn access(state: &AppState, caller: &Caller, tenant: &str) -> Result<Access, AppError> {
    tenancy::access(state.db()?, &caller.0, uuid(tenant, "Kurum")?).await
}

pub async fn list(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path(tenant): Path<String>,
) -> Result<Json<ProjectList>, Failure> {
    let run = async {
        let a = access(&state, &caller, &tenant).await?;
        projects::list(state.db()?, &a).await
    };
    run.await.map(Json).map_err(|e| Failure::with(e, &headers))
}

pub async fn create(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path(tenant): Path<String>,
    Body(input): Body<ProjectCreate>,
) -> Result<(StatusCode, Json<ProjectInfo>), Failure> {
    let key = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let run = async {
        let a = access(&state, &caller, &tenant).await?;
        projects::create(state.db()?, &a, input, key.as_deref()).await
    };
    run.await
        .map(|p| (StatusCode::CREATED, Json(p)))
        .map_err(|e| Failure::with(e, &headers))
}

pub async fn info(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path((tenant, project)): Path<(String, String)>,
) -> Result<Json<ProjectInfo>, Failure> {
    let run = async {
        let a = access(&state, &caller, &tenant).await?;
        projects::info(state.db()?, &a, uuid(&project, "Proje")?).await
    };
    run.await.map(Json).map_err(|e| Failure::with(e, &headers))
}

/// `DELETE …/projects/{project}`: 204 whether it was deleted now or before (a retry); its open editors are told live.
pub async fn delete(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path((tenant, project)): Path<(String, String)>,
) -> Result<StatusCode, Failure> {
    let run = async {
        let a = access(&state, &caller, &tenant).await?;
        let project = uuid(&project, "Proje")?;
        let rid = request_id(&headers);
        if lifecycle::delete(state.db()?, &a, project, rid.as_deref())
            .await?
            .is_some()
        {
            state.hub.notify(a.tenant, project);
        }
        Ok(StatusCode::NO_CONTENT)
    };
    run.await.map_err(|e| Failure::with(e, &headers))
}

#[derive(Deserialize)]
pub struct FeatureQuery {
    after: Option<String>,
    limit: Option<i64>,
    /// Comma-separated ids: the current copies of just these.
    ids: Option<String>,
}

pub async fn features(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path((tenant, project)): Path<(String, String)>,
    Query(q): Query<FeatureQuery>,
) -> Result<Json<FeaturePage>, Failure> {
    let run = async {
        let a = access(&state, &caller, &tenant).await?;
        let project = uuid(&project, "Proje")?;
        let db = state.db()?;
        if let Some(ids) = q.ids.as_deref() {
            let ids = ids
                .split(',')
                .filter(|s| !s.is_empty())
                .map(|s| {
                    Uuid::parse_str(s)
                        .map_err(|_| AppError::invalid(format!("Nesne kimliği geçersiz: {s}")))
                })
                .collect::<Result<Vec<_>, _>>()?;
            let features = projects::features_by_id(db, &a, project, &ids).await?;
            return Ok(FeaturePage {
                features,
                next: None,
            });
        }
        let after = q
            .after
            .as_deref()
            .map(|s| {
                Uuid::parse_str(s).map_err(|_| AppError::invalid("after bir nesne kimliği olmalı."))
            })
            .transpose()?;
        projects::features(
            db,
            &a,
            project,
            after,
            q.limit.unwrap_or(projects::PAGE_MAX),
        )
        .await
    };
    run.await.map(Json).map_err(|e| Failure::with(e, &headers))
}

pub async fn command(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path((tenant, project)): Path<(String, String)>,
    Body(envelope): Body<CommandEnvelope>,
) -> Result<Json<CommitResult>, Failure> {
    let run = async {
        if envelope.project_id != project {
            return Err(AppError::invalid(
                "Komutun projesi adresteki projeyle aynı değil.",
            ));
        }
        let a = access(&state, &caller, &tenant).await?;
        let result = changes::commit(state.db()?, &a, envelope).await?;
        if !result.replayed {
            state.hub.notify(a.tenant, uuid(&project, "Proje")?);
        }
        Ok(result)
    };
    run.await.map(Json).map_err(|e| Failure::with(e, &headers))
}

#[derive(Deserialize)]
pub struct EventQuery {
    after: Option<String>,
    limit: Option<i64>,
}

pub async fn event_log(
    State(state): State<AppState>,
    headers: HeaderMap,
    caller: Caller,
    Path((tenant, project)): Path<(String, String)>,
    Query(q): Query<EventQuery>,
) -> Result<Json<EventPage>, Failure> {
    let run = async {
        let a = access(&state, &caller, &tenant).await?;
        let after = q
            .after
            .as_deref()
            .unwrap_or("0")
            .parse::<i64>()
            .map_err(|_| AppError::invalid("after bir olay imleci olmalı."))?;
        events::after(
            state.db()?,
            &a,
            uuid(&project, "Proje")?,
            after,
            q.limit.unwrap_or(events::PAGE_MAX),
        )
        .await
    };
    run.await.map(Json).map_err(|e| Failure::with(e, &headers))
}
