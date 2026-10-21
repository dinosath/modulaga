# Modulaga Project Brief

Last updated: 2026-09-30. Status: local Rust/Axum configuration slice and federation proof implemented; production identity and full designer remain pending.

## 1. Project Overview

Modulaga is a lightweight microfrontend workspace platform centered on an app
catalog: administrators discover compatible applications and install a specific
release into a workspace. Users configure workspace navigation, layouts, and theme
preferences. Independently deployed applications may use different frameworks,
provided they implement the platform's integration contract and consume its design
system.

## 2. Concept / Product Description

The shell loads a published workspace configuration and mounts installed
applications on demand. Catalog apps and immutable releases are distinct from
workspace installations, which pin an exact release. Compatibility is checked
against Modulaga's integration contract, shell version, federation format, required
capabilities, and styling contract. Navigation and layouts are data, not hardcoded
application logic.

A separate SolidJS admin console provides catalog and workspace-management flows.
Its compact, shadcn-inspired interface uses Solid-compatible components and shared
theme tokens. Admins can configure the console's own sections and nested navigation
tree by composing registered admin views; this is separate from editing a
workspace's end-user menu. Panel configuration is metadata-driven and cannot inject
arbitrary components, scripts, CSS, or routes. A future content type builder is
another application and publisher, not part of the shell.

The current prototype demonstrates a Solid shell with a production React
federation remote and a Rust/Axum API for persisted application declarations and
workspace menu entries. Planned milestones add Vue interoperability, a searchable
compatible-app catalog, version-pinned workspace installs/upgrades, configurable
chrome and personalization, revisioned publishing, and the editable admin console.

## 3. Tech Stack

- Shell and workspace designer: **SolidJS 2.0**, RC allowed and required if stable
  2.0 is unavailable. Never downgrade to Solid 1.x without explicit user approval.
- Frontend tooling: TypeScript strict mode, Vite, pnpm workspaces. Pin exact
  versions and commit a lockfile during implementation, not during planning.
- Delivery: `@module-federation/enhanced/runtime` in the consuming shell;
  `@module-federation/vite` for demo producers. No federation build plugin is
  required in the shell unless it starts exposing modules, which is out of scope.
- Contracts: JSON Schema with generated TypeScript and precompiled validators.
  A separate handwritten TypeScript lifecycle interface defines the DOM adapter.
- Styling: versioned CSS design tokens and shared control styles; the admin console
  follows shadcn-inspired visual patterns using Solid-compatible components, not
  React shadcn/ui. Scoped light DOM app styling initially. Shadow DOM is a later
  compatibility profile.
- Tests: Vitest and Playwright; axe checks for selected browser journeys.
- Configuration API: Rust with Axum and SQLite via SQLx. The current local
  prototype serves workspace bootstrap reads and token-protected app/menu writes.
- Hosting: static shell and immutable remote assets; one configuration API
  process. Cloud provider and production identity provider are not selected.
- CI/CD: provider-neutral documented commands first. Do not assume GitHub
  Actions, GitLab CI, or a cloud provider before the owner selects one.

## 4. Architecture

```text
App Catalog -----------+
        v
Admin Console ------> Configuration API ----> SQLite
            |                     |
          published snapshot <---------+
            v
Solid 2.0 Shell -- DOM contract + SDK --> installed federated apps / widgets
  |
  +-- routes, workspace menus/layouts, theme, lifecycle, fallback UI

Future Content Builder --> app catalog + workspace configuration
```

The admin console contains catalog and workspace-management views; its configurable
section tree references registered admin views and remains distinct from workspace
menus. Menus reference routes; they do not define routes. The shell owns browser
history. Apps own paths beneath their installation base path through adapters.
Catalog apps, immutable releases, workspace installations, menu entries, and
component instances have separate stable IDs. Context is per mounted instance, not
a global current app.

## 5. Key Files Map

The workspace includes planning artifacts and the implemented local prototype.

| Path | Purpose |
| --- | --- |
| `docs/implementation/plan.md` | Requirements, tasks, dependencies, gates, assignment prompt |
| `docs/implementation/research.md` | Decisions and source links from the architecture investigation |
| `docs/implementation/checkpoints/` | Requirement and task coverage, not runtime completion evidence |
| `apps/shell/` | Solid 2.0 shell and workspace-driven navigation |
| `apps/workspace-designer/` | Future separate designer remote |
| `apps/demo-react/`, `apps/demo-vue/` | Future interoperability fixtures |
| `apps/config-api/` | Rust/Axum local configuration API and SQLite persistence |
| `packages/contracts/`, `packages/sdk/`, `packages/theme/` | Future shared contracts and styles |
| `tests/e2e/` | Future real-browser acceptance journeys |

