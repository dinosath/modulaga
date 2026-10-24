use std::str::FromStr;

use async_trait::async_trait;
use serde_json::Value;
use sqlx::{
    Row, SqlitePool,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

use crate::{
    StoreError, WorkspaceConfigRecord, WorkspaceStore, merge_seed_defaults,
    migrate_admin_panel_paths,
};

pub struct SqliteWorkspaceStore {
    pool: SqlitePool,
}

impl SqliteWorkspaceStore {
    pub async fn connect(
        database_url: &str, seed_id: &str, seed: Value,
    ) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::from_str(database_url)?.create_if_missing(true);
        let pool = SqlitePoolOptions::new().max_connections(5).connect_with(options).await?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS workspace_configs (workspace_id TEXT PRIMARY KEY, config TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "INSERT INTO workspace_configs (workspace_id, config, revision) VALUES (?1, ?2, 0) ON CONFLICT(workspace_id) DO NOTHING",
        )
        .bind(seed_id)
        .bind(serde_json::to_string(&seed).map_err(|error| sqlx::Error::Decode(Box::new(error)))?)
        .execute(&pool)
        .await?;
        let stored: String =
            sqlx::query_scalar("SELECT config FROM workspace_configs WHERE workspace_id = ?1")
                .bind(seed_id)
                .fetch_one(&pool)
                .await?;
        let mut stored_config: Value =
            serde_json::from_str(&stored).map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
        if merge_seed_defaults(&mut stored_config, &seed)
            | migrate_admin_panel_paths(&mut stored_config, &seed)
        {
            sqlx::query(
                "UPDATE workspace_configs SET config = ?2, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?1",
            )
            .bind(seed_id)
            .bind(serde_json::to_string(&stored_config).map_err(|error| sqlx::Error::Decode(Box::new(error)))?)
            .execute(&pool)
            .await?;
        }
        Ok(Self { pool })
    }
}

#[async_trait]
impl WorkspaceStore for SqliteWorkspaceStore {
    async fn get(&self, workspace_id: &str) -> Result<WorkspaceConfigRecord, StoreError> {
        let row =
            sqlx::query("SELECT config, revision FROM workspace_configs WHERE workspace_id = ?1")
                .bind(workspace_id)
                .fetch_optional(&self.pool)
                .await
                .map_err(|error| {
                    tracing::error!(%error, "workspace config query failed");
                    StoreError::Unavailable
                })?
                .ok_or(StoreError::NotFound)?;
        let config_json: String = row.try_get("config").map_err(|error| {
            tracing::error!(%error, "invalid stored workspace config");
            StoreError::Unavailable
        })?;
        let revision: i64 = row.try_get("revision").map_err(|error| {
            tracing::error!(%error, "invalid workspace revision");
            StoreError::Unavailable
        })?;
        Ok(WorkspaceConfigRecord {
            workspace_id: workspace_id.to_owned(),
            config: serde_json::from_str(&config_json).map_err(|error| {
                tracing::error!(%error, "invalid stored workspace config JSON");
                StoreError::Unavailable
            })?,
            revision: u64::try_from(revision).map_err(|_| StoreError::Unavailable)?,
        })
    }

    async fn update(
        &self, workspace_id: &str, expected_revision: u64, config: Value,
    ) -> Result<WorkspaceConfigRecord, StoreError> {
        let expected_revision =
            i64::try_from(expected_revision).map_err(|_| StoreError::RevisionConflict)?;
        let config_json = serde_json::to_string(&config).map_err(|error| {
            tracing::error!(%error, "workspace config serialization failed");
            StoreError::Unavailable
        })?;
        let row = sqlx::query(
            "UPDATE workspace_configs SET config = ?3, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE workspace_id = ?1 AND revision = ?2 RETURNING revision",
        )
        .bind(workspace_id)
        .bind(expected_revision)
        .bind(config_json)
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| {
            tracing::error!(%error, "workspace config update failed");
            StoreError::Unavailable
        })?
        .ok_or(StoreError::RevisionConflict)?;
        let revision = u64::try_from(row.try_get::<i64, _>("revision").map_err(|error| {
            tracing::error!(%error, "invalid workspace revision");
            StoreError::Unavailable
        })?)
        .map_err(|_| StoreError::Unavailable)?;
        Ok(WorkspaceConfigRecord { workspace_id: workspace_id.to_owned(), config, revision })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::SqliteWorkspaceStore;
    use crate::{StoreError, WorkspaceStore};

