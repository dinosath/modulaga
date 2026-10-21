# Modulaga Implementation Plan

> Superseded implementation plan. It predates the Rust/ConnectRPC and FerrisKey POC; use [the current architecture](../architecture/architecture.md) and [README](../../README.md).

Date: 2026-09-30. Status: active implementation; T001/T002 remain subject to their review gates.

## Summary

Build a lightweight **SolidJS 2.0** microfrontend workspace platform with a
compatible-app catalog, workspace installations, a configuration-driven shell,
and a separate admin console. Catalog releases are distinct from workspace
installations. Deliver a working vertical slice before the full designer or
configuration service. The content type builder is excluded; only its future
publication boundary is documented. Solid 1.x is not an approved fallback,
including during a failed spike.

Design inputs: the previous architecture recommendation, `PROJECT_BRIEF.md`, and
`research.md`. This is a greenfield plan, not a legacy migration. Requirements below
are the task-assignment baseline derived from that discussion. Schema details are
implemented and reviewed in T003/T004 before dependent agents proceed.

## Technical Context And Constraints

- TypeScript strict mode; pnpm workspaces; Vite; Node.js 24 LTS target.
- SolidJS 2.0 shell/designer; exact compatible package versions established in T001.
- Shell consumes `@module-federation/enhanced/runtime`; producers use their matching
  federation build plugin. Verify real production builds, not just Vite dev mode.
- Framework-neutral DOM adapters, shell-owned browser history, per-instance SDK.
- Canonical JSON Schema for configuration; generated TS types and standalone Ajv
  validators avoid shipping the Ajv schema compiler in initial browser chunks.
- CSS design system; light DOM and scoped application CSS first. The admin console
  uses a shadcn-inspired management UI built with Solid-compatible components and
  shared tokens; React shadcn/ui is not a shell dependency. Native controls share
  styles; third-party UI libraries require explicit token mappings.
- Vitest for unit/contract tests; Playwright for browser journeys. Tests are part
  of task acceptance, even though this is not a migration workflow.
- Frontend milestones use deterministic fixtures and local-only preferences.
  M3 configuration service uses Rust/Axum/SQLite per the owner's updated
  direction. No cloud, Kubernetes, real app business backends, SSR,
  Angular demo, arbitrary user JS/CSS, or sandboxed third-party plugin platform.
- Initial proposed budget: empty-shell startup <= 150 KiB gzip JS and <= 30 KiB
  gzip CSS, measured across all initially fetched shell chunks. Count initial
  federation and shared chunks too; report active-route app bytes separately.
  Exclude source maps, but report fonts/images separately. Owner approval is
  required to increase the budget; never exclude bytes merely to make it pass.

## Principles Check

| Principle | Plan treatment |
| --- | --- |
| Solid 2.0 is mandatory | T001/T002 block instead of falling back to 1.x |
| Shell stays small | Editors/frameworks load on demand; T028 measures bytes |
| Apps remain independent | DOM contract, versioned releases, no compulsory shared framework |
| Styling comes from shell | Shared versioned tokens and control styles, T005/T026 |
| Configuration cannot escalate access | Capability checks, allowlists, server authorization in M3 |
| Future builder stays separate | T029 documents publication; no builder implementation |
| Catalog and install are separate | T003/T019 model immutable catalog releases separately from workspace installations |
| Admin composition is bounded | T026 composes registered admin views; it cannot inject arbitrary UI code |
| Agent assignments remain bounded | Explicit ownership, dependencies, focused checks, escalation rules |

Applied guidelines: greenfield platform conventions from the preceding design,
the design-system three-layer token approach, and the orchestration handoff
protocol. Migration/transformation guidelines do not apply to this empty repo.

## Requirements

| ID | Requirement |
| --- | --- |
| REQ-001 | Shell uses SolidJS 2.0, including RC, with verified pinned tooling |
| REQ-002 | Discover and lazy-load approved independently built federated releases |
| REQ-003 | Host multiple frameworks and multiple independent component instances |
| REQ-004 | Configure menu definitions, entries, nesting, ordering, icons, and visibility |
| REQ-005 | Configure menu placement, presentation, responsive behavior, and accessibility |
| REQ-006 | Configure shell layouts, named regions, and component assignments |
| REQ-007 | Apply allowed user preferences without changing shared defaults or permissions |
| REQ-008 | Shell provides versioned theme tokens and consistent control styling |
| REQ-009 | Stable routes, deep links, back/forward, navigation guards, and focus restoration |
| REQ-010 | Separate designer supports editing, preview, validation, publication, and rollback |
| REQ-011 | Persist configurations/preferences and enforce publishing/access policy server-side |
| REQ-012 | Handle invalid config, remote failures, stale loads, and lifecycle cleanup |
| REQ-013 | Enforce lightweight loading, bundle budgets, reproducible builds, and acceptance evidence |
| REQ-014 | Document integration/publication contract for a separate future content builder |
| REQ-015 | Browse compatible catalog apps and install, pin, upgrade, or uninstall releases per workspace |
| REQ-016 | Dynamically configure the admin console's sections and nested navigation tree |
| REQ-017 | Provide an accessible, shadcn-inspired admin experience without requiring React UI components |

## Execution Protocol

1. Assign one ready task per agent. Read only the brief, selected task, its design
   sections, and accepted dependency handoffs. Do not ask each agent to investigate
   Module Federation or OneCX again.
2. A dependency must be accepted before a task starts. T003/T004 require contract
   freeze approval. Milestone gates are not automatic consequences of checkboxes.
