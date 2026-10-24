use async_trait::async_trait;
use serde_json::Value;
use sqlx::{PgPool, Row};

use crate::{
    StoreError, WorkspaceConfigRecord, WorkspaceStore, merge_seed_defaults,
    migrate_admin_panel_paths,
};

pub struct PostgresWorkspaceStore {
    pool: PgPool,
}

impl PostgresWorkspaceStore {
    pub async fn connect(
        database_url: &str, seed_id: &str, seed: Value,
    ) -> Result<Self, sqlx::Error> {
        let pool = PgPool::connect(database_url).await?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS workspace_configs (workspace_id TEXT PRIMARY KEY, config JSONB NOT NULL, revision BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        ).execute(&pool).await?;
        sqlx::query("INSERT INTO workspace_configs (workspace_id, config, revision) VALUES ($1, $2, 0) ON CONFLICT (workspace_id) DO NOTHING")
            .bind(seed_id).bind(seed.clone()).execute(&pool).await?;
        let mut stored: Value =
            sqlx::query_scalar("SELECT config FROM workspace_configs WHERE workspace_id = $1")
                .bind(seed_id)
                .fetch_one(&pool)
                .await?;
        if merge_seed_defaults(&mut stored, &seed) | migrate_admin_panel_paths(&mut stored, &seed) {
            sqlx::query(
                "UPDATE workspace_configs SET config = $2, revision = revision + 1, updated_at = now() WHERE workspace_id = $1",
            )
            .bind(seed_id)
            .bind(stored)
            .execute(&pool)
            .await?;
        }
        Ok(Self { pool })
    }
}

#[async_trait]
impl WorkspaceStore for PostgresWorkspaceStore {
    async fn get(&self, workspace_id: &str) -> Result<WorkspaceConfigRecord, StoreError> {
        let row =
            sqlx::query("SELECT config, revision FROM workspace_configs WHERE workspace_id = $1")
                .bind(workspace_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| {
                    tracing::error!(%error, "workspace config query failed");
                    StoreError::Unavailable
                })?
                .ok_or(StoreError::NotFound)?;
        Ok(WorkspaceConfigRecord {
            workspace_id: workspace_id.to_owned(),
            config: row.try_get("config").map_err(|error| {
                tracing::error!(%error, "invalid stored workspace config");
                StoreError::Unavailable
            })?,
            revision: u64::try_from(row.try_get::<i64, _>("revision").map_err(|error| {
                tracing::error!(%error, "invalid workspace revision");
                StoreError::Unavailable
            })?)
            .map_err(|_| StoreError::Unavailable)?,
        })
    }

    async fn update(
        &self, workspace_id: &str, expected_revision: u64, config: Value,
    ) -> Result<WorkspaceConfigRecord, StoreError> {
        let expected_revision =
            i64::try_from(expected_revision).map_err(|_| StoreError::RevisionConflict)?;
        let row = sqlx::query("UPDATE workspace_configs SET config = $3, revision = revision + 1, updated_at = now() WHERE workspace_id = $1 AND revision = $2 RETURNING revision")
            .bind(workspace_id).bind(expected_revision).bind(config.clone()).fetch_optional(&self.pool).await.map_err(|error| {
                tracing::error!(%error, "workspace config update failed"); StoreError::Unavailable
            })?.ok_or(StoreError::RevisionConflict)?;
        let revision = u64::try_from(row.try_get::<i64, _>("revision").map_err(|error| {
            tracing::error!(%error, "invalid workspace revision");
            StoreError::Unavailable
        })?)
        .map_err(|_| StoreError::Unavailable)?;
        Ok(WorkspaceConfigRecord { workspace_id: workspace_id.to_owned(), config, revision })
    }
}
