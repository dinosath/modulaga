# Codebase Structure

> Historical repository snapshot from before the Rust/ConnectRPC POC. See [the active architecture](../architecture/architecture.md) for current paths and service boundaries.

## 1) Top-Level Map

| Path | Purpose | Evidence |
| --- | --- | --- |
| `apps/shell/` | Solid workspace shell, local workspace API client, federation host | `apps/shell/src/` |
| `apps/demo-react/` | Independently built React remote exposing a `mount` module | `apps/demo-react/vite.config.ts`, `apps/demo-react/src/mount.tsx` |
| `apps/config-api/` | Rust/Axum local configuration API and SQLite persistence | `apps/config-api/src/main.rs`, `apps/config-api/src/lib.rs` |
| `packages/contracts/` | Draft JSON Schema contracts, generated TS types, standalone validators | `packages/contracts/src/`, `packages/contracts/scripts/` |
| `fixtures/` | Valid and invalid catalog, workspace, preference, and admin-navigation examples | `fixtures/` |
| `tests/spike/` | Playwright production federation and API-backed workspace journey | `tests/spike/federation.spec.ts` |
| `docs/contracts/` | Local API and draft configuration contract documentation | `docs/contracts/` |
| `docs/implementation/` | Plan, research, checkpoints, and task handoffs | `docs/implementation/` |
| `docs/codebase/` | This source-grounded implementation report | `docs/codebase/` |
| Root manifests | pnpm workspace, scripts, Node target, shared TS settings | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json` |

Planned but not currently implemented as workspace packages: `apps/workspace-designer`,
`apps/demo-vue`, `packages/sdk`, `packages/theme`, and the planned E2E suite beyond
the federation spike.

## 2) Entry Points

- Shell browser entry: `apps/shell/index.html` loads `apps/shell/src/main.tsx`,
  which renders `App` into `#root`.
- Configuration API entry: Cargo binary `apps/config-api/src/main.rs`; it loads
  environment, opens SQLite, initializes tables, binds a loopback listener, and
  serves the router exported from `src/lib.rs`.
- React demo entry: `apps/demo-react/src/main.tsx`; the producer plugin exposes
  `./mount` from `apps/demo-react/src/mount.tsx`.
- Package scripts select dev/build/test entry points. No CLI worker or background
  job entry point was found.

## 3) Module Boundaries

| Boundary | What belongs here | What must not be here | Evidence |
| --- | --- | --- | --- |
| Shell composition | Workspace bootstrap, menu rendering, browser history, mount lifecycle, local admin forms | Persistence implementation or React rendering internals | `apps/shell/src/App.tsx` |
| Shell API client | DTOs, HTTP fetch wrapper, admin bearer header | SQL or policy enforcement | `apps/shell/src/workspace/api.ts` |
| Federation adapter | Create federation runtime, load exposed module, validate `mount` shape | Catalog compatibility policy or publisher trust decisions | `apps/shell/src/probe/federation.ts` |
| React proof remote | React root, demo component, scoped remote CSS | Shell navigation or workspace persistence | `apps/demo-react/src/` |
| Configuration API | Axum routes, input validation, SQL statements, DTOs, static errors | Production identity/session provider | `apps/config-api/src/lib.rs`, `src/main.rs` |
| Contracts package | Canonical structural schemas, type/validator generation, fixture validation | Cross-record authorization or live shell compatibility decisions | `packages/contracts/src/`, `packages/contracts/scripts/generate.mjs` |

The config API currently combines handlers, validation, SQL, and tests in one
`lib.rs`; the table is a responsibility description, not evidence of separate
service/repository layers.

## 4) Naming And Organization Rules

- TypeScript module filenames are mixed: `App.tsx`/`RemoteApp.tsx` use component
  names, while `api.ts`, `federation.ts`, and `validation.test.ts` use lowercase
  feature names. Rust source uses `main.rs` and `lib.rs`.
- Source organization is shallow and feature-oriented in the shell (`workspace/`,
  `probe/`); the API is a compact crate rather than a layered directory tree.
- TypeScript imports are relative. No TS path aliases are configured in
  `tsconfig.base.json`.
- Generated declarations/validators live under `packages/contracts/src/generated/`
  and are generated from `src/schemas/`; do not treat generated files as source of
  contract truth.

## 5) Evidence

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- `apps/shell/src/main.tsx`, `apps/shell/src/App.tsx`
- `apps/config-api/src/main.rs`, `apps/config-api/src/lib.rs`
- `apps/demo-react/vite.config.ts`, `apps/demo-react/src/mount.tsx`
- `packages/contracts/src/schemas/`, `packages/contracts/scripts/generate.mjs`