3. Lower-cost agents implement routine tasks. A stronger reviewer/owner approves
   M0, M1 interoperability, and M3 security boundaries. No agents are spawned by
   this plan; the user assigns them later.
4. Only `[P]` tasks with disjoint ownership may run in parallel, in separate prepared
   worktrees/clones. One writer owns root manifests, lockfile, shared contracts,
   and central shell/designer composition. Request integration changes through
   the coordinator rather than editing those files concurrently.
5. Start with the smallest behavior-scoped change and immediately run its focused
   check. Stop after two unsuccessful approaches to the same blocker; report the
   evidence rather than inventing another architecture or installing alternatives.
6. Never change frozen contracts, remove tests, downgrade Solid, expand scope,
   raise budgets, commit, push, or create branches without explicit authorization.
7. Every completed task produces a short `handoffs/Txxx.md` with changed files,
   commands actually run, pass/fail/skip counts, criterion results, and blockers.
   The coordinator alone updates task checkboxes and the brief's milestone status.

### Copy-Paste Assignment Prompt

```text
Implement TASK_ID from docs/implementation/plan.md.
Read PROJECT_BRIEF.md, the selected task, the contract baseline sections it uses,
and the accepted handoffs for its dependencies. Do not re-research the whole repo.
Confirm dependencies are accepted. Work only in the task's owned files. You may
add nearby tests and update your own package manifest serially, but root manifests,
the lockfile, frozen contracts, and central composition require coordinator ownership.
Use SolidJS 2.0 for Solid code, even if an RC is required. Never downgrade to 1.x.
Make the smallest complete change, run the task's focused checks, and report results.
Do not skip tests, widen scope, commit, push, or create branches without authorization.
After two failed approaches to a blocker, stop and provide the exact evidence.
Write docs/implementation/handoffs/TASK_ID.md with: status; files changed; commands;
pass/fail/skip counts; acceptance results; unresolved risks; and next ready task IDs.
Leave the task unchecked if blocked. Do not modify another agent's handoff.
```

Replace `TASK_ID` with one concrete ID such as `T005`. Specify a prepared workspace
when running parallel agents; a prompt alone does not isolate their file writes.

## Contract Baseline

### Configuration

T003 implements separate catalog app, immutable app release, workspace installation,
route, menu, placement, layout, slot binding, theme reference, preference, and admin
navigation schemas. Every configuration has a `schemaVersion`; each app release
declares the Modulaga integration/lifecycle contract, federation format, minimum
shell version, supported remote type, required capabilities, and design-system
compatibility. A release descriptor references a real `mf-manifest.json` and
exposed module, not a bespoke replacement for the federation manifest. Published
assets and metadata are immutable and carry a stable release ID and integrity
reference.

Catalog apps have stable identity and publisher metadata; versioned releases belong
to an app. A workspace installation references one exact release ID, has a unique
validated base path, and may carry schema-validated install settings. Installation
requires an approved publisher/origin and a successful compatibility check.
Upgrades explicitly change the pinned release; uninstalling removes the workspace
association without deleting the catalog release. Shell bootstrap is derived from
workspace installations and never eagerly downloads the full catalog.

The admin console has a data-driven section tree separate from each workspace's
end-user menu. Nodes are groups or references to registered admin views, with stable
IDs, parent, order, labels, and capability requirements. Authorized admins may add,
rename, remove, reorder, and nest allowed nodes through revisioned configuration;
they cannot register arbitrary components, scripts, or routes. Workspace menu entries use
stable IDs and a discriminated type: group, internal route, or approved external
link. Optional localized label keys are strings, not executable templates. Internal
entries reference route IDs and validated parameters, not free-form JavaScript.
Menu placements independently reference menu IDs, regions, renderer modes, and
breakpoints. Removing a menu item does not unregister its application route.

Layouts are bounded templates: single-column, split-pane, or dashboard grid.
Named regions bind installed components through unique instance IDs and validated
settings. Define deterministic breakpoint/order behavior and reject impossible
placements. Do not build a free-form page designer or app-internal layout engine.

Effective config = defaults + allowed stable-ID user overrides, followed by policy
and permissions enforcement. Unknown/deleted override IDs are ignored with a
diagnostic. A user override cannot change catalog URLs, install apps, or grant access.
Reject broken references, duplicate IDs, ambiguous routes, menu cycles, unsafe URL
schemes, invalid settings, unsupported versions, and non-allowlisted publishers.

### DOM Lifecycle And SDK

T004 freezes a plain TypeScript `AppModule` with `mount(container, input)` returning
an instance handle with `update(input)` and `unmount()`. No Solid signals, React
nodes, framework routers, or global singleton current-app state cross this boundary.
Require a declared contract version and runtime shape checks before mounting.

Inputs contain instance ID, installation ID, immutable settings, route snapshot,
base path, SDK context, and an AbortSignal for lifecycle cancellation. Module
loading may not be abortable: discard stale results, and unmount late-created
handles. Serialize each handle's update/unmount operations; define partial-mount
cleanup and idempotent teardown. Each component instance owns its subscriptions.

The shell creates per-instance contexts for reading/subscribing to locale, theme,
workspace identity, permissions, route, and display metadata; requesting navigation
and notifications; and reporting remote errors. Pass plain values/functions, not a
shared framework store. Subscription APIs return disposers. Cross-app business
events are optional, typed, namespaced, and never the authoritative data store.

The shell owns history and supplies the complete location snapshot including
query/hash. Remote adapters translate app-local memory routes. Preserve real anchor
URLs and modifier-click behavior. Define no-op/replace/push semantics, route params,
deep-link server fallback, unsaved-change guards, and focus restoration. Remote
framework boundaries report their errors; Solid's boundary is not a universal catch.

