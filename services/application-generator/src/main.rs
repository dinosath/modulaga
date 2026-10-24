use std::{net::SocketAddr, sync::Arc};

use application_generator::{
    ApplicationGenerator, GeneratorConfig, GeneratorStore,
    proto::modulaga::applicationgenerator::v1::ApplicationGeneratorServiceExt,
};
use axum::{Json, Router, routing::get};
use connectrpc::Router as ConnectRouter;
use tower_http::{
    cors::{Any, CorsLayer},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use workspace_config::Authenticator;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    let database_url = std::env::var("APPLICATION_GENERATOR_DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://.data/application-generator.sqlite?mode=rwc".into());
    let store = Arc::new(GeneratorStore::connect(&database_url).await?);
    let auth = match std::env::var("AUTH_MODE").as_deref() {
        Ok("disabled") => Authenticator::disabled(),
        Ok("oidc") => Authenticator::oidc_with_endpoints(
            std::env::var("OIDC_ISSUER").expect("OIDC_ISSUER is required when AUTH_MODE=oidc"),
            std::env::var("OIDC_AUDIENCE")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            std::env::var("OIDC_ADMIN_ROLE").unwrap_or_else(|_| "modulaga-admin".into()),
            std::env::var("OIDC_DISCOVERY_URL").ok(),
            std::env::var("OIDC_JWKS_URI").ok(),
        ),
        _ => return Err("AUTH_MODE must explicitly be set to oidc or disabled".into()),
    };
    let service = Arc::new(ApplicationGenerator::new(
        store,
        auth,
        GeneratorConfig::from_env(),
    ))
    .register(ConnectRouter::new());
    let allowed_origins = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://127.0.0.1:4300,http://localhost:4300,http://127.0.0.1:4177,http://localhost:4177".into());
    let origins = allowed_origins
        .split(',')
        .filter_map(|origin| origin.trim().parse().ok())
        .collect::<Vec<_>>();
    let app = Router::new()
        .route(
            "/health",
            get(|| async { Json(serde_json::json!({"status":"ok"})) }),
        )
        .merge(service.into_axum_router())
        .layer(
            CorsLayer::new()
                .allow_origin(origins)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers(Any),
        )
        .layer(TraceLayer::new_for_http())
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::X_CONTENT_TYPE_OPTIONS,
            axum::http::HeaderValue::from_static("nosniff"),
        ));
    let address: SocketAddr = std::env::var("APPLICATION_GENERATOR_BIND_ADDRESS")
        .unwrap_or_else(|_| "0.0.0.0:4306".into())
        .parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    tracing::info!(%address, "application generator ConnectRPC service ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
