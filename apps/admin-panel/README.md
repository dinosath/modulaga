# Modulaga Admin Panel

The admin panel is a static workspace app under `apps/admin-panel`. The shell
bundles it directly, so the menu editor does not need a separately deployed
remote. It reads and edits the workspace document served by the ConnectRPC
configuration service.

Menu entries and their order, labels, icons, visibility, and group behavior are
defined by the workspace configuration; this app contains the editor UI, not a
second menu definition.
