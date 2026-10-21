# Integrations And External Boundaries

> Historical repository snapshot from before the Rust/ConnectRPC POC. The current API uses Axum and ConnectRPC; see [the active architecture](../architecture/architecture.md).

## 1) HTTP API

| Method | Path | Auth | Current behavior | Evidence |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | None | Returns HTTP 204 | `apps/config-api/src/lib.rs` |
| GET | `/api/workspaces/default/bootstrap` | None | Returns fixed default workspace plus all registered applications and ordered menu entries | `apps/config-api/src/lib.rs` |
| POST | `/api/applications` | `Authorization: Bearer <local token>` | Validates and stores an application declaration; route collision returns 409 | `apps/config-api/src/lib.rs` |
| POST | `/api/menu-entries` | Same bearer token | Adds menu entry referencing a registered application; duplicate position returns 409 | `apps/config-api/src/lib.rs` |
| DELETE | `/api/menu-entries/{id}` | Same bearer token | Removes only the menu entry; application declaration remains | `apps/config-api/src/lib.rs` |

The API binds to `127.0.0.1:4303` by default. CORS permits the local shell and
preview origins on ports 4300 and 4173, for both `localhost` and `127.0.0.1`.
There are no public-service, webhook, payment, analytics, or cloud-provider
integrations in the current source.

## 2) Persistence

- SQLite file defaults to `.data/modulaga.sqlite3`; override with
  `MODULAGA_DATABASE_PATH`.
- Tables: `applications` (unique route path) and `menu_entries` (foreign key to
  application with cascade delete, unique position). Startup creates tables with
  `CREATE TABLE IF NOT EXISTS`; no versioned migration files were found.
- SQLx binds request values as parameters. The bootstrap identity and name are
  constants (`default`, `Default workspace`), not persisted workspace records.
- Test mode uses SQLite memory databases and temporary files; Playwright uses a
  process-specific database path under `.data/`.

## 3) Federation Boundary

- The shell consumes Module Federation manifests with
  `@module-federation/enhanced/runtime`.
- `apps/demo-react` produces a remote with `@module-federation/vite`, manifest
  enabled, and the `./mount` exposure. The production preview is at port 4174.
- Both the declared-remote API validation and demo configuration are local-first:
  API registration accepts only `http` URLs on loopback with a path ending in
  `/mf-manifest.json`, without URL credentials, query, or fragment.
- The loaded module is expected to expose `mount(container)` and return a
  disposer. The check is a runtime shape check, not a sandbox or integrity check.
- A fixed React probe remote and a declaration-driven remote path coexist in the
  shell. The latter creates a runtime instance from each workspace declaration.
- No Vue producer, catalog resolver, remote signature verification, or production
  remote publishing service is present.

## 4) Contracts Package

- `packages/contracts/src/schemas/` contains JSON Schema draft 2020-12 for
  catalog, workspace, preferences, and admin navigation configuration.
- `scripts/generate.mjs` generates TypeScript declarations and standalone Ajv
  validators. `fixtures/` contains example payloads; package tests validate those
  samples.
- This package is a draft structural contract boundary. Current shell DTOs and API
  structs are independently declared and do not import generated types/validators.
- Schema validation does not itself implement compatibility decisions, publisher
  approval, authorization, installation, revision history, or admin UI behavior.

## 5) Security And Identity Boundary

- All write routes require a bearer token compared by a local constant-time byte
  comparison. The token is read from process environment and must have at least
  32 bytes (checked by UTF-8 byte length).
- API startup exits unless `MODULAGA_ENV=development` (default) and the bind IP is
  loopback. This is explicitly not a production identity mechanism.
- The browser stores the entered admin token only in component memory; it is not
  persisted to local storage by current shell code.
- Same-page federated remotes execute as trusted browser code. There is no iframe
  sandbox, publisher identity, release approval workflow, or permission broker.

## 6) Evidence

- `apps/config-api/src/main.rs`, `apps/config-api/src/lib.rs`
- `apps/shell/src/workspace/api.ts`, `apps/shell/src/probe/federation.ts`
- `apps/demo-react/vite.config.ts`, `apps/demo-react/src/mount.tsx`
- `packages/contracts/src/schemas/`, `packages/contracts/scripts/generate.mjs`
- `playwright.spike.config.ts`