### Styling And Trust

Use `--mg-*` primitive, semantic, and control tokens, versioned with the shared
styles. Shell sets theme/density once; app-specific CSS is scoped and token-based.
No app-level body/html resets or global utility preflight. Native controls share
styles; third-party components declare mappings. No arbitrary CSS or JS in config.
Shadow DOM support is deferred and must later install shared sheets inside roots.

Federated JavaScript runs with shell-page privileges. Approval, origin/publisher
allowlists, and backend authorization are required, not optional sandbox substitutes.
A future untrusted extension must use a separately designed iframe boundary.

## Implementation Steps And Tasks

All file paths below are planned paths. Focused commands become available during
T001/T003 scaffolding; they are not currently executable. Each implementer adds
tests beside its code and reports their results. `[P]` means potentially parallel
only after dependencies are accepted and shared integration edits are serialized.

### Phase 0: Toolchain And Contract Freeze (M0)

Plan item **0.1**: verify tooling and establish the reproducible shell foundation.
Requirements: REQ-001, REQ-002, REQ-013. Inputs: Technical Context, research.md.

- [ ] T001 [Plan:0.1] Scaffold pnpm/Vite/Solid 2.0 in `apps/shell/` and root workspace/test configuration.
  - Depends on: none. Agent: implementer; serial root-file ownership.
  - Owns: root manifests/lockfile, Node version file, TS/Vitest config, `apps/shell/package.json`, `apps/shell/src/main.tsx`, minimal `App.tsx`.
  - Deliver: exact compatible Solid 2.0/compiler/Vite versions, strict TS, `pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm build`. Target Node 24 rather than assuming planning-time Node 26 is supported. Use current official 2.0 APIs, not guessed 1.x equivalents.
  - Check: cold install and shell startup/render test; `pnpm --filter @modulaga/shell typecheck`, `test`, and `build`.
  - Accept: minimal shell renders from a production build; exact versions recorded; no 1.x fallback; no unnecessary UI/router dependency.

- [ ] T002 [Plan:0.1] Prove runtime federation in `apps/shell/src/probe/` with a minimal React producer in `apps/demo-react/`.
  - Depends on: T001. Agent: implementer plus interoperability reviewer.
  - Owns: temporary shell probe, demo React producer scaffold, probe test, `handoffs/T002.md`; coordinate root scripts/lockfile changes.
  - Deliver: shell uses runtime `createInstance`/`loadRemote` to mount a real producer module. Keep the probe producer as the seed for T008; remove temporary shell probe during T011 integration.
  - Check: build both apps, serve static outputs on separate ports, mount/unmount/reload through the browser. Establish `pnpm test:spike` as the reproducible command.
  - Accept: federation manifest, chunks, framework rendering, and CSS work in built outputs without importing React into the shell source. Record exact versions, origins, and request evidence. On incompatibility, block while retaining Solid 2.0.

Plan item **0.2**: freeze serializable configuration and framework-neutral lifecycle.
Requirements: REQ-002 through REQ-012, REQ-014 through REQ-017. Inputs: Contract Baseline.

- [ ] T003 [Plan:0.2] Implement canonical config schemas/types in `packages/contracts/src/config/` and fixtures in `fixtures/workspaces/`.
  - Depends on: T002. Agent: contract implementer; mandatory owner/reviewer freeze.
  - Owns: contracts package scaffold, JSON schemas, generated-type/validator build, example catalog/workspace/preferences, `docs/contracts/configuration.md`.
  - Deliver: catalog app/release, workspace installation, admin navigation, and shell configuration shapes from Configuration baseline; generation scripts, runtime structural validators, named exports, positive and negative fixtures. Export generated TS and precompiled validators; do not ship an Ajv schema compiler in the shell.
  - Check: `pnpm --filter @modulaga/contracts test` and `build`; valid fixtures round-trip and invalid shape/version fixtures fail.
  - Accept: entity IDs/relations, release compatibility/integrity fields, workspace release pinning, admin view/node constraints and scope, three layout templates, four placement regions, allowed menu modes, settings schema references, revision/preference semantics documented. Semantic cross-reference checking belongs to T006.

- [ ] T004 [Plan:0.2] Freeze `packages/contracts/src/lifecycle.ts` and implement instance SDK in `packages/sdk/src/`.
  - Depends on: T003. Agent: contract/SDK implementer; mandatory owner/reviewer freeze.
  - Owns: lifecycle types and guards, SDK context/disposers, context tests, `docs/contracts/integration.md`.
  - Deliver: lifecycle, version checks, cancellation/update rules, route/navigation interfaces, and instance-scoped read/subscribe functions from the baseline.
  - Check: `pnpm --filter @modulaga/contracts test`; `pnpm --filter @modulaga/sdk test` and `typecheck`.
  - Accept: two SDK instances remain independent, disposal is idempotent, no framework runtime is imported, and error/navigation/guard ownership is explicit. Owner freezes exports before M1 tasks.

M0 gate: T001-T004 accepted; owner approves contract exports and actual Solid 2.0
federation evidence. Do not assign downstream agents against unfinished contracts.

### Phase 1: Routed Cross-Framework Shell (M1)

Plan item **1.1**: establish styling, config resolution, and remote loading.
Requirements: REQ-002, REQ-003, REQ-007, REQ-008, REQ-011, REQ-012, REQ-013.
Inputs: frozen configuration/lifecycle and Styling And Trust baseline.

