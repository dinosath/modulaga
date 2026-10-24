use std::sync::Arc;

use axum::http::HeaderMap;
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde_json::{Map, Value, json};
use sqlx::{Row, SqlitePool, sqlite::SqlitePoolOptions};
use workspace_config::Authenticator;

pub mod proto {
    connectrpc::include_generated!();
}

use proto::modulaga::contenttypes::v1::{
    ContentTypeRecord, ContentTypesService, DeleteContentTypeRequest, DeleteContentTypeResponse,
    GetContentTypeRequest, ListContentTypesRequest, ListContentTypesResponse,
    SaveContentTypeRequest,
};

const MAX_SCHEMA_BYTES: usize = 1_048_576;

#[derive(Clone)]
pub struct ContentTypeStore {
    pool: SqlitePool,
}

impl ContentTypeStore {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let max_connections = if database_url.contains(":memory:") {
            1
        } else {
            5
        };
        let pool = SqlitePoolOptions::new()
            .max_connections(max_connections)
            .connect(database_url)
            .await?;
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS content_types (
                uid TEXT PRIMARY KEY NOT NULL,
                schema_json TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             )",
        )
        .execute(&pool)
        .await?;
        Ok(Self { pool })
    }

    async fn list(&self) -> Result<Vec<ContentTypeRecord>, sqlx::Error> {
        let rows = sqlx::query("SELECT uid, schema_json, revision FROM content_types ORDER BY uid")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| ContentTypeRecord {
                uid: row.get("uid"),
                schema_json: row.get("schema_json"),
                revision: row.get::<i64, _>("revision") as u64,
                ..Default::default()
            })
            .collect())
    }

    async fn get(&self, uid: &str) -> Result<Option<ContentTypeRecord>, sqlx::Error> {
        let row = sqlx::query("SELECT uid, schema_json, revision FROM content_types WHERE uid = ?")
            .bind(uid)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|row| ContentTypeRecord {
            uid: row.get("uid"),
            schema_json: row.get("schema_json"),
            revision: row.get::<i64, _>("revision") as u64,
            ..Default::default()
        }))
    }

    async fn save(
        &self,
        uid: &str,
        schema_json: &str,
        expected_revision: u64,
    ) -> Result<ContentTypeRecord, StoreError> {
        if expected_revision == 0 {
            let row = sqlx::query(
                "INSERT INTO content_types(uid, schema_json, revision) VALUES (?, ?, 1)
                 ON CONFLICT(uid) DO NOTHING
                 RETURNING uid, schema_json, revision",
            )
            .bind(uid)
            .bind(schema_json)
            .fetch_optional(&self.pool)
            .await
            .map_err(|_| StoreError::Unavailable)?;
            return row.map(record_from_row).ok_or(StoreError::Conflict);
        }
        let result = sqlx::query(
            "UPDATE content_types SET schema_json = ?, revision = revision + 1,
               updated_at = CURRENT_TIMESTAMP
             WHERE uid = ? AND revision = ?
             RETURNING uid, schema_json, revision",
        )
        .bind(schema_json)
        .bind(uid)
        .bind(expected_revision as i64)
        .fetch_optional(&self.pool)
        .await
        .map_err(|_| StoreError::Unavailable)?;
        let Some(row) = result else {
            return Err(StoreError::Conflict);
        };
        Ok(record_from_row(row))
    }

    async fn delete(&self, uid: &str) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query("DELETE FROM content_types WHERE uid = ?")
            .bind(uid)
            .execute(&self.pool)
            .await?
            .rows_affected()
            > 0)
    }
}

