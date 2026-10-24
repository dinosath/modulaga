use std::{
    path::{Path, PathBuf},
    process::{ExitStatus, Stdio},
    sync::Arc,
    time::Duration,
};

use axum::http::{HeaderMap, header};
use connectrpc::{ConnectError, RequestContext, Response, ServiceRequest, ServiceResult};
use serde_json::{Value, json};
use sqlx::{Row, SqlitePool};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::mpsc,
    time::timeout,
};
use workspace_config::Authenticator;

pub mod proto {
    connectrpc::include_generated!();
}

use proto::modulaga::applicationgenerator::v1::{
    ApplicationGeneratorService, ApplicationTemplate, CheckTemplateRequest, CheckTemplateResponse,
    ContentTypeOption, CreateTemplateRequest, DeleteGenerationRunRequest,
    DeleteGenerationRunResponse, DeleteTemplateRequest, DeleteTemplateResponse,
    GenerateApplicationRequest, GeneratedApplication, GenerationRun, GetGenerationRunRequest,
    GetTemplateRequest, ListApplicationsRequest, ListApplicationsResponse, ListContentTypesRequest,
    ListContentTypesResponse, ListGenerationRunsRequest, ListGenerationRunsResponse,
    ListTemplatesRequest, ListTemplatesResponse, StartGenerationRequest, UpdateTemplateRequest,
};

const MAX_GENERATION_SECONDS: u64 = 240;

#[derive(Clone)]
pub struct GeneratorStore {
    pool: SqlitePool,
}

impl GeneratorStore {
    pub async fn connect(database_url: &str) -> Result<Self, sqlx::Error> {
        let pool = SqlitePool::connect(database_url).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS generated_applications (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, output_path TEXT NOT NULL, status TEXT NOT NULL, build_output TEXT NOT NULL, content_type_uids_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
            .execute(&pool).await?;
        sqlx::query("CREATE TABLE IF NOT EXISTS application_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
            .execute(&pool).await?;
        let columns = sqlx::query("PRAGMA table_info(application_templates)")
            .fetch_all(&pool)
            .await?;
        if !columns
            .iter()
            .any(|row| row.get::<String, _>("name") == "questions_json")
        {
            sqlx::query("ALTER TABLE application_templates ADD COLUMN questions_json TEXT NOT NULL DEFAULT '{}'").execute(&pool).await?;
        }
        sqlx::query("CREATE TABLE IF NOT EXISTS generation_runs (id TEXT PRIMARY KEY, template_id TEXT NOT NULL DEFAULT '', template_name TEXT NOT NULL, template_url TEXT NOT NULL, status TEXT NOT NULL, destination_type TEXT NOT NULL, destination TEXT NOT NULL, output_path TEXT NOT NULL DEFAULT '', configuration_json TEXT NOT NULL, logs TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
            .execute(&pool).await?;
        Ok(Self { pool })
    }

    async fn list_templates(&self) -> Result<Vec<ApplicationTemplate>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,name,url,description,icon,questions_json,created_at,updated_at FROM application_templates ORDER BY name COLLATE NOCASE,id")
            .fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(template_from_row).collect())
    }

    async fn get_template(&self, id: &str) -> Result<Option<ApplicationTemplate>, sqlx::Error> {
        let row = sqlx::query("SELECT id,name,url,description,icon,questions_json,created_at,updated_at FROM application_templates WHERE id=?")
            .bind(id).fetch_optional(&self.pool).await?;
        Ok(row.map(template_from_row))
    }

    async fn create_template(
        &self,
        id: &str,
        name: &str,
        url: &str,
        description: &str,
        icon: &str,
        questions_json: &str,
    ) -> Result<ApplicationTemplate, sqlx::Error> {
        sqlx::query("INSERT INTO application_templates (id,name,url,description,icon,questions_json) VALUES (?,?,?,?,?,?)")
            .bind(id).bind(name).bind(url).bind(description).bind(icon).bind(questions_json)
            .execute(&self.pool).await?;
        self.get_template(id).await?.ok_or(sqlx::Error::RowNotFound)
    }

    async fn update_template(
        &self,
        id: &str,
        name: &str,
        url: &str,
        description: &str,
        icon: &str,
        questions_json: &str,
    ) -> Result<Option<ApplicationTemplate>, sqlx::Error> {
        let result = sqlx::query("UPDATE application_templates SET name=?,url=?,description=?,icon=?,questions_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(name).bind(url).bind(description).bind(icon).bind(questions_json).bind(id)
            .execute(&self.pool).await?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        self.get_template(id).await
    }

    async fn delete_template(&self, id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM application_templates WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn save_run(&self, run: &GenerationRun) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO generation_runs (id,template_id,template_name,template_url,status,destination_type,destination,output_path,configuration_json,logs,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET status=excluded.status,destination=excluded.destination,output_path=excluded.output_path,configuration_json=excluded.configuration_json,logs=excluded.logs,updated_at=CURRENT_TIMESTAMP")
            .bind(&run.id).bind(&run.template_id).bind(&run.template_name).bind(&run.template_url)
            .bind(&run.status).bind(&run.destination_type).bind(&run.destination).bind(&run.output_path)
            .bind(&run.configuration_json).bind(&run.logs).execute(&self.pool).await?;
        Ok(())
    }

    async fn get_run(&self, id: &str) -> Result<Option<GenerationRun>, sqlx::Error> {
        let row = sqlx::query("SELECT id,template_id,template_name,template_url,status,destination_type,destination,output_path,configuration_json,logs,created_at,updated_at FROM generation_runs WHERE id=?")
            .bind(id).fetch_optional(&self.pool).await?;
        Ok(row.map(run_from_row))
    }

    async fn list_runs(&self) -> Result<Vec<GenerationRun>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,template_id,template_name,template_url,status,destination_type,destination,output_path,configuration_json,logs,created_at,updated_at FROM generation_runs ORDER BY created_at DESC,id DESC")
            .fetch_all(&self.pool).await?;
        Ok(rows.into_iter().map(run_from_row).collect())
    }

    async fn delete_run(&self, id: &str) -> Result<bool, sqlx::Error> {
        let result = sqlx::query("DELETE FROM generation_runs WHERE id=?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    async fn save(&self, record: &GeneratedApplication) -> Result<(), sqlx::Error> {
        sqlx::query("INSERT INTO generated_applications (id,name,slug,output_path,status,build_output,content_type_uids_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,build_output=excluded.build_output")
            .bind(&record.id).bind(&record.name).bind(&record.slug).bind(&record.output_path)
            .bind(&record.status).bind(&record.build_output)
            .bind(serde_json::to_string(&record.content_type_uids).unwrap_or_else(|_| "[]".into()))
            .execute(&self.pool).await?;
        Ok(())
    }

    async fn list(&self) -> Result<Vec<GeneratedApplication>, sqlx::Error> {
        let rows = sqlx::query("SELECT id,name,slug,output_path,status,build_output,content_type_uids_json,created_at FROM generated_applications ORDER BY created_at DESC,id DESC")
            .fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let uids_json: String = row.get("content_type_uids_json");
                GeneratedApplication {
                    id: row.get("id"),
                    name: row.get("name"),
                    slug: row.get("slug"),
                    output_path: row.get("output_path"),
                    status: row.get("status"),
                    build_output: row.get("build_output"),
                    content_type_uids: serde_json::from_str(&uids_json).unwrap_or_default(),
                    created_at: row.get("created_at"),
                    ..Default::default()
                }
            })
            .collect())
    }
}

