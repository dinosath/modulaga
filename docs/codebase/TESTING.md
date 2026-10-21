# Testing And Validation

> Historical repository snapshot from before the Rust/ConnectRPC POC. Current test commands and coverage gates are listed in the [project README](../../README.md).

## 1) Test Layers

| Layer | Tool | Scope | Current tests | Evidence |
| --- | --- | --- | --- | --- |
| Shell unit | Vitest + happy-dom | Shell identity and API-driven menu rendering | 2 tests | `apps/shell/src/App.test.tsx` |
| Contract | Vitest | Generated JSON Schema validators against valid/invalid samples | 3 tests | `packages/contracts/src/validation.test.ts`, `fixtures/` |
| API unit/request | Rust `#[tokio::test]`, Axum `oneshot`, SQLite | Bootstrap, authorization, invalid manifest, malformed/unknown fields, menu deletion, DB reopen | 7 tests | `apps/config-api/src/lib.rs` |
| Browser integration | Playwright Chromium | Production federation lifecycle and workspace registration/menu flow | 2 scenarios | `tests/spike/federation.spec.ts`, `playwright.spike.config.ts` |
| Typecheck/build | TypeScript, Vite, contract generator | Shell and contracts compile/build | Package-specific scripts | package manifests |

## 2) Commands

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @modulaga/contracts build
pnpm --filter @modulaga/contracts test
cargo test --manifest-path apps/config-api/Cargo.toml
pnpm test:spike
```

Root `pnpm typecheck`, `pnpm test`, and `pnpm build` affect only `@modulaga/shell`.
Contracts need explicit package commands. The API test command does not require a
running service; the browser command builds both frontends and starts the API,
preview servers, and Playwright.

## 3) Test Setup And Isolation

- Shell Vitest uses `happy-dom`; test file stubs `fetch`, mounts the Solid app,
  then disposes the render and resets global stubs.
- API tests create fresh in-memory SQLite pools. The persistence case uses a
  uniquely named temporary file and removes it after reopening and asserting data.
- Playwright starts production previews for the shell and remote and runs the API
  on loopback. Its admin token is a test-only literal; the database path includes
  the current process ID. Test server reuse is disabled when `CI` is set.
- Playwright retains traces on failure and uses a list reporter. No screenshot
  baseline, axe accessibility check, load test, or multi-browser matrix was found.

## 4) Current Validation Run

Validated while preparing this report:

| Check | Result |
| --- | --- |
| `cargo test --manifest-path apps/config-api/Cargo.toml` | Passed: 7 tests; binary/doc targets had 0 tests |
| Contracts build/generation | Passed: generator and TypeScript build completed |
| Contracts Vitest | Passed: 3 tests |
| Shell TypeScript check | Passed: `tsc --noEmit -p tsconfig.json` |
| Shell Vitest | Passed: 2 tests |
| Production browser spike | Previously recorded passed: 2 Playwright scenarios; not rerun in this report session |

The current environment reported Node.js 26.0.0 while the repository declares
Node.js `>=24 <25`; the current shell check and contracts build nonetheless
completed. A prior task handoff records validation with Node 24.21.0.

## 5) Coverage Gaps

- The shell unit tests do not exercise form submission, errors, history/back-forward,
  cancellation, or remote mount/unmount failure paths.
- API tests do not exercise a live TCP server, rate limits, database contention,
  migrations, production identity, or multi-workspace authorization.
- Browser scenarios cover a thin local happy path and production federation proof;
  there are no catalog installation, release upgrade, dynamic admin-tree,
  keyboard/a11y, or responsive acceptance journeys because those features are
  not implemented.
- The package contract tests demonstrate structural examples only; they do not
  prove the running shell/API conform to the schemas.
- No CI workflow, coverage threshold, lint gate, performance budget check, or
  dependency vulnerability gate is present in the repository.

## 6) Evidence

- `apps/shell/package.json`, `apps/shell/vitest.config.ts`
- `apps/shell/src/App.test.tsx`
- `apps/config-api/src/lib.rs`, `apps/config-api/Cargo.toml`
- `packages/contracts/package.json`, `packages/contracts/src/validation.test.ts`
- `playwright.spike.config.ts`, `tests/spike/federation.spec.ts`
- Root `package.json`, `.node-version`
