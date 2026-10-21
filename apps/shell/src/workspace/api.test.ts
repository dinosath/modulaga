import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeWorkspaceConfigResponse,
  decodeCatalogResponse,
  encodeGetRequest,
  encodeUpdateRequest,
  getWorkspaceConfig,
  getApplicationCatalog,
  updateWorkspaceConfig,
} from "./api";
import { defaultNavigation } from "../config/navigation";

function varint(value: number) {
  const result: number[] = [];
  while (value > 127) { result.push((value & 127) | 128); value >>>= 7; }
  result.push(value);
  return result;
}

function stringField(field: number, value: string) {
  const bytes = [...new TextEncoder().encode(value)];
  return [...varint(field * 8 + 2), ...varint(bytes.length), ...bytes];
}

function responseBytes(config = defaultNavigation, revision = 5) {
  return new Uint8Array([
    ...stringField(1, config.workspace.id),
    ...stringField(2, JSON.stringify(config)),
    ...varint(24), ...varint(revision),
  ]);
}

function catalogResponseBytes(catalog: { schemaVersion: number; apps: unknown[] } = { schemaVersion: 1, apps: [] }, revision = 7) {
  return new Uint8Array([
    ...stringField(1, JSON.stringify(catalog)),
    ...varint(16), ...varint(revision),
  ]);
}

afterEach(() => vi.unstubAllGlobals());