- [ ] T005 [P] [Plan:1.1] Implement tokens and control styles in `packages/theme/src/`.
  - Depends on: T004. Owns: theme package, light/dark and density CSS, native-control examples/tests.
  - Deliver: three token layers, prefixed controls, typography/focus/motion rules, no global utility reset. No framework UI toolkit in the theme package.
  - Check: theme build plus CSS/token tests; record computed-style examples for later T012 browser validation.
  - Accept: semantic tokens determine visual changes; controls have keyboard focus and disabled/error states; CSS remains under the proposed startup budget.

- [ ] T006 [P] [Plan:1.1] Implement semantic validation and preference resolution in `packages/contracts/src/resolution/`.
  - Depends on: T004. Owns: config cross-reference validator, effective-config resolver, resolver tests.
  - Deliver: reject cycles/duplicate IDs/bad references/conflicting routes/unsafe links/unsupported versions; apply overrides by stable ID under policy. Prune empty permission-filtered groups; ignore deleted override IDs with diagnostics.
  - Check: `pnpm --filter @modulaga/contracts test` covering all listed rejection paths and non-escalation.
  - Accept: deterministic immutable output; preferences cannot change code URLs/access; hidden navigation does not delete valid routes. This task is authorized to add planned resolution exports, not alter frozen entity shapes.

- [ ] T007 [P] [Plan:1.1] Implement catalog loader in `apps/shell/src/federation/`.
  - Depends on: T004. Owns: runtime wrapper, release registry, remote shape checks, bounded load retry/timeouts, unit tests.
  - Deliver: register approved descriptors, lazy load exposes, validate lifecycle/version, deduplicate concurrent loads, session-pin releases. No forced runtime replacement of already mounted releases.
  - Check: shell unit tests for success, unavailable manifest, invalid export/version, timeout, duplicate requests, rejected origin.
  - Accept: no remote requested until needed, no framework imports, bounded failure behavior. Unit fakes supplement, never replace, T002/T012 real federation.

Plan item **1.2**: integrate framework adapters and deterministic navigation.
Requirements: REQ-003, REQ-008, REQ-009, REQ-012. Inputs: frozen integration contract.

- [ ] T008 [P] [Plan:1.2] Expand `apps/demo-react/` with routed app and reusable counter widget adapters.
  - Depends on: T004, T005. Owns: React demo source/exposes and its adapter tests.
  - Deliver: mount/update/unmount, two internal routes, input/settings updates, instance-local state, framework error reporting, shell token/control styling. Keep React dependencies local initially.
  - Check: React adapter tests/typecheck/build; widget can mount twice with independent state and complete cleanup.
  - Accept: obeys SDK navigation/disposal contract; no global reset or own browser-history owner; no shell framework dependency.

- [ ] T009 [P] [Plan:1.2] Implement equivalent Vue producer in `apps/demo-vue/`.
  - Depends on: T004, T005. Owns: Vue demo source/exposes and adapter tests.
  - Deliver/check: same lifecycle/routing/styling/error coverage as T008, using Vue and app-local memory routing.
  - Accept: Vue works through the same public contract without React/Solid-specific host logic. Declare package dependencies through the coordinator to serialize the lockfile.

- [ ] T010 [P] [Plan:1.2] Implement route ownership in `apps/shell/src/routing/`.
  - Depends on: T004, T006. Owns: route matcher, history adapter, guards, URL resolution, routing tests.
  - Deliver: workspace/install base paths, route IDs/params, segment-boundary matching, query/hash preservation, back/forward, no-op/replace/push, unsaved-change guards, anchor modifier-click support.
  - Check: unit tests including nested paths, invalid params, ambiguous patterns, guard cancellation, and app-local navigation loops.
  - Accept: exactly one browser-history owner; menu edits cannot alter route addresses; focus intent is returned for T011 to apply.

- [ ] T011 [Plan:1.2] Implement instance hosting in `apps/shell/src/host/` and integrate `apps/shell/src/App.tsx`.
  - Depends on: T005, T006, T007, T008, T009, T010. Agent: serial integration implementer.
  - Owns: bootstrap fixture fetch, app/component host, fallback/status UI, theme application, central App composition, host tests, removal of temporary T002 probe.
  - Deliver: complete config/load/mount path, per-instance context, serialized lifecycle, stale-load discard/late-handle cleanup, route updates, disposal, focus restoration, failure rendering without losing shell navigation.
  - Check: shell tests/typecheck/build, including rapid A-B-A navigation, partial mount failure, repeated unmount, and error reporting from each remote framework.
  - Accept: no leaked subscriptions or stale screen overwrite; widget instance contexts are not confused with routed app context; unknown route/denied route/loading/error states exist.

Plan item **1.3**: verify the first vertical slice in production outputs.
Requirements: REQ-001, REQ-002, REQ-003, REQ-008, REQ-009, REQ-012, REQ-013.

- [ ] T012 [Plan:1.3] Add `tests/e2e/interoperability.spec.ts` and production-build browser harness.
  - Depends on: T011. Agent: QA/integration reviewer; serialize root E2E config/scripts.
  - Owns: Playwright scaffold, production static-server harness, interoperability/theme/failure journeys.
  - Check: `pnpm build` then `pnpm test:e2e --project=chromium tests/e2e/interoperability.spec.ts`.
  - Accept: Solid shell + React app + Vue app; two React widgets with independent state; shared styles/theme change; direct deep link and refresh; back/forward; unavailable remote fallback; stale navigation cleanup. Record network and console evidence, not screenshots alone.

M1 gate: real built remotes passed, not just mocked imports. Pause for owner review
before investing in the workspace designer. This is the first useful demonstrator.

### Phase 2: Configurable Chrome And Personalization (M2)

