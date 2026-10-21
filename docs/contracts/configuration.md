# Configuration Contracts

> Draft contract note. The canonical runtime schema is under `packages/contracts/`; the implemented workspace model is described in [the current architecture](../architecture/architecture.md).

The JSON Schemas in `packages/contracts/src/schemas/` are the canonical structural
contracts. TypeScript declarations and standalone Ajv validators are generated
from those files; do not edit generated outputs directly. Schema version `1` is
the initial draft and must be reviewed before it is treated as frozen.

## Catalog And Installation

A catalog app has stable identity and publisher metadata. Each immutable release
has its own ID/version, Module Federation manifest and exposed module, Subresource
Integrity value, required capabilities, and compatibility declaration. Compatibility
declares the Modulaga lifecycle contract version, minimum shell version, federation
format/remote type, and design-system version. A workspace installation references
one exact app/release ID and has a unique base path and schema-validated settings.
Installing, upgrading, and uninstalling are workspace operations; uninstalling does
not delete a catalog release.

Installation/component settings include a schema ID and a value object. The schema
reference is resolved against the installed app/component declaration and the value
is validated against that app-owned settings schema by the resolver.

The schema validates structure and primitive constraints. It does not decide whether
a release is compatible with a running shell, whether its publisher/origin is
approved, or whether cross-record IDs are unique and resolve. Those checks belong to
the configuration resolver and server policy. Never treat schema validity as
authorization.

## Workspace And Admin Navigation

Workspace configuration contains installations, routes, nested menu definitions,
menu placements, a bounded layout/region structure, and an optional theme reference.
Internal menu entries reference route IDs; external links are data, not executable
templates. User preferences are a separate schema and can only refer to allowed
stable IDs. They cannot register applications or grant capabilities.

Admin navigation has deployment or tenant scope, a registry of allowed admin views,
and a nested tree containing groups or references to those views. It is separate from
workspace end-user menus. The tree can be rearranged without a rebuild, but cannot
declare components, scripts, CSS, or arbitrary routes. The server remains responsible
for scope and capability authorization.

## Revisions And Preferences

Catalog release IDs identify immutable published assets; publishing new app code
creates a new release ID/version rather than replacing an existing release.
Published workspace and admin-navigation configurations are carried in immutable
revision envelopes with stable revision IDs. Draft writes name the revision they
were based on (the HTTP contract uses optimistic concurrency); publishing creates
a new revision, and rollback republishes prior content as another new revision.
Revision metadata is transport/publication metadata and is not user-editable config.

Preferences are scoped by the `(userId, workspaceId)` pair and independently carry
their schema version. They may alter only declared appearance/navigation options
and stable menu IDs; missing/retired IDs are ignored with diagnostics by the
resolver. Preferences cannot install apps, change release origins, or grant
capabilities.

The examples and negative fixtures under `fixtures/` are exercised by the contract
package tests. Cross-reference validation, cycle detection, route ambiguity, release
compatibility, and settings-schema validation are follow-up resolver responsibilities.
