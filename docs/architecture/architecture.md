# Modulaga shell and configuration architecture

Status: working direction for the first configurable-shell proof of concept.

## Product shape

Modulaga is a lightweight workspace shell. A workspace document describes which
applications are available, the routes they own, the navigation users see, and
the panels placed into page regions. The shell reads that document, renders its
own chrome, and loads application code only when a configured destination is
opened. The admin studio edits the same declarative model and previews the
result immediately.

The monorepo is the development and contract boundary. It does not require every
application to ship together: each remote still builds and deploys independently.

```text
workspace-config/                 checked-in workspace documents
services/workspace-config/        Rust + Axum configuration service
apps/shell/                       lightweight host, routing and composition
apps/admin/                       future independently built admin remote
apps/demo-react/, apps/demo-vue/  cross-framework integration fixtures
packages/contracts/               schemas, generated types and validation
packages/runtime/                 loader adapters and mount lifecycle contracts
packages/theme/                   framework-neutral CSS tokens
```

For the first milestone, the admin studio is a static UI app in `apps/admin-panel`
and is bundled into `apps/shell`. Workspace documents remain in the root
`workspace-config/` directory; the Rust + Axum server remains in
`services/workspace-config/`.

## What to take from OneCX

OneCX uses a shell UI and a shell BFF together. The BFF gathers workspace data
from platform services; the UI builds workspace routes from the response, then
loads the selected remote at navigation time. Workspaces own app registrations,
themes, role assignments, menu trees, and slot assignments. This is the core
pattern Modulaga should keep: the shell consumes a composed workspace snapshot
and its behavior follows that data rather than a hard-coded app list.

OneCX models page remotes and reusable remote components separately. A module
owns a route or page area and the shell loads it through federation. A remote
component is loaded into a named slot by the application that renders that slot;
workspace configuration chooses which component fills the slot. Empty slots
are valid, and one slot can render ordered components. This maps naturally to
Modulaga page regions and dashboard panels.

OneCX separates a route-owned module from a reusable remote component. A module
is resolved by shell routing; a reusable widget is resolved by a named slot in
the page that hosts it. Slot assignments are workspace scoped, may be empty or
contain several ordered remotes, and can be changed by an administrator without
redeploying either app. Modulaga should keep this distinction explicit:
`routes` select page remotes, while `regions` and `placements` select panel and
shell-extension remotes.

OneCX's shell constructs a workspace from backend data and passes workspace,
user, permission, slot, and active-application context through its Topics
integration interface. Framework-specific helpers exist for Angular and React.
The current documentation describes technology-agnostic concepts and React
slot hosting, alongside Angular integration. Its legacy shell overview still
describes the UI as Angular and names Angular Architects Federation; current
integration guidance also discusses Module Federation Enhanced and Native
Federation. Modulaga should keep the useful contract (versioned,
framework-neutral context messages) while treating loaders as replaceable
adapters rather than inheriting OneCX's framework or package choices.

OneCX's compatibility guidance describes web-component modules and scripts as
well as Angular bootstrapping, and discourages Angular-module integration that
forces applications onto compatible Angular versions. This supports
Modulaga's adapter boundary: framework-neutral web components first, federation
for remotes designed for it, and iframes for stronger isolation or incompatible
runtimes. No adapter should be advertised as supporting arbitrary frameworks
unless it can actually mount them.

| OneCX concept | Modulaga contract | Why it matters |
| --- | --- | --- |
| Workspace snapshot assembled by Shell BFF | Versioned workspace document served by Rust ConnectRPC | Shell routes and chrome derive from one validated composition model. |
| Module loaded when a route is activated | App installation + route + loader descriptor | Business applications load on demand and remain independently deployed. |
| Remote Component hosted by a named Slot | Registered component + ordered region placement | Dashboards and shell panels are configurable without embedding app code in JSON. |
| Workspace and user Topics | Versioned shell context/event contract | Remotes consume changes without importing a shell framework. |
| Workspace-specific menu and slot assignment | Workspace-owned menu tree and placements | Admin edits affect only the selected workspace. |

