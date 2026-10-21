use std::{net::SocketAddr, sync::Arc};

use axum::{Json, Router, routing::get};
use connectrpc::{
    RequestContext, Response, Router as ConnectRouter, ServiceRequest, ServiceResult,
};
use serde_json::Value;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use workspace_config::catalog::validate_catalog;
use workspace_config::proto::modulaga::catalog::v1::{
    CatalogResponse, CatalogService, CatalogServiceExt, GetCatalogRequest,
};

const DEFAULT_CATALOG: &str = include_str!("../../../../workspace-config/catalog.json");

struct CatalogApi {
    serialized: String,
}

#[allow(refining_impl_trait)]
impl CatalogService for CatalogApi {
    async fn get(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, GetCatalogRequest>,
    ) -> ServiceResult<CatalogResponse> {
        Response::ok(CatalogResponse {
            catalog_json: self.serialized.clone(),
            revision: 1,
            ..Default::default()
        })
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    let source = match std::env::var("CATALOG_PATH") {
        Ok(path) => tokio::fs::read_to_string(path).await?,
        Err(_) => DEFAULT_CATALOG.to_owned(),
    };
    let catalog: Value = serde_json::from_str(&source)?;
    validate_catalog(&catalog).map_err(std::io::Error::other)?;
    let serialized = serde_json::to_string(&catalog)?;
    let rpc = Arc::new(CatalogApi { serialized }).register(ConnectRouter::new());
    let origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:4310,http://127.0.0.1:4310".into());
    let origins = origins
        .split(',')
        .filter_map(|value| value.trim().parse().ok())
        .collect::<Vec<_>>();
    let app = Router::new()
        .route(
            "/health",
            get(|| async { Json(serde_json::json!({"status":"ok"})) }),
        )
        .merge(rpc.into_axum_router())
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers(Any),
        )
        .layer(TraceLayer::new_for_http());
    let address: SocketAddr = std::env::var("CATALOG_BIND_ADDRESS")
        .unwrap_or_else(|_| "0.0.0.0:4304".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "microfrontend catalog ConnectRPC service ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
