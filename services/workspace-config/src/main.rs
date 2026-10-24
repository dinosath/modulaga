use std::{net::SocketAddr, sync::Arc};

use axum::{Json, Router, routing::get};
use connectrpc::Router as ConnectRouter;
use serde_json::Value;
use tower_http::{
    cors::{Any, CorsLayer},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use workspace_config::proto::modulaga::workspace::v1::WorkspaceConfigServiceExt;
use workspace_config::{
    AppState, Authenticator, ConfigService, MemoryWorkspaceStore, PostgresWorkspaceStore,
    SqliteWorkspaceStore, WorkspaceConfigRecord, WorkspaceStore,
};

const DEFAULT_CONFIG: &str = include_str!("../../../workspace-config/workspaces/default.json");

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let seed = match std::env::var("DEFAULT_WORKSPACE_CONFIG_PATH") {
        Ok(path) => tokio::fs::read_to_string(path).await?,
        Err(_) => DEFAULT_CONFIG.to_owned(),
    };
    let config: Value = serde_json::from_str(&seed)?;
    workspace_config::validate_workspace_config(&config).map_err(std::io::Error::other)?;
    let workspace_id = config["workspace"]["id"].as_str().unwrap_or("default").to_owned();
    let store_mode = std::env::var("WORKSPACE_STORE").unwrap_or_else(|_| "sqlite".into());
    let store: Arc<dyn WorkspaceStore> = match store_mode.as_str() {
        "memory" => {
            tracing::warn!(
                "workspace configuration is stored in memory and will be lost on restart"
            );
            Arc::new(MemoryWorkspaceStore::with_record(WorkspaceConfigRecord {
                workspace_id: workspace_id.clone(),
                config,
                revision: 0,
            }))
        }
        "postgres" => {
            let database_url = std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://modulaga:modulaga@127.0.0.1:5432/modulaga".into());
            Arc::new(PostgresWorkspaceStore::connect(&database_url, &workspace_id, config).await?)
        }
        "sqlite" => {
            let database_url = std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite://.data/workspace-config.sqlite?mode=rwc".into());
            Arc::new(SqliteWorkspaceStore::connect(&database_url, &workspace_id, config).await?)
        }
        _ => return Err("WORKSPACE_STORE must be memory, sqlite, or postgres".into()),
    };
    let auth = match std::env::var("AUTH_MODE").as_deref() {
        Ok("oidc") => Authenticator::oidc_with_endpoints(
            std::env::var("OIDC_ISSUER").expect("OIDC_ISSUER is required when AUTH_MODE=oidc"),
            std::env::var("OIDC_AUDIENCE").ok().filter(|value| !value.trim().is_empty()),
            std::env::var("OIDC_ADMIN_ROLE").unwrap_or_else(|_| "modulaga-admin".into()),
            std::env::var("OIDC_DISCOVERY_URL").ok(),
            std::env::var("OIDC_JWKS_URI").ok(),
        ),
        Ok("disabled") => {
            tracing::warn!(
                "Ferriskey token checks are disabled; intended for local development only"
            );
            Authenticator::disabled()
        }
        Err(_) => return Err("AUTH_MODE must be explicitly set to oidc or disabled".into()),
        Ok(other) => return Err(format!("unsupported AUTH_MODE: {other}").into()),
    };

    let connect_router =
        Arc::new(ConfigService::new(AppState::new(store, auth))).register(ConnectRouter::new());
    let allowed_origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://127.0.0.1:4300,http://localhost:4300".into());
    let origins = allowed_origins
        .split(',')
        .filter_map(|value| value.trim().parse().ok())
        .collect::<Vec<_>>();
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers(Any);
    let app = Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({"status":"ok"})) }))
        .merge(connect_router.into_axum_router())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            axum::http::HeaderValue::from_static("nosniff"),
        ));

    let address: SocketAddr =
        std::env::var("BIND_ADDRESS").unwrap_or_else(|_| "0.0.0.0:4303".into()).parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "workspace configuration ConnectRPC service ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