## 6. Team Roles

- Coordinator/owner: approve gates, assign ready tasks, integrate changes, update status.
- Implementer: one bounded task, its owned files, and its focused validation.
- Reviewer: inspect contract, routing, lifecycle, security, and bundle risks.
- QA: verify milestone journeys and report reproducible defects.

Use lower-cost agents for routine bounded tasks. Use a stronger reviewer for
contract freeze, cross-framework integration, and production security decisions.
No agents have been launched as part of preparing this plan.

## 7. Sprint Status

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Toolchain and contract freeze | Federation proof ready for independent review |
| M1 | Routed cross-framework shell | Not started |
| M2 | Menus, layouts, personalization | Not started |
| M3 | Catalog installs, configurable admin console, designer and persistence | Local app/menu/bootstrap slice implemented; broader scope pending |
| M4 | Release validation and deployment documentation | Not started |

Task checkboxes in the implementation plan are the authoritative completion list.

## 8. Current State

- Working: Solid 2 shell, React federation proof, and local Rust/Axum API.
- Implemented API slice: SQLite-backed application declarations, menu entries,
  workspace bootstrap, and local admin-token protected writes.
- Not implemented: app catalog discovery and compatibility UX, workspace release
  installs/upgrades, editable admin-console sections/tree, production identity,
  multi-workspace tenancy, drafts, revisions, publishing, preferences, and the
  separate admin console/designer.
- Keep T001/T002 review checkboxes and M0/M3 acceptance gates authoritative.
- Environment observed during planning: macOS, Node.js 26.0.0, Docker functional.
  Target Node.js 24 LTS during T001; pnpm and Playwright have not been verified.

## 9. Security Rules

Never commit secrets or ship credentials in snapshots. Browser permission checks
are UX only; the API must enforce authorization. Same-page federated apps are
trusted code, not sandboxed plugins. Only approved publishers may register remote
code. Local demo sessions must be loopback-only and impossible to enable in
production. Production release is blocked until real identity/session integration
and authorization are approved and tested.

## 10. How to Run Locally

Run the API with `cargo run --manifest-path apps/config-api/Cargo.toml` after
setting `MODULAGA_ADMIN_TOKEN` to a local secret of at least 32 characters.
Run the shell with `pnpm dev`. The shell uses port 4300, the demo remote preview
uses 4174, and the API uses 4303. The API refuses non-loopback binding and
refuses non-development mode until a trusted identity provider is configured.

## 11. How to Deploy

Not deployable yet. T027 documents static asset delivery, SPA route fallback,
immutable remote releases, configuration API storage, TLS, allowed origins,
cache rules, and rollback. Deployment provider and CI configuration are deferred
until selected by the owner. Do not describe local demo auth as production-ready.

## 12. Cross-Chat Handoff Protocol

Before starting, read this brief and only the selected task plus its dependencies
and cited contract sections. Check task readiness and the working tree. Do not
repeat the original web research unless a concrete compatibility question remains.

Every task response must include: task ID; changed files; commands actually run;
pass/fail/skip counts; acceptance results; open blockers; and suggested next ready
task IDs. Never claim an unrun test passed. A blocked task stays unchecked.

The coordinator marks task checkboxes only after accepting evidence, updates
milestone status and this document's Current State section at each milestone, and
passes the updated files to subsequent chats. When execution begins, record concise
handoffs in `docs/implementation/handoffs/Txxx.md`; those files do not exist yet.
Do not commit, push, create branches, or open PRs unless the user authorizes it.

## 13. Bug & Fix Tracking

Until a remote issue tracker is selected, record blockers and bugs in task
handoffs with IDs such as `BUG-T011-01`, reproduction steps, expected behavior,
actual behavior, severity, and ownership. Link duplicate reports rather than
creating conflicting fixes. New unrelated ideas belong in a handoff's Deferred
section, not in the current task's implementation. A coordinator may migrate this
tracking to an approved issue tracker later; no external issues are created now.

## 14. Multi-Repo Setup

Use one pnpm monorepo for the initial implementation. Separately deployed apps
remain separate builds, even when their demo sources share a repository.

Default to serial task assignment in this VS Code workspace. For true parallel
work, the user/coordinator prepares separate clones or worktrees from the same
accepted base revision. Do not launch writers in the same working tree. Agents
must not create clones, branches, or worktrees without authorization.

Only tasks marked parallel-ready may run concurrently, and their file ownership
must not overlap. Root manifests, the lockfile, shared contracts, and central
composition files are coordinator-owned shared resources: one writer at a time.
The coordinator integrates each result, validates the combined tree, and then
assigns dependent tasks. Do not rebase, reset, or overwrite other agents' work.