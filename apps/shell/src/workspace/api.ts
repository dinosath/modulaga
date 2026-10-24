import type { WorkspaceNavigation } from "../config/navigation";
import { runtimeConfig } from "../runtime-config";

const API_ROOT = runtimeConfig.configApiUrl ?? import.meta.env.VITE_CONFIG_API_URL ?? "http://127.0.0.1:4303";
const CATALOG_API_ROOT = runtimeConfig.catalogApiUrl ?? import.meta.env.VITE_CATALOG_API_URL ?? "http://127.0.0.1:4304";
const SERVICE = "modulaga.workspace.v1.WorkspaceConfigService";
const CATALOG_SERVICE = "modulaga.catalog.v1.CatalogService";
const WORKSPACE_ID = runtimeConfig.workspaceId ?? import.meta.env.VITE_WORKSPACE_ID ?? "default";

export type WorkspaceConfigSnapshot = { config: WorkspaceNavigation; revision: number };
export type ApplicationRelease = {
  id: string;
  version: string;
  manifestUrl: string;
  remoteName: string;
  exposedModule: string;
};
export type CatalogApplication = { id: string; name: string; description?: string; releases: ApplicationRelease[] };
export type ApplicationCatalog = { schemaVersion: 1; apps: CatalogApplication[] };
export type ApplicationCatalogSnapshot = { catalog: ApplicationCatalog; revision: number };

function varint(value: number | bigint) {
  let remaining = BigInt(value);
  const bytes: number[] = [];
  while (remaining > 0x7fn) {
    bytes.push(Number((remaining & 0x7fn) | 0x80n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return bytes;
}

function protobufString(field: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
}

export function encodeGetRequest(workspaceId: string) {
  return new Uint8Array(protobufString(1, workspaceId));
}

export function encodeUpdateRequest(workspaceId: string, configJson: string, expectedRevision: number) {
  return new Uint8Array([
    ...protobufString(1, workspaceId),
    ...protobufString(2, configJson),
    ...varint((3 << 3) | 0),
    ...varint(expectedRevision),
  ]);
}

function readVarint(bytes: Uint8Array, cursor: { value: number }): bigint {
  let value = 0n;
  let shift = 0n;
  while (cursor.value < bytes.length && shift < 70n) {
    const byte = bytes[cursor.value++];
    value |= BigInt(byte! & 0x7f) << shift;
    if ((byte! & 0x80) === 0) return value;
    shift += 7n;
  }
  throw new Error("ConnectRPC returned malformed protobuf data");
}

export function decodeWorkspaceConfigResponse(bytes: Uint8Array) {
  const cursor = { value: 0 };
  const response: { workspaceId?: string; configJson?: string; revision: number } = { revision: 0 };
  while (cursor.value < bytes.length) {
    const tag = Number(readVarint(bytes, cursor));
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 2) {
      const length = Number(readVarint(bytes, cursor));
      const end = cursor.value + length;
      if (end > bytes.length) throw new Error("ConnectRPC returned truncated protobuf data");
      const value = new TextDecoder().decode(bytes.slice(cursor.value, end));
      cursor.value = end;
      if (field === 1) response.workspaceId = value;
      if (field === 2) response.configJson = value;
    } else if (wire === 0) {
      const value = readVarint(bytes, cursor);
      if (field === 3) response.revision = Number(value);
    } else if (wire === 1) {
      cursor.value += 8;
    } else if (wire === 5) {
      cursor.value += 4;
    } else {
      throw new Error("ConnectRPC returned an unsupported protobuf field");
    }
    if (cursor.value > bytes.length) throw new Error("ConnectRPC returned truncated protobuf data");
  }
  if (!response.workspaceId || !response.configJson) {
    throw new Error("ConnectRPC returned an incomplete workspace configuration");
  }
  return response as { workspaceId: string; configJson: string; revision: number };
}

export function decodeCatalogResponse(bytes: Uint8Array) {
  const cursor = { value: 0 };
  const response: { catalogJson?: string; revision: number } = { revision: 0 };
  while (cursor.value < bytes.length) {
    const tag = Number(readVarint(bytes, cursor));
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 2) {
      const length = Number(readVarint(bytes, cursor));
      const end = cursor.value + length;
      if (end > bytes.length) throw new Error("ConnectRPC returned truncated protobuf data");
      const value = new TextDecoder().decode(bytes.slice(cursor.value, end));
      cursor.value = end;
      if (field === 1) response.catalogJson = value;
    } else if (wire === 0) {
      const value = readVarint(bytes, cursor);
      if (field === 2) response.revision = Number(value);
    } else if (wire === 1) {
      cursor.value += 8;
    } else if (wire === 5) {
      cursor.value += 4;
    } else {
      throw new Error("ConnectRPC returned an unsupported protobuf field");
    }
    if (cursor.value > bytes.length) throw new Error("ConnectRPC returned truncated protobuf data");
  }
  if (!response.catalogJson) {
    throw new Error("ConnectRPC returned an incomplete application catalog");
  }
  return response as { catalogJson: string; revision: number };
}

async function callAt(root: string, service: string, method: "Get" | "Update", body: Uint8Array, token?: string) {
  const headers = new Headers({ "Content-Type": "application/proto", "Connect-Protocol-Version": "1", Accept: "application/proto" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${root}/${service}/${method}`, { method: "POST", headers, body: Uint8Array.from(body).buffer });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    throw new Error(payload?.message ?? `${payload?.code ?? "ConnectRPC"}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function getWorkspaceConfig(workspaceId = WORKSPACE_ID): Promise<WorkspaceConfigSnapshot> {
  const response = decodeWorkspaceConfigResponse(await callAt(API_ROOT, SERVICE, "Get", encodeGetRequest(workspaceId)));
  return { config: JSON.parse(response.configJson) as WorkspaceNavigation, revision: response.revision };
}

export async function getApplicationCatalog(): Promise<ApplicationCatalogSnapshot> {
  const response = decodeCatalogResponse(await callAt(CATALOG_API_ROOT, CATALOG_SERVICE, "Get", new Uint8Array()));
  const catalog = JSON.parse(response.catalogJson) as ApplicationCatalog;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.apps)) {
    throw new Error("ConnectRPC returned an unsupported application catalog");
  }
  return { catalog, revision: response.revision };
}

export async function updateWorkspaceConfig(config: WorkspaceNavigation, expectedRevision: number, token?: string): Promise<WorkspaceConfigSnapshot> {
  const response = decodeWorkspaceConfigResponse(await callAt(API_ROOT, SERVICE, "Update", encodeUpdateRequest(config.workspace.id, JSON.stringify(config), expectedRevision), token));
  return { config: JSON.parse(response.configJson) as WorkspaceNavigation, revision: response.revision };
}
