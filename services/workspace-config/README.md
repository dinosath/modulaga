# Workspace configuration service

This service is Rust only. Axum hosts the HTTP endpoints, and ConnectRPC routes
are generated from `proto/workspace_config.proto` with protobuf message types.
The shell uses Connect's binary protobuf encoding over HTTP/1.1.

`Get` reads a workspace snapshot. `Update` validates the document and saves it
using an expected revision, so stale editors receive an `aborted` Connect error.
SQLite stores the full versioned workspace JSON document during local
development; the registry Compose profile uses PostgreSQL. The document schema
is shared with the TypeScript contracts under
`packages/contracts/src/schemas/workspace.schema.json`.

The `app-catalog` binary in this crate is a separate Rust/Axum service. It
serves the validated microfrontend catalog from `workspace-config/catalog.json`
over its own ConnectRPC service on port 4304. Compose builds and runs the two
binaries as distinct services.

The update method requires a FerrisKey access token carrying the configured
realm role when `AUTH_MODE=oidc`. Tokens are checked against the configured
issuer and FerrisKey's discovered JWKS. Set `OIDC_DISCOVERY_URL` and
`OIDC_JWKS_URI` when containers use an internal network address while tokens
retain the public issuer value. Set `AUTH_MODE=disabled` only for local
development.

Run locally with the persistent SQLite file and an explicit auth mode:

```sh
mkdir -p .data
WORKSPACE_STORE=sqlite \
DATABASE_URL=sqlite://$PWD/.data/workspace-config.sqlite?mode=rwc \
AUTH_MODE=disabled cargo run --manifest-path services/workspace-config/Cargo.toml --bin workspace-config
```

The `GET /health` endpoint is for liveness checks. Compose profiles, seed
workspace files, FerrisKey setup, and the shell workflow are documented in the
repository README.