Plan item **2.1**: configurable menu data and accessible placements.
Requirements: REQ-004, REQ-005, REQ-007, REQ-009. Inputs: frozen menus/placements.

- [ ] T013 [P] [Plan:2.1] Implement menu model projection in `apps/shell/src/navigation/model/`.
  - Depends on: T012. Owns: derived menu trees, active-entry projection, menu commands, tests.
  - Deliver: nested groups, order/icons/labels, route links, approved external links, hidden/favorite entries, filtered empty groups, active-state selection independent of placement.
  - Check: shell menu model tests; changing menus never changes router registrations.
  - Accept: stable IDs throughout; invalid/denied targets cannot become clickable through overrides.

- [ ] T014 [Plan:2.1] Implement menu renderers/placements in `apps/shell/src/navigation/ui/`.
  - Depends on: T013. Owns: tree/rail/horizontal/drawer renderers, responsive region styles, interaction tests.
  - Deliver: configurable top/left/right/bottom placement, overflow behavior, mobile drawer fallback, collapsed state, keyboard access, labels/tooltips, focus return. Use nav/link/disclosure semantics, not unnecessary ARIA application-menu roles.
  - Check: shell interaction tests and a focused browser navigation journey at 1440x900, 768x1024, and 390x844.
  - Accept: entries/regions never overlap; repositioning or resizing preserves URLs and active entry; all reachable entries remain keyboard operable.

Plan item **2.2**: bounded layouts and allowed persistent personalization.
Requirements: REQ-003, REQ-006, REQ-007, REQ-008, REQ-012.

- [ ] T015 [P] [Plan:2.2] Implement layouts/regions in `apps/shell/src/layout/`.
  - Depends on: T012. Owns: single-column/split-pane/dashboard renderers, region/slot bindings, layout tests.
  - Deliver: stable tracks, responsive stacking, named-region instances, deterministic ordering, per-region failure isolation, visible-region lazy loading, disposal when assignments disappear.
  - Check: shell layout tests and focused browser slot journey with two independently configured widgets.
  - Accept: layout changes do not restart unchanged keyed instances; removed instances dispose; failed widget does not blank the route or siblings. No app-internal DOM rearrangement.

- [ ] T016 [P] [Plan:2.2] Implement preferences in `apps/shell/src/preferences/`.
  - Depends on: T012. Owns: preference store/storage adapter, controls, preference tests.
  - Deliver: choose allowed menu/mode/placement/layout/theme/density, favorites, reorder/hide, restore defaults. Persist by user+workspace+schema version in localStorage only in fixture mode; expose an adapter for the later API.
  - Check: preference tests for reload, reset, denied changes, obsolete IDs, corrupt storage, and multiple demo users/workspaces.
  - Accept: shared defaults stay unchanged; no remote URLs or permissions can be overridden. Clearly mark fixture identities as development-only.

- [ ] T017 [Plan:2.2] Integrate configurable chrome in `apps/shell/src/App.tsx`.
  - Depends on: T014, T015, T016. Agent: serial integration implementer.
  - Owns: central composition, responsive shell CSS, integrated menu/layout/preference E2E specs.
  - Check: shell tests/build and focused Playwright personalization/layout/navigation journeys.
  - Accept: user chooses/reorders entries, places menus, changes layout and theme, reloads preferences, restores defaults, and retains direct route access. Verify keyboard flow and no overlap at all three viewports.

M2 gate: all shell customization works without the designer bundle or API. Owner
accepts the supported configuration surface before its editing UI is built.

### Phase 3: Workspace Designer And Persistence (M3)

Plan item **3.1**: a minimal configuration service with explicit identity boundary.
Requirements: REQ-002, REQ-007, REQ-010, REQ-011, REQ-012.

- [ ] T018 [Plan:3.1] Define HTTP API/session authorization contract in `packages/contracts/src/http/` and `docs/contracts/http.md`.
  - Depends on: T017. Agent: contract implementer plus security reviewer; serial export changes.
  - Owns: request/response schemas, permission vocabulary, session interface, API fixtures.
  - Deliver: searchable catalog/release detail and compatibility reads; workspace installation, upgrade, and uninstall draft operations; published-workspace reads; revisioned admin-navigation configuration; draft writes with If-Match revision; preview validation; publish; rollback creating a new published revision; scoped preferences GET/PUT. Define catalog and admin-panel configuration scope, 400/401/403/404/409/412 responses, and CSRF handling for cookie sessions.
  - Check: contracts tests covering valid/invalid DTOs, revision conflicts, and forbidden request fields.
  - Accept: server derives user/tenant/capabilities from a trusted session, never request-provided identity; install operations target an authorized workspace and an approved compatible release. Freeze this contract before T019/T020/T023/T025/T026. Production provider integration is a release gate, not an assumed completed feature.

- [ ] T019 [P] [Plan:3.1] Implement SQLite repositories in `apps/config-api/src/storage/`.
  - Depends on: T018. Owns: config-api package scaffold, migrations, repositories, storage tests.
  - Deliver: immutable catalog releases, workspace-to-release installation pins, immutable workspace revisions, mutable drafts, scoped admin-navigation configuration and preferences, optimistic concurrency, atomic publication, bounded revision retention policy. Do not prune an active referenced release.
  - Check: config-api storage tests on fresh temporary real SQLite files, concurrent-write conflicts, release pin updates/removal, restart persistence, and rollback history.
  - Accept: deterministic migrations; no shared test database; no lost updates. Coordinate package/root/lockfile changes serially.

