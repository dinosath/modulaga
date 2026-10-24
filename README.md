# Modulaga

Modulaga is a configurable microfrontend shell. Workspace documents define the
menus, sidebar, breadcrumbs, routes, dashboards, and panel placements. The shell
renders that data and loads business UI through registered microfrontend
adapters. The shell-bundled static admin app edits workspace menu and shell
settings through the configuration service.

## Run the project

Choose either the pnpm development stack or the all-container Compose stack.
Both start the shell, workspace configuration API, application catalog,
content-types and application-generator APIs, standalone admin, content-types,
and application-generator UIs, plus a React microfrontend. Local development stores workspace settings in SQLite;
the registry deployment profile uses PostgreSQL.

### One command with pnpm

Install the prerequisites once: Node 24, pnpm, Rust, and the [Baker CLI](https://github.com/aliev/baker#installation). From
the repository root, install JavaScript dependencies and start the app:

```sh
npm_config_manage_package_manager_versions=false pnpm install
npm_config_manage_package_manager_versions=false pnpm dev
# or, after mise has installed the tools
mise run dev
```

`pnpm dev` starts the Rust + Axum ConnectRPC services, builds and serves the
React, content-types, and application-generator remote apps independently,
serves the standalone admin panel UI, and runs the Vite shell. Generated source
and build output are written to `.data/generated-apps`.
Workspace settings persist in
`.data/workspace-config.sqlite` and content type schemas in
`.data/content-types.sqlite`; no database container is required. Open the
shell at [http://127.0.0.1:4300](http://127.0.0.1:4300), admin panel at
[http://127.0.0.1:4176](http://127.0.0.1:4176), and content-types UI at
[http://127.0.0.1:4175](http://127.0.0.1:4175). Configuration writes
are saved to SQLite; Ferriskey authorization is disabled for local development.
The application generator is at [http://127.0.0.1:4177](http://127.0.0.1:4177)
and is also available under Settings in the shell. It reads saved schemas from
the content-types service, invokes Baker with the bundled project template,
injects the selected schemas, and runs an offline Cargo build. Generated
projects are stored under `.data/generated-apps`.
Press Ctrl+C to stop the app services. The root `mise run dev` task starts this same full stack; project-local `mise run dev` tasks start an individual app or backend. The root `mise run build` builds every app and service.

### One command with Docker Compose

With Docker Desktop or Docker Engine and the Compose plugin installed, run:

```sh
docker compose --profile local up --build
```

Open the shell at [http://localhost:4310](http://localhost:4310). Choose
**Workspace Settings** under Settings to change the welcome page, menu, sidebar,
breadcrumbs, and dashboard. **Save changes** persists them through ConnectRPC
to SQLite in the local Compose profile. The application generator appears under
Settings and stores generated projects under `.data/generated-apps` in the local
profile. The registry profile keeps them in the `modulaga_generated_apps` volume.
Ferriskey's admin console is at
[http://localhost:5556](http://localhost:5556). The local Ferriskey image
defaults to `admin` / `admin`; change these values in `.env` before exposing
the stack beyond local development.

## Ferriskey authorization

The `registry` Compose profile enables OIDC token validation on workspace
configuration and content type writes. Configure Ferriskey with a `modulaga` realm, a public
OIDC client for the shell, authorization code + PKCE, the shell callback
`http://localhost:4310/` (and standalone admin/generator callbacks at
`http://localhost:4176/` and `http://localhost:4177/`), and the `roles` scope. Add the `modulaga-admin` realm
role to users permitted to edit workspace configuration. Then set
`FERRISKEY_CLIENT_ID` and, if needed, `OIDC_ISSUER` in `.env` before building
the shell image. The service checks the access token signature, issuer,
expiration, optional audience, and Ferriskey `realm_access.roles` claim.

```sh
docker compose --profile registry up -d
```

The first user-facing login setup is documented in the [Ferriskey SSO guide](https://docs.ferriskey.rs/en/discover/guides/application-sso).

## Architecture and services

- `apps/shell`: SolidJS 2 shell, workspace menu renderer, admin studio, and
  module-federation compatibility fixture.
- `apps/admin-panel`: Standalone workspace menu/settings UI, also bundled into
  the shell. Its Compose service serves the same UI independently and connects
  to the workspace-config service.
- `services/workspace-config`: Rust + Axum service. ConnectRPC methods and
  protobuf messages are generated from `proto/workspace_config.proto`.
- `services/content-types`: Rust + Axum ConnectRPC service for Ferris CMS style
  content type definitions. It persists schemas in SQLite and generates the
  `tableSchema` shape from Trailbase's SQLite schema model.
- `services/application-generator`: Rust + Axum ConnectRPC service that reads
  saved content types, runs Baker against the bundled project template, and
  builds the generated Rust application.
- `apps/content-types`: Standalone SolidJS Module Federation remote for content
  type editing. The shell discovers it through the catalog just like other
  applications; it is not bundled into the shell. It uses the shared
  shadcn-solid component source and calls the separate content-types service.
- `apps/application-generator`: SolidJS Module Federation remote for selecting
  content types and generating/building applications through the generator
  service.
- `services/app-catalog` (the `app-catalog` Rust binary in the same crate):
  Rust + Axum ConnectRPC service that serves and validates microfrontend
  release descriptors from `workspace-config/catalog.json`.
- `packages/contracts`: canonical JSON Schemas and generated validators/types.
- `workspace-config/`: workspace snapshots and the microfrontend catalog
  loaded as defaults by the Rust workspace and catalog services.
- `compose.yaml`: `local` build profile and `registry` image profile for the
  shell, standalone admin, content-types, and application-generator UIs, React
  remote, workspace, content-types, and application-generator services, with
  Ferriskey and PostgreSQL.

## Add an application

The shell loads application UIs from the catalog and mounts them on routes
declared by a workspace. A backend is a separate service; it is not discovered
or registered through the UI catalog. There is currently no application
installation screen, so adding an app involves editing the catalog and
workspace configuration files.

### Add the UI remote

1. Create an app under `apps/<app-id>` and configure its bundler for Module
   Federation. Expose `./mount` with the contract in
   `packages/contracts/src/microfrontend.ts`; the remote's mount function takes
   a container and shell context, and returns a cleanup function. See
   `apps/content-types/vite.config.ts` and `apps/content-types/src/mount.tsx`
   for a working SolidJS example. Other frontend technologies can be used if
   they implement this mount contract and Module Federation remote format.
2. Build and host the remote's federation manifest and assets. Use HTTPS for
   deployed manifests. Local development permits HTTP on loopback addresses.
3. Register the app and release in the catalog. For the pnpm dev stack, edit
   `fixtures/catalog.local.json`; local Compose reads that same file. The
   registry Compose profile reads `fixtures/catalog.compose.json`. The
   catalog service can instead load another JSON file via `CATALOG_PATH`.
   Each release needs a unique ID prefixed by the app ID, a manifest URL, a
   Module Federation remote name, and an exposed module (normally `./mount`).
   `services/workspace-config/src/catalog.rs` documents and validates the
   catalog shape.
4. Add an installation and one or more routes to
   `workspace-config/workspaces/default.json` (or the workspace document used
   by your environment). The installation's `appId` and `releaseId` must match
   the catalog. Each route references that installation by `installationId`.
   Add `type: "route"` menu entries referencing those route IDs to make them
   appear in the sidebar. The menu editor changes menu entries, but does not
   currently create catalog apps, installations, or routes.

For example, the workspace installation and route have this shape:

```json
{
  "installations": [
    {
      "id": "inventory-installation",
      "appId": "inventory",
      "releaseId": "inventory@1.0.0",
      "basePath": "/inventory",
      "settings": { "schemaId": "inventory-settings", "value": {} }
    }
  ],
  "routes": [
    {
      "id": "inventory-home",
      "installationId": "inventory-installation",
      "path": "/inventory"
    }
  ]
}
```

Put the route entry inside an existing menu section's `children` array:

```json
{
  "id": "inventory-link",
  "type": "route",
  "label": "Inventory",
  "routeId": "inventory-home",
  "icon": "box",
  "visible": true
}
```

### Add the backend service

1. Create a service under `services/<service-name>` using Rust, Axum, and
   ConnectRPC. Define its API in protobuf and generate the ConnectRPC service
   bindings using the existing Rust service patterns, such as
   `services/content-types`.
2. Add the service to `compose.yaml` for both `local` and `registry` profiles,
   including its port, health/dependency configuration, persistence, and
   Ferriskey OIDC settings if it accepts authenticated requests. For local
   pnpm development, wire it into `scripts/dev-local.sh` as well.
3. Give the UI a browser-reachable backend URL through runtime configuration
   (the shell's runtime settings are templated in
   `apps/shell/runtime-config.js.template`). Use the published host URL in
   browser code—for example, `http://localhost:<port>` in local Compose—not a
   Compose-only hostname such as `my-service`. Use Compose service DNS names
   for service-to-service calls. Add CORS origins for the shell and standalone
   UI as needed.

The catalog describes UI releases and how to load them; it does not contain
backend endpoints or start backend services. Compose and deployment
configuration manage those services independently. In production, publish the
remote manifest over HTTPS and configure browser-visible API URLs and OIDC
settings for the target environment.

Read the [architecture and OneCX investigation](docs/architecture/architecture.md)
for the shell boundaries, loader adapter plan, configuration model, and design
decisions. Menu visibility is presentation only; the service protects updates
using Ferriskey roles, and business APIs must authorize their own requests.
The proposed schema/workflow editor and Baker generation architecture is in
[Template Studio and Application Generation](docs/architecture/template-studio-and-generation.md).

## Quality gates

```sh
pnpm --filter @modulaga/shell typecheck
pnpm --filter @modulaga/shell test:coverage
cargo test --manifest-path services/workspace-config/Cargo.toml
cargo test --manifest-path services/content-types/Cargo.toml
```

Coverage commands enforce at least 90% line, branch, function, and statement
coverage for the shell's configuration transport and navigation validation,
plus at least 90% Rust line coverage for catalog validation, workspace
validation, ConnectRPC service behavior, and Ferriskey token checks. Rust
coverage excludes process startup binaries and the PostgreSQL adapter, which
require process and database integration environments. Rust coverage uses
`cargo llvm-cov`; install it with `cargo install cargo-llvm-cov`.