    #[tokio::test]
    async fn seeds_reads_and_updates_workspace_configuration_with_revision_checks() {
        let seed: Value =
            serde_json::from_str(include_str!("../../../workspace-config/workspaces/default.json"))
                .unwrap();
        let default_entries = seed["menus"][0]["entries"].as_array().unwrap();
        fn contains_admin_panel_action(entries: &[Value]) -> bool {
            entries.iter().any(|entry| {
                (entry["type"] == "action" && entry["action"] == "admin-panel")
                    || entry["children"]
                        .as_array()
                        .is_some_and(|children| contains_admin_panel_action(children))
            })
        }
        assert!(!contains_admin_panel_action(default_entries));
        assert!(default_entries.iter().all(|entry| entry["type"] == "section"));
        assert_eq!(
            seed["shell"]["sidebar"]["adminMenuSettingsPath"],
            "/workspace-settings"
        );
        let store = SqliteWorkspaceStore::connect("sqlite::memory:", "default", seed.clone())
            .await
            .unwrap();

        let current = store.get("default").await.unwrap();
        assert_eq!(current.config, seed);
        assert_eq!(current.revision, 0);
        assert_eq!(store.get("other").await, Err(StoreError::NotFound));

        let updated = json!({"menus": [{"entries": [{"id": "settings"}, {"id": "reports"}]}]});
        let saved = store.update("default", 0, updated.clone()).await.unwrap();
        assert_eq!(saved.config, updated);
        assert_eq!(saved.revision, 1);
        assert_eq!(store.get("default").await.unwrap(), saved);
        assert_eq!(store.update("default", 0, json!({})).await, Err(StoreError::RevisionConflict));
    }

    #[tokio::test]
    async fn startup_adds_new_seed_menu_nodes_without_replacing_user_state() {
        let seed: Value =
            serde_json::from_str(include_str!("../../../workspace-config/workspaces/default.json"))
                .unwrap();
        let old_config = json!({
            "schemaVersion": 1,
            "workspace": {"id":"default", "name":"My workspace"},
            "installations": [], "routes": [],
            "menus": [{"id":"primary", "name":"My navigation", "entries":[
                {"id":"operations", "type":"section", "label":"My operations", "children":[
                    {"id":"custom-entry", "type":"external", "label":"Custom", "href":"https://example.com", "visible":true}
                ]}
            ]}],
            "menuPlacements": [], "layout":{"template":"single-column","regions":[]}
        });
        let path = std::env::temp_dir()
            .join(format!("modulaga-config-migration-{}.sqlite", uuid::Uuid::new_v4()));
        let database_url = format!("sqlite://{}?mode=rwc", path.display());
        drop(SqliteWorkspaceStore::connect(&database_url, "default", old_config).await.unwrap());
        let store = SqliteWorkspaceStore::connect(&database_url, "default", seed).await.unwrap();
        let merged = store.get("default").await.unwrap();
        assert_eq!(merged.revision, 1);
        assert_eq!(merged.config["workspace"]["name"], "My workspace");
        assert_eq!(merged.config["menus"][0]["name"], "My navigation");
        assert_eq!(merged.config["menus"][0]["entries"][0]["label"], "My operations");
        assert_eq!(merged.config["menus"][0]["entries"][0]["children"][0]["id"], "custom-entry");
        assert!(
            merged.config["routes"]
                .as_array()
                .unwrap()
                .iter()
                .any(|route| route["id"] == "content-types-overview")
        );
        assert!(merged.config["menus"][0]["entries"].as_array().unwrap().iter().any(|entry| {
            entry["id"] == "settings"
                && entry["children"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|child| child["id"] == "content-types-link")
        }));
        drop(store);
        let _ = std::fs::remove_file(path);
    }
}
