import { getAccessToken } from "../../shell/src/workspace/auth";
import { runtimeConfig } from "../../shell/src/runtime-config";

const API_ROOT = runtimeConfig.applicationGeneratorApiUrl ?? import.meta.env.VITE_APPLICATION_GENERATOR_API_URL ?? "http://127.0.0.1:4306";
const SERVICE = "modulaga.applicationgenerator.v1.ApplicationGeneratorService";

export type BakerQuestion = { type?: string; help?: string; default?: unknown; choices?: string[]; multiselect?: boolean; ask_if?: string; schema?: unknown; schema_file?: string };
export type ApplicationTemplate = { id: string; name: string; url: string; description: string; icon: string; questionsJson: string; createdAt: string; updatedAt: string };
export type TemplateInspection = { url: string; bakerYaml: string; questions: Record<string, BakerQuestion> };
export type GenerationRun = { id: string; templateId: string; templateName: string; templateUrl: string; status: string; destinationType: string; destination: string; outputPath: string; configurationJson: string; logs: string; createdAt: string; updatedAt: string };

function varint(value: number | bigint) {
  let left = BigInt(value); const output: number[] = [];
  while (left > 0x7fn) { output.push(Number((left & 0x7fn) | 0x80n)); left >>= 7n; }
  output.push(Number(left)); return output;
}
function stringField(field: number, value: string) {
  const bytes = new TextEncoder().encode(value); return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
}
type Field = { field: number; value: string | bigint | Uint8Array };
function decode(bytes: Uint8Array): Field[] {
  const result: Field[] = []; let cursor = 0;
  const readVarint = () => { let n = 0n; let shift = 0n; while (cursor < bytes.length && shift < 70n) { const b = bytes[cursor++]!; n |= BigInt(b & 127) << shift; if (!(b & 128)) return n; shift += 7n; } throw new Error("Generator returned malformed protobuf."); };
  while (cursor < bytes.length) {
    const tag = Number(readVarint()); const field = tag >>> 3; const wire = tag & 7;
    if (wire === 2) { const length = Number(readVarint()); const end = cursor + length; if (end > bytes.length) throw new Error("Generator returned truncated protobuf."); result.push({ field, value: bytes.slice(cursor, end) }); cursor = end; }
    else if (wire === 0) result.push({ field, value: readVarint() });
    else if (wire === 1 || wire === 5) cursor += wire === 1 ? 8 : 4;
    else throw new Error("Generator returned an unsupported protobuf field.");
    if (cursor > bytes.length) throw new Error("Generator returned truncated protobuf.");
  }
  return result;
}
const text = (field: Field | undefined) => field?.value instanceof Uint8Array ? new TextDecoder().decode(field.value) : "";
function decodeTemplate(bytes: Uint8Array): ApplicationTemplate {
  const fields = decode(bytes);
  return { id: text(fields.find((f) => f.field === 1)), name: text(fields.find((f) => f.field === 2)), url: text(fields.find((f) => f.field === 3)), description: text(fields.find((f) => f.field === 4)), icon: text(fields.find((f) => f.field === 5)), questionsJson: text(fields.find((f) => f.field === 6)), createdAt: text(fields.find((f) => f.field === 7)), updatedAt: text(fields.find((f) => f.field === 8)) };
}
function decodeRun(bytes: Uint8Array): GenerationRun {
  const fields = decode(bytes);
  return { id: text(fields.find((f) => f.field === 1)), templateName: text(fields.find((f) => f.field === 2)), templateUrl: text(fields.find((f) => f.field === 3)), status: text(fields.find((f) => f.field === 4)), destinationType: text(fields.find((f) => f.field === 5)), destination: text(fields.find((f) => f.field === 6)), outputPath: text(fields.find((f) => f.field === 7)), configurationJson: text(fields.find((f) => f.field === 8)), logs: text(fields.find((f) => f.field === 9)), createdAt: text(fields.find((f) => f.field === 10)), updatedAt: text(fields.find((f) => f.field === 11)), templateId: text(fields.find((f) => f.field === 12)) };
}
type Method = "ListTemplates" | "GetTemplate" | "CheckTemplate" | "CreateTemplate" | "UpdateTemplate" | "DeleteTemplate" | "ListGenerationRuns" | "GetGenerationRun" | "StartGeneration" | "DeleteGenerationRun";
async function call(method: Method, body: Uint8Array) {
  const headers = new Headers({ "Content-Type": "application/proto", "Connect-Protocol-Version": "1", Accept: "application/proto" });
  const token = getAccessToken(); if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_ROOT}/${SERVICE}/${method}`, { method: "POST", headers, body: Uint8Array.from(body).buffer });
  if (!response.ok) { const error = await response.json().catch(() => null) as { message?: string; code?: string } | null; throw new Error(error?.message ?? `${error?.code ?? "ConnectRPC"}: ${response.status}`); }
  return new Uint8Array(await response.arrayBuffer());
}
function listResponse(bytes: Uint8Array, field: number) {
  return decode(bytes).filter((f) => f.field === field && f.value instanceof Uint8Array).map((f) => f.value as Uint8Array);
}
export async function listTemplates() { return listResponse(await call("ListTemplates", new Uint8Array()), 1).map(decodeTemplate); }
export async function getTemplate(id: string) { return decodeTemplate(await call("GetTemplate", new Uint8Array(stringField(1, id)))); }
export async function inspectTemplate(url: string): Promise<TemplateInspection> {
  const fields = decode(await call("CheckTemplate", new Uint8Array(stringField(1, url))));
  const questionsRaw = text(fields.find((f) => f.field === 2));
  return { url: text(fields.find((f) => f.field === 1)), bakerYaml: text(fields.find((f) => f.field === 3)), questions: JSON.parse(questionsRaw || "{}") as Record<string, BakerQuestion> };
}
export async function createTemplate(input: { name: string; url: string; description: string; icon: string }) {
  const body = new Uint8Array([...stringField(1, input.name), ...stringField(2, input.url), ...stringField(3, input.description), ...stringField(4, input.icon)]);
  return decodeTemplate(await call("CreateTemplate", body));
}
export async function updateTemplate(input: { id: string; name: string; url: string; description: string; icon: string }) {
  const body = new Uint8Array([...stringField(1, input.id), ...stringField(2, input.name), ...stringField(3, input.url), ...stringField(4, input.description), ...stringField(5, input.icon)]);
  return decodeTemplate(await call("UpdateTemplate", body));
}
export async function deleteTemplate(id: string) { await call("DeleteTemplate", new Uint8Array(stringField(1, id))); }
export async function listGenerationRuns() { return listResponse(await call("ListGenerationRuns", new Uint8Array()), 1).map(decodeRun); }
export async function getGenerationRun(id: string) { return decodeRun(await call("GetGenerationRun", new Uint8Array(stringField(1, id)))); }
export async function startGeneration(input: { templateId: string; templateName: string; templateUrl: string; answers: Record<string, unknown>; destinationType: string; destination: string; branch: string }) {
  const body = new Uint8Array([...stringField(1, input.templateId), ...stringField(2, input.templateName), ...stringField(3, input.templateUrl), ...stringField(4, JSON.stringify(input.answers)), ...stringField(5, input.destinationType), ...stringField(6, input.destination), ...stringField(7, input.branch)]);
  return decodeRun(await call("StartGeneration", body));
}
export async function deleteGenerationRun(id: string) { await call("DeleteGenerationRun", new Uint8Array(stringField(1, id))); }