fn record_from_row(row: sqlx::sqlite::SqliteRow) -> ContentTypeRecord {
    ContentTypeRecord {
        uid: row.get("uid"),
        schema_json: row.get("schema_json"),
        revision: row.get::<i64, _>("revision") as u64,
        ..Default::default()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StoreError {
    Conflict,
    Unavailable,
}

#[derive(Clone)]
pub struct ContentTypesApi {
    store: Arc<ContentTypeStore>,
    auth: Authenticator,
}

impl ContentTypesApi {
    pub fn new(store: Arc<ContentTypeStore>, auth: Authenticator) -> Self {
        Self { store, auth }
    }

    async fn require_admin(&self, headers: &HeaderMap) -> ServiceResult<()> {
        self.auth.require_admin(headers).await?;
        Response::ok(())
    }
}

#[allow(refining_impl_trait)]
impl ContentTypesService for ContentTypesApi {
    async fn list(
        &self,
        _ctx: RequestContext,
        _request: ServiceRequest<'_, ListContentTypesRequest>,
    ) -> ServiceResult<ListContentTypesResponse> {
        let content_types = self
            .store
            .list()
            .await
            .map_err(|_| ConnectError::internal("content type store unavailable"))?;
        Response::ok(ListContentTypesResponse {
            content_types,
            ..Default::default()
        })
    }

    async fn get(
        &self,
        _ctx: RequestContext,
        request: ServiceRequest<'_, GetContentTypeRequest>,
    ) -> ServiceResult<ContentTypeRecord> {
        let uid = request.view().uid.trim();
        validate_uid(uid).map_err(ConnectError::invalid_argument)?;
        let record = self
            .store
            .get(uid)
            .await
            .map_err(|_| ConnectError::internal("content type store unavailable"))?;
        match record {
            Some(record) => Response::ok(record),
            None => Err(ConnectError::not_found("content type was not found")),
        }
    }

    async fn save(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, SaveContentTypeRequest>,
    ) -> ServiceResult<ContentTypeRecord> {
        self.require_admin(ctx.headers()).await?;
        let request = request.view();
        let uid = request.uid.trim();
        validate_uid(uid).map_err(ConnectError::invalid_argument)?;
        if request.schema_json.len() > MAX_SCHEMA_BYTES {
            return Err(ConnectError::invalid_argument(
                "content type schema exceeds the 1 MiB limit",
            ));
        }
        let mut schema: Value = serde_json::from_str(&request.schema_json)
            .map_err(|_| ConnectError::invalid_argument("schema_json must contain valid JSON"))?;
        validate_schema(uid, &mut schema).map_err(ConnectError::invalid_argument)?;
        let schema_json = serde_json::to_string(&schema)
            .map_err(|_| ConnectError::internal("could not encode content type schema"))?;
        let record = self
            .store
            .save(uid, &schema_json, request.expected_revision)
            .await
            .map_err(|error| match error {
                StoreError::Conflict => {
                    ConnectError::aborted("content type changed; reload before saving")
                }
                StoreError::Unavailable => ConnectError::internal("content type store unavailable"),
            })?;
        Response::ok(record)
    }

    async fn delete(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteContentTypeRequest>,
    ) -> ServiceResult<DeleteContentTypeResponse> {
        self.require_admin(ctx.headers()).await?;
        let uid = request.view().uid.trim();
        validate_uid(uid).map_err(ConnectError::invalid_argument)?;
        let deleted = self
            .store
            .delete(uid)
            .await
            .map_err(|_| ConnectError::internal("content type store unavailable"))?;
        Response::ok(DeleteContentTypeResponse {
            deleted,
            ..Default::default()
        })
    }
}

fn validate_uid(uid: &str) -> Result<(), &'static str> {
    let valid_part = |part: &str| {
        !part.is_empty()
            && part.split('.').all(|segment| {
                !segment.is_empty()
                    && segment.chars().all(|c| {
                        c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-'
                    })
            })
    };
    let valid = uid.len() <= 128
        && (match uid.split_once("::") {
            Some((scope, path)) => !path.contains("::") && valid_part(scope) && valid_part(path),
            None => uid
                .split_once('.')
                .is_some_and(|(namespace, name)| valid_part(namespace) && valid_part(name)),
        });
    if valid {
        Ok(())
    } else {
        Err("uid must use a lower-case schema identifier, such as api::post.post or shared.button")
    }
}

fn validate_schema(uid: &str, schema: &mut Value) -> Result<(), &'static str> {
    let object = schema
        .as_object_mut()
        .ok_or("content type schema must be a JSON object")?;
    if object.get("uid").and_then(Value::as_str) != Some(uid) {
        return Err("schema uid must match request uid");
    }
    if !matches!(
        object.get("kind").and_then(Value::as_str),
        Some("collectionType" | "singleType" | "component")
    ) {
        return Err("kind must be collectionType, singleType, or component");
    }
    let info = object
        .get("info")
        .and_then(Value::as_object)
        .ok_or("info must be an object")?;
    for name in ["singularName", "pluralName", "displayName"] {
        if info
            .get(name)
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            return Err("info requires singularName, pluralName, and displayName");
        }
    }
    let attributes = object
        .get("attributes")
        .and_then(Value::as_object)
        .ok_or("attributes must be an object")?;
    for (name, attribute) in attributes {
        if name.is_empty()
            || !name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        {
            return Err("attribute names must be snake_case identifiers");
        }
        let attr = attribute
            .as_object()
            .ok_or("each attribute must be an object")?;
        let kind = attr
            .get("type")
            .and_then(Value::as_str)
            .ok_or("each attribute requires a type")?;
        if !matches!(
            kind,
            "string"
                | "text"
                | "richtext"
                | "blocks"
                | "integer"
                | "biginteger"
                | "decimal"
                | "float"
                | "date"
                | "datetime"
                | "time"
                | "boolean"
                | "email"
                | "password"
                | "enumeration"
                | "json"
                | "uid"
                | "media"
                | "relation"
                | "component"
                | "dynamiczone"
        ) {
            return Err("attribute type is not supported");
        }
        if kind == "enumeration"
            && attr
                .get("enum")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
        {
            return Err("enumeration attributes require at least one enum value");
        }
        if matches!(kind, "relation" | "component" | "dynamiczone")
            && attr.get("target").and_then(Value::as_str).is_none_or(str::is_empty)
        {
            return Err("relation, component, and dynamic zone attributes require a target UID");
        }
        if kind == "relation"
            && !matches!(attr.get("relation").and_then(Value::as_str), Some("oneToOne" | "oneToMany" | "manyToOne" | "manyToMany"))
        {
            return Err("relation attributes require a supported cardinality");
        }
    }
    let table_name = object.get("collectionName").and_then(Value::as_str);
    if table_name.is_some_and(|name| {
        name.is_empty()
            || !name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    }) {
        return Err("collectionName must be a snake_case SQLite table name");
    }
    object.insert(
        "tableSchema".into(),
        trailbase_table_schema(uid, table_name, attributes),
    );
    Ok(())
}