fn template_from_row(row: sqlx::sqlite::SqliteRow) -> ApplicationTemplate {
    ApplicationTemplate {
        id: row.get("id"),
        name: row.get("name"),
        url: row.get("url"),
        description: row.get("description"),
        icon: row.get("icon"),
        questions_json: row.get("questions_json"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        ..Default::default()
    }
}

fn run_from_row(row: sqlx::sqlite::SqliteRow) -> GenerationRun {
    GenerationRun {
        id: row.get("id"),
        template_id: row.get("template_id"),
        template_name: row.get("template_name"),
        template_url: row.get("template_url"),
        status: row.get("status"),
        destination_type: row.get("destination_type"),
        destination: row.get("destination"),
        output_path: row.get("output_path"),
        configuration_json: row.get("configuration_json"),
        logs: row.get("logs"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        ..Default::default()
    }
}

#[derive(Clone)]
pub struct GeneratorConfig {
    pub content_types_api_url: String,
    pub templates_dir: PathBuf,
    pub generated_dir: PathBuf,
    pub baker_binary: String,
    pub cargo_binary: String,
}

impl GeneratorConfig {
    pub fn from_env() -> Self {
        Self {
            content_types_api_url: std::env::var("CONTENT_TYPES_API_URL")
                .unwrap_or_else(|_| "http://127.0.0.1:4305".into()),
            templates_dir: std::env::var("APPLICATION_TEMPLATES_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates")),
            generated_dir: std::env::var("GENERATED_APPS_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from(".data/generated-apps")),
            baker_binary: std::env::var("BAKER_BINARY").unwrap_or_else(|_| "baker".into()),
            cargo_binary: std::env::var("CARGO_BINARY").unwrap_or_else(|_| "cargo".into()),
        }
    }
}

pub struct ApplicationGenerator {
    store: Arc<GeneratorStore>,
    auth: Authenticator,
    config: GeneratorConfig,
    http: reqwest::Client,
}

impl ApplicationGenerator {
    pub fn new(store: Arc<GeneratorStore>, auth: Authenticator, config: GeneratorConfig) -> Self {
        Self {
            store,
            auth,
            config,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }

    async fn content_types(
        &self,
        headers: &HeaderMap,
    ) -> Result<Vec<ContentTypeOption>, ConnectError> {
        let url = format!(
            "{}/modulaga.contenttypes.v1.ContentTypesService/List",
            self.config.content_types_api_url.trim_end_matches('/')
        );
        let mut request = self
            .http
            .post(url)
            .header("Content-Type", "application/proto")
            .header("Connect-Protocol-Version", "1")
            .header("Accept", "application/proto")
            .body(Vec::<u8>::new());
        if let Some(value) = headers.get(header::AUTHORIZATION) {
            request = request.header(header::AUTHORIZATION, value.clone());
        }
        let response = request
            .send()
            .await
            .map_err(|_| ConnectError::unavailable("content types service is unavailable"))?;
        if !response.status().is_success() {
            return Err(ConnectError::unavailable(
                "could not load content types from the schema service",
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| ConnectError::internal("could not read content types response"))?;
        decode_content_types(&bytes).map_err(ConnectError::internal)
    }

    async fn inspect_template(&self, source: &str) -> Result<CheckTemplateResponse, ConnectError> {
        let (baker_yaml, questions_json) = fetch_baker_yaml(&self.http, source)
            .await
            .map_err(ConnectError::invalid_argument)?;
        Ok(CheckTemplateResponse {
            url: source.into(),
            questions_json,
            baker_yaml,
            ..Default::default()
        })
    }

    async fn generate(
        &self,
        ctx: RequestContext,
        request: GenerateApplicationRequest,
    ) -> ServiceResult<GeneratedApplication> {
        self.auth.require_admin(ctx.headers()).await?;
        let name = request.name.trim();
        let slug = request.slug.trim();
        validate_app_name(name).map_err(ConnectError::invalid_argument)?;
        validate_slug(slug).map_err(ConnectError::invalid_argument)?;
        let mut selected = request.content_type_uids.clone();
        selected.sort();
        selected.dedup();
        if selected.is_empty()
            || selected.len() > 100
            || selected.len() != request.content_type_uids.len()
        {
            return Err(ConnectError::invalid_argument(
                "select between one and 100 unique content types",
            ));
        }
        let available = self.content_types(ctx.headers()).await?;
        let schemas = available
            .into_iter()
            .filter(|item| selected.contains(&item.uid))
            .collect::<Vec<_>>();
        if schemas.len() != selected.len() {
            return Err(ConnectError::invalid_argument(
                "one or more selected content types no longer exist",
            ));
        }
        let schema_values = schemas
            .iter()
            .map(|item| {
                serde_json::from_str::<Value>(&item.schema_json)
                    .map_err(|_| ConnectError::internal("a stored content type schema is invalid"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let schema_bytes = schemas
            .iter()
            .map(|item| item.schema_json.len())
            .sum::<usize>();
        if schema_bytes > 8 * 1_048_576 {
            return Err(ConnectError::invalid_argument(
                "selected content type schemas exceed the 8 MiB generation limit",
            ));
        }

        tokio::fs::create_dir_all(&self.config.generated_dir)
            .await
            .map_err(|_| {
                ConnectError::internal("could not create generated applications directory")
            })?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let app_dir = self.config.generated_dir.join(format!("{slug}-{id}"));
        let answers_path = self
            .config
            .generated_dir
            .join(format!(".{id}-baker-answers.json"));
        let answers = serde_json::to_vec(&json!({
            "application_name": escape_html(name),
            "application_slug": slug
        }))
        .map_err(|_| ConnectError::internal("could not encode Baker answers"))?;
        tokio::fs::write(&answers_path, answers)
            .await
            .map_err(|_| ConnectError::internal("could not write Baker answers"))?;

        let bake = timeout(
            Duration::from_secs(30),
            Command::new(&self.config.baker_binary)
                .arg("generate")
                .arg(self.config.templates_dir.join("content-app"))
                .arg(&app_dir)
                .arg("--answers-file")
                .arg(&answers_path)
                .arg("--non-interactive")
                .arg("--skip-confirms=all")
                .kill_on_drop(true)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;
        let (bake_success, bake_output) = match bake {
            Ok(Ok(output)) => (
                output.status.success(),
                String::from_utf8_lossy(&output.stdout).to_string()
                    + &String::from_utf8_lossy(&output.stderr),
            ),
            Ok(Err(error)) => (false, format!("Could not run Baker: {error}")),
            Err(_) => (false, "Baker timed out after 30 seconds".into()),
        };
        let _ = tokio::fs::remove_file(&answers_path).await;
        if !bake_success {
            let record = generated_record(
                &id,
                name,
                slug,
                &app_dir,
                "failed",
                bake_output,
                &selected,
                "",
            );
            self.store.save(&record).await.map_err(|_| {
                ConnectError::internal("could not store generated application status")
            })?;
            return Response::ok(record);
        }
        let schema_path = app_dir.join("schemas.json");
        let serialized = serde_json::to_vec_pretty(&schema_values)
            .map_err(|_| ConnectError::internal("could not encode selected schemas"))?;
        let mut schema_file = tokio::fs::File::create(&schema_path)
            .await
            .map_err(|_| ConnectError::internal("could not write generated schema data"))?;
        schema_file
            .write_all(&serialized)
            .await
            .map_err(|_| ConnectError::internal("could not write generated schema data"))?;

        let build = timeout(
            Duration::from_secs(MAX_GENERATION_SECONDS),
            Command::new(&self.config.cargo_binary)
                .arg("build")
                .arg("--offline")
                .arg("--manifest-path")
                .arg(app_dir.join("Cargo.toml"))
                .current_dir(&app_dir)
                .env("CARGO_TARGET_DIR", app_dir.join("target"))
                .kill_on_drop(true)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output(),
        )
        .await;
        let (success, output) = match build {
            Ok(Ok(output)) => (
                output.status.success(),
                format!(
                    "{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ),
            ),
            Ok(Err(error)) => (
                false,
                format!("Could not run the application build: {error}"),
            ),
            Err(_) => (
                false,
                format!("Build timed out after {MAX_GENERATION_SECONDS} seconds"),
            ),
        };
        let status = if success { "built" } else { "build-failed" };
        let record = generated_record(
            &id,
            name,
            slug,
            &app_dir,
            status,
            format!("{bake_output}{output}"),
            &selected,
            "",
        );
        self.store
            .save(&record)
            .await
            .map_err(|_| ConnectError::internal("could not store generated application status"))?;
        Response::ok(record)
    }

    async fn create_template(
        &self,
        ctx: RequestContext,
        request: CreateTemplateRequest,
    ) -> ServiceResult<ApplicationTemplate> {
        self.auth.require_admin(ctx.headers()).await?;
        let name = request.name.trim();
        let url = request.url.trim();
        let description = request.description.trim();
        let icon = request.icon.trim();
        validate_template(name, url, description, icon).map_err(ConnectError::invalid_argument)?;
        let manifest = self.inspect_template(url).await?;
        let id = uuid::Uuid::new_v4().simple().to_string();
        let template = self
            .store
            .create_template(&id, name, url, description, icon, &manifest.questions_json)
            .await
            .map_err(|_| ConnectError::internal("could not save application template"))?;
        Response::ok(template)
    }

    async fn update_template(
        &self,
        ctx: RequestContext,
        request: UpdateTemplateRequest,
    ) -> ServiceResult<ApplicationTemplate> {
        self.auth.require_admin(ctx.headers()).await?;
        let id = request.id.trim();
        if id.is_empty() {
            return Err(ConnectError::invalid_argument("template id is required"));
        }
        let name = request.name.trim();
        let url = request.url.trim();
        let description = request.description.trim();
        let icon = request.icon.trim();
        validate_template(name, url, description, icon).map_err(ConnectError::invalid_argument)?;
        let manifest = self.inspect_template(url).await?;
        let template = self
            .store
            .update_template(id, name, url, description, icon, &manifest.questions_json)
            .await
            .map_err(|_| ConnectError::internal("could not update application template"))?
            .ok_or_else(|| ConnectError::not_found("application template was not found"))?;
        Response::ok(template)
    }

    async fn start_generation(
        &self,
        ctx: RequestContext,
        request: StartGenerationRequest,
    ) -> ServiceResult<GenerationRun> {
        self.auth.require_admin(ctx.headers()).await?;
        let mut answers: Value = serde_json::from_str(&request.answers_json)
            .map_err(|_| ConnectError::invalid_argument("generation answers must be valid JSON"))?;
        if !answers.is_object() {
            return Err(ConnectError::invalid_argument(
                "generation answers must be a JSON object",
            ));
        }
        let source = request.template_url.trim();
        let template_id = request.template_id.trim();
        let (template_name, template_url) = if !template_id.is_empty() {
            let template = self
                .store
                .get_template(template_id)
                .await
                .map_err(|_| ConnectError::internal("could not read application template"))?
                .ok_or_else(|| ConnectError::not_found("application template was not found"))?;
            (template.name, template.url)
        } else {
            let name = request.template_name.trim();
            if name.is_empty() || name.chars().count() > 80 {
                return Err(ConnectError::invalid_argument("template name is required"));
            }
            validate_template(name, source, "", "").map_err(ConnectError::invalid_argument)?;
            (name.to_string(), source.to_string())
        };
        let manifest = self.inspect_template(&template_url).await?;
        validate_baker_answers(&manifest.questions_json, &mut answers)
            .map_err(ConnectError::invalid_argument)?;
        let run_id = uuid::Uuid::new_v4().simple().to_string();
        let destination_type = request.destination_type.trim();
        let mut destination = request.destination.trim().to_string();
        let mut branch = request.branch.trim().to_string();
        match destination_type {
            "local" => {
                if destination.is_empty() {
                    destination = format!("generated-{run_id}");
                }
                validate_slug(&destination).map_err(ConnectError::invalid_argument)?;
            }
            "github" | "gitlab" => {
                validate_git_destination(&destination, destination_type)
                    .map_err(ConnectError::invalid_argument)?;
                if branch.is_empty() {
                    branch = format!("modulaga/{run_id}");
                }
                validate_branch(&branch).map_err(ConnectError::invalid_argument)?;
            }
            _ => {
                return Err(ConnectError::invalid_argument(
                    "destination type must be local, github, or gitlab",
                ));
            }
        }
        let configuration_json = serde_json::to_string(&json!({
            "answers": answers,
            "destinationType": destination_type,
            "destination": destination,
            "branch": branch,
            "bakerYaml": manifest.baker_yaml,
        }))
        .map_err(|_| ConnectError::internal("could not save generation configuration"))?;
        let run = GenerationRun {
            id: run_id,
            template_id: template_id.into(),
            template_name,
            template_url,
            status: "queued".into(),
            destination_type: destination_type.into(),
            destination: if destination_type == "local" {
                destination.clone()
            } else {
                format!("{destination}#{branch}")
            },
            output_path: String::new(),
            configuration_json: configuration_json.clone(),
            logs: "Generation queued.\n".into(),
            created_at: String::new(),
            updated_at: String::new(),
            ..Default::default()
        };
        self.store
            .save_run(&run)
            .await
            .map_err(|_| ConnectError::internal("could not save generation run"))?;
        let store = self.store.clone();
        let config = self.config.clone();
        let answers_json = serde_json::to_string(&answers)
            .map_err(|_| ConnectError::internal("could not encode generation answers"))?;
        let requested_branch = branch;
        let queued = run.clone();
        tokio::spawn(async move {
            execute_generation(store, config, queued, answers_json, requested_branch).await;
        });
        Response::ok(run)
    }
}

#[allow(refining_impl_trait)]
impl ApplicationGeneratorService for ApplicationGenerator {
    async fn list_content_types(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListContentTypesRequest>,
    ) -> ServiceResult<ListContentTypesResponse> {
        let types = self.content_types(ctx.headers()).await?;
        Response::ok(ListContentTypesResponse {
            content_types: types,
            ..Default::default()
        })
    }

    async fn list_applications(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListApplicationsRequest>,
    ) -> ServiceResult<ListApplicationsResponse> {
        self.auth.require_admin(ctx.headers()).await?;
        let applications = self
            .store
            .list()
            .await
            .map_err(|_| ConnectError::internal("could not read generated applications"))?;
        Response::ok(ListApplicationsResponse {
            applications,
            ..Default::default()
        })
    }

    async fn generate(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, GenerateApplicationRequest>,
    ) -> ServiceResult<GeneratedApplication> {
        self.generate(ctx, request.to_owned_message()).await
    }

    async fn list_templates(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListTemplatesRequest>,
    ) -> ServiceResult<ListTemplatesResponse> {
        self.auth.require_admin(ctx.headers()).await?;
        let templates = self
            .store
            .list_templates()
            .await
            .map_err(|_| ConnectError::internal("could not read application templates"))?;
        Response::ok(ListTemplatesResponse {
            templates,
            ..Default::default()
        })
    }

    async fn check_template(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, CheckTemplateRequest>,
    ) -> ServiceResult<CheckTemplateResponse> {
        self.auth.require_admin(ctx.headers()).await?;
        let source = request.view().url.trim().to_string();
        let inspection = self.inspect_template(&source).await?;
        Response::ok(inspection)
    }

    async fn get_template(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, GetTemplateRequest>,
    ) -> ServiceResult<ApplicationTemplate> {
        self.auth.require_admin(ctx.headers()).await?;
        let request = request.view();
        let id = request.id.trim();
        if id.is_empty() {
            return Err(ConnectError::invalid_argument("template id is required"));
        }
        let template = self
            .store
            .get_template(id)
            .await
            .map_err(|_| ConnectError::internal("could not read application template"))?
            .ok_or_else(|| ConnectError::not_found("application template was not found"))?;
        Response::ok(template)
    }

    async fn create_template(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, CreateTemplateRequest>,
    ) -> ServiceResult<ApplicationTemplate> {
        self.create_template(ctx, request.to_owned_message()).await
    }

    async fn update_template(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, UpdateTemplateRequest>,
    ) -> ServiceResult<ApplicationTemplate> {
        self.update_template(ctx, request.to_owned_message()).await
    }

    async fn delete_template(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteTemplateRequest>,
    ) -> ServiceResult<DeleteTemplateResponse> {
        self.auth.require_admin(ctx.headers()).await?;
        let request = request.view();
        let id = request.id.trim();
        if id.is_empty() {
            return Err(ConnectError::invalid_argument("template id is required"));
        }
        let deleted = self
            .store
            .delete_template(id)
            .await
            .map_err(|_| ConnectError::internal("could not delete application template"))?;
        if !deleted {
            return Err(ConnectError::not_found(
                "application template was not found",
            ));
        }
        Response::ok(DeleteTemplateResponse {
            deleted,
            ..Default::default()
        })
    }

    async fn list_generation_runs(
        &self,
        ctx: RequestContext,
        _request: ServiceRequest<'_, ListGenerationRunsRequest>,
    ) -> ServiceResult<ListGenerationRunsResponse> {
        self.auth.require_admin(ctx.headers()).await?;
        let runs = self
            .store
            .list_runs()
            .await
            .map_err(|_| ConnectError::internal("could not read generation runs"))?;
        Response::ok(ListGenerationRunsResponse {
            runs,
            ..Default::default()
        })
    }

    async fn get_generation_run(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, GetGenerationRunRequest>,
    ) -> ServiceResult<GenerationRun> {
        self.auth.require_admin(ctx.headers()).await?;
        let id = request.view().id.trim().to_string();
        if id.is_empty() {
            return Err(ConnectError::invalid_argument(
                "generation run id is required",
            ));
        }
        let run = self
            .store
            .get_run(&id)
            .await
            .map_err(|_| ConnectError::internal("could not read generation run"))?
            .ok_or_else(|| ConnectError::not_found("generation run was not found"))?;
        Response::ok(run)
    }

    async fn start_generation(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, StartGenerationRequest>,
    ) -> ServiceResult<GenerationRun> {
        self.start_generation(ctx, request.to_owned_message()).await
    }

    async fn delete_generation_run(
        &self,
        ctx: RequestContext,
        request: ServiceRequest<'_, DeleteGenerationRunRequest>,
    ) -> ServiceResult<DeleteGenerationRunResponse> {
        self.auth.require_admin(ctx.headers()).await?;
        let id = request.view().id.trim().to_string();
        if id.is_empty() {
            return Err(ConnectError::invalid_argument(
                "generation run id is required",
            ));
        }
        let run = self
            .store
            .get_run(&id)
            .await
            .map_err(|_| ConnectError::internal("could not read generation run"))?
            .ok_or_else(|| ConnectError::not_found("generation run was not found"))?;
        if run.status == "queued" || run.status == "running" {
            return Err(ConnectError::invalid_argument(
                "a generation run cannot be deleted while it is active",
            ));
        }
        self.store
            .delete_run(&id)
            .await
            .map_err(|_| ConnectError::internal("could not delete generation run"))?;
        Response::ok(DeleteGenerationRunResponse {
            deleted: true,
            ..Default::default()
        })
    }
}

fn spawn_log_reader<R>(mut stream: R, tx: mpsc::Sender<String>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buffer = [0u8; 4096];
        loop {
            match stream.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if tx
                        .send(String::from_utf8_lossy(&buffer[..count]).into_owned())
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });
}

fn validate_git_destination(url: &str, provider: &str) -> Result<(), &'static str> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| "repository URL must be an absolute HTTPS URL")?;
    if parsed.scheme() != "https"
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
    {
        return Err(
            "repository URL must be HTTPS and must not contain credentials or query parameters",
        );
    }
    let expected = if provider == "github" {
        "github.com"
    } else {
        "gitlab.com"
    };
    if parsed.host_str() != Some(expected)
        || parsed
            .path_segments()
            .map(|segments| segments.count())
            .unwrap_or(0)
            < 2
    {
        return Err("repository URL must point to an existing GitHub or GitLab repository");
    }
    Ok(())
}

fn validate_branch(branch: &str) -> Result<(), &'static str> {
    if branch.is_empty()
        || branch.len() > 200
        || branch.starts_with('-')
        || branch.ends_with('/')
        || branch.contains("..")
        || branch.contains("//")
        || !branch
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-._/".contains(&byte))
    {
        return Err("branch must use letters, numbers, dots, underscores, hyphens, and slashes");
    }
    Ok(())
}

async fn execute_generation(
    store: Arc<GeneratorStore>,
    config: GeneratorConfig,
    mut run: GenerationRun,
    answers_json: String,
    branch: String,
) {
    run.status = "running".into();
    run.logs.push_str(&format!(
        "Starting Baker generation from {}.\n",
        run.template_url
    ));
    run.logs
        .push_str(&format!("Output destination: {}\n", run.destination));
    let _ = store.save_run(&run).await;
    match render_and_deliver(&store, &config, &mut run, &answers_json, &branch).await {
        Ok((output_path, output_log)) => {
            run.status = "succeeded".into();
            run.output_path = output_path;
            run.logs.push_str(&output_log);
            run.logs.push_str("Generation completed.\n");
        }
        Err(log) => {
            run.status = "failed".into();
            run.logs.push_str(&log);
            run.logs.push_str("Generation failed.\n");
        }
    }
    let _ = tokio::fs::remove_dir_all(config.generated_dir.join(format!(".run-{}", run.id))).await;
    if run.logs.len() > 500_000 {
        run.logs = run
            .logs
            .chars()
            .rev()
            .take(500_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }
    let _ = store.save_run(&run).await;
}

async fn render_and_deliver(
    store: &GeneratorStore,
    config: &GeneratorConfig,
    run: &mut GenerationRun,
    answers_json: &str,
    branch: &str,
) -> Result<(String, String), String> {
    let run_root = config.generated_dir.join(format!(".run-{}", run.id));
    let output_dir = if run.destination_type == "local" {
        config.generated_dir.join(&run.destination)
    } else {
        run_root.join("generated")
    };
    tokio::fs::create_dir_all(&config.generated_dir)
        .await
        .map_err(|error| format!("Could not prepare output root: {error}\n"))?;
    if output_dir.exists() {
        return Err(format!(
            "Output directory already exists: {}\n",
            output_dir.display()
        ));
    }
    if run.destination_type != "local" {
        tokio::fs::create_dir_all(&run_root)
            .await
            .map_err(|error| format!("Could not create run workspace: {error}\n"))?;
    }
    let answers_path = run_root.join("answers.json");
    tokio::fs::create_dir_all(&run_root)
        .await
        .map_err(|error| format!("Could not create run workspace: {error}\n"))?;
    tokio::fs::write(&answers_path, answers_json)
        .await
        .map_err(|error| format!("Could not write Baker answers: {error}\n"))?;
    let mut baker = Command::new(&config.baker_binary);
    baker
        .arg("generate")
        .arg(&run.template_url)
        .arg(&output_dir)
        .arg("--answers-file")
        .arg(&answers_path)
        .arg("--non-interactive")
        .arg("--skip-confirms=all")
        .env("GIT_TERMINAL_PROMPT", "0")
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = baker
        .spawn()
        .map_err(|error| format!("Could not run Baker: {error}\n"))?;
    let (log_tx, mut log_rx) = mpsc::channel::<String>(32);
    if let Some(stdout) = child.stdout.take() {
        spawn_log_reader(stdout, log_tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_log_reader(stderr, log_tx.clone());
    }
    drop(log_tx);
    let process_result: Result<ExitStatus, String> = timeout(
        Duration::from_secs(MAX_GENERATION_SECONDS),
        async {
            loop {
                tokio::select! {
                    chunk = log_rx.recv() => {
                        if let Some(chunk) = chunk {
                            run.logs.push_str(&chunk);
                            if run.logs.len() > 500_000 {
                                run.logs = run.logs.chars().rev().take(500_000).collect::<String>().chars().rev().collect();
                            }
                            let _ = store.save_run(run).await;
                        }
                    }
                    status = child.wait() => {
                        let status = status.map_err(|error| format!("Could not wait for Baker: {error}"))?;
                        while let Some(chunk) = log_rx.recv().await {
                            run.logs.push_str(&chunk);
                        }
                        return Ok(status);
                    }
                }
            }
        },
    )
    .await
    .map_err(|_| format!("Baker timed out after {MAX_GENERATION_SECONDS} seconds"))?;
    let _ = tokio::fs::remove_file(&answers_path).await;
    let status = process_result?;
    if !status.success() {
        return Err(format!("Baker exited with status {status}.\n"));
    }
    if run.destination_type == "local" {
        Ok((
            output_dir.display().to_string(),
            format!("Saved generated files to {}.\n", output_dir.display()),
        ))
    } else {
        let repo_dir = run_root.join("repository");
        let clone = Command::new("git")
            .arg("clone")
            .arg("--depth")
            .arg("1")
            .arg("--")
            .arg(&run.destination.split('#').next().unwrap_or_default())
            .arg(&repo_dir)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(|error| format!("Could not run git clone: {error}\n"))?;
        let clone_log = format!(
            "{}{}",
            String::from_utf8_lossy(&clone.stdout),
            String::from_utf8_lossy(&clone.stderr)
        );
        if !clone.status.success() {
            return Err(format!("Git clone failed.\n{clone_log}"));
        }
        let checkout = Command::new("git")
            .arg("-C")
            .arg(&repo_dir)
            .arg("checkout")
            .arg("-b")
            .arg(branch)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(|error| format!("Could not create output branch: {error}\n"))?;
        let checkout_log = format!(
            "{}{}",
            String::from_utf8_lossy(&checkout.stdout),
            String::from_utf8_lossy(&checkout.stderr)
        );
        if !checkout.status.success() {
            return Err(format!("Could not create output branch.\n{checkout_log}"));
        }
        copy_tree(&output_dir, &repo_dir).map_err(|error| {
            format!("Could not copy generated files into the repository: {error}\n")
        })?;
        let add = Command::new("git")
            .arg("-C")
            .arg(&repo_dir)
            .args(["add", "-A"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(|error| format!("Could not stage generated files: {error}\n"))?;
        if !add.status.success() {
            return Err(format!(
                "Could not stage generated files.\n{}",
                String::from_utf8_lossy(&add.stderr)
            ));
        }
        let commit = Command::new("git")
            .arg("-C")
            .arg(&repo_dir)
            .args([
                "-c",
                "user.name=Modulaga Generator",
                "-c",
                "user.email=generator@modulaga.local",
                "commit",
                "-m",
                "Generate application from Modulaga",
            ])
            .env("GIT_AUTHOR_NAME", "Modulaga Generator")
            .env("GIT_AUTHOR_EMAIL", "generator@modulaga.local")
            .env("GIT_COMMITTER_NAME", "Modulaga Generator")
            .env("GIT_COMMITTER_EMAIL", "generator@modulaga.local")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(|error| format!("Could not commit generated files: {error}\n"))?;
        if !commit.status.success() {
            return Err(format!(
                "Could not commit generated files.\n{}{}",
                String::from_utf8_lossy(&commit.stdout),
                String::from_utf8_lossy(&commit.stderr)
            ));
        }
        let push = Command::new("git")
            .arg("-C")
            .arg(&repo_dir)
            .arg("push")
            .arg("origin")
            .arg(format!("HEAD:refs/heads/{branch}"))
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .await
            .map_err(|error| format!("Could not push generated branch: {error}\n"))?;
        let push_log = format!(
            "{}{}",
            String::from_utf8_lossy(&push.stdout),
            String::from_utf8_lossy(&push.stderr)
        );
        if !push.status.success() {
            return Err(format!(
                "Git push failed. Configure runner credentials with write access to the repository.\n{push_log}"
            ));
        }
        let output_path = format!(
            "{}#{branch}",
            run.destination.split('#').next().unwrap_or_default()
        );
        let _ = tokio::fs::remove_dir_all(&run_root).await;
        Ok((
            output_path.clone(),
            format!(
                "{clone_log}{checkout_log}{push_log}Pushed generated files to {output_path}.\n"
            ),
        ))
    }
}

fn copy_tree(source: &Path, destination: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_symlink() {
            return Err(std::io::Error::other(format!(
                "generated output contains a symbolic link: {}",
                source_path.display()
            )));
        }
        if kind.is_dir() {
            std::fs::create_dir_all(&destination_path)?;
            copy_tree(&source_path, &destination_path)?;
        } else if kind.is_file() {
            std::fs::copy(source_path, destination_path)?;
        }
    }
    Ok(())
}

fn validate_baker_answers(questions_json: &str, answers: &mut Value) -> Result<(), String> {
    let questions: Value = serde_json::from_str(questions_json)
        .map_err(|_| "template questions are invalid".to_string())?;
    let questions = questions
        .as_object()
        .ok_or_else(|| "template questions are invalid".to_string())?;
    let answers = answers
        .as_object_mut()
        .ok_or_else(|| "generation answers must be a JSON object".to_string())?;
    for key in answers.keys() {
        if !questions.contains_key(key) {
            return Err(format!("unknown Baker answer '{key}'"));
        }
    }
    for (key, question) in questions {
        let kind = question
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("str");
        if kind == "yaml" {
            if let Some(source) = answers.get(key).and_then(Value::as_str).map(str::to_owned) {
                let parsed: serde_yaml::Value = serde_yaml::from_str(&source)
                    .map_err(|_| format!("answer for '{key}' must contain valid YAML"))?;
                let json = serde_json::to_value(parsed)
                    .map_err(|_| format!("answer for '{key}' could not be converted from YAML"))?;
                answers.insert(key.clone(), json);
            }
        }
        let Some(value) = answers.get(key) else {
            continue;
        };
        let valid = match kind {
            "bool" => value.is_boolean(),
            "json" | "yaml" => true,
            "str" if question.get("multiselect").and_then(Value::as_bool) == Some(true) => value
                .as_array()
                .is_some_and(|items| items.iter().all(Value::is_string)),
            "str" => value.is_string(),
            _ => false,
        };
        if !valid {
            return Err(format!(
                "answer for '{key}' does not match its Baker question type"
            ));
        }
        if let Some(choices) = question.get("choices").and_then(Value::as_array) {
            let allowed = choices.iter().filter_map(Value::as_str).collect::<Vec<_>>();
            let values = if question.get("multiselect").and_then(Value::as_bool) == Some(true) {
                value
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
            } else {
                value.as_str().into_iter().collect::<Vec<_>>()
            };
            if values.iter().any(|item| !allowed.contains(item)) {
                return Err(format!(
                    "answer for '{key}' is not one of the allowed choices"
                ));
            }
        }
    }
    Ok(())
}

fn validate_template(
    name: &str,
    url: &str,
    description: &str,
    icon: &str,
) -> Result<(), &'static str> {
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("template name must be 1–80 printable characters");
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| "template URL must be an absolute HTTP or HTTPS URL")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("template URL must be an absolute HTTP or HTTPS URL");
    }
    if description.chars().count() > 2000
        || description
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err("template description must be at most 2000 printable characters");
    }
    if icon.chars().count() > 80 || icon.chars().any(char::is_control) {
        return Err("template icon must be at most 80 printable characters");
    }
    Ok(())
}

fn baker_manifest_candidates(source: &str) -> Result<Vec<String>, &'static str> {
    let parsed = reqwest::Url::parse(source)
        .map_err(|_| "template URL must be an absolute HTTP or HTTPS URL")?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("template URL must be an absolute HTTP or HTTPS URL");
    }
    if parsed.username() != "" || parsed.password().is_some() {
        return Err("template URL must not contain embedded credentials");
    }
    if parsed.path().trim_end_matches('/').ends_with("baker.yaml")
        || parsed.path().trim_end_matches('/').ends_with("baker.yml")
    {
        return Ok(vec![parsed.to_string()]);
    }
    let host = parsed.host_str().unwrap_or_default();
    let segments = parsed
        .path_segments()
        .map(|segments| segments.collect::<Vec<_>>())
        .unwrap_or_default();
    if host == "github.com" && segments.len() >= 2 {
        let owner = segments[0];
        let repo = segments[1].trim_end_matches(".git");
        let branch = if segments.get(2) == Some(&"tree") {
            segments.get(3).copied().unwrap_or("main")
        } else {
            "main"
        };
        let mut result = vec![format!(
            "https://raw.githubusercontent.com/{owner}/{repo}/{branch}/baker.yaml"
        )];
        if branch == "main" {
            result.push(format!(
                "https://raw.githubusercontent.com/{owner}/{repo}/master/baker.yaml"
            ));
        }
        return Ok(result);
    }
    if host == "gitlab.com" && !segments.is_empty() {
        let (repo_segments, branch) =
            if let Some(marker) = segments.iter().position(|segment| *segment == "-") {
                let branch = if segments.get(marker + 1) == Some(&"tree")
                    || segments.get(marker + 1) == Some(&"raw")
                {
                    segments.get(marker + 2).copied().unwrap_or("main")
                } else {
                    "main"
                };
                (&segments[..marker], branch)
            } else {
                (&segments[..], "main")
            };
        if repo_segments.is_empty() {
            return Err("GitLab URL must include a project path");
        }
        let project = repo_segments.join("/");
        let mut result = vec![format!(
            "https://gitlab.com/{project}/-/raw/{branch}/baker.yaml"
        )];
        if branch == "main" {
            result.push(format!(
                "https://gitlab.com/{project}/-/raw/master/baker.yaml"
            ));
        }
        return Ok(result);
    }
    if parsed.path().ends_with('/') {
        return Ok(vec![format!(
            "{}{}/baker.yaml",
            parsed.origin().ascii_serialization(),
            parsed.path().trim_end_matches('/')
        )]);
    }
    Err("template URL must be a GitHub or GitLab repository URL, or point directly to baker.yaml")
}

async fn fetch_baker_yaml(
    http: &reqwest::Client,
    source: &str,
) -> Result<(String, String), String> {
    let candidates = baker_manifest_candidates(source).map_err(str::to_string)?;
    let mut last_error = "baker.yaml was not found at this template URL".to_string();
    for candidate in candidates {
        let response = match http.get(&candidate).send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("could not load baker.yaml: {error}");
                continue;
            }
        };
        if !response.status().is_success() {
            last_error = format!("could not load baker.yaml (HTTP {})", response.status());
            continue;
        }
        if response
            .content_length()
            .is_some_and(|length| length > 1_048_576)
        {
            return Err("baker.yaml is larger than 1 MiB".into());
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| "could not read baker.yaml response".to_string())?;
        if bytes.len() > 1_048_576 {
            return Err("baker.yaml is larger than 1 MiB".into());
        }
        let yaml =
            std::str::from_utf8(&bytes).map_err(|_| "baker.yaml is not UTF-8".to_string())?;
        let document: serde_yaml::Value = serde_yaml::from_str(yaml)
            .map_err(|error| format!("baker.yaml is invalid: {error}"))?;
        if document
            .get("schemaVersion")
            .and_then(serde_yaml::Value::as_str)
            != Some("v1")
        {
            return Err("baker.yaml must declare schemaVersion: v1".into());
        }
        let questions = document
            .get("questions")
            .cloned()
            .unwrap_or_else(|| serde_yaml::Value::Mapping(serde_yaml::Mapping::new()));
        let Some(questions_map) = questions.as_mapping() else {
            return Err("baker.yaml questions must be a mapping".into());
        };
        for (key, question) in questions_map {
            let Some(key) = key.as_str() else {
                return Err("baker.yaml question names must be strings".into());
            };
            let kind = question
                .get("type")
                .and_then(serde_yaml::Value::as_str)
                .unwrap_or("str");
            if !matches!(kind, "str" | "bool" | "json" | "yaml") {
                return Err(format!("question '{key}' uses unsupported type '{kind}'"));
            }
        }
        let questions_json = serde_json::to_string(&questions)
            .map_err(|_| "could not encode Baker questions".to_string())?;
        return Ok((yaml.to_string(), questions_json));
    }
    Err(last_error)
}

fn generated_record(
    id: &str,
    name: &str,
    slug: &str,
    path: &Path,
    status: &str,
    output: String,
    uids: &[String],
    created_at: &str,
) -> GeneratedApplication {
    GeneratedApplication {
        id: id.into(),
        name: name.into(),
        slug: slug.into(),
        output_path: path.display().to_string(),
        status: status.into(),
        build_output: output,
        content_type_uids: uids.to_vec(),
        created_at: created_at.into(),
        ..Default::default()
    }
}

pub fn validate_app_name(name: &str) -> Result<(), &'static str> {
    if name.is_empty()
        || name.len() > 80
        || !name.chars().all(|character| {
            character.is_alphanumeric()
                || (character.is_whitespace() && !character.is_control())
                || matches!(character, '-' | '_' | '.' | '(' | ')')
        })
    {
        Err("application name must be 1–80 printable characters")
    } else {
        Ok(())
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub fn validate_slug(slug: &str) -> Result<(), &'static str> {
    if slug.is_empty()
        || slug.len() > 48
        || !slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        || slug.starts_with('-')
        || slug.ends_with('-')
    {
        Err("slug must use lowercase letters, numbers, and internal hyphens")
    } else {
        Ok(())
    }
}

fn read_varint(bytes: &[u8], cursor: &mut usize) -> Result<u64, &'static str> {
    let mut value = 0u64;
    for shift in (0..70).step_by(7) {
        let byte = *bytes.get(*cursor).ok_or("truncated protobuf response")?;
        *cursor += 1;
        value |= u64::from(byte & 0x7f)
            .checked_shl(shift)
            .ok_or("invalid protobuf varint")?;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("invalid protobuf varint")
}

fn read_fields(bytes: &[u8]) -> Result<Vec<(u32, u8, Vec<u8>)>, &'static str> {
    let mut fields = Vec::new();
    let mut cursor = 0;
    while cursor < bytes.len() {
        let tag = read_varint(bytes, &mut cursor)?;
        let (number, wire) = ((tag >> 3) as u32, (tag & 7) as u8);
        if wire == 2 {
            let length = usize::try_from(read_varint(bytes, &mut cursor)?)
                .map_err(|_| "invalid protobuf length")?;
            let end = cursor
                .checked_add(length)
                .filter(|end| *end <= bytes.len())
                .ok_or("truncated protobuf field")?;
            fields.push((number, wire, bytes[cursor..end].to_vec()));
            cursor = end;
        } else if wire == 0 {
            let value = read_varint(bytes, &mut cursor)?;
            fields.push((number, wire, value.to_le_bytes().to_vec()));
        } else if wire == 1 || wire == 5 {
            let length = if wire == 1 { 8 } else { 4 };
            let end = cursor
                .checked_add(length)
                .filter(|end| *end <= bytes.len())
                .ok_or("truncated protobuf field")?;
            fields.push((number, wire, bytes[cursor..end].to_vec()));
            cursor = end;
        } else {
            return Err("unsupported protobuf wire type");
        }
    }
    Ok(fields)
}

fn decode_content_types(bytes: &[u8]) -> Result<Vec<ContentTypeOption>, &'static str> {
    let mut records = Vec::new();
    for (_, wire, record) in read_fields(bytes)? {
        if wire != 2 {
            continue;
        }
        let fields = read_fields(&record)?;
        let get = |number| {
            fields
                .iter()
                .find(|(n, _, _)| *n == number)
                .map(|(_, _, value)| value.as_slice())
        };
        let uid = get(1)
            .and_then(|v| std::str::from_utf8(v).ok())
            .ok_or("content type response has no UID")?
            .to_string();
        let schema_json = get(2)
            .and_then(|v| std::str::from_utf8(v).ok())
            .ok_or("content type response has no schema")?
            .to_string();
        let revision = get(3)
            .and_then(|v| (v.len() == 8).then(|| u64::from_le_bytes(v.try_into().unwrap())))
            .unwrap_or_default();
        let schema: Value = serde_json::from_str(&schema_json)
            .map_err(|_| "content type schema is invalid JSON")?;
        records.push(ContentTypeOption {
            uid,
            display_name: schema
                .pointer("/info/displayName")
                .and_then(Value::as_str)
                .unwrap_or("Untitled")
                .into(),
            kind: schema
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("collectionType")
                .into(),
            schema_json,
            revision,
            ..Default::default()
        });
    }
    Ok(records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Bytes, routing::post};
    use buffa::Message;
    use connectrpc::HasMessageView;
    use std::{os::unix::fs::PermissionsExt, sync::Arc};
    use tempfile::TempDir;
    use tokio::{net::TcpListener, task::JoinHandle};

    const SCHEMA_UID: &str = "api::article.article";
    const SCHEMA_JSON: &str = r#"{"uid":"api::article.article","kind":"collectionType","info":{"singularName":"article","pluralName":"articles","displayName":"Article"},"attributes":{"title":{"type":"string","required":true}}}"#;

    fn put_varint(mut value: usize, out: &mut Vec<u8>) {
        while value > 0x7f {
            out.push((value as u8 & 0x7f) | 0x80);
            value >>= 7;
        }
        out.push(value as u8);
    }

    fn bytes_field(number: usize, value: &[u8], out: &mut Vec<u8>) {
        put_varint((number << 3) | 2, out);
        put_varint(value.len(), out);
        out.extend_from_slice(value);
    }

    fn content_types_payload(schema_json: &str) -> Vec<u8> {
        let mut record = Vec::new();
        bytes_field(1, SCHEMA_UID.as_bytes(), &mut record);
        bytes_field(2, schema_json.as_bytes(), &mut record);
        record.extend_from_slice(&[24, 1]);
        let mut response = Vec::new();
        bytes_field(1, &record, &mut response);
        response
    }

    async fn mock_content_types(payload: Vec<u8>) -> (String, JoinHandle<()>) {
        mock_content_types_with_status(payload, axum::http::StatusCode::OK).await
    }

    async fn mock_content_types_with_status(
        payload: Vec<u8>,
        status: axum::http::StatusCode,
    ) -> (String, JoinHandle<()>) {
        let app = axum::Router::new().route(
            "/modulaga.contenttypes.v1.ContentTypesService/List",
            post(move || {
                let payload = payload.clone();
                async move {
                    (
                        status,
                        [(axum::http::header::CONTENT_TYPE, "application/proto")],
                        Bytes::from(payload),
                    )
                }
            }),
        );
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (format!("http://{address}"), handle)
    }

    fn script(path: &Path, body: &str) {
        std::fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        let mut permissions = std::fs::metadata(path).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).unwrap();
    }

    async fn fixture(
        baker_script: &str,
        cargo_script: &str,
    ) -> (ApplicationGenerator, TempDir, JoinHandle<()>) {
        let dir = tempfile::tempdir().unwrap();
        let output = dir.path().join("generated");
        let templates = dir.path().join("templates");
        std::fs::create_dir_all(templates.join("content-app")).unwrap();
        let baker = dir.path().join("baker");
        let cargo = dir.path().join("cargo");
        script(&baker, baker_script);
        script(&cargo, cargo_script);
        let (content_types_api_url, mock) =
            mock_content_types(content_types_payload(SCHEMA_JSON)).await;
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            dir.path().join("apps.sqlite").display()
        );
        let store = Arc::new(GeneratorStore::connect(&database_url).await.unwrap());
        let config = GeneratorConfig {
            content_types_api_url,
            templates_dir: templates,
            generated_dir: output,
            baker_binary: baker.display().to_string(),
            cargo_binary: cargo.display().to_string(),
        };
        (
            ApplicationGenerator::new(store, Authenticator::disabled(), config),
            dir,
            mock,
        )
    }

    fn generate_request(uids: Vec<String>) -> GenerateApplicationRequest {
        GenerateApplicationRequest {
            name: "Article service".into(),
            slug: "article-service".into(),
            content_type_uids: uids,
            ..Default::default()
        }
    }

    async fn invoke_generate(
        service: &ApplicationGenerator,
        input: GenerateApplicationRequest,
    ) -> Result<Response<GeneratedApplication>, ConnectError> {
        let body = buffa::bytes::Bytes::from(input.encode_to_vec());
        let view = GenerateApplicationRequest::decode_view(&body).unwrap();
        <ApplicationGenerator as ApplicationGeneratorService>::generate(
            service,
            RequestContext::default(),
            ServiceRequest::from_parts(&view, &body),
        )
        .await
    }

    const SUCCESSFUL_BAKER: &str = r#"out="$3"; mkdir -p "$out/src"; printf '[package]\nname = "generated"\nversion = "0.1.0"\nedition = "2024"\n' > "$out/Cargo.toml"; printf 'fn main() {}\n' > "$out/src/main.rs"; echo 'baker done'"#;
    const SUCCESSFUL_CARGO: &str = "echo cargo build completed; exit 0";

    #[test]
    fn validates_application_names_and_slugs() {
        assert!(validate_app_name("Inventory API (v2)").is_ok());
        assert!(validate_app_name("").is_err());
        assert!(validate_app_name("a".repeat(81).as_str()).is_err());
        assert!(validate_app_name("bad\nname").is_err());
        assert!(validate_app_name("<script>").is_err());
        assert!(validate_slug("inventory-api-2").is_ok());
        assert!(validate_slug("").is_err());
        assert!(validate_slug("../outside").is_err());
        assert!(validate_slug("UpperCase").is_err());
        assert!(validate_slug("-starts-with-dash").is_err());
        assert!(validate_slug("ends-with-dash-").is_err());
    }

    #[test]
    fn generator_config_reads_defaults_and_environment_overrides() {
        let names = [
            "CONTENT_TYPES_API_URL",
            "APPLICATION_TEMPLATES_DIR",
            "GENERATED_APPS_DIR",
            "BAKER_BINARY",
            "CARGO_BINARY",
        ];
        let originals = names.map(|name| std::env::var_os(name));
        unsafe {
            for name in names {
                std::env::remove_var(name);
            }
        }
        let defaults = GeneratorConfig::from_env();
        assert_eq!(defaults.content_types_api_url, "http://127.0.0.1:4305");
        assert_eq!(
            defaults.templates_dir,
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("templates")
        );
        assert_eq!(
            defaults.generated_dir,
            PathBuf::from(".data/generated-apps")
        );
        assert_eq!(defaults.baker_binary, "baker");
        assert_eq!(defaults.cargo_binary, "cargo");
        unsafe {
            std::env::set_var(names[0], "http://schema.test");
            std::env::set_var(names[1], "/tmp/templates");
            std::env::set_var(names[2], "/tmp/apps");
            std::env::set_var(names[3], "/bin/baker");
            std::env::set_var(names[4], "/bin/cargo");
        }
        let configured = GeneratorConfig::from_env();
        assert_eq!(configured.content_types_api_url, "http://schema.test");
        assert_eq!(configured.templates_dir, PathBuf::from("/tmp/templates"));
        assert_eq!(configured.generated_dir, PathBuf::from("/tmp/apps"));
        assert_eq!(configured.baker_binary, "/bin/baker");
        assert_eq!(configured.cargo_binary, "/bin/cargo");
        unsafe {
            for (name, original) in names.into_iter().zip(originals) {
                match original {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }

    #[test]
    fn escapes_markup_in_template_answers() {
        assert_eq!(
            escape_html("A & <B> \"C\" 'D'"),
            "A &amp; &lt;B&gt; &quot;C&quot; &#39;D&#39;"
        );
    }

    #[test]
    fn reads_protobuf_fields_and_rejects_truncated_or_unknown_wire_values() {
        let mut field = Vec::new();
        bytes_field(1, b"value", &mut field);
        assert_eq!(read_fields(&field).unwrap()[0].2, b"value");
        assert_eq!(read_fields(&[0x80]), Err("truncated protobuf response"));
        assert_eq!(
            read_fields(&[0x0a, 0x04, 0x01]),
            Err("truncated protobuf field")
        );
        assert_eq!(read_fields(&[0x0e]), Err("unsupported protobuf wire type"));
        assert_eq!(
            read_varint(&[0x80; 10], &mut 0),
            Err("invalid protobuf varint")
        );
        assert_eq!(read_fields(&[0x08, 0x03]).unwrap()[0].2.len(), 8);
        assert_eq!(
            read_fields(&[0x09, 1, 2, 3, 4, 5, 6, 7, 8]).unwrap()[0]
                .2
                .len(),
            8
        );
        assert_eq!(read_fields(&[0x0d, 1, 2, 3, 4]).unwrap()[0].2.len(), 4);
    }

    #[test]
    fn decodes_content_type_metadata_and_rejects_invalid_schemas() {
        let records = decode_content_types(&content_types_payload(SCHEMA_JSON)).unwrap();
        assert_eq!(records[0].uid, SCHEMA_UID);
        assert_eq!(records[0].display_name, "Article");
        assert_eq!(records[0].kind, "collectionType");
        assert_eq!(records[0].revision, 1);
        let mut with_unknown = vec![0x08, 0x01];
        with_unknown.extend(content_types_payload(SCHEMA_JSON));
        assert_eq!(decode_content_types(&with_unknown).unwrap().len(), 1);
        assert_eq!(
            decode_content_types(&content_types_payload("not json")),
            Err("content type schema is invalid JSON")
        );
        assert_eq!(
            decode_content_types(&[0x0a, 0x00]),
            Err("content type response has no UID")
        );
    }

    #[tokio::test]
    async fn lists_content_types_from_the_content_types_connect_service() {
        let (url, mock) = mock_content_types(content_types_payload(SCHEMA_JSON)).await;
        let config = GeneratorConfig {
            content_types_api_url: url,
            templates_dir: PathBuf::new(),
            generated_dir: PathBuf::new(),
            baker_binary: String::new(),
            cargo_binary: String::new(),
        };
        let store = Arc::new(GeneratorStore::connect("sqlite::memory:").await.unwrap());
        let service = ApplicationGenerator::new(store, Authenticator::disabled(), config);
        let body = buffa::bytes::Bytes::from(ListContentTypesRequest::default().encode_to_vec());
        let view = ListContentTypesRequest::decode_view(&body).unwrap();
        let response = service
            .list_content_types(
                RequestContext::default(),
                ServiceRequest::from_parts(&view, &body),
            )
            .await
            .unwrap();
        assert_eq!(response.body.content_types.len(), 1);
        assert_eq!(response.body.content_types[0].uid, SCHEMA_UID);
        mock.abort();
    }

    #[tokio::test]
    async fn content_type_proxy_forwards_auth_and_reports_upstream_errors() {
        let (url, mock) = mock_content_types(content_types_payload(SCHEMA_JSON)).await;
        let config = GeneratorConfig {
            content_types_api_url: url,
            templates_dir: PathBuf::new(),
            generated_dir: PathBuf::new(),
            baker_binary: String::new(),
            cargo_binary: String::new(),
        };
        let store = Arc::new(GeneratorStore::connect("sqlite::memory:").await.unwrap());
        let service = ApplicationGenerator::new(store, Authenticator::disabled(), config);
        let mut headers = HeaderMap::new();
        headers.insert(header::AUTHORIZATION, "Bearer session".parse().unwrap());
        assert_eq!(service.content_types(&headers).await.unwrap().len(), 1);
        mock.abort();

        let (url, mock) =
            mock_content_types_with_status(Vec::new(), axum::http::StatusCode::SERVICE_UNAVAILABLE)
                .await;
        let config = GeneratorConfig {
            content_types_api_url: url,
            templates_dir: PathBuf::new(),
            generated_dir: PathBuf::new(),
            baker_binary: String::new(),
            cargo_binary: String::new(),
        };
        let service = ApplicationGenerator::new(
            Arc::new(GeneratorStore::connect("sqlite::memory:").await.unwrap()),
            Authenticator::disabled(),
            config,
        );
        assert!(service.content_types(&HeaderMap::new()).await.is_err());
        mock.abort();

        let config = GeneratorConfig {
            content_types_api_url: "http://127.0.0.1:1".into(),
            templates_dir: PathBuf::new(),
            generated_dir: PathBuf::new(),
            baker_binary: String::new(),
            cargo_binary: String::new(),
        };
        let service = ApplicationGenerator::new(
            Arc::new(GeneratorStore::connect("sqlite::memory:").await.unwrap()),
            Authenticator::disabled(),
            config,
        );
        assert!(service.content_types(&HeaderMap::new()).await.is_err());
    }

    #[tokio::test]
    async fn generate_runs_baker_and_builds_the_selected_schema_application() {
        let (service, temp, mock) = fixture(SUCCESSFUL_BAKER, SUCCESSFUL_CARGO).await;
        let response = invoke_generate(&service, generate_request(vec![SCHEMA_UID.into()]))
            .await
            .unwrap()
            .body;
        assert_eq!(response.status, "built");
        assert_eq!(response.content_type_uids, [SCHEMA_UID]);
        assert!(response.build_output.contains("baker done"));
        assert!(response.build_output.contains("cargo build completed"));
        let schemas: Value = serde_json::from_slice(
            &tokio::fs::read(Path::new(&response.output_path).join("schemas.json"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(schemas[0]["uid"], SCHEMA_UID);
        assert_eq!(service.store.list().await.unwrap().len(), 1);
        assert!(temp.path().join("generated").exists());
        mock.abort();
    }

    #[tokio::test]
    async fn generate_records_baker_and_cargo_failures() {
        let (service, _temp, mock) =
            fixture("echo baker failed >&2; exit 1", SUCCESSFUL_CARGO).await;
        let baked = invoke_generate(&service, generate_request(vec![SCHEMA_UID.into()]))
            .await
            .unwrap()
            .body;
        assert_eq!(baked.status, "failed");
        assert!(baked.build_output.contains("baker failed"));
        mock.abort();

        let (service, _temp, mock) =
            fixture(SUCCESSFUL_BAKER, "echo cargo failed >&2; exit 1").await;
        let built = invoke_generate(&service, generate_request(vec![SCHEMA_UID.into()]))
            .await
            .unwrap()
            .body;
        assert_eq!(built.status, "build-failed");
        assert!(built.build_output.contains("cargo failed"));
        mock.abort();

        let (mut service, _temp, mock) = fixture(SUCCESSFUL_BAKER, SUCCESSFUL_CARGO).await;
        service.config.cargo_binary = "/missing/cargo".into();
        let built = invoke_generate(&service, generate_request(vec![SCHEMA_UID.into()]))
            .await
            .unwrap()
            .body;
        assert_eq!(built.status, "build-failed");
        assert!(
            built
                .build_output
                .contains("Could not run the application build")
        );
        mock.abort();

        let (mut service, _temp, mock) = fixture(SUCCESSFUL_BAKER, SUCCESSFUL_CARGO).await;
        service.config.baker_binary = "/missing/baker".into();
        let baked = invoke_generate(&service, generate_request(vec![SCHEMA_UID.into()]))
            .await
            .unwrap()
            .body;
        assert_eq!(baked.status, "failed");
        assert!(baked.build_output.contains("Could not run Baker"));
        mock.abort();
    }

    #[tokio::test]
    async fn generate_rejects_bad_input_and_unknown_schemas_before_running_baker() {
        let (service, _temp, mock) = fixture(SUCCESSFUL_BAKER, SUCCESSFUL_CARGO).await;
        assert!(
            invoke_generate(&service, generate_request(Vec::new()))
                .await
                .is_err()
        );
        assert!(
            invoke_generate(
                &service,
                generate_request(vec![SCHEMA_UID.into(), SCHEMA_UID.into()])
            )
            .await
            .is_err()
        );
        assert!(
            invoke_generate(
                &service,
                GenerateApplicationRequest {
                    slug: "../bad".into(),
                    content_type_uids: vec![SCHEMA_UID.into()],
                    ..generate_request(vec![])
                }
            )
            .await
            .is_err()
        );
        assert!(
            invoke_generate(
                &service,
                generate_request(vec!["api::missing.missing".into()])
            )
            .await
            .is_err()
        );
        mock.abort();
    }

    #[tokio::test]
    async fn generated_application_store_persists_and_lists_records() {
        let temp = tempfile::tempdir().unwrap();
        let database_url = format!(
            "sqlite://{}?mode=rwc",
            temp.path().join("apps.sqlite").display()
        );
        let store = GeneratorStore::connect(&database_url).await.unwrap();
        assert!(store.list().await.unwrap().is_empty());
        let record = generated_record(
            "one",
            "One",
            "one",
            &temp.path().join("one"),
            "built",
            "done".into(),
            &[SCHEMA_UID.into()],
            "",
        );
        store.save(&record).await.unwrap();
        let stored = store.list().await.unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].name, "One");
        assert_eq!(stored[0].content_type_uids, [SCHEMA_UID]);
    }
}