- [ ] T020 [Plan:3.1] Implement Axum endpoints/policy in `apps/config-api/src/`.
  - Depends on: T019. Owns: HTTP handlers, session adapter boundary, authorization, bootstrap snapshot, API tests.
  - Deliver: validate with frozen contracts/resolver; enforce catalog publisher/origin approval, release compatibility, workspace authorization, and admin-view capability policy on reads and writes; validate draft settings; apply request limits, CSRF/origin policy, and cache separation for user data. Provide loopback-only seeded demo sessions for local tests; reject demo mode outside development/test.
  - Check: `cargo test --manifest-path apps/config-api/Cargo.toml` with real SQLite and Axum requests, including unauthorized writes and cross-user/tenant access attempts.
  - Accept: non-admin cannot publish/register executable URLs, install unapproved/incompatible releases, or modify admin navigation; direct HTTP requests cannot bypass UI policy; transaction failures leave prior publication intact. Missing real identity provider is explicitly reported as a production blocker.

Owner-directed implementation note: the current Rust/Axum slice implements
application registration, menu-entry registration/removal, and a public
workspace bootstrap for one local workspace. Writes require a local admin
bearer token; manifests are restricted to loopback origins. This does not
complete T018-T020's draft/revision/publish/preferences contract or its
production identity and authorization gates. Their task checkboxes remain
unchecked until those acceptance criteria are met.

Plan item **3.2**: separately loaded editing, preview, and publication workflows.
Requirements: REQ-001, REQ-004, REQ-005, REQ-006, REQ-008, REQ-010, REQ-011.

- [ ] T021 [P] [Plan:3.2] Scaffold the Solid 2.0 designer remote and API client in `apps/workspace-designer/`.
  - Depends on: T018. Owns: designer scaffold, federation adapter, HTTP client, draft/session state, tests.
  - Deliver: separate built remote consuming frozen SDK/contracts/theme; typed client operations for catalog/compatibility reads, workspace-install draft operations, admin-navigation drafts, preview/publish/rollback; API error/concurrency presentation; no bundling into shell entry.
  - Check: designer typecheck/test/build; mocked HTTP contract tests and real shell loading at integration.
  - Accept: uses pinned Solid 2.0; no shared Solid singleton is required; client cannot select its identity or bypass authorization.

- [ ] T022 [Plan:3.2] Implement menu/layout/theme editors in `apps/workspace-designer/src/editors/`.
  - Depends on: T021. Owns: menu tree/placement editor, layout/slot editor, allowed theme/settings editor, tests.
  - Deliver: create/edit/delete/order entries, select routes/approved apps, choose positions/renderers/templates, assign components with instance IDs, edit schema-valid settings. Provide keyboard reorder controls, validation messages, undo within the draft, and unsaved-change guard.
  - Check: designer unit/interaction tests for invalid references, deleting used entities, cycle prevention, denied controls, and undo.
  - Accept: no raw JS/CSS editing, no free-form page builder, and no remote code registration by unapproved users. Preserve stable IDs when editing.

- [ ] T023 [Plan:3.2] Integrate persistence into `apps/shell/src/config/` and implement preview/publish in `apps/workspace-designer/src/publishing/`.
  - Depends on: T020, T022. Agent: serial integration implementer.
  - Owns: shell API snapshot/preference adapter wiring, designer publishing controls, isolated preview route/bootstrap, integration tests.
  - Deliver: API-backed startup/preferences, isolated draft preview that cannot mutate the live workspace, conflict handling, publish and rollback with new revisions. Preview may load approved apps only; avoid a second nested shell in the live DOM.
  - Check: focused shell/designer tests and browser edit-preview-publish-reload-rollback journey.
  - Accept: draft never changes other users' published config; stale draft cannot overwrite a newer revision; session-pinned remote releases do not hot-swap active code; user changes appear safely after a configured reload/refresh boundary.

- [ ] T024 [Plan:3.2] Verify persistence/security journeys in `tests/e2e/workspace-designer.spec.ts` and config-api integration tests.
  - Depends on: T023. Agent: QA/security reviewer.
  - Owns: designer/persistence/concurrency tests and security handoff evidence.
  - Check: built shell/designer/remotes + real API/temp SQLite; browser publish/rollback/preferences/restart; direct HTTP authorization and cross-tenant checks.
  - Accept: permitted editor succeeds; viewer fails via both UI and API; conflicts are visible; restart preserves state; failed publication leaves the prior revision usable. Clearly state that seeded demo sessions do not prove production authentication.

Plan item **3.3**: discover compatible releases and manage workspace installations.
Requirements: REQ-002, REQ-011, REQ-012, REQ-015.

- [ ] T025 [Plan:3.3] Implement the app catalog and workspace-install workflow in `apps/workspace-designer/src/catalog/`.
  - Depends on: T020, T023, T024. Owns: catalog browse/detail views, compatibility presentation, installation management UI, focused tests.
  - Deliver: search/filter published apps; show publisher, release, required capabilities, supported shell/contract versions, and compatibility reasons; select a workspace and install an exact compatible release into its draft; manage installed apps, explicitly pin upgrades, and remove installations with route/placement dependency checks. Reuse the frozen API client and publication flow; do not preload catalog remotes.
  - Check: designer tests and a browser journey for browse, compatible install, incompatible-release rejection, pinned upgrade, uninstall, publish, and rollback.
  - Accept: only approved compatible releases can be installed; conflicts and required cleanup are clear before draft changes; unpublished operations never alter the live workspace; catalog releases remain available after uninstall.

Plan item **3.4**: build the admin console and editable navigation tree.
Requirements: REQ-008, REQ-010, REQ-011, REQ-016, REQ-017.