fn trailbase_table_schema(
    uid: &str,
    collection_name: Option<&str>,
    attributes: &Map<String, Value>,
) -> Value {
    fn column(
        name: &str,
        type_name: &str,
        data_type: &str,
        affinity: &str,
        options: Vec<Value>,
    ) -> Value {
        json!({"name":name,"type_name":type_name,"data_type":data_type,"affinity_type":affinity,"options":options})
    }
    let table = uid.rsplit('.').next().unwrap_or("content");
    let mut columns = vec![column(
        "id",
        "INTEGER",
        "Integer",
        "Integer",
        vec![
            json!({"Unique":{"is_primary":true,"conflict_clause":null}}),
            json!("NotNull"),
        ],
    )];
    for (name, attr) in attributes {
        let ty = attr.get("type").and_then(Value::as_str).unwrap_or("string");
        let (type_name, data_type, affinity) = match ty {
            "integer" | "biginteger" | "boolean" => ("INTEGER", "Integer", "Integer"),
            "float" | "decimal" => ("REAL", "Real", "Real"),
            "json" => ("TEXT", "Text", "Text"),
            "media" | "relation" | "component" | "dynamiczone" => continue,
            _ => ("TEXT", "Text", "Text"),
        };
        let mut options = Vec::new();
        if attr.get("required").and_then(Value::as_bool) == Some(true) {
            options.push(json!("NotNull"));
        }
        if attr.get("unique").and_then(Value::as_bool) == Some(true) {
            options.push(json!({"Unique":{"is_primary":false,"conflict_clause":null}}));
        }
        if let Some(default) = attr.get("default") {
            options.push(json!({"Default":default.to_string()}));
        }
        columns.push(column(name, type_name, data_type, affinity, options));
    }
    json!({
        "name":{"name":collection_name.map(str::to_owned).unwrap_or_else(|| format!("ct_{table}")),"database_schema":null},
        "strict":true,"columns":columns,"foreign_keys":[],"unique":[],"checks":[],"virtual_table":false,"temporary":false
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use connectrpc::HasMessageView;

    fn schema(uid: &str) -> Value {
        json!({"uid":uid,"kind":"collectionType","info":{"singularName":"article","pluralName":"articles","displayName":"Article"},"options":{"draftAndPublish":true},"attributes":{"title":{"type":"string","required":true},"views":{"type":"integer"},"cover":{"type":"media"}}})
    }

    #[test]
    fn valid_schema_receives_trailbase_table_definition() {
        let uid = "api::article.article";
        let mut value = schema(uid);
        validate_schema(uid, &mut value).unwrap();
        let columns = value["tableSchema"]["columns"].as_array().unwrap();
        assert_eq!(columns.len(), 3);
        assert_eq!(value["tableSchema"]["name"]["name"], "ct_article");
        assert_eq!(columns[1]["data_type"], "Text");
        assert_eq!(columns[2]["affinity_type"], "Integer");
    }

    #[test]
    fn rejects_invalid_schema_identity_shape_and_fields() {
        assert!(validate_uid("api::Article").is_err());
        assert!(validate_uid("api::post.post").is_ok());
        assert!(validate_uid("shared.button").is_ok());
        let mut value = schema("api::article.article");
        assert!(validate_schema("api::different.different", &mut value).is_err());
        let mut invalid = schema("api::article.article");
        invalid["attributes"]["bad-name"] = json!({"type":"string"});
        assert!(validate_schema("api::article.article", &mut invalid).is_err());
        let mut invalid_type = schema("api::article.article");
        invalid_type["attributes"]["title"]["type"] = json!("unknown");
        assert!(validate_schema("api::article.article", &mut invalid_type).is_err());
        let mut invalid_enum = schema("api::article.article");
        invalid_enum["attributes"]["state"] = json!({"type":"enumeration","enum":[]});
        assert!(validate_schema("api::article.article", &mut invalid_enum).is_err());
        let mut invalid_collection = schema("api::article.article");
        invalid_collection["collectionName"] = json!("Not Valid");
        assert!(validate_schema("api::article.article", &mut invalid_collection).is_err());
        let mut invalid_relation = schema("api::article.article");
        invalid_relation["attributes"]["author"] = json!({"type":"relation","target":"api::author.author","relation":"many"});
        assert!(validate_schema("api::article.article", &mut invalid_relation).is_err());
    }

    #[tokio::test]
    async fn sqlite_store_enforces_revision_and_delete() {
        let store = ContentTypeStore::connect("sqlite::memory:").await.unwrap();
        let schema = schema("api::article.article");
        let record = store
            .save("api::article.article", &schema.to_string(), 0)
            .await
            .unwrap();
        assert_eq!(record.revision, 1);
        let updated = store
            .save("api::article.article", &schema.to_string(), 1)
            .await
            .unwrap();
        assert_eq!(updated.revision, 2);
        assert!(matches!(
            store
                .save("api::article.article", &schema.to_string(), 1)
                .await,
            Err(StoreError::Conflict)
        ));
        assert_eq!(store.list().await.unwrap().len(), 1);
        assert!(store.delete("api::article.article").await.unwrap());
        assert!(!store.delete("api::article.article").await.unwrap());
        assert!(store.get("api::article.article").await.unwrap().is_none());
        assert!(store.list().await.unwrap().is_empty());
        assert!(matches!(
            store
                .save("api::article.article", &schema.to_string(), 0)
                .await,
            Ok(_)
        ));
        assert!(matches!(
            store
                .save("api::article.article", &schema.to_string(), 0)
                .await,
            Err(StoreError::Conflict)
        ));
    }

    #[tokio::test]
    async fn connect_rejects_an_unusable_sqlite_database_url() {
        assert!(ContentTypeStore::connect("not-a-sqlite-url").await.is_err());
    }

    #[tokio::test]
    async fn connectrpc_handlers_list_get_save_and_delete_content_types() {
        use buffa::Message;

        let store = Arc::new(ContentTypeStore::connect("sqlite::memory:").await.unwrap());
        let service = ContentTypesApi::new(store, Authenticator::disabled());
        let context = RequestContext::default();

        let request = ListContentTypesRequest::default();
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = ListContentTypesRequest::decode_view(&body).unwrap();
        let list = service
            .list(context.clone(), ServiceRequest::from_parts(&view, &body))
            .await
            .unwrap();
        assert!(list.body.content_types.is_empty());

        let schema_json = schema("api::article.article").to_string();
        let request = SaveContentTypeRequest {
            uid: "api::article.article".into(),
            schema_json: schema_json.clone(),
            expected_revision: 0,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = SaveContentTypeRequest::decode_view(&body).unwrap();
        let saved = service
            .save(context.clone(), ServiceRequest::from_parts(&view, &body))
            .await
            .unwrap()
            .body;
        assert_eq!(saved.revision, 1);

        let request = ListContentTypesRequest::default();
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = ListContentTypesRequest::decode_view(&body).unwrap();
        assert_eq!(
            service
                .list(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .unwrap()
                .body
                .content_types
                .len(),
            1
        );

        let request = SaveContentTypeRequest {
            uid: "api::article.article".into(),
            schema_json: schema_json.clone(),
            expected_revision: 1,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = SaveContentTypeRequest::decode_view(&body).unwrap();
        assert_eq!(
            service
                .save(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .unwrap()
                .body
                .revision,
            2
        );

        let request = SaveContentTypeRequest {
            uid: "api::article.article".into(),
            schema_json: schema_json.clone(),
            expected_revision: 1,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = SaveContentTypeRequest::decode_view(&body).unwrap();
        assert!(
            service
                .save(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .is_err()
        );

        let request = GetContentTypeRequest {
            uid: "api::article.article".into(),
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = GetContentTypeRequest::decode_view(&body).unwrap();
        assert_eq!(
            service
                .get(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .unwrap()
                .body
                .uid,
            "api::article.article"
        );

        let request = DeleteContentTypeRequest {
            uid: "api::article.article".into(),
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = DeleteContentTypeRequest::decode_view(&body).unwrap();
        assert!(
            service
                .delete(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .unwrap()
                .body
                .deleted
        );
    }

    #[tokio::test]
    async fn connectrpc_handlers_reject_invalid_inputs_and_missing_items() {
        use buffa::Message;

        let store = Arc::new(ContentTypeStore::connect("sqlite::memory:").await.unwrap());
        let service = ContentTypesApi::new(store, Authenticator::disabled());
        let context = RequestContext::default();

        for (uid, schema_json) in [("invalid", "{}"), ("api::article.article", "not json")] {
            let request = SaveContentTypeRequest {
                uid: uid.into(),
                schema_json: schema_json.into(),
                expected_revision: 0,
                ..Default::default()
            };
            let body = buffa::bytes::Bytes::from(request.encode_to_vec());
            let view = SaveContentTypeRequest::decode_view(&body).unwrap();
            assert!(
                service
                    .save(context.clone(), ServiceRequest::from_parts(&view, &body))
                    .await
                    .is_err()
            );
        }

        let request = SaveContentTypeRequest {
            uid: "api::article.article".into(),
            schema_json: " ".repeat(MAX_SCHEMA_BYTES + 1),
            expected_revision: 0,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = SaveContentTypeRequest::decode_view(&body).unwrap();
        assert!(
            service
                .save(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .is_err()
        );

        for schema_json in [
            "{}",
            r#"{"uid":"api::article.article","kind":"collectionType","info":{},"attributes":{}}"#,
        ] {
            let request = SaveContentTypeRequest {
                uid: "api::article.article".into(),
                schema_json: schema_json.into(),
                expected_revision: 0,
                ..Default::default()
            };
            let body = buffa::bytes::Bytes::from(request.encode_to_vec());
            let view = SaveContentTypeRequest::decode_view(&body).unwrap();
            assert!(
                service
                    .save(context.clone(), ServiceRequest::from_parts(&view, &body))
                    .await
                    .is_err()
            );
        }

        for uid in ["invalid", "api::missing.missing"] {
            let request = GetContentTypeRequest {
                uid: uid.into(),
                ..Default::default()
            };
            let body = buffa::bytes::Bytes::from(request.encode_to_vec());
            let view = GetContentTypeRequest::decode_view(&body).unwrap();
            assert!(
                service
                    .get(context.clone(), ServiceRequest::from_parts(&view, &body))
                    .await
                    .is_err()
            );

            let request = DeleteContentTypeRequest {
                uid: uid.into(),
                ..Default::default()
            };
            let body = buffa::bytes::Bytes::from(request.encode_to_vec());
            let view = DeleteContentTypeRequest::decode_view(&body).unwrap();
            let result = service
                .delete(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await;
            if uid == "invalid" {
                assert!(result.is_err());
            } else {
                assert!(!result.unwrap().body.deleted);
            }
        }
    }

    #[tokio::test]
    async fn write_handlers_require_an_admin_token_when_oidc_is_enabled() {
        use buffa::Message;

        let store = Arc::new(ContentTypeStore::connect("sqlite::memory:").await.unwrap());
        let auth = Authenticator::oidc(
            "https://identity.example/realms/workspace".into(),
            None,
            "modulaga-admin".into(),
        );
        let service = ContentTypesApi::new(store, auth);
        let context = RequestContext::default();

        let request = SaveContentTypeRequest {
            uid: "api::article.article".into(),
            schema_json: schema("api::article.article").to_string(),
            expected_revision: 0,
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = SaveContentTypeRequest::decode_view(&body).unwrap();
        assert!(
            service
                .save(context.clone(), ServiceRequest::from_parts(&view, &body))
                .await
                .is_err()
        );

        let request = DeleteContentTypeRequest {
            uid: "api::article.article".into(),
            ..Default::default()
        };
        let body = buffa::bytes::Bytes::from(request.encode_to_vec());
        let view = DeleteContentTypeRequest::decode_view(&body).unwrap();
        assert!(
            service
                .delete(context, ServiceRequest::from_parts(&view, &body))
                .await
                .is_err()
        );
    }
}
