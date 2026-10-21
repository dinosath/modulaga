# Implementation Concerns And Open Questions

> Historical repository snapshot from before the Rust/ConnectRPC POC. Its file paths and status claims are stale; see [the active architecture](../architecture/architecture.md).

## 1) Important Gaps

| Priority | Finding | Evidence and impact |
| --- | --- | --- |
| Blocker for production | API explicitly rejects non-development mode and only supports a local bearer token; there is no trusted identity provider, user/session model, or per-workspace authorization. | `apps/config-api/src/main.rs`, `PROJECT_BRIEF.md`; deployment is not currently possible as a production service. |
| High | Federated remotes execute in the shell page with its browser privileges. The loopback URL restriction is appropriate for this local prototype but does not establish publisher trust or protect users from remote code. | `apps/config-api/src/lib.rs`, `apps/shell/src/probe/federation.ts`; production requires reviewed publisher/origin approval and an explicit trust model. |
| High | Product intent and running behavior diverge: no catalog discovery/search, compatibility engine, immutable release registry, exact-release installation, upgrade/uninstall lifecycle, or workspace isolation exists. | `PROJECT_BRIEF.md` and `docs/implementation/plan.md` describe intent; current routes/tables are only application declarations, menu entries, and one default bootstrap. |
| High | The configurable admin console requested in the brief is not implemented. The present shell has a local management form for app/menu registration, not a separate admin app, shadcn-style component system, metadata-driven admin sections, nested tree editor, revisions, or publishing flow. | `apps/shell/src/App.tsx`, `apps/shell/src/App.css`, `apps/config-api/src/lib.rs`; no shadcn or Solid-compatible UI package is in the manifests. |
| High | Draft contracts are not connected to runtime code. Shell DTOs and API structs are independently maintained; schema changes can drift from actual request/response behavior. | `packages/contracts/src/`, `apps/shell/src/workspace/api.ts`, `apps/config-api/src/lib.rs`. T003 remains a draft awaiting owner review/freeze. |
| Medium | Storage schema is initialized with inline `CREATE TABLE IF NOT EXISTS`; no schema version or migration mechanism exists. Workspace identity is hard-coded. | `apps/config-api/src/lib.rs`; expanding beyond local proof risks incompatible persisted data and cross-workspace leakage if tenancy is added without redesign. |
| Medium | Current API is create-only for app declarations and create/delete for menu entries. There is no application update/delete endpoint, menu update/reorder endpoint, or explicit transaction that stages a whole workspace config. | Axum route registration in `apps/config-api/src/lib.rs`. |
| Medium | Error and lifecycle coverage is narrow. Shell unit tests exercise identity and menu rendering only; runtime module checking validates only the `mount` function. | `apps/shell/src/App.test.tsx`, `apps/shell/src/probe/federation.ts`; asynchronous failures, partial mounts, stale loads, and history transitions need acceptance coverage. |
| Medium | Browser accessibility, performance, and dependency-security gates are absent. | No axe, CI workflow, bundle budget check, coverage threshold, or audit job was found; the plan explicitly calls for these later. |
| Low | The repository targets Node 24 but this report's session used Node 26; no CI image pins the runtime. | `.node-version`, root `package.json`; pin toolchain in CI before relying on reproducible gates. |

## 2) Intent Versus Current Implementation

| Product intent | Current implementation |
| --- | --- |
| Discover compatible applications from a catalog | No catalog endpoint or UI; app declaration must be entered locally. |
| Install/pin/upgrade a particular immutable release in a workspace | Shell stores a remote declaration directly; no catalog release or installation entity. |
| Configurable shell menus, nested tree, layouts, theme, preferences | Flat menu entries and one default snapshot; no layout, placement, preference, or theme runtime. |
| Separate shadcn-inspired Solid admin console with dynamic admin-view tree | No separate console or tree editor; current local forms do not use a shadcn component package. |
| Production identity, multi-workspace auth, draft/publish revisions | Explicitly unavailable; startup refuses production mode. |
| Vue and additional framework interop | Only a React producer proof exists. |
| Contract-driven validation at runtime | Contracts and generated validators exist, but shell/API do not consume them. |

One useful correction to the original brief's key-file map: `packages/contracts/`
now exists and contains draft schemas, generated types/validators, fixtures, and
tests. Its presence does not imply the catalog or admin product workflow exists.

## 3) Planning And Status Caveats

- `docs/implementation/plan.md` describes desired requirements and planned paths;
  task checkboxes and review gates remain authoritative for completion.
- T001/T002 handoffs provide prior environment and browser validation evidence.
- T003 added the contracts package, but its schema set is a draft pending owner
  contract freeze. Do not describe that as completed catalog behavior.
- This report describes code observed in the current workspace and test results
  run or explicitly recorded above. It does not certify production readiness.

## 4) Questions For The Owner

1. [ASK USER] Should contract freeze/review be the next gate before implementation of dependent catalog, installation, or admin-tree work?
2. [ASK USER] Which user-facing vertical slice should take priority next: catalog discovery plus exact-release workspace installation, or the separate editable admin console and section tree?
3. [ASK USER] Should the UI direction continue to mean shadcn-inspired Solid-native styling and interaction patterns, without React shadcn/ui as a runtime dependency, as stated in the implementation plan?

## 5) Evidence

- `PROJECT_BRIEF.md`, `docs/implementation/plan.md`
- `docs/implementation/handoffs/T001.md`, `docs/implementation/handoffs/T002.md`, `docs/implementation/handoffs/T003.md`
- `apps/shell/src/App.tsx`, `apps/shell/src/App.css`, `apps/shell/src/workspace/api.ts`
- `apps/config-api/src/main.rs`, `apps/config-api/src/lib.rs`
- `apps/shell/src/probe/federation.ts`, `packages/contracts/src/`
- Root `package.json`, `.node-version`, `apps/shell/src/App.test.tsx`
