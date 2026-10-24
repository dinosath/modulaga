import { runtimeConfig } from "../../shell/src/runtime-config";
import { getAccessToken } from "../../shell/src/workspace/auth";

const API_ROOT = runtimeConfig.contentTypesApiUrl ?? import.meta.env.VITE_CONTENT_TYPES_API_URL ?? "http://127.0.0.1:4305";
const SERVICE = "modulaga.contenttypes.v1.ContentTypesService";

export type ContentTypeSchema = {
  uid: string;
  kind: "collectionType" | "singleType" | "component";
  collectionName?: string;
  info: { singularName: string; pluralName: string; displayName: string; description?: string };
  options: { draftAndPublish: boolean };
  attributes: Record<string, ContentTypeAttribute>;
  tableSchema?: TrailbaseTable;
};
export type ContentTypeAttribute = {
  type: string;
  required?: boolean;
  unique?: boolean;
  default?: unknown;
  enum?: string[];
  target?: string;
  relation?: "oneToOne" | "oneToMany" | "manyToOne" | "manyToMany";
  multiple?: boolean;
};
export type TrailbaseTable = {
  name: { name: string; database_schema: string | null };
  strict: boolean;
  columns: { name: string; type_name: string; data_type: string; affinity_type: string; options: unknown[] }[];
  foreign_keys: unknown[];
  unique: unknown[];
  checks: unknown[];
  virtual_table: boolean;
  temporary: boolean;
};
export type ContentTypeRecord = { uid: string; schema: ContentTypeSchema; revision: number };

function varint(value: number | bigint) {
  let left = BigInt(value);
  const output: number[] = [];
  while (left > 0x7fn) {
    output.push(Number((left & 0x7fn) | 0x80n));
    left >>= 7n;
  }
  output.push(Number(left));
  return output;
}

function stringField(field: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
}

function decodeFields(bytes: Uint8Array) {
  const result: { field: number; wire: number; value: string | bigint | Uint8Array }[] = [];
  const cursor = { value: 0 };
  const readVarint = () => {
    let value = 0n;
    let shift = 0n;
    while (cursor.value < bytes.length && shift < 70n) {
      const byte = bytes[cursor.value++]!;
      value |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7n;
    }
    throw new Error("Content types service returned malformed protobuf data.");
  };
  while (cursor.value < bytes.length) {
    const tag = Number(readVarint());
    const field = tag >>> 3;
    const wire = tag & 7;
    if (wire === 2) {
      const length = Number(readVarint());
      const end = cursor.value + length;
      if (end > bytes.length) throw new Error("Content types service returned truncated protobuf data.");
      const payload = bytes.slice(cursor.value, end);
      cursor.value = end;
      result.push({ field, wire, value: payload });
    } else if (wire === 0) {
      result.push({ field, wire, value: readVarint() });
    } else if (wire === 1) cursor.value += 8;
    else if (wire === 5) cursor.value += 4;
    else throw new Error("Content types service returned an unsupported protobuf field.");
    if (cursor.value > bytes.length) throw new Error("Content types service returned truncated protobuf data.");
  }
  return result;
}

function fieldText(field: { value: string | bigint | Uint8Array } | undefined) {
  return field?.value instanceof Uint8Array ? new TextDecoder().decode(field.value) : "";
}

function decodeRecord(bytes: Uint8Array): ContentTypeRecord {
  const fields = decodeFields(bytes);
  const uid = fieldText(fields.find((item) => item.field === 1));
  const json = fieldText(fields.find((item) => item.field === 2));
  const revision = Number(fields.find((item) => item.field === 3)?.value ?? 0n);
  if (!uid || !json) throw new Error("Content types service returned an incomplete content type.");
  return { uid, schema: JSON.parse(json) as ContentTypeSchema, revision };
}

async function call(method: "List" | "Get" | "Save" | "Delete", body: Uint8Array) {
  const headers = new Headers({ "Content-Type": "application/proto", "Connect-Protocol-Version": "1", Accept: "application/proto" });
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_ROOT}/${SERVICE}/${method}`, { method: "POST", headers, body: Uint8Array.from(body).buffer });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string; code?: string } | null;
    throw new Error(error?.message ?? `${error?.code ?? "ConnectRPC"}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function listContentTypes(): Promise<ContentTypeRecord[]> {
  const response = decodeFields(await call("List", new Uint8Array()));
  return response.filter((field) => field.field === 1 && field.value instanceof Uint8Array).map((field) => decodeRecord(field.value as Uint8Array));
}

export async function saveContentType(schema: ContentTypeSchema, expectedRevision: number): Promise<ContentTypeRecord> {
  const body = new Uint8Array([
    ...stringField(1, schema.uid),
    ...stringField(2, JSON.stringify(schema)),
    ...varint((3 << 3) | 0),
    ...varint(expectedRevision),
  ]);
  return decodeRecord(await call("Save", body));
}

export async function deleteContentType(uid: string): Promise<void> {
  const response = decodeFields(await call("Delete", new Uint8Array(stringField(1, uid))));
  if (!response.some((field) => field.field === 1 && field.value === 1n)) throw new Error("Content type could not be deleted.");
}
