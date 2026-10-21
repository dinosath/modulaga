# Architecture Decisions

> Historical decision draft. Use [the implemented architecture](../architecture/architecture.md) for current choices.

Date: 2026-09-29. Input: the preceding architecture investigation and the user's
explicit requirement to use SolidJS 2.0 even when only an RC is available.

## Fixed Decisions

| Decision | Rationale | Alternative not selected |
| --- | --- | --- |
| SolidJS 2.0 shell and designer | Explicit user constraint; small reactive shell | Solid 1.x fallback |
| Runtime-only federation consumer | Dynamic catalog without shell rebuilds | Static remote imports in shell |
| DOM mount/update/unmount adapters | Mixed-framework apps with explicit cleanup | Directly rendering React/Vue exports in Solid |
| Catalog/workspace/shell separation | Reconfigure composition without changing app code | Hardcoded shell menus and installations |
| Scoped light DOM first | Simple adoption of shell control styles | Mandatory Shadow DOM for every remote |
| Shared CSS design system | Framework-neutral visual contract | Shipping Solid components as the universal UI library |
| One configuration API later | Persistence without a fleet of platform services | One service per platform concept |
| JSON Schema and generated types | Builder-compatible configuration with one canonical shape | Independently maintained TS and JSON definitions |
| Framework dependencies local initially | Avoid startup frameworks and singleton coupling | Globally sharing every framework by default |

## Version Verification Boundary

The investigation observed `solid-js@2.0.0-rc.11`. This is evidence, not a promise
that all companion packages have the same version or are compatible. T001/T002
verify current published versions, pin compatible 2.0 packages, and test a real
federated production build. Never paste Solid 1.x APIs into a 2.0 implementation
without checking their current replacements. If 2.0 stable exists when executing,
use a compatible stable 2.0 release; do not cross to another major automatically.

Current shell bundle size and interoperability have not been measured. The plan's
budgets are proposed acceptance targets, not upstream benchmark claims.

## Sources

- Module Federation runtime: https://module-federation.io/guide/runtime/index.html
- Runtime API: https://module-federation.io/guide/runtime/runtime-api.html
- Manifest: https://module-federation.io/guide/advanced/manifest-fields.html
- Vite producers: https://module-federation.io/integrations/build-tool/vite.html
- CSS limitations: https://module-federation.io/guide/basic/css-isolate.html
- Loading/fallbacks: https://module-federation.io/guide/runtime/runtime-plugins.html
- OneCX architecture: https://onecx.github.io/docs/documentation/current/onecx-docs-overview/architecture/index.html
- OneCX shell: https://onecx.github.io/docs/documentation/current/onecx-docs-overview/architecture/shell.html
- OneCX slots: https://onecx.github.io/docs/documentation/current/onecx-docs-overview/architecture/remote-components.html
- OneCX shared context: https://onecx.github.io/docs/documentation/current/onecx-portal-ui-libs/libraries/integration-interface.html
- OneCX current code: https://github.com/onecx/onecx-shell-ui/blob/main/package.json
- Solid 2.0 RC: https://www.solidjs.com/blog/solid-2-0-rc-the-big-reveal
- Solid 2.0 documentation: https://v2.solidjs.com/

OneCX overview pages mention an older federation loader than the current shell
repository. Reuse its workspace and slot concepts, not its implementation details
or dependency footprint. No new web research or compatibility execution was
performed when writing this plan; the runtime spike is mandatory.
