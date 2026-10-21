# Technology Stack

> Historical repository snapshot from before the Rust/ConnectRPC POC. See [the active architecture](../architecture/architecture.md) for the current stack.

## 1) Runtime Summary

| Area | Value | Evidence |
| --- | --- | --- |
| Primary UI language | TypeScript 5.9.3 with TSX | `apps/shell/package.json`, `apps/demo-react/package.json`, `packages/contracts/package.json` |
| API language | Rust, Cargo edition 2024; compiler version is not pinned | `apps/config-api/Cargo.toml` |
| JavaScript runtime target | Node.js `>=24 <25`; `.node-version` contains `24` | `package.json`, `.node-version` |
| Package manager | pnpm 12.8.1, lockfile version 9 | `package.json`, `pnpm-lock.yaml` |
| Workspace model | pnpm monorepo, `apps/*` and `packages/*` | `pnpm-workspace.yaml` |
| UI framework | SolidJS `2.0.0-rc.11` and `@solidjs/web` `2.0.0-rc.11` | `apps/shell/package.json` |
| Build system | Vite 8.3.1; separate app builds | workspace package manifests and Vite configs |
| Module format | ESM application packages; generated validators are CommonJS loaded by the ESM contracts entry | package manifests, `packages/contracts/scripts/generate.mjs` |

The current terminal used for this report was running Node.js 26.0.0, outside the
root package's declared engine range. The T001 handoff separately records a clean
Node 24.21.0 install and validation. Use Node 24 for reproducible project commands.

## 2) Production Frameworks And Dependencies

| Dependency | Version | Role | Evidence |
| --- | --- | --- | --- |
| `solid-js`, `@solidjs/web` | 2.0.0-rc.11 | Shell UI and DOM rendering | `apps/shell/package.json` |
| `@module-federation/enhanced` | 2.9.2 | Runtime federation consumer in the shell | `apps/shell/package.json`, `apps/shell/src/probe/federation.ts` |
| `react`, `react-dom` | 19.3.0 | Independent proof remote | `apps/demo-react/package.json` |
| `axum` | 0.8.9 | Rust HTTP router and handlers | `apps/config-api/Cargo.toml` |
| `sqlx` with SQLite | 0.8.6 | Async SQLite storage | `apps/config-api/Cargo.toml` |
| `tokio` | 1.53.1 | Async runtime and TCP listener | `apps/config-api/Cargo.toml`, `apps/config-api/src/main.rs` |
| `serde`, `serde_json` | 1.0.228, 1.0.149 | Rust request/response JSON serialization | `apps/config-api/Cargo.toml` |
| `uuid` | 1.21.0 | Application/menu IDs | `apps/config-api/Cargo.toml` |
| `ajv`, `ajv-formats` | 8.20.0, 3.0.1 | Runtime helpers used by generated standalone validators | `packages/contracts/package.json` |

## 3) Development Toolchain

| Tool | Purpose | Evidence |
| --- | --- | --- |
| Vite 8.3.1, `@solidjs/vite-plugin` 3.0.0-next.35 | Shell dev server and build | `apps/shell/package.json`, `apps/shell/vite.config.ts` |
| `@module-federation/vite` 1.23.0 | Build-time producer plugin for React proof remote | `apps/demo-react/package.json`, `apps/demo-react/vite.config.ts` |
| TypeScript 5.9.3 | Strict type checking and generated declarations | package manifests, `tsconfig.base.json` |
| Vitest 5.0.2, happy-dom 20.14.5 | UI and contract unit tests | `apps/shell/package.json`, `packages/contracts/package.json` |
| Playwright 1.63.0 | Production-build federation/browser scenarios | root `package.json`, `playwright.spike.config.ts` |
| `json-schema-to-typescript` 16.0.0 | Generate declaration files from JSON Schema | `packages/contracts/package.json`, `packages/contracts/scripts/generate.mjs` |
| Cargo | Rust API build and tests | `apps/config-api/Cargo.toml` |

## 4) Key Commands

Run from the repository root unless a package directory is specified:

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm test:spike
pnpm --filter @modulaga/contracts build
pnpm --filter @modulaga/contracts test
cargo run --manifest-path apps/config-api/Cargo.toml
cargo test --manifest-path apps/config-api/Cargo.toml
```

The root `typecheck`, `test`, and `build` scripts target only the shell. The
contracts package has its own scripts and is not currently included in those root
checks. `test:spike` builds the shell and React remote, then runs Playwright.

## 5) Environment And Configuration

- Node target: `.node-version` and root `engines`.
- API variables: `MODULAGA_ENV`, `MODULAGA_API_ADDR`, `MODULAGA_ADMIN_TOKEN`,
  `MODULAGA_DATABASE_PATH` in `apps/config-api/src/main.rs`.
- Shell API override: `VITE_CONFIG_API_URL`; defaults to
  `http://127.0.0.1:4303/api` in `apps/shell/src/workspace/api.ts`.
- No committed `.env.example` or equivalent was found. No cloud or deployment
  configuration is present.
- API defaults to development mode, loopback port 4303, and
  `.data/modulaga.sqlite3`; it refuses non-development mode and non-loopback binds.

## 6) Evidence

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.node-version`
- `apps/shell/package.json`, `apps/shell/vite.config.ts`
- `apps/demo-react/package.json`, `apps/demo-react/vite.config.ts`
- `apps/config-api/Cargo.toml`, `apps/config-api/src/main.rs`
- `packages/contracts/package.json`, `packages/contracts/scripts/generate.mjs`
