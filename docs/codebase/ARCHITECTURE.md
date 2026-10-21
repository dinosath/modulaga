# Architecture

> Historical repository snapshot from before the Rust/ConnectRPC POC. For the current implementation, see [the active architecture](../architecture/architecture.md).

## 1) Architectural Style

- Primary style: a small browser shell plus a separate local HTTP configuration
  service and independently built federated remote. This is a prototype with
  feature modules, not a fully layered platform architecture.
- The shell owns workspace bootstrap, navigation, browser history, and remote
  lifecycle. The API owns current local persistence and write validation.
- Current installed applications are declarations in one workspace; the catalog,
  immutable release/install lifecycle, designer, SDK, and shared theme package are
  not yet wired into runtime code.

## 2) System Flow

```text
Browser shell -> GET workspace bootstrap -> Axum handler -> SQLite -> JSON snapshot
       |
       +-> menu click -> history.pushState -> federation runtime -> manifest/module
                                                               -> remote mount hook
```

1. `main.tsx` mounts `App`; `App` calls `getWorkspace()` from
   `apps/shell/src/workspace/api.ts` during setup.
2. The API reads application declarations and menu rows from SQLite, orders them,
   and returns the fixed `default` workspace snapshot.
3. `App.tsx` maps each menu row to its application declaration. A primary click
   pushes that application's `route_path` into browser history and starts loading.
4. `mountDeclaredRemote()` creates a Module Federation runtime instance from the
   declaration's `remote_name` and `manifest_url`, then loads the exposed module.
5. The shell checks that the returned module has a `mount` function. The React
   remote creates a React root in the shell-owned container and returns an unmount
   callback. Switching apps disposes the previous callback; a generation counter
   discards and disposes stale asynchronous loads.
6. Admin forms POST registrations/menu entries with an in-memory bearer token,
   then refresh the workspace snapshot. Menu deletion is separate from application
   registration.

## 3) Module Responsibilities

| Module | Owns | Must not own | Evidence |
| --- | --- | --- | --- |
| `apps/shell/src/App.tsx` | Shell UI/state, workspace menu, history handling, forms, remote mount/dispose | Durable storage, server authorization, React rendering | `apps/shell/src/App.tsx` |
| `apps/shell/src/workspace/api.ts` | HTTP calls, TS DTOs, generic error conversion | Authorization decisions or schema validation | `apps/shell/src/workspace/api.ts` |
| `apps/shell/src/probe/federation.ts` | Federation instances, remote lookup, mount-shape check | Isolation/sandboxing or compatibility checks | `apps/shell/src/probe/federation.ts` |
| `apps/config-api/src/lib.rs` | Axum routes, SQL, request checks, errors, DTOs | Multi-tenant identity or production auth | `apps/config-api/src/lib.rs` |
| `apps/config-api/src/main.rs` | Dev-mode guard, env parsing, DB startup, listener | Business workflow orchestration | `apps/config-api/src/main.rs` |
| `packages/contracts/` | Structural schema source and generated validators/types | Runtime authorization or semantic cross-record resolution | `packages/contracts/src/schemas/`, `src/index.ts` |

## 4) Reused Patterns

| Pattern | Where found | Why it exists |
| --- | --- | --- |
| Runtime adapter | `apps/shell/src/probe/federation.ts` | The shell loads a plain `mount(container)` export rather than framework components directly. |
| Explicit disposer | Remote mount return values and shell disposal state | The shell can unmount remote framework roots when switching or leaving. |
| Stale-load generation guard | `mountGeneration` in `apps/shell/src/App.tsx` | A late async load is disposed rather than replacing the newer selected application. |
| Bound SQL parameters | `sqlx::query(...).bind(...)` in `apps/config-api/src/lib.rs` | Values are kept separate from SQL source text. |
| In-memory handler state | `AppState` injected via Axum `with_state` | Router handlers share the pool/token without a global mutable singleton. |
| Canonical schema generation | Generator reads JSON Schema and emits types/standalone validators | Avoid maintaining separate hand-written contract types and runtime validators in the contracts package. |

## 5) Known Architectural Risks

- Shell and API DTOs are independently handwritten. The new contracts package is
  not imported by either runtime package, so schema drift is possible.
- The federation proof casts the loaded module to a local TS shape and performs
  only a `mount` function check. It does not prove lifecycle version, capability,
  integrity, or remote-type compatibility.
- The API's handlers and SQL are in one module and schema setup is ad hoc
  `CREATE TABLE IF NOT EXISTS`; there is no versioned migration/repository layer.
- The UI models menu entries as a flat list and app declarations, while the draft
  contract models nested menus and release-pinned installations.

## 6) Evidence

- `apps/shell/src/main.tsx`, `apps/shell/src/App.tsx`
- `apps/shell/src/workspace/api.ts`, `apps/shell/src/probe/federation.ts`
- `apps/config-api/src/main.rs`, `apps/config-api/src/lib.rs`
- `apps/demo-react/src/mount.tsx`, `apps/demo-react/vite.config.ts`
- `packages/contracts/src/schemas/`, `packages/contracts/scripts/generate.mjs`