describe("workspace ConnectRPC protobuf transport", () => {
  it("encodes protobuf string fields for the Get request", () => {
    expect([...encodeGetRequest("default")]).toEqual([10, 7, ...new TextEncoder().encode("default")]);
  });

  it("encodes workspace, JSON configuration, and expected revision", () => {
    const bytes = encodeUpdateRequest("x", "{}", 300);
    expect([...bytes.slice(0, 3)]).toEqual([10, 1, 120]);
    expect([...bytes.slice(-3)]).toEqual([24, 172, 2]);
  });

  it("decodes workspace snapshots from protobuf responses", () => {
    const decoded = decodeWorkspaceConfigResponse(responseBytes());
    expect(decoded.workspaceId).toBe("default");
    expect(JSON.parse(decoded.configJson).workspace.name).toBe("Default workspace");
    expect(decoded.revision).toBe(5);
  });

  it("uses the proto3 zero default when a revision field is omitted", () => {
    const bytes = new Uint8Array([
      ...stringField(1, "default"),
      ...stringField(2, JSON.stringify(defaultNavigation)),
    ]);
    expect(decodeWorkspaceConfigResponse(bytes).revision).toBe(0);
    expect(decodeCatalogResponse(new Uint8Array(stringField(1, JSON.stringify({ schemaVersion: 1, apps: [] })))).revision).toBe(0);
  });

  it("decodes catalog JSON and its separate revision field", () => {
    const decoded = decodeCatalogResponse(catalogResponseBytes());
    expect(JSON.parse(decoded.catalogJson)).toEqual({ schemaVersion: 1, apps: [] });
    expect(decoded.revision).toBe(7);
  });

  it("skips unknown catalog fields and uses proto3 defaults", () => {
    const valid = catalogResponseBytes();
    const bytes = new Uint8Array([
      29, 1, 2, 3, 4,
      33, 1, 2, 3, 4, 5, 6, 7, 8,
      ...valid,
    ]);
    expect(decodeCatalogResponse(bytes).revision).toBe(7);
    expect(decodeCatalogResponse(new Uint8Array(stringField(1, "{}"))).revision).toBe(0);
  });

  it("rejects malformed, truncated, and incomplete catalog responses", () => {
    expect(() => decodeCatalogResponse(new Uint8Array([10, 4, 1]))).toThrow("truncated");
    expect(() => decodeCatalogResponse(new Uint8Array([7]))).toThrow("unsupported");
    expect(() => decodeCatalogResponse(new Uint8Array([16, 1]))).toThrow("incomplete");
    expect(() => decodeCatalogResponse(new Uint8Array(Array(11).fill(128)))).toThrow("malformed");
  });

  it("rejects malformed, truncated, and incomplete response data", () => {
    expect(() => decodeWorkspaceConfigResponse(new Uint8Array([10, 4, 1]))).toThrow("truncated");
    expect(() => decodeWorkspaceConfigResponse(new Uint8Array([7]))).toThrow("unsupported");
    expect(() => decodeWorkspaceConfigResponse(new Uint8Array([10, 1, 120]))).toThrow("incomplete");
    expect(() => decodeWorkspaceConfigResponse(new Uint8Array(Array(11).fill(128)))).toThrow("malformed");
  });

  it("skips unknown fixed-width protobuf fields", () => {
    const bytes = new Uint8Array([
      ...stringField(1, "default"),
      29, 1, 2, 3, 4,
      33, 1, 2, 3, 4, 5, 6, 7, 8,
      ...stringField(2, JSON.stringify(defaultNavigation)),
      24, 5,
    ]);
    expect(decodeWorkspaceConfigResponse(bytes).revision).toBe(5);
  });

  it("skips unknown protobuf fields for each supported wire type and rejects truncated fixed-width fields", () => {
    const configBytes = new Uint8Array([
      ...stringField(1, "default"),
      ...stringField(2, JSON.stringify(defaultNavigation)),
      32, 1,
      34, 1, 42,
    ]);
    expect(decodeWorkspaceConfigResponse(configBytes).revision).toBe(0);
    expect(decodeCatalogResponse(new Uint8Array([...stringField(1, "{}"), 24, 1, 34, 1, 42])).revision).toBe(0);
    expect(() => decodeWorkspaceConfigResponse(new Uint8Array([9, 1]))).toThrow("truncated");
    expect(() => decodeWorkspaceConfigResponse(new Uint8Array([29, 1]))).toThrow("truncated");
    expect(() => decodeCatalogResponse(new Uint8Array([9, 1]))).toThrow("truncated");
    expect(() => decodeCatalogResponse(new Uint8Array([29, 1]))).toThrow("truncated");
  });

  it("loads a workspace over Connect with binary protobuf media types", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(responseBytes(), { headers: { "content-type": "application/proto" } }));
    vi.stubGlobal("fetch", fetch);
    const snapshot = await getWorkspaceConfig();
    expect(snapshot.revision).toBe(5);
    expect(fetch.mock.calls[0]?.[0]).toContain("WorkspaceConfigService/Get");
    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/proto");
    expect(headers.get("Connect-Protocol-Version")).toBe("1");
    expect(headers.get("Accept")).toBe("application/proto");
  });

  it("loads a validated application catalog over Connect", async () => {
    const catalog = { schemaVersion: 1, apps: [{ id: "orders", name: "Orders", releases: [] }] };
    const fetch = vi.fn().mockResolvedValue(new Response(catalogResponseBytes(catalog), { headers: { "content-type": "application/proto" } }));
    vi.stubGlobal("fetch", fetch);
    const snapshot = await getApplicationCatalog();
    expect(snapshot).toEqual({ catalog, revision: 7 });
    expect(fetch.mock.calls[0]?.[0]).toContain("CatalogService/Get");
    await expect(Promise.resolve().then(() => {
      const invalid = catalogResponseBytes({ schemaVersion: 2, apps: [] });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(invalid)));
      return getApplicationCatalog();
    })).rejects.toThrow("unsupported application catalog");
  });

  it("sends authenticated updates and surfaces Connect errors", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(responseBytes(defaultNavigation, 6), { headers: { "content-type": "application/proto" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "permission_denied", message: "admin role required" }), { status: 403 }));
    vi.stubGlobal("fetch", fetch);
    expect((await updateWorkspaceConfig(defaultNavigation, 5, "access-token")).revision).toBe(6);
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer access-token");
    await expect(updateWorkspaceConfig(defaultNavigation, 5)).rejects.toThrow("admin role required");
  });

  it("uses Connect error codes and status when the response omits a message", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "permission_denied" }), { status: 403 }))
      .mockResolvedValueOnce(new Response("not JSON", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(updateWorkspaceConfig(defaultNavigation, 5)).rejects.toThrow("permission_denied: 403");
    await expect(getWorkspaceConfig()).rejects.toThrow("ConnectRPC: 503");
  });
});
