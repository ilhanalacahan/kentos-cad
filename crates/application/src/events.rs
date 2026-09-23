//! A project's committed changes after a cursor, in commit order (the
//! outbox, CLAUDE.md §17 "Tile güncellik kapısı", §21.1). Clients replay what
//! they missed from here; the WebSocket pushes the same records live.

use kentos_contracts::{EventPage, EventRecord};
use serde_json::Value;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::tenancy::{Access, Capability};

pub const PAGE_MAX: i64 = 500;

pub fn record(seq: i64, payload: Value) -> AppResult<EventRecord> {
    let mut e: EventRecord = serde_json::from_value(payload)
        .map_err(|e| AppError::invalid(format!("Olay {seq} okunamadı: {e}")))?;
    e.seq = seq.to_string();
    Ok(e)
}

/// Events with `seq > after`, at most `limit`; `next` is the cursor to continue from.
pub async fn after(
    db: &kentos_postgres::Db,
    access: &Access,
    project: Uuid,
    after: i64,
    limit: i64,
) -> AppResult<EventPage> {
    access.require(Capability::ProjectRead)?;
    let mut tx = db.scoped(access.scope()).await?;
    let found: bool = sqlx::query_scalar(
        "select exists (select 1 from kentos.project where tenant_id = $1 and id = $2)",
    )
    .bind(access.tenant)
    .bind(project)
    .fetch_one(&mut *tx)
    .await?;
    if !found {
        return Err(AppError::not_found("Proje bulunamadı."));
    }
    let rows: Vec<(i64, Value)> = sqlx::query_as(
        "select seq, payload from kentos.outbox_event where tenant_id = $1 and project_id = $2 and seq > $3 order by seq limit $4",
    )
    .bind(access.tenant)
    .bind(project)
    .bind(after)
    .bind(limit.clamp(1, PAGE_MAX))
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    let next = rows.last().map(|(s, _)| *s).unwrap_or(after);
    let events = rows
        .into_iter()
        .map(|(s, p)| record(s, p))
        .collect::<AppResult<_>>()?;
    Ok(EventPage {
        events,
        next: next.to_string(),
    })
}

/// The newest event's cursor (0 when none); a client ahead of it must reopen the project.
pub async fn latest(db: &kentos_postgres::Db, access: &Access, project: Uuid) -> AppResult<i64> {
    access.require(Capability::ProjectRead)?;
    let mut tx = db.scoped(access.scope()).await?;
    let row: Option<i64> = sqlx::query_scalar(
        "select coalesce((select max(seq) from kentos.outbox_event o where o.tenant_id = p.tenant_id and o.project_id = p.id), 0)
           from kentos.project p where p.tenant_id = $1 and p.id = $2",
    )
    .bind(access.tenant)
    .bind(project)
    .fetch_optional(&mut *tx)
    .await?;
    tx.commit().await?;
    row.ok_or_else(|| AppError::not_found("Proje bulunamadı."))
}
