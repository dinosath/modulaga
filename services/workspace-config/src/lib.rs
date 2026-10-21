use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use async_trait::async_trait;
use axum::http::{HeaderMap, header::AUTHORIZATION};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

pub mod catalog;
mod postgres;
pub use postgres::PostgresWorkspaceStore;
mod sqlite;
pub use sqlite::SqliteWorkspaceStore;

pub mod proto {
    connectrpc::include_generated!();
}

use proto::modulaga::workspace::v1::{
    GetWorkspaceConfigRequest, UpdateWorkspaceConfigRequest, WorkspaceConfigResponse,
    WorkspaceConfigService,
};

const MAX_CONFIG_BYTES: usize = 1_048_576;
const JWKS_TTL: Duration = Duration::from_secs(300);

pub(crate) fn migrate_admin_panel_paths(config: &mut Value, seed: &Value) -> bool {
    fn find_path(entries: &[Value]) -> Option<String> {
        for entry in entries {
            if entry.get("type").and_then(Value::as_str) == Some("action")
                && entry.get("action").and_then(Value::as_str) == Some("admin-panel")
            {
                if let Some(path) = entry.get("path").and_then(Value::as_str) {
                    return Some(path.to_owned());
                }
            }
            if let Some(children) = entry.get("children").and_then(Value::as_array) {
                if let Some(path) = find_path(children) {
                    return Some(path);
                }
            }
        }
        None
    }

    fn update_entries(entries: &mut [Value], path: &str) -> bool {
        let mut changed = false;
        for entry in entries {
            let is_admin_panel = entry.get("type").and_then(Value::as_str) == Some("action")
                && entry.get("action").and_then(Value::as_str) == Some("admin-panel");
            if is_admin_panel && entry.get("path").and_then(Value::as_str).is_none() {
                entry["path"] = Value::String(path.to_owned());
                changed = true;
            }
            if let Some(children) = entry.get_mut("children").and_then(Value::as_array_mut) {
                changed |= update_entries(children, path);
            }
        }
        changed
    }

    let Some(path) = seed
        .get("menus")
        .and_then(Value::as_array)
        .and_then(|menus| {
            menus.iter().find_map(|menu| {
                menu.get("entries")
                    .and_then(Value::as_array)
                    .and_then(|entries| find_path(entries))
            })
        })
    else {
        return false;
    };

    config
        .get_mut("menus")
        .and_then(Value::as_array_mut)
        .map(|menus| {
            menus.iter_mut().fold(false, |changed, menu| {
                let entries = menu.get_mut("entries").and_then(Value::as_array_mut);
                changed | entries.is_some_and(|entries| update_entries(entries, &path))
            })
        })
        .unwrap_or(false)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceConfigRecord {
    pub workspace_id: String,
    pub config: Value,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum StoreError {
    NotFound,
    RevisionConflict,
    Unavailable,
}

#[async_trait]
pub trait WorkspaceStore: Send + Sync {
    async fn get(&self, workspace_id: &str) -> Result<WorkspaceConfigRecord, StoreError>;
    async fn update(
        &self,
        workspace_id: &str,
        expected_revision: u64,
        config: Value,
    ) -> Result<WorkspaceConfigRecord, StoreError>;
}

#[derive(Default)]
pub struct MemoryWorkspaceStore {
    records: Mutex<HashMap<String, WorkspaceConfigRecord>>,
}

impl MemoryWorkspaceStore {
    pub fn with_record(record: WorkspaceConfigRecord) -> Self {
        Self {
            records: Mutex::new(HashMap::from([(record.workspace_id.clone(), record)])),
        }
    }
}

#[async_trait]
impl WorkspaceStore for MemoryWorkspaceStore {
    async fn get(&self, workspace_id: &str) -> Result<WorkspaceConfigRecord, StoreError> {
        self.records
            .lock()
            .await
            .get(workspace_id)
            .cloned()
            .ok_or(StoreError::NotFound)
    }

    async fn update(
        &self,
        workspace_id: &str,
        expected_revision: u64,
        config: Value,
    ) -> Result<WorkspaceConfigRecord, StoreError> {
        let mut records = self.records.lock().await;
        let current = records.get(workspace_id).ok_or(StoreError::NotFound)?;
        if current.revision != expected_revision {
            return Err(StoreError::RevisionConflict);
        }
        let updated = WorkspaceConfigRecord {
            workspace_id: workspace_id.to_owned(),
            config,
            revision: current.revision + 1,
        };
        records.insert(workspace_id.to_owned(), updated.clone());
        Ok(updated)
    }
}

#[derive(Clone)]
pub struct AppState {
    pub store: Arc<dyn WorkspaceStore>,
    pub auth: Authenticator,
}

impl AppState {
    pub fn new(store: Arc<dyn WorkspaceStore>, auth: Authenticator) -> Self {
        Self { store, auth }
    }
}

pub struct ConfigService {
    state: AppState,
}

impl ConfigService {
    pub fn new(state: AppState) -> Self {
        Self { state }
    }
}

#[allow(refining_impl_trait)]
impl WorkspaceConfigService for ConfigService {
    async fn get(
        &self,
        _ctx: RequestContext,
        request: ServiceRequest<'_, GetWorkspaceConfigRequest>,
    ) -> ServiceResult<WorkspaceConfigResponse> {
        let workspace_id = request.view().workspace_id.trim();
        if !valid_identifier(workspace_id) {
            return Err(ConnectError::invalid_argument(
                "workspace_id must be a valid identifier",
            ));
        }
        let record = self
            .state
            .store
            .get(workspace_id)
            .await
            .map_err(store_error)?;
        Response::ok(to_response(record)?)
    }

    async fn update(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpdateWorkspaceConfigRequest>,
    ) -> ServiceResult<WorkspaceConfigResponse> {
        self.state.auth.require_admin(ctx.headers()).await?;
        let request = request.view();
        let workspace_id = request.workspace_id.trim();
        if !valid_identifier(workspace_id) {
            return Err(ConnectError::invalid_argument(
                "workspace_id must be a valid identifier",
            ));
        }
        if request.config_json.len() > MAX_CONFIG_BYTES {
            return Err(ConnectError::invalid_argument(
                "configuration exceeds the 1 MiB limit",
            ));
        }
        let config: Value = serde_json::from_str(&request.config_json)
            .map_err(|_| ConnectError::invalid_argument("config_json must contain valid JSON"))?;
        validate_workspace_config(&config).map_err(ConnectError::invalid_argument)?;
        let record = self
            .state
            .store
            .update(workspace_id, request.expected_revision, config)
            .await
            .map_err(store_error)?;
        Response::ok(to_response(record)?)
    }
}

fn to_response(record: WorkspaceConfigRecord) -> Result<WorkspaceConfigResponse, ConnectError> {
    let config_json = serde_json::to_string(&record.config)
        .map_err(|_| ConnectError::internal("could not encode workspace configuration"))?;
    Ok(WorkspaceConfigResponse {
        workspace_id: record.workspace_id,
        config_json,
        revision: record.revision,
        ..Default::default()
    })
}

fn store_error(error: StoreError) -> ConnectError {
    match error {
        StoreError::NotFound => ConnectError::not_found("workspace configuration was not found"),
        StoreError::RevisionConflict => {
            ConnectError::aborted("configuration revision changed; reload and retry")
        }
        StoreError::Unavailable => ConnectError::internal("configuration storage is unavailable"),
    }
}

#[cfg(test)]
mod service_tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};
    use buffa::Message;
    use connectrpc::HasMessageView;
    use connectrpc::ServiceRequest;
    use jsonwebtoken::{EncodingKey, Header, encode};

    const TEST_RSA_PRIVATE_KEY: &[u8] = b"-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCfRe8i2VkIS2w+\nonxJtehLb9FxP+o7GGgVhlcpQJX3Jg19nrXZYIj1+WnDXZEsF1uhIhaczvy0d1Mf\nKhb3jmgSSkUkvgC95B3nckLbimzvoFtVuP+3JldstN3e3SmhmDoD4tTXv9ZeCXj/\nL0S/avHYiIxbnQ4R1D6GO7b1MtzNscIc2GD5hYyiaqdNfbrtZiblj6K6wzwsVgGf\nUWv0hu0RAPgnmEipWfzLP8LEq5HPK8b5Gz5sUsXIVxVN0qYcolCqabNTTUa1b8Qd\nmQze+gJ/1lRkTGk7SdaouVd2XMKyXshDyMNXQYkz4SxPHTaP/AH1fUKJnebihx+r\n+3fZg7hzAgMBAAECggEAMVabIQr+OwUON4rjAHxyxKeTVEct2neRipVue69vpTtq\n826OO5PdaYEFI8lg1q03q78hDRtLieXq4F0L90zsbToHmD2pgilfoBoznsmPPF3K\n3U+tG0Gr1Fdk4YxWQKIk2p5SO7FICSJbEoXEgJ1y5JZMEHci7B/47GEkKGnEn40C\n3XrfiUwdIMAUEsvHJpTvSgTKh/takYlB8He9Pjxqaw+L/fb2a0gW8H8EAdTSt/aH\nxoOX+lfpNwBKY6Hhs9/n4mbLLtafHL6/O+cOBbIUpFg2bN4L2XIRsG5ft8eXLSLU\noigNZL2zBUh7ggjOU9hD/w7d8czUS48NB12OVX2s4QKBgQDgYN2/hk9gkk/rvwPV\nUKojgMfepTvnUmtPuR1dJd9yqIu54h+0S1Duw8k/D38G1cG5nW2uuPU/1asvh6dx\nSDN+yk3aizTzJWAbiMCfGWZmtGPgXzabBJrFsc9aB3rKSfl7r0QLwlUORxuNpTtu\nJwffmp+gHP9LX3+losPLeQAfkwKBgQC1uDMI2WALVE1wdbfumTvuBT2JGQq9F6g1\noc+vx4Ccy6kZz0dooHU7fjrbYuWBHBafPdaZsd271MeVgBrPK/0H9Jdg8RRmKGDE\nBMlFy5PefunAisT6xvE0Gh0gqC8888+L+6CVmcPI4sdP6IFOY2kRXyLMvbRATKt6\n42L9/njPoQKBgQC+HvXmMj0SHAeiPvFVj4sKmDVDH4kZocmR/M23vr6OHeh/Me4h\nS+wg1D6ys0O0G+2RhKaKdOhCFZ9+n5gusboIhgzf0DKmkBXWXtKwPMp63gD+/k57\nnbQzLU3///R4caP2vHSQ7jI57eCX7djkpifSvObiuY9MY3f6dmcnArkrBwKBgEds\nieqdfemWDgX4zv2iDvMj7ibXx+fAx6Wk3vvJH10Bk4qIdRnDj7B9keau/WP8xUt7\nw8CPL4bnQDcbre3l7UNWOLWqrAjnL/l7pByhwpH+MiQypu+miCGhbfdrA34iml37\n3gdO86werpZS3ZgQ7LgeO5Bbs+BeAjx/6WXJwnRhAoGAXWOtMSkn0LRJ63L+IjCA\nEidZqJ+1/u4WrVQ55+aIGnZN60KjOhamoPQCOirOjEgtr0OMgDM9OSVFwrNVg9yn\nstez5j5L7mqUPEIzfNKZ/hxZbFf1tkGV5zWQgQFMfHDJi/3a3meOFGmYuzQKCHoC\nXpmEGyBufldTwaip+Onnmqk=\n-----END PRIVATE KEY-----\n";
    const TEST_RSA_MODULUS: &str = "n0XvItlZCEtsPqJ8SbXoS2_RcT_qOxhoFYZXKUCV9yYNfZ612WCI9flpw12RLBdboSIWnM78tHdTHyoW945oEkpFJL4AveQd53JC24ps76BbVbj_tyZXbLTd3t0poZg6A-LU17_WXgl4_y9Ev2rx2IiMW50OEdQ-hju29TLczbHCHNhg-YWMomqnTX267WYm5Y-iusM8LFYBn1Fr9IbtEQD4J5hIqVn8yz_CxKuRzyvG-Rs-bFLFyFcVTdKmHKJQqmmzU01GtW_EHZkM3voCf9ZUZExpO0nWqLlXdlzCsl7IQ8jDV0GJM-EsTx02j_wB9X1CiZ3m4ocfq_t32YO4cw";

    fn state() -> AppState {
        AppState::new(
            Arc::new(MemoryWorkspaceStore::with_record(WorkspaceConfigRecord {
                workspace_id: "default".into(),
                config: serde_json::json!({}),
                revision: 0,
            })),
            Authenticator::disabled(),
        )
    }

    #[tokio::test]
    async fn get_returns_config_and_reports_bad_or_missing_workspace() {
        let service = ConfigService::new(state());
        let input = GetWorkspaceConfigRequest {
            workspace_id: "default".into(),
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = GetWorkspaceConfigRequest::decode_view(&body).unwrap();
        let request = ServiceRequest::from_parts(&view, &body);
        assert!(
            service
                .get(RequestContext::default(), request)
                .await
                .is_ok()
        );

        let input = GetWorkspaceConfigRequest {
            workspace_id: "bad/id".into(),
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = GetWorkspaceConfigRequest::decode_view(&body).unwrap();
        assert!(
            service
                .get(
                    RequestContext::default(),
                    ServiceRequest::from_parts(&view, &body)
                )
                .await
                .is_err()
        );

        let input = GetWorkspaceConfigRequest {
            workspace_id: "missing".into(),
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = GetWorkspaceConfigRequest::decode_view(&body).unwrap();
        assert!(
            service
                .get(
                    RequestContext::default(),
                    ServiceRequest::from_parts(&view, &body)
                )
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn update_checks_authorization_json_size_structure_and_revision() {
        let service = ConfigService::new(state());
        let valid = include_str!("../../../workspace-config/workspaces/default.json").to_owned();
        let input = UpdateWorkspaceConfigRequest {
            workspace_id: "default".into(),
            config_json: valid.clone(),
            expected_revision: 0,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = UpdateWorkspaceConfigRequest::decode_view(&body).unwrap();
        assert!(
            service
                .update(
                    RequestContext::default(),
                    ServiceRequest::from_parts(&view, &body)
                )
                .await
                .is_ok()
        );

        let input = UpdateWorkspaceConfigRequest {
            workspace_id: "default".into(),
            config_json: valid,
            expected_revision: 0,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = UpdateWorkspaceConfigRequest::decode_view(&body).unwrap();
        assert!(
            service
                .update(
                    RequestContext::default(),
                    ServiceRequest::from_parts(&view, &body)
                )
                .await
                .is_err()
        );

        for (workspace_id, config_json) in
            [("bad/id", "{}"), ("default", "not json"), ("default", "{}")]
        {
            let input = UpdateWorkspaceConfigRequest {
                workspace_id: workspace_id.into(),
                config_json: config_json.into(),
                expected_revision: 1,
                ..Default::default()
            };
            let body = buffa::bytes::Bytes::from(input.encode_to_vec());
            let view = UpdateWorkspaceConfigRequest::decode_view(&body).unwrap();
            assert!(
                service
                    .update(
                        RequestContext::default(),
                        ServiceRequest::from_parts(&view, &body)
                    )
                    .await
                    .is_err()
            );
        }

        let input = UpdateWorkspaceConfigRequest {
            workspace_id: "default".into(),
            config_json: " ".repeat(MAX_CONFIG_BYTES + 1),
            expected_revision: 1,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = UpdateWorkspaceConfigRequest::decode_view(&body).unwrap();
        assert!(
            service
                .update(
                    RequestContext::default(),
                    ServiceRequest::from_parts(&view, &body)
                )
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn oidc_mode_rejects_absent_and_wrong_authorization_schemes() {
        let auth = Authenticator::oidc(
            "https://iam.example/realms/demo".into(),
            None,
            "modulaga-admin".into(),
        );
        assert!(auth.require_admin(&HeaderMap::new()).await.is_err());
        let mut headers = HeaderMap::new();
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_static("Basic dXNlcjpwYXNz"),
        );
        assert!(auth.require_admin(&headers).await.is_err());
    }

    #[tokio::test]
    async fn oidc_checks_jwks_signature_issuer_audience_and_admin_role() {
        let issuer = "https://iam.example/realms/modulaga";
        let authenticator = Authenticator::oidc_with_endpoints(
            issuer.into(),
            Some("modulaga-api".into()),
            "modulaga-admin".into(),
            Some("https://iam.example/.well-known/openid-configuration".into()),
            None,
        );
        let jwks: JwkSet = serde_json::from_value(serde_json::json!({"keys":[{
            "kty":"RSA", "kid":"test-key", "use":"sig", "alg":"RS256",
            "n":TEST_RSA_MODULUS, "e":"AQAB"
        }]}))
        .unwrap();
        *authenticator.jwks.write().await = Some((Instant::now(), jwks, issuer.into()));

        let token = |audience: &str, roles: &[&str], token_issuer: &str| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs();
            let claims = serde_json::json!({"iss":token_issuer,"aud":audience,"exp":now + 60,"realm_access":{"roles":roles}});
            let mut header = Header::new(Algorithm::RS256);
            header.kid = Some("test-key".into());
            encode(
                &header,
                &claims,
                &EncodingKey::from_rsa_pem(TEST_RSA_PRIVATE_KEY).unwrap(),
            )
            .unwrap()
        };
        let headers_for = |token: String| {
            let mut headers = HeaderMap::new();
            headers.insert(
                AUTHORIZATION,
                HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
            );
            headers
        };

        assert!(
            authenticator
                .require_admin(&headers_for(token(
                    "modulaga-api",
                    &["modulaga-admin"],
                    issuer
                )))
                .await
                .is_ok()
        );
        assert!(
            authenticator
                .require_admin(&headers_for(token("modulaga-api", &["viewer"], issuer)))
                .await
                .is_err()
        );
        assert!(
            authenticator
                .require_admin(&headers_for(token(
                    "another-api",
                    &["modulaga-admin"],
                    issuer
                )))
                .await
                .is_err()
        );
        assert!(
            authenticator
                .require_admin(&headers_for(token(
                    "modulaga-api",
                    &["modulaga-admin"],
                    "http://wrong-issuer.test"
                )))
                .await
                .is_err()
        );
        let mut unknown_key_header =
            headers_for(token("modulaga-api", &["modulaga-admin"], issuer));
        let mut unknown_key = Header::new(Algorithm::RS256);
        unknown_key.kid = Some("missing-key".into());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = serde_json::json!({"iss":issuer,"aud":"modulaga-api","exp":now + 60,"realm_access":{"roles":["modulaga-admin"]}});
        unknown_key_header.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!(
                "Bearer {}",
                encode(
                    &unknown_key,
                    &claims,
                    &EncodingKey::from_rsa_pem(TEST_RSA_PRIVATE_KEY).unwrap()
                )
                .unwrap()
            ))
            .unwrap(),
        );
        assert!(
            authenticator
                .require_admin(&unknown_key_header)
                .await
                .is_err()
        );

        let mut no_kid = Header::new(Algorithm::RS256);
        no_kid.kid = None;
        let no_kid_token = encode(
            &no_kid,
            &claims,
            &EncodingKey::from_rsa_pem(TEST_RSA_PRIVATE_KEY).unwrap(),
        )
        .unwrap();
        assert!(
            authenticator
                .require_admin(&headers_for(no_kid_token))
                .await
                .is_err()
        );
        let mut wrong_algorithm = Header::new(Algorithm::HS256);
        wrong_algorithm.kid = Some("test-key".into());
        let wrong_algorithm_token = encode(
            &wrong_algorithm,
            &claims,
            &EncodingKey::from_secret(b"test-secret"),
        )
        .unwrap();
        assert!(
            authenticator
                .require_admin(&headers_for(wrong_algorithm_token))
                .await
                .is_err()
        );
        assert!(
            authenticator
                .require_admin(&headers_for("not-a-jwt".into()))
                .await
                .is_err()
        );
        assert!(
            authenticator
                .require_admin(&headers_for(String::new()))
                .await
                .is_err()
        );
    }
}

fn valid_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

pub fn validate_workspace_config(config: &Value) -> Result<(), String> {
    let root = config
        .as_object()
        .ok_or("configuration must be an object")?;
    if root.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err("schemaVersion must be 1".into());
    }
    let workspace = root
        .get("workspace")
        .and_then(Value::as_object)
        .ok_or("workspace must be an object")?;
    if !valid_identifier(workspace.get("id").and_then(Value::as_str).unwrap_or("")) {
        return Err("workspace.id is invalid".into());
    }
    if workspace
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty() && name.len() <= 80)
        .is_none()
    {
        return Err("workspace.name must contain 1 to 80 characters".into());
    }
    if let Some(welcome) = root.get("welcomePage") {
        let welcome = welcome
            .as_object()
            .ok_or("welcomePage must be an object")?;
        if welcome.get("enabled").and_then(Value::as_bool).is_none() {
            return Err("welcomePage.enabled must be a boolean".into());
        }
        if welcome
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.trim().is_empty() && title.chars().count() <= 120)
            .is_none()
        {
            return Err("welcomePage.title must contain 1 to 120 characters".into());
        }
        if welcome
            .get("description")
            .and_then(Value::as_str)
            .filter(|description| description.chars().count() <= 500)
            .is_none()
        {
            return Err("welcomePage.description must be a string up to 500 characters".into());
        }
        if welcome.get("showDashboard").and_then(Value::as_bool).is_none() {
            return Err("welcomePage.showDashboard must be a boolean".into());
        }
    }
    let installations = root
        .get("installations")
        .and_then(Value::as_array)
        .ok_or("installations must be an array")?;
    let mut installation_ids = std::collections::HashSet::new();
    for installation in installations {
        let id = installation
            .get("id")
            .and_then(Value::as_str)
            .ok_or("each installation needs an id")?;
        if !valid_identifier(id) || !installation_ids.insert(id) {
            return Err("installation IDs must be valid and unique".into());
        }
    }
    let routes = root
        .get("routes")
        .and_then(Value::as_array)
        .ok_or("routes must be an array")?;
    let mut route_ids = std::collections::HashSet::new();
    let mut route_paths = std::collections::HashSet::new();
    for route in routes {
        let id = route
            .get("id")
            .and_then(Value::as_str)
            .ok_or("each route needs an id")?;
        let path = route
            .get("path")
            .and_then(Value::as_str)
            .ok_or("each route needs a path")?;
        if !valid_identifier(id) || !route_ids.insert(id) {
            return Err("route IDs must be valid and unique".into());
        }
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains(['?', '#'])
            || !route_paths.insert(path)
        {
            return Err(
                "route paths must be unique absolute paths without query or fragment".into(),
            );
        }
        if !installation_ids.contains(
            route
                .get("installationId")
                .and_then(Value::as_str)
                .unwrap_or(""),
        ) {
            return Err("route references an unknown installation".into());
        }
    }
    let menus = root
        .get("menus")
        .and_then(Value::as_array)
        .ok_or("menus must be an array")?;
    let mut menu_ids = std::collections::HashSet::new();
    for menu in menus {
        let id = menu
            .get("id")
            .and_then(Value::as_str)
            .ok_or("each menu needs an id")?;
        if !valid_identifier(id) || !menu_ids.insert(id) {
            return Err("menu IDs must be valid and unique".into());
        }
        let entries = menu
            .get("entries")
            .and_then(Value::as_array)
            .ok_or("menu entries must be an array")?;
        validate_entries(entries, &route_ids, 0)?;
    }
    let placements = root
        .get("menuPlacements")
        .and_then(Value::as_array)
        .ok_or("menuPlacements must be an array")?;
    for placement in placements {
        if !menu_ids.contains(
            placement
                .get("menuId")
                .and_then(Value::as_str)
                .unwrap_or(""),
        ) {
            return Err("menu placement references an unknown menu".into());
        }
        if !matches!(
            placement.get("region").and_then(Value::as_str),
            Some("top" | "left" | "right" | "bottom")
        ) {
            return Err("menu placement region is invalid".into());
        }
    }
    validate_shell(root.get("shell"))?;
    validate_dashboards(root.get("dashboards"), &route_ids, &installation_ids)?;
    Ok(())
}

fn validate_entries(
    entries: &[Value],
    route_ids: &std::collections::HashSet<&str>,
    depth: usize,
) -> Result<(), String> {
    if depth > 2 {
        return Err("menu groups may only be nested one level".into());
    }
    let mut ids = std::collections::HashSet::new();
    for entry in entries {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or("each menu entry needs an id")?;
        if !valid_identifier(id) || !ids.insert(id) {
            return Err("menu entry IDs must be valid and unique within each menu".into());
        }
        if entry
            .get("label")
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty() && text.len() <= 80)
            .is_none()
        {
            return Err("menu entry labels must contain 1 to 80 characters".into());
        }
        match entry.get("type").and_then(Value::as_str) {
            Some("group") => validate_entries(
                entry
                    .get("children")
                    .and_then(Value::as_array)
                    .ok_or("groups need a children array")?,
                route_ids,
                depth + 1,
            )?,
            Some("route")
                if route_ids
                    .contains(entry.get("routeId").and_then(Value::as_str).unwrap_or("")) => {}
            Some("route") => return Err("menu route references an unknown route".into()),
            Some("external") => {
                let href = entry
                    .get("href")
                    .and_then(Value::as_str)
                    .ok_or("external links need an href")?;
                if !href.starts_with("https://") || href.len() > 2048 {
                    return Err(
                        "external menu links must use HTTPS and be at most 2048 characters".into(),
                    );
                }
            }
            Some("action") if entry.get("action").and_then(Value::as_str) == Some("admin-panel") => {
                let path = entry
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or("admin panel actions need a path")?;
                if !path.starts_with('/')
                    || path.starts_with("//")
                    || path.contains(['?', '#'])
                {
                    return Err("admin panel paths must be absolute paths without query or fragment".into());
                }
            }
            Some("action") => return Err("menu action is unsupported".into()),
            _ => return Err("menu entry type must be group, route, external, or action".into()),
        }
    }
    Ok(())
}

fn validate_shell(shell: Option<&Value>) -> Result<(), String> {
    let Some(shell) = shell else { return Ok(()) };
    let sidebar = shell
        .get("sidebar")
        .and_then(Value::as_object)
        .ok_or("shell.sidebar must be an object")?;
    let width = sidebar
        .get("width")
        .and_then(Value::as_u64)
        .ok_or("shell.sidebar.width must be an integer")?;
    if !(200..=360).contains(&width) {
        return Err("shell.sidebar.width must be between 200 and 360 pixels".into());
    }
    if !matches!(
        sidebar.get("mode").and_then(Value::as_str),
        Some("fixed" | "collapsible")
    ) {
        return Err("shell.sidebar.mode must be fixed or collapsible".into());
    }
    if let Some(path) = sidebar.get("adminMenuSettingsPath") {
        let path = path
            .as_str()
            .ok_or("shell.sidebar.adminMenuSettingsPath must be a string")?;
        if path.is_empty()
            || path.len() > 256
            || !path.starts_with('/')
            || path.starts_with("//")
            || path.contains(['?', '#'])
        {
            return Err("shell.sidebar.adminMenuSettingsPath must be an absolute path without query or fragment".into());
        }
    }
    let breadcrumbs = shell
        .get("breadcrumbs")
        .and_then(Value::as_object)
        .ok_or("shell.breadcrumbs must be an object")?;
    if breadcrumbs
        .get("enabled")
        .and_then(Value::as_bool)
        .is_none()
    {
        return Err("shell.breadcrumbs.enabled must be boolean".into());
    }
    if breadcrumbs
        .get("maxDepth")
        .and_then(Value::as_u64)
        .is_none_or(|depth| !(1..=8).contains(&depth))
    {
        return Err("shell.breadcrumbs.maxDepth must be between 1 and 8".into());
    }
    Ok(())
}

fn validate_dashboards(
    dashboards: Option<&Value>,
    route_ids: &std::collections::HashSet<&str>,
    installation_ids: &std::collections::HashSet<&str>,
) -> Result<(), String> {
    let Some(dashboards) = dashboards else {
        return Ok(());
    };
    let dashboards = dashboards.as_array().ok_or("dashboards must be an array")?;
    let mut ids = std::collections::HashSet::new();
    for dashboard in dashboards {
        let id = dashboard
            .get("id")
            .and_then(Value::as_str)
            .ok_or("each dashboard needs an id")?;
        if !valid_identifier(id) || !ids.insert(id) {
            return Err("dashboard IDs must be valid and unique".into());
        }
        if !route_ids.contains(
            dashboard
                .get("routeId")
                .and_then(Value::as_str)
                .unwrap_or(""),
        ) {
            return Err("dashboard references an unknown route".into());
        }
        if dashboard
            .get("columns")
            .and_then(Value::as_u64)
            .is_none_or(|columns| !(1..=12).contains(&columns))
        {
            return Err("dashboard.columns must be between 1 and 12".into());
        }
        let widgets = dashboard
            .get("widgets")
            .and_then(Value::as_array)
            .ok_or("dashboard.widgets must be an array")?;
        let mut widget_ids = std::collections::HashSet::new();
        for widget in widgets {
            let widget_id = widget
                .get("id")
                .and_then(Value::as_str)
                .ok_or("each dashboard widget needs an id")?;
            if !valid_identifier(widget_id) || !widget_ids.insert(widget_id) {
                return Err("dashboard widget IDs must be valid and unique".into());
            }
            if !installation_ids.contains(
                widget
                    .get("installationId")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
            ) {
                return Err("dashboard widget references an unknown installation".into());
            }
            if widget
                .get("componentId")
                .and_then(Value::as_str)
                .filter(|component| valid_identifier(component))
                .is_none()
            {
                return Err("dashboard widget needs a valid componentId".into());
            }
            let settings = widget
                .get("settings")
                .and_then(Value::as_object)
                .ok_or("dashboard widget settings must be an object")?;
            if settings
                .get("schemaId")
                .and_then(Value::as_str)
                .filter(|schema| valid_identifier(schema))
                .is_none()
                || settings.get("value").and_then(Value::as_object).is_none()
            {
                return Err("dashboard widget settings need schemaId and object value".into());
            }
        }
    }
    Ok(())
}

#[derive(Clone)]
pub struct Authenticator {
    issuer: Option<String>,
    audience: Option<String>,
    admin_role: String,
    discovery_url: Option<String>,
    jwks_uri: Option<String>,
    jwks: Arc<RwLock<Option<(Instant, JwkSet, String)>>>,
    client: reqwest::Client,
}

impl Authenticator {
    pub fn disabled() -> Self {
        Self {
            issuer: None,
            audience: None,
            admin_role: "modulaga-admin".into(),
            discovery_url: None,
            jwks_uri: None,
            jwks: Arc::new(RwLock::new(None)),
            client: reqwest::Client::new(),
        }
    }
    pub fn oidc(issuer: String, audience: Option<String>, admin_role: String) -> Self {
        Self::oidc_with_endpoints(issuer, audience, admin_role, None, None)
    }
    pub fn oidc_with_endpoints(
        issuer: String,
        audience: Option<String>,
        admin_role: String,
        discovery_url: Option<String>,
        jwks_uri: Option<String>,
    ) -> Self {
        Self {
            issuer: Some(issuer.trim_end_matches('/').to_owned()),
            audience,
            admin_role,
            discovery_url,
            jwks_uri,
            jwks: Arc::new(RwLock::new(None)),
            client: reqwest::Client::new(),
        }
    }
    pub async fn require_admin(&self, headers: &HeaderMap) -> Result<(), ConnectError> {
        let Some(issuer) = &self.issuer else {
            return Ok(());
        };
        let raw = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| {
                ConnectError::unauthenticated("a Ferriskey bearer access token is required")
            })?;
        let token = raw.strip_prefix("Bearer ").ok_or_else(|| {
            ConnectError::unauthenticated("authorization must use the Bearer scheme")
        })?;
        if token.is_empty() {
            return Err(ConnectError::unauthenticated("bearer token is empty"));
        }
        let header = decode_header(token)
            .map_err(|_| ConnectError::unauthenticated("bearer token is invalid"))?;
        let kid = header
            .kid
            .ok_or_else(|| ConnectError::unauthenticated("bearer token has no signing key id"))?;
        if header.alg != Algorithm::RS256 {
            return Err(ConnectError::unauthenticated(
                "token signing algorithm is not allowed",
            ));
        }
        let (key_set, discovered_issuer) = self
            .key_set(issuer)
            .await
            .map_err(|_| ConnectError::unauthenticated("could not load Ferriskey signing keys"))?;
        if discovered_issuer != *issuer {
            return Err(ConnectError::unauthenticated(
                "Ferriskey issuer does not match configuration",
            ));
        }
        let jwk = key_set
            .find(&kid)
            .ok_or_else(|| ConnectError::unauthenticated("token signing key was not found"))?;
        let key = DecodingKey::from_jwk(jwk)
            .map_err(|_| ConnectError::unauthenticated("Ferriskey signing key is invalid"))?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_issuer(&[issuer]);
        if let Some(audience) = &self.audience {
            validation.set_audience(&[audience]);
        }
        let data = decode::<TokenClaims>(token, &key, &validation)
            .map_err(|_| ConnectError::unauthenticated("bearer token validation failed"))?;
        if !data.claims.has_role(&self.admin_role) {
            return Err(ConnectError::permission_denied(
                "Ferriskey admin role is required",
            ));
        }
        Ok(())
    }
    async fn key_set(&self, issuer: &str) -> Result<(JwkSet, String), reqwest::Error> {
        if let Some((fetched_at, keys, actual_issuer)) = self.jwks.read().await.as_ref() {
            if fetched_at.elapsed() < JWKS_TTL {
                return Ok((keys.clone(), actual_issuer.clone()));
            }
        }
        let mut cache = self.jwks.write().await;
        if let Some((fetched_at, keys, actual_issuer)) = cache.as_ref() {
            if fetched_at.elapsed() < JWKS_TTL {
                return Ok((keys.clone(), actual_issuer.clone()));
            }
        }
        let discovery_url = self
            .discovery_url
            .clone()
            .unwrap_or_else(|| format!("{issuer}/.well-known/openid-configuration"));
        let discovery: OidcDiscovery = self
            .client
            .get(discovery_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let jwks_uri = self.jwks_uri.clone().unwrap_or(discovery.jwks_uri);
        let keys = self
            .client
            .get(jwks_uri)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        *cache = Some((Instant::now(), keys, discovery.issuer.clone()));
        Ok((cache.as_ref().unwrap().1.clone(), discovery.issuer))
    }
}

#[derive(Deserialize)]
struct OidcDiscovery {
    issuer: String,
    jwks_uri: String,
}

#[derive(Deserialize)]
struct TokenClaims {
    #[serde(default)]
    realm_access: Option<RealmAccess>,
}

#[derive(Deserialize)]
struct RealmAccess {
    #[serde(default)]
    roles: Vec<String>,
}

impl TokenClaims {
    fn has_role(&self, role: &str) -> bool {
        self.realm_access
            .as_ref()
            .is_some_and(|access| access.roles.iter().any(|candidate| candidate == role))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::json!({
            "schemaVersion":1,"workspace":{"id":"default","name":"Demo"},
            "welcomePage":{"enabled":true,"title":"Welcome","description":"Demo workspace","showDashboard":true},
            "installations":[{"id":"orders-installation"}],
            "routes":[{"id":"orders","installationId":"orders-installation","path":"/orders"}],
            "menus":[{"id":"primary","name":"Primary","entries":[{"id":"orders-link","type":"route","label":"Orders","routeId":"orders"}]}],
            "menuPlacements":[{"menuId":"primary","region":"left"}],
            "shell":{"sidebar":{"width":280,"mode":"collapsible"},"breadcrumbs":{"enabled":true,"maxDepth":5}},
            "dashboards":[{"id":"overview","routeId":"orders","columns":3,"widgets":[]}]
        })
    }

    #[test]
    fn accepts_valid_workspace_with_shell_and_dashboard_settings() {
        assert_eq!(validate_workspace_config(&fixture()), Ok(()));
    }
    #[test]
    fn validates_welcome_page_settings() {
        let mut config = fixture();
        config["welcomePage"]["title"] = " ".into();
        assert!(validate_workspace_config(&config)
            .unwrap_err()
            .contains("welcomePage.title"));
        config["welcomePage"]["title"] = "Welcome".into();
        config["welcomePage"]["showDashboard"] = "yes".into();
        assert!(validate_workspace_config(&config)
            .unwrap_err()
            .contains("welcomePage.showDashboard"));
    }
    #[test]
    fn rejects_non_object_and_unknown_schema_version() {
        assert_eq!(
            validate_workspace_config(&Value::Null),
            Err("configuration must be an object".into())
        );
        let mut value = fixture();
        value["schemaVersion"] = 2.into();
        assert_eq!(
            validate_workspace_config(&value),
            Err("schemaVersion must be 1".into())
        );
    }
    #[test]
    fn rejects_invalid_workspace_identity_and_name() {
        let mut value = fixture();
        value["workspace"]["id"] = "invalid/id".into();
        assert_eq!(
            validate_workspace_config(&value),
            Err("workspace.id is invalid".into())
        );
        let mut value = fixture();
        value["workspace"]["name"] = "".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("workspace.name")
        );
    }
    #[test]
    fn rejects_duplicate_route_ids_and_bad_paths() {
        let mut value = fixture();
        value["routes"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"id":"orders","installationId":"x","path":"/other"}));
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("route IDs")
        );
        let mut value = fixture();
        value["routes"][0]["path"] = "//bad".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("route paths")
        );
    }
    #[test]
    fn validates_menu_types_links_nesting_and_references() {
        let mut value = fixture();
        value["menus"][0]["entries"][0]["routeId"] = "missing".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("unknown route")
        );
        let mut value = fixture();
        value["menus"][0]["entries"][0] = serde_json::json!({"id":"external","type":"external","label":"Help","href":"http://unsafe.test"});
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("HTTPS")
        );
        let mut value = fixture();
        value["menus"][0]["entries"][0] = serde_json::json!({"id":"group","type":"group","label":"Nested","children":[{"id":"g2","type":"group","label":"Nested again","children":[{"id":"g3","type":"group","label":"Too deep","children":[]}]}]});
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("nested one level")
        );
    }
    #[test]
    fn accepts_admin_panel_actions_in_workspace_menus() {
        let mut value = fixture();
        value["menus"][0]["entries"].as_array_mut().unwrap().push(serde_json::json!({
            "id":"settings",
            "type":"group",
            "label":"Settings",
            "icon":"settings",
            "visible":true,
            "chevron":false,
            "defaultExpanded":true,
            "children":[{"id":"admin-panel","type":"action","label":"Admin Panel","action":"admin-panel","path":"/settings/admin-panel","icon":"settings","visible":true}]
        }));
        assert!(validate_workspace_config(&value).is_ok());

        value["menus"][0]["entries"][1]["children"][0]["action"] = "unknown".into();
        assert_eq!(
            validate_workspace_config(&value),
            Err("menu action is unsupported".into())
        );
    }
    #[test]
    fn validates_sidebar_breadcrumbs_and_dashboard_bindings() {
        let mut value = fixture();
        value["shell"]["sidebar"]["width"] = 120.into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("200 and 360")
        );
        let mut value = fixture();
        value["shell"]["breadcrumbs"]["maxDepth"] = 0.into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("maxDepth")
        );
        let mut value = fixture();
        value["dashboards"][0]["routeId"] = "missing".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("unknown route")
        );
    }

    #[test]
    fn rejects_invalid_installations_routes_menus_and_dashboard_panels() {
        let mut value = fixture();
        let duplicate = value["installations"][0].clone();
        value["installations"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("installation IDs")
        );

        let mut value = fixture();
        value["routes"][0]["installationId"] = "missing".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("unknown installation")
        );

        let mut value = fixture();
        let duplicate = value["menus"][0].clone();
        value["menus"].as_array_mut().unwrap().push(duplicate);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("menu IDs")
        );

        let mut value = fixture();
        value["menuPlacements"][0]["menuId"] = "missing".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("unknown menu")
        );

        let mut value = fixture();
        value["menuPlacements"][0]["region"] = "center".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("region")
        );

        let mut value = fixture();
        let duplicate = value["menus"][0]["entries"][0].clone();
        value["menus"][0]["entries"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("menu entry IDs")
        );

        let mut value = fixture();
        value["menus"][0]["entries"][0]["label"] = "".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("labels")
        );

        let mut value = fixture();
        value["menus"][0]["entries"][0]["type"] = "custom".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("type must")
        );

        let mut value = fixture();
        value["shell"]["sidebar"]["mode"] = "floating".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("sidebar.mode")
        );

        let mut value = fixture();
        value["shell"]["breadcrumbs"]["enabled"] = "yes".into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("enabled")
        );

        let mut value = fixture();
        value["dashboards"][0]["columns"] = 0.into();
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("columns")
        );

        let mut value = fixture();
        let duplicate = value["dashboards"][0].clone();
        value["dashboards"].as_array_mut().unwrap().push(duplicate);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("dashboard IDs")
        );

        let widget = serde_json::json!({"id":"panel","installationId":"orders-installation","componentId":"stat-card","settings":{"schemaId":"stat-card","value":{}}});
        let mut value = fixture();
        value["dashboards"][0]["widgets"] = serde_json::json!([widget.clone(), widget]);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("widget IDs")
        );

        let mut value = fixture();
        value["dashboards"][0]["widgets"] = serde_json::json!([{"id":"panel","installationId":"missing","componentId":"stat-card","settings":{"schemaId":"stat-card","value":{}}}]);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("unknown installation")
        );

        let mut value = fixture();
        value["dashboards"][0]["widgets"] = serde_json::json!([{"id":"panel","installationId":"orders-installation","componentId":"bad/id","settings":{"schemaId":"stat-card","value":{}}}]);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("componentId")
        );

        let mut value = fixture();
        value["dashboards"][0]["widgets"] = serde_json::json!([{"id":"panel","installationId":"orders-installation","componentId":"stat-card","settings":{"schemaId":"stat-card","value":null}}]);
        assert!(
            validate_workspace_config(&value)
                .unwrap_err()
                .contains("settings need")
        );
    }
    #[test]
    fn identifiers_are_bounded_and_ascii_safe() {
        assert!(valid_identifier("orders_v2-1"));
        assert!(!valid_identifier(""));
        assert!(!valid_identifier("bad/id"));
        assert!(!valid_identifier(&"x".repeat(81)));
    }
    #[test]
    fn ferriskey_roles_are_read_from_realm_access_claims() {
        let admin: TokenClaims = serde_json::from_value(
            serde_json::json!({"realm_access":{"roles":["modulaga-admin","user"]}}),
        )
        .unwrap();
        let user: TokenClaims =
            serde_json::from_value(serde_json::json!({"realm_access":{"roles":["user"]}})).unwrap();
        let no_roles: TokenClaims = serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(admin.has_role("modulaga-admin"));
        assert!(!user.has_role("modulaga-admin"));
        assert!(!no_roles.has_role("modulaga-admin"));
    }
    #[tokio::test]
    async fn in_memory_store_enforces_optimistic_revision() {
        let store = MemoryWorkspaceStore::with_record(WorkspaceConfigRecord {
            workspace_id: "default".into(),
            config: fixture(),
            revision: 0,
        });
        let first = store.update("default", 0, fixture()).await.unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(
            store.update("default", 0, fixture()).await,
            Err(StoreError::RevisionConflict)
        );
        assert_eq!(store.get("missing").await, Err(StoreError::NotFound));
    }
    #[tokio::test]
    async fn disabled_auth_allows_local_development_writes() {
        assert!(
            Authenticator::disabled()
                .require_admin(&HeaderMap::new())
                .await
                .is_ok()
        );
    }
}