- [ ] T026 [Plan:3.4] Implement the configurable admin console in `apps/workspace-designer/src/admin-navigation/`.
  - Depends on: T005, T022, T023, T025. Owns: admin-console composition/styling, registered-view registry, section-tree editor, interaction tests.
  - Deliver: a compact, shadcn-inspired management interface implemented with Solid-compatible components and shared theme tokens; configurable admin sections/groups with stable IDs, add/edit/remove/reorder/nest controls, and navigation to registered admin views. Persist edits through the revisioned draft/preview/publish flow. Keep admin navigation separate from the workspace's end-user menu.
  - Check: designer and tree interaction tests plus a keyboard-accessible browser edit-preview-publish-reload journey at desktop and mobile viewports.
  - Accept: published navigation changes appear without a rebuild; only registered views and authorized capabilities are addressable; admin structure is scoped and authorized per T018; no arbitrary component, script, CSS, or route injection. Preserve focus and avoid overflow/overlap.

M3 gate: API authorization and persistence, catalog installation workflows, and
configurable admin navigation are accepted. Do not expose the local/demo platform
publicly. Real identity/session provider and production threat review require owner
decisions and a subsequent explicitly scoped integration task.

### Phase 4: Release Validation And Handoff (M4)

Plan item **4.1**: validate usability, loading cost, and release operations.
Requirements: REQ-001 through REQ-017. Inputs: all accepted milestone handoffs.

- [ ] T027 [P] [Plan:4.1] Verify accessibility/responsiveness/styling in `tests/e2e/accessibility.spec.ts`.
  - Depends on: T026. Agent: QA plus focused UI fixes; coordinate owners for fixes.
  - Owns: accessibility E2E and evidence; changes outside tests require explicit ownership assignment.
  - Check: keyboard-only menus/drawers/editor reorder/dialog/guard flows; focused axe checks; light/dark/density and contrast samples; screenshots at 1440x900, 768x1024, 390x844.
  - Accept: no serious/critical automated findings; no overflow/occlusion; usable focus and announcements. Automated results are not a claim of complete WCAG compliance.

- [ ] T028 [P] [Plan:4.1] Implement bundle/request budgets in `scripts/check-budgets.mjs` and `tests/e2e/loading.spec.ts`.
  - Depends on: T026. Owns: budget script, loading/performance tests, build evidence.
  - Check: `pnpm check:budgets`; browser request assertions for shell-only start, first app, revisit, designer activation, and hidden/offscreen slots. Measure all startup chunks per Technical Context.
  - Accept: proposed gzip limits met; no React/Vue/designer fetched before use; no eager catalog-wide preload; cache revisit explained; repeated 50 mount/unmount cycles leave no owned subscriptions/handles. Report retained JS/module-cache growth honestly, not as guaranteed unload.

- [ ] T029 [Plan:4.1] Document deployment, app onboarding, and builder publication in `docs/deployment.md` and `docs/integration.md`.
  - Depends on: T027, T028. Agent: documentation/release reviewer.
  - Owns: deployment/integration docs, README run instructions, final acceptance report; serialize root script/document changes.
  - Deliver: canonical commands, static deep-link fallback, asset public paths/CORS/CSP, session/cache boundaries, immutable deploy/rollback, API storage backup, app/component descriptor walkthrough, producer compatibility matrix, supported UI styling contract, future builder registration/install flow.
  - Check: clean install, typecheck, unit/API tests, build, browser suite, budgets; record precise versions and environment in `handoffs/T029.md`.
  - Accept: every requirement has accepted evidence; generated/builder apps use the same contracts; no builder code added. List production blockers (identity provider, hosting/CI decisions, security review). Do not claim production readiness while any required blocker remains.

M4 gate: demonstrator accepted with documented deployment prerequisites. A
production release requires the separate identity/session integration and security
approval described above; marking T029 complete does not waive those prerequisites.

## Dependency Batches

| Batch | Ready tasks | Integration/approval boundary |
| --- | --- | --- |
| 1 | T001 -> T002 -> T003 -> T004 | Serial; M0 contract freeze |
| 2 | T005, T006, T007 | Disjoint packages/loader; root edits serialized |
| 3 | T008, T009, T010 | T010 needs T006; producer tasks need T005 |
| 4 | T011 -> T012 | Serial; M1 interoperability review |
| 5 | T013, T015, T016; then T014 | T014 needs T013 |
| 6 | T017 -> T018 | Serial; M2 and HTTP contract review |
| 7 | T019, T021 | Storage and designer scaffold, disjoint ownership |
| 8 | T020, T022 | API and designer editors, disjoint ownership |
| 9 | T023 -> T024 | Serial; M3 integration/security review |
| 10 | T025 -> T026 | Serial catalog and admin-console integration |
| 11 | T027, T028; then T029 | Serial final integration/sign-off |

These are scheduling suggestions, not permission to bypass exact dependencies.
For minimum coordination cost, assign everything serially; parallelism is optional.

## Planned Project Structure

```text
apps/
  shell/src/{config,federation,host,routing,navigation,layout,preferences}/
  demo-react/src/
  demo-vue/src/
  workspace-designer/src/{editors,publishing,catalog,admin-navigation}/
  config-api/src/{storage,http}/
packages/
  contracts/src/{config,resolution,http}/
  sdk/src/
  theme/src/
fixtures/workspaces/
tests/e2e/
scripts/check-budgets.mjs
docs/contracts/{configuration,integration,http}.md
docs/implementation/{plan,research}.md
docs/implementation/{checkpoints,handoffs}/
```

