# Workspace Settings

Workspace Settings is a microfrontend mounted at the unique
`/workspace-settings` route. It provides the workspace menu editor, shell
settings, styles, and dynamic views of installed applications and connected
services. The shell only resolves this route from workspace configuration and
mounts the declared remote.

Workspace installations and services are read from the workspace configuration;
application display names are resolved from the application catalog. Run it with
`pnpm --filter @modulaga/admin-panel dev` or start it as part of the `local` or
`registry` Docker Compose profile.
