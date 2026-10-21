# Coding Conventions

> Historical repository snapshot from before the Rust/ConnectRPC POC. See [the active architecture](../architecture/architecture.md) and current source tree for conventions.

## 1) Naming Rules

| Item | Rule observed | Example | Evidence |
| --- | --- | --- | --- |
| TypeScript filenames | Mixed PascalCase for UI components; lowercase feature names for modules/tests | `App.tsx`, `RemoteApp.tsx`, `api.ts`, `validation.test.ts` | `apps/shell/src/`, `apps/demo-react/src/`, `packages/contracts/src/` |
| TypeScript functions/variables | camelCase | `getWorkspace`, `mountDeclaredRemote`, `mountGeneration` | `apps/shell/src/workspace/api.ts`, `apps/shell/src/App.tsx` |
| TypeScript types/components | PascalCase | `WorkspaceSnapshot`, `ApplicationDeclaration`, `RemoteApp` | `apps/shell/src/`, `apps/demo-react/src/` |
| Rust functions/fields | snake_case | `get_workspace`, `manifest_url`, `validate_application` | `apps/config-api/src/lib.rs` |
| Rust types | PascalCase | `ApplicationInput`, `WorkspaceSnapshot`, `ApiError` | `apps/config-api/src/lib.rs` |
| Environment variables | Upper snake case with `MODULAGA_` prefix for API settings | `MODULAGA_ADMIN_TOKEN` | `apps/config-api/src/main.rs` |
| TS module constants | Upper snake case for module-wide fixed roots | `API_ROOT` | `apps/shell/src/workspace/api.ts` |

## 2) Formatting And Linting

- TypeScript compiler strict mode is enabled, including `noUnusedLocals`,
  `noUnusedParameters`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  and `isolatedModules` in `tsconfig.base.json`.
- No ESLint, Prettier, Biome, rustfmt override, or repository formatting config
  was found. Rust uses the standard Rust toolchain defaults; no format command is
  wired in package scripts.
- Commands actually configured: `pnpm typecheck`, package-level contract
  typecheck/build, and `cargo test --manifest-path apps/config-api/Cargo.toml`.
- Imports are relative within TypeScript packages; no TS path mappings are present.
  `packages/contracts/src/index.ts` is an explicit public export barrel.

## 3) Import And Module Conventions

- Application packages declare `"type": "module"`; imports use explicit
  relative module paths. React and Solid components use TSX.
- Rust uses crate-root `lib.rs` for the reusable router/handlers and `main.rs`
  for process startup. Shared API state is passed through Axum's router state.
- Public contract exports are explicitly re-exported from
  `packages/contracts/src/index.ts`; generated validators use `.cjs` output and
  matching `.d.cts` declarations for Node/TypeScript module resolution.

## 4) Error Handling And Validation

- Shell fetch failures become `Error` instances using the API's JSON `error`
  field where available; HTTP 204 is represented as `undefined` in the generic
  client. DTO response bodies are cast, not runtime-validated.
- Axum input DTOs deny unknown fields. Handlers map parse/validation failures to
  a small JSON error shape and HTTP status; internal SQL details are not returned.
- Application registration validates route syntax, remote/module identifiers,
  and a loopback-only HTTP federation manifest URL. Menu writes validate label,
  position, foreign key, and unique position constraints.
- Generated contract validators expose structural validation results, but no
  shell/API consumer currently invokes them.

## 5) Test Conventions

- Tests use Vitest `*.test.ts` / `*.test.tsx`; Rust tests are inline under
  `#[cfg(test)]` in `src/lib.rs`; browser scenarios live under `tests/spike/`.
- Shell tests stub global `fetch` and mount `App` with `@solidjs/web`; cleanup
  disposes the Solid render and unstubs globals after each case.
- API tests exercise the Axum router using `tower::ServiceExt::oneshot`, an
  in-memory SQLite database, and a temporary file-backed database for reopen
  persistence.
- Contract tests exercise generated validators with positive and negative
  fixture data. Playwright uses production previews and a per-process SQLite path.

## 6) Evidence

- `tsconfig.base.json`, `apps/shell/vitest.config.ts`
- `apps/shell/src/App.test.tsx`, `apps/config-api/src/lib.rs`
- `packages/contracts/src/validation.test.ts`, `packages/contracts/scripts/generate.mjs`
- `tests/spike/federation.spec.ts`, `playwright.spike.config.ts`
