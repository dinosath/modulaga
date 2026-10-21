# Local Workspace Configuration API

> Superseded HTTP contract. The API now uses ConnectRPC protobuf services; see `services/workspace-config/proto/` and [the current architecture](../architecture/architecture.md).

This document describes the owner-directed Rust/Axum prototype. It is not the
full T018 production contract. The service currently exposes one workspace,
`default`, and is safe to run only on the local machine.

## Runtime Boundary

- Bind only to a loopback address; the server rejects other addresses.
- Set `MODULAGA_ADMIN_TOKEN` to a local secret with at least 32 characters.
- All writes require `Authorization: Bearer <token>`. The shell keeps the token
  in memory and sends it only for write requests.
- Production mode is refused until a trusted identity/session provider is added.
- Application manifests must use `http` and a `localhost`, `127.0.0.0/8`, or
  `[::1]` host, with a path ending in `/mf-manifest.json`. Credentials, queries,
  fragments, HTTPS origins, and non-loopback hosts are rejected.
- Federated applications execute in the shell page and are trusted code. The
  loopback restriction is a development guard, not a production publisher policy.

## Endpoints

`GET /api/health` returns `204` when the process is available.

`GET /api/workspaces/default/bootstrap` returns the persisted applications and
menu entries in menu order:

```json
{
  "id": "default",
  "name": "Default workspace",
  "applications": [
    {
      "id": "uuid",
      "name": "Orders",
      "route_path": "/orders",
      "remote_name": "orders_remote",
      "exposed_module": "./mount",
      "manifest_url": "http://127.0.0.1:4174/mf-manifest.json"
    }
  ],
  "menu": [
    { "id": "uuid", "label": "Order desk", "application_id": "uuid", "position": 0 }
  ]
}
```

`POST /api/applications` requires the admin bearer token. Request fields are
`name`, `route_path`, `remote_name`, `exposed_module`, and `manifest_url`.
Successful registration returns `201` and the created declaration. Routes are
unique; duplicate routes return `409`. Unknown fields are rejected.

`POST /api/menu-entries` requires the admin bearer token. Request fields are
`label`, `application_id`, and non-negative `position`. Successful creation
returns `201`. References to missing applications and duplicate positions
return `409`.

`DELETE /api/menu-entries/{id}` requires the admin bearer token. It returns
`204`; deleting a menu entry does not unregister its application. Missing IDs
return `404`.

Invalid request data returns `400`; absent or invalid bearer tokens return
`401`; unexpected storage failures return `500`. Drafts, revisions, publishing,
rollback, preferences, multiple workspaces, user permissions, and application
deletion are not implemented by this prototype.