Do not create all directories upfront. Each task creates only its owned slice.

## Testing Strategy

- App type: browser SPA plus a thin HTTP configuration service in M3.
- Primary stack: Vitest, real production-build federated remotes, Playwright
  Chromium, Axum request tests, and temporary real SQLite files. Add Firefox/WebKit
  smoke coverage at T027; incompatibility must be recorded, not silently skipped.
- Critical journeys: cross-framework app switching/deep links; independently
  mounted widgets; menu/layout/theme changes; allowed preferences across reload;
  catalog compatibility, install, pinned upgrade, and uninstall; admin section-tree
  edits; draft preview/publish/rollback; viewer denial and revision conflicts;
  offline remote and stale-load recovery. Criteria are specified in
  T012/T017/T024/T025/T026.
- Planning environment verified: Node 26.0.0 and functional Docker. Target Node 24
  compatibility, pnpm, npm network access, and browser binaries verified in T001/T012.
  No existing test command or legacy test assets exist; T001 creates canonical scripts.
- Infra tier: SQLite is the chosen real datastore, not a fallback for PostgreSQL.
  Docker is optional and not needed for these tests. No broker/cache/cloud emulator.
- Browser tier: Playwright required. If browser installation is blocked, unit/API
  checks may continue, but M1/M2/M3/M4 browser gates stay blocked. Record exact error;
  HTTP tests are not equivalent evidence of rendering or navigation.
- Contracts: test producer adapters against shared lifecycle assertions; test HTTP
  client using fixtures from the same request/response schemas. API tests validate
  those responses too. Fixture/mocked loader tests cannot prove bundler compatibility.
- Test data: deterministic workspace/release fixtures; isolated user/workspace IDs;
  a fresh temporary SQLite DB per API suite; reset browser storage/session per test.
- Each package is independently testable. T001 provides baseline shell startup
  skeleton; later package-creation tasks provide their startup/adapter skeletons.
  Shared browser setup owns servers, readiness detection, and teardown. No manually
  running server is required for canonical E2E commands.
- Test completion rule: every implementation task runs its package's focused tests
  plus typecheck/build where applicable. Report pass/fail/skip counts; failure or
  skipped required checks means the task is not accepted.
- Reviewer confirms results came from the accepted combined tree, production
  assets were actually fetched, schema/API drift is absent, and known gaps remain visible.
- Known gaps: initial two-framework examples do not certify every federation plugin,
  framework version, Angular integration, UI library, Shadow DOM profile, or third-party
  remote. Production identity and hosting are deliberately unresolved prerequisites.

## Requirement Mapping

Implementation evidence names future files and checks, not completed functionality.

| REQ ID | Description | Plan Items | Implementation Evidence |
| --- | --- | --- | --- |
| REQ-001 | Solid 2.0 | 0.1, 1.3, 3.2, 4.1 | pinned manifests; T002 spike; designer build |
| REQ-002 | Dynamic approved federation | 0.1, 0.2, 1.1, 1.3, 3.1, 4.1 | catalog schema; shell federation; real remote requests |
| REQ-003 | Frameworks and instances | 0.2, 1.1, 1.2, 1.3, 2.2, 4.1 | lifecycle/SDK; demo adapters; two-widget E2E |
| REQ-004 | Menu entries | 0.2, 2.1, 3.2, 4.1 | menu schema/model; designer editors |
| REQ-005 | Menu placement | 0.2, 2.1, 3.2, 4.1 | placement schema; renderers; responsive E2E |
| REQ-006 | Layouts and regions | 0.2, 2.2, 3.2, 4.1 | layout schema/renderers; slot instance E2E |
| REQ-007 | Allowed preferences | 0.2, 1.1, 2.1, 2.2, 3.1, 4.1 | resolver; preference adapters; policy/API tests |
| REQ-008 | Shell styling | 0.2, 1.1, 1.2, 1.3, 2.2, 3.2, 3.4, 4.1 | theme CSS; producer styling; admin-console tokens; computed-style E2E |
| REQ-009 | Stable navigation | 0.2, 1.2, 1.3, 2.1, 4.1 | routing/guards; deep-link/back/forward tests |
| REQ-010 | Separate designer | 0.2, 3.1, 3.2, 3.3, 3.4, 4.1 | catalog, designer editors/publishing, admin navigation; revision E2E |
| REQ-011 | Persistence and policy | 0.2, 1.1, 3.1, 3.2, 3.3, 3.4, 4.1 | real SQLite; install pins; API authorization; restart tests |
| REQ-012 | Failures and cleanup | 0.2, 1.1, 1.2, 1.3, 2.2, 3.1, 4.1 | validators/host/retries; disposal/failure tests |
| REQ-013 | Lightweight reproducibility | 0.1, 1.1, 1.3, 4.1 | lockfile; build/browser harness; budget script |
| REQ-014 | Future builder boundary | 0.2, 4.1 | reusable config/lifecycle contracts; integration docs |
| REQ-015 | Catalog and workspace installations | 0.2, 3.1, 3.3, 4.1 | compatibility contract/API; pinned install/upgrade/uninstall journey |
| REQ-016 | Configurable admin section tree | 0.2, 3.1, 3.4, 4.1 | admin-nav schema/API; tree editor; publish/reload journey |
| REQ-017 | Admin visual and interaction design | 1.1, 3.4, 4.1 | shared-token Solid UI; responsive and accessibility checks |

Checkpoint files use JSON-compatible YAML so tools can parse them without adding
a planning-only dependency. They record plan coverage only; acceptance lives in
task checkboxes and handoffs. Never interpret `validation.passed` as tests passing.
