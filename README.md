# Modulaga

Modulaga is a configurable microfrontend shell. Workspace documents define the
menus, sidebar, breadcrumbs, routes, dashboards, and panel placements. The shell
renders that data and loads business UI through registered microfrontend
adapters. The shell-bundled static admin app edits workspace menu and shell
settings through the configuration service.

## Run the project

Choose either the pnpm development stack or the all-container Compose stack.
Both start the shell, workspace configuration API, catalog API, and React
example microfrontend. Local development stores workspace settings in SQLite;
the registry deployment profile uses PostgreSQL.

### One command with pnpm

Install the prerequisites once: Node 24, pnpm, and Rust. From
the repository root, install JavaScript dependencies and start the app:

```sh
npm_config_manage_package_manager_versions=false pnpm install
npm_config_manage_package_manager_versions=false pnpm dev
```

`pnpm dev` starts both Rust + Axum ConnectRPC services, the built React example
remote, and the Vite shell. Workspace settings persist in
`.data/workspace-config.sqlite`; no database container is required. Open the
shell at [http://127.0.0.1:4300](http://127.0.0.1:4300). Configuration writes
are saved to SQLite; Ferriskey authorization is disabled for local development.
Press Ctrl+C to stop the app services.

### One command with Docker Compose

With Docker Desktop or Docker Engine and the Compose plugin installed, run:

```sh
docker compose --profile local up --build
```

Open the shell at [http://localhost:4310](http://localhost:4310). Choose
**Admin Panel** under Settings to change the welcome page, menu, sidebar,
breadcrumbs, and dashboard. **Save changes** persists them through ConnectRPC
to SQLite in the local Compose profile. Ferriskey's admin console is at
[http://localhost:5556](http://localhost:5556). The local Ferriskey image
defaults to `admin` / `admin`; change these values in `.env` before exposing
the stack beyond local development.

## Ferriskey authorization

The `registry` Compose profile enables OIDC token validation on workspace
configuration writes. Configure Ferriskey with a `modulaga` realm, a public
OIDC client for the shell, authorization code + PKCE, the shell callback
`http://localhost:4310/`, and the `roles` scope. Add the `modulaga-admin` realm
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
- `services/workspace-config`: Rust + Axum service. ConnectRPC methods and
  protobuf messages are generated from `proto/workspace_config.proto`.
- `services/app-catalog` (the `app-catalog` Rust binary in the same crate):
  Rust + Axum ConnectRPC service that serves and validates microfrontend
  release descriptors from `workspace-config/catalog.json`.
- `packages/contracts`: canonical JSON Schemas and generated validators/types.
- `workspace-config/`: workspace snapshots and the microfrontend catalog that
  both services load. The workspace-config Rust service source was copied from
  the sibling `../workspace-config` project and adapted to the ConnectRPC
  document contract.
- `compose.yaml`: `local` build profile and `registry` image profile for the
  shell, React remote, and workspace service, with Ferriskey and PostgreSQL.

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
```

Coverage commands enforce at least 90% line, branch, function, and statement
coverage for the shell's configuration transport and navigation validation,
plus at least 90% Rust line coverage for catalog validation, workspace
validation, ConnectRPC service behavior, and Ferriskey token checks. Rust
coverage excludes process startup binaries and the PostgreSQL adapter, which
require process and database integration environments. Rust coverage uses
`cargo llvm-cov`; install it with `cargo install cargo-llvm-cov`.