The shell must enforce style boundaries. OneCX applies style isolation to
remote content and uses platform theme variables for cross-app appearance.
Modulaga should publish CSS tokens and require scoped remote styles; Shadow DOM
and iframe profiles can be optional adapters where stronger isolation is
needed.

Sources: [OneCX architecture](https://onecx.github.io/docs/documentation/current/onecx-docs-overview/architecture/index.html),
[OneCX shell](https://onecx.github.io/docs/documentation/current/onecx-docs-overview/architecture/shell.html),
[remote components and slots](https://onecx.github.io/docs/documentation/current/docs-guides-ui/concepts/remote-components.html),
[routing](https://onecx.github.io/docs/documentation/current/docs-guides-ui/concepts/routing.html),
[module federation](https://onecx.github.io/docs/documentation/current/docs-guides-ui/concepts/module-federation.html),
[integration interface](https://onecx.github.io/docs/documentation/current/onecx-portal-ui-libs/libraries/integration-interface.html),
[style isolation](https://onecx.github.io/docs/documentation/current/docs-guides-ui/concepts/style-isolation.html).

OneCX provides useful composition ideas, but its current product also includes a
shell BFF and many platform services, and its implementation is Angular-centered.
Modulaga should borrow its workspace, route, slot, and shared-context contracts
without inheriting that service footprint or requiring Angular.

There is a documentation-version seam worth keeping in view: the shell
architecture page still names `@angular-architects/module-federation`, while the
current UI guide recommends `@module-federation/enhanced` and documents React
integration packages alongside Angular. The stable lesson is runtime remote
loading and explicit integration contracts; the package choice should follow the
specific producer/consumer adapter and be checked against its maintained docs.

## Runtime boundaries

### Shell

The shell owns workspace bootstrap, top-level history, authorization-aware
navigation visibility, loader selection, app mount/unmount, error boundaries,
loading states, and layout regions. It does not contain business pages or app-
specific data logic. It validates configuration before rendering it.

### Application descriptor

Each independently deployable app publishes a descriptor with a stable app ID,
release/version, loader type, remote entry or manifest, exposed page modules,
optional reusable components, route declarations, required shell capabilities,
contract version, and styling profile. Workspace configuration pins the chosen
release and assigns its routes and components to the workspace.

### Loader adapters

“Support every microfrontend technology” should mean an adapter contract, not a
claim that one loader can execute every framework. Start with the already
implemented Module Federation Enhanced runtime adapter. Add adapters behind the
same mount/update/unmount boundary as real demand appears:

| Adapter | Intended content | Integration tradeoff |
| --- | --- | --- |
| Module Federation Enhanced | Runtime-shared modules from Vite/Webpack producers | Best fit for the existing proof; dependency sharing needs compatibility checks. |
| Native Federation | ESM-based federation producers | Separate runtime semantics and package-resolution rules. |
| Custom element | Framework-neutral Web Components and wrappers | Strong DOM contract; framework router and shared state need explicit bridging. |
| iframe | Isolated third-party or incompatible apps | Strongest browser boundary; communication, sizing, and navigation are constrained. |

The shell chooses a registered adapter by descriptor type. Remote code is trusted
code unless it runs in an iframe; federation is not a security sandbox. The shell
must only load approved origins/releases and must not accept executable code,
arbitrary CSS, or component import paths from an editable workspace document.

## Configuration model

Keep configuration declarative and validate it against versioned JSON Schemas.
The workspace document is the source for workspace composition:

- workspace identity, theme reference, menu placements, sidebar dimensions and
  mode, breadcrumb behavior, and dashboard definitions;
- app installation pins and route declarations;
- nested menu groups, route links, and safe external links;
- layout templates, named regions, ordered component placements, and each
  dashboard's grid size and registered panel instances;
- component setting values validated against the app's declared settings schema.

Keep the app catalog (publishers and immutable releases) separate from a
workspace's installation pins. Keep deployment-level admin view registration
separate from an end-user workspace menu, while allowing both to use the same
registered-view and menu-renderer primitives. Admin configuration selects
registered views and their allowed settings; it does not manufacture arbitrary
React/Solid/Vue components from JSON.

Configuration scope is explicit: deployment defaults, tenant/workspace overrides,
then permitted user preferences. The server resolves authorization and the
effective config. Hiding a menu item is not authorization; route and API access
must still be checked independently.

### Rust services and ConnectRPC

Workspace configuration documents live in
`workspace-config/workspaces/default.json`. The Rust + Axum service is in
`services/workspace-config/`. `connectrpc-build` generates its ConnectRPC handlers
and protobuf message types from
`services/workspace-config/proto/workspace_config.proto`. The shell
uses Connect's binary protobuf encoding over browser HTTP. The service stores
the complete workspace snapshot in PostgreSQL JSONB and enforces optimistic
revision checks. The previous flat Tonic CRUD API and generated menu tables are
removed; configuration is now one versioned document, matching the contract
that the shell edits.

Ferriskey supplies OIDC authentication and role-based authorization. The shell
uses authorization code with PKCE, and the service verifies access-token
signatures against the realm's discovered JWKS, checks issuer, expiration,
optional audience, and requires the configured `realm_access.roles` entry for
updates. Local Compose sets `AUTH_MODE=disabled` for the first interactive POC;
registry deployment sets OIDC mode and internal discovery/JWKS URLs while
retaining Ferriskey's public issuer. Reads are public for workspace bootstrap.
The local override must not be used for a shared or production deployment.

Compose starts the workspace service, app-catalog service, and shell in `local`
(build) or `registry` (published image) profiles, along with Ferriskey and
separate PostgreSQL databases. The catalog service validates and serves the
microfrontend release document from `workspace-config/catalog.json`; workspace
installations pin a catalog release ID. Publishing immutable releases and
catalog administration remain follow-up work.

## Admin studio and dashboard composition

The admin studio edits structured configuration. Its first screen edits menu
links and groups while a live preview renders the changed workspace shell. Later
screens can add app releases, page regions, and dashboard panels from registered
catalog entries. A schema-driven inspector edits only settings that a panel
declares, with validation errors next to the relevant fields.

Dashboard documents name regions such as `main`, `aside`, and `header`. Each
region has ordered placements with a component release ID and JSON settings.
The host supplies a slot/container and lifecycle context; the selected app
contributes the component implementation. Empty, missing, incompatible, or failed
placements get a shell-owned fallback state. This keeps page layout dynamic
without allowing user configuration to inject arbitrary code.

## First proof of concept

The current POC places a menu and shell-settings editor inside the Solid shell.
It reads the starter workspace, shows menu and dashboard panels in a live shell
preview, and saves the whole document through the ConnectRPC API with an
expected revision. A bundled starter workspace allows the shell to render
offline; local draft persistence is retained as a fallback. Multi-user drafts,
publish/rollback workflow, and role-filtered menu resolution remain later work.
The React remote remains the interoperability fixture.

Next architecture steps:

1. Add service-side schema cross-reference validation for all settings and
   component releases, then draft/publish immutable workspace revisions.
2. Connect catalog release pins to route resolution and mount configured
   remotes through the shell loader adapters.
3. Add Ferriskey realm/client bootstrap fixtures so the registry profile can be
   initialized repeatably without manual console setup.
4. Extract runtime loader adapters and the framework-neutral mount/context
   contracts; add a Vue or custom-element fixture after the first contract review.

The proposed Template Studio, application blueprint, Baker template, and
generation-runner architecture is documented in
[Template Studio and Application Generation](template-studio-and-generation.md).
