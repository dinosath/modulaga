import { For, Show, createEffect, createSignal, onSettled } from "solid-js";
import { CirclePlus, Database, FilePlus2, ListFilter, Pencil, Plus, Save, Search, SlidersHorizontal, Trash2, X } from "@lucide/solid";
import type { MicrofrontendRouteContext } from "../../../packages/contracts/src/microfrontend";
import { Badge } from "../../shell/src/components/ui/badge";
import { Button } from "../../shell/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shell/src/components/ui/card";
import { Input } from "../../shell/src/components/ui/input";
import { deleteContentType, listContentTypes, saveContentType, type ContentTypeAttribute, type ContentTypeRecord, type ContentTypeSchema } from "./api";

const fieldTypes = ["string", "text", "richtext", "blocks", "integer", "biginteger", "decimal", "float", "date", "datetime", "time", "boolean", "email", "password", "enumeration", "json", "uid", "media", "relation", "component", "dynamiczone"];
const kindLabels: Record<ContentTypeSchema["kind"], string> = { collectionType: "Collection type", singleType: "Single type", component: "Component" };
const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "content";
const fieldSlug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function emptySchema(displayName: string, kind: ContentTypeSchema["kind"]): ContentTypeSchema {
  const singular = slug(displayName);
  const plural = `${singular}s`;
  return {
    uid: kind === "component" ? `shared.${singular}` : `api::${singular}.${singular}`,
    kind,
    ...(kind === "collectionType" ? { collectionName: `ct_${plural.replaceAll("-", "_")}` } : {}),
    info: { singularName: singular, pluralName: plural, displayName, description: "" },
    options: { draftAndPublish: false },
    attributes: {},
  };
}

export default function ContentTypesApp(props: { context: MicrofrontendRouteContext }) {
  const [records, setRecords] = createSignal<ContentTypeRecord[]>([]);
  const [selectedUid, setSelectedUid] = createSignal<string>();
  const [search, setSearch] = createSignal("");
  const [filterOpen, setFilterOpen] = createSignal(false);
  const [displayOpen, setDisplayOpen] = createSignal(false);
  const [columns, setColumns] = createSignal({ kind: true, uid: true, fields: true });
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [status, setStatus] = createSignal("");
  const [draft, setDraft] = createSignal<ContentTypeSchema>();
  const [createOpen, setCreateOpen] = createSignal(false);
  const [newName, setNewName] = createSignal("");
  const [newKind, setNewKind] = createSignal<ContentTypeSchema["kind"]>("collectionType");
  const [newFieldOpen, setNewFieldOpen] = createSignal(false);
  const [newFieldName, setNewFieldName] = createSignal("");
  const [newFieldType, setNewFieldType] = createSignal("string");
  const [newFieldRequired, setNewFieldRequired] = createSignal(false);
  const [newFieldUnique, setNewFieldUnique] = createSignal(false);
  const [enumValues, setEnumValues] = createSignal("");
  const [newFieldTarget, setNewFieldTarget] = createSignal("");
  const [newFieldRelation, setNewFieldRelation] = createSignal<NonNullable<ContentTypeAttribute["relation"]>>("manyToOne");
  const [newFieldMultiple, setNewFieldMultiple] = createSignal(false);

  const selected = () => records().find((record) => record.uid === selectedUid());
  const visibleRecords = () => records().filter((record) => `${record.schema.info.displayName} ${record.uid} ${record.schema.kind}`.toLowerCase().includes(search().trim().toLowerCase()));
  const updateDraft = (update: (schema: ContentTypeSchema) => ContentTypeSchema) => setDraft((current) => current ? update(current) : current);

  function returnToList() {
    setSelectedUid(undefined);
    setDraft(undefined);
  }

  createEffect(
    () => ({ record: selected(), draftName: draft()?.info.displayName }),
    ({ record, draftName }) => {
      if (!record) {
        props.context.setBreadcrumbs([]);
        return;
      }
      props.context.setBreadcrumbs([
        { label: "All content types", icon: "database", onClick: returnToList },
        { label: draftName ?? record.schema.info.displayName, icon: "database" },
      ]);
    },
  );

  async function refresh() {
    setLoading(true);
    try {
      const next = await listContentTypes();
      setRecords(next);
      if (selectedUid() && !next.some((record) => record.uid === selectedUid())) setSelectedUid(undefined);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load content types.");
    } finally {
      setLoading(false);
    }
  }

  onSettled(() => { void refresh(); });

  function createContentType() {
    const name = newName().trim();
    if (!name) return;
    const schema = emptySchema(name, newKind());
    setRecords((current) => [{ uid: schema.uid, schema, revision: 0 }, ...current]);
    setSelectedUid(schema.uid);
    setDraft(schema);
    setCreateOpen(false);
    setNewName("");
    setStatus("New content type. Add fields and save to store it.");
  }

  function addField(event: SubmitEvent) {
    event.preventDefault();
    const name = fieldSlug(newFieldName());
    if (!name || draft()?.attributes[name]) return;
    const field: ContentTypeAttribute = { type: newFieldType(), required: newFieldRequired(), unique: newFieldUnique() };
    if (field.type === "enumeration") field.enum = enumValues().split(",").map((value) => value.trim()).filter(Boolean);
    if (["relation", "component", "dynamiczone"].includes(field.type) && newFieldTarget().trim()) field.target = newFieldTarget().trim();
    if (field.type === "relation") field.relation = newFieldRelation();
    if (field.type === "media") field.multiple = newFieldMultiple();
    updateDraft((schema) => ({ ...schema, attributes: { ...schema.attributes, [name]: field } }));
    setNewFieldName("");
    setNewFieldType("string");
    setNewFieldRequired(false);
    setNewFieldUnique(false);
    setEnumValues("");
    setNewFieldTarget("");
    setNewFieldRelation("manyToOne");
    setNewFieldMultiple(false);
    setNewFieldOpen(false);
  }

  async function save() {
    const schema = draft();
    if (!schema) return;
    setSaving(true);
    setStatus("Saving content type…");
    try {
      const current = records().find((record) => record.uid === schema.uid);
      const saved = await saveContentType(schema, current?.revision ?? 0);
      setRecords((all) => [saved, ...all.filter((record) => record.uid !== saved.uid)]);
      setDraft(saved.schema);
      setStatus("Content type saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save content type.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(uid: string) {
    const record = records().find((item) => item.uid === uid);
    if (!record || !window.confirm(`Delete ${record.schema.info.displayName}?`)) return;
    try {
      await deleteContentType(uid);
      setRecords((all) => all.filter((item) => item.uid !== uid));
      if (selectedUid() === uid) { setSelectedUid(undefined); setDraft(undefined); }
      setStatus(`${record.schema.info.displayName} deleted.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete content type.");
    }
  }

  function moveField(fieldName: string, direction: -1 | 1) {
    updateDraft((schema) => {
      const fields = Object.entries(schema.attributes);
      const index = fields.findIndex(([name]) => name === fieldName);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= fields.length) return schema;
      [fields[index], fields[target]] = [fields[target]!, fields[index]!];
      return { ...schema, attributes: Object.fromEntries(fields) };
    });
  }

  return <div class="mx-auto w-full max-w-[1500px] space-y-6 text-foreground">
    <Show when={!selected()} fallback={<>
      <Show when={draft()} keyed>{(schema) => <div class="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        <div class="space-y-5">
          <Card>
            <CardHeader class="flex-row items-start justify-between gap-3"><div><CardTitle>Content type settings</CardTitle><CardDescription>Change the identity and publishing behavior for this schema.</CardDescription></div><Button type="button" disabled={saving()} onClick={() => void save()}><Save class="size-4" />{saving() ? "Saving…" : "Save changes"}</Button></CardHeader>
            <CardContent class="grid gap-4 sm:grid-cols-2">
              <label class="grid gap-2 text-sm font-medium">Display name<Input aria-label="Content type display name" value={schema.info.displayName} onInput={(event) => updateDraft((current) => ({ ...current, info: { ...current.info, displayName: event.currentTarget.value } }))} /></label>
              <label class="grid gap-2 text-sm font-medium">Schema kind<select aria-label="Content type kind" disabled={(selected()?.revision ?? 0) > 0} class={selectClass} value={schema.kind} onChange={(event) => updateDraft((current) => {
                const kind = event.currentTarget.value as ContentTypeSchema["kind"];
                const { collectionName: _collectionName, ...withoutCollectionName } = current;
                return { ...withoutCollectionName, kind, uid: kind === "component" ? `shared.${current.info.singularName}` : `api::${current.info.singularName}.${current.info.singularName}`, ...(kind === "collectionType" ? { collectionName: `ct_${current.info.pluralName}` } : {}) };
              })}><For each={Object.entries(kindLabels)}>{([value, label]) => <option value={value}>{label}</option>}</For></select></label>
              <label class="grid gap-2 text-sm font-medium">Singular name<Input aria-label="Singular name" disabled={(selected()?.revision ?? 0) > 0} value={schema.info.singularName} onInput={(event) => updateDraft((current) => ({ ...current, info: { ...current.info, singularName: fieldSlug(event.currentTarget.value) }, uid: current.kind === "component" ? `shared.${fieldSlug(event.currentTarget.value)}` : `api::${fieldSlug(event.currentTarget.value)}.${fieldSlug(event.currentTarget.value)}` }))} /></label>
              <label class="grid gap-2 text-sm font-medium">Plural name<Input aria-label="Plural name" value={schema.info.pluralName} onInput={(event) => updateDraft((current) => ({ ...current, info: { ...current.info, pluralName: fieldSlug(event.currentTarget.value) } }))} /></label>
              <label class="grid gap-2 text-sm font-medium sm:col-span-2">Description<Input aria-label="Content type description" value={schema.info.description ?? ""} onInput={(event) => updateDraft((current) => ({ ...current, info: { ...current.info, description: event.currentTarget.value } }))} /></label>
              <label class="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={schema.options.draftAndPublish} onChange={(event) => updateDraft((current) => ({ ...current, options: { ...current.options, draftAndPublish: event.currentTarget.checked } }))} />Enable draft and publish workflow</label>
              <p class="text-xs text-muted-foreground sm:col-span-2">UID: <code>{schema.uid}</code></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader class="flex-row items-start justify-between gap-3"><div><CardTitle>Fields <Badge variant="secondary" class="ml-2">{Object.keys(schema.attributes).length}</Badge></CardTitle><CardDescription>Fields become columns in the generated SQLite table where supported.</CardDescription></div><Button variant="outline" type="button" onClick={() => setNewFieldOpen((open) => !open)}><CirclePlus class="size-4" />Add field</Button></CardHeader>
            <CardContent class="space-y-3">
              <Show when={newFieldOpen()}><form class="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-[1fr_1fr_auto_auto_auto] sm:items-end" onSubmit={addField}>
                <label class="grid gap-2 text-sm font-medium">Field name<Input aria-label="New field name" placeholder="e.g. published_at" value={newFieldName()} onInput={(event) => setNewFieldName(event.currentTarget.value)} required /></label>
                <label class="grid gap-2 text-sm font-medium">Field type<select aria-label="New field type" class={selectClass} value={newFieldType()} onChange={(event) => setNewFieldType(event.currentTarget.value)}><For each={fieldTypes}>{(type) => <option value={type}>{type}</option>}</For></select></label>
                <label class="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={newFieldRequired()} onChange={(event) => setNewFieldRequired(event.currentTarget.checked)} />Required</label>
                <label class="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={newFieldUnique()} onChange={(event) => setNewFieldUnique(event.currentTarget.checked)} />Unique</label>
                <Button type="submit"><Plus class="size-4" />Add</Button>
                <Show when={newFieldType() === "enumeration"}><label class="grid gap-2 text-sm font-medium sm:col-span-2">Values, comma separated<Input aria-label="Enumeration values" placeholder="draft, published" value={enumValues()} onInput={(event) => setEnumValues(event.currentTarget.value)} /></label></Show>
                <Show when={["relation", "component", "dynamiczone"].includes(newFieldType())}><label class="grid gap-2 text-sm font-medium sm:col-span-2">Target schema UID<Input aria-label="Target schema UID" placeholder="api::author.author" value={newFieldTarget()} onInput={(event) => setNewFieldTarget(event.currentTarget.value)} /></label></Show>
                <Show when={newFieldType() === "relation"}><label class="grid gap-2 text-sm font-medium">Relation<select aria-label="Relation cardinality" class={selectClass} value={newFieldRelation()} onChange={(event) => setNewFieldRelation(event.currentTarget.value as NonNullable<ContentTypeAttribute["relation"]>)}><option value="oneToOne">One to one</option><option value="oneToMany">One to many</option><option value="manyToOne">Many to one</option><option value="manyToMany">Many to many</option></select></label></Show>
                <Show when={newFieldType() === "media"}><label class="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={newFieldMultiple()} onChange={(event) => setNewFieldMultiple(event.currentTarget.checked)} />Multiple files</label></Show>
              </form></Show>
              <Show when={Object.keys(schema.attributes).length > 0} fallback={<div class="rounded-lg border border-dashed border-border p-8 text-center"><FilePlus2 class="mx-auto mb-3 size-6 text-muted-foreground" /><p class="font-medium">No fields defined</p><p class="mt-1 text-sm text-muted-foreground">Add fields to describe this content type.</p></div>}>
                <div class="divide-y divide-border rounded-lg border border-border">
                  <For each={Object.entries(schema.attributes)}>{([name, field], index) => <div class="flex min-w-0 items-center gap-3 p-3">
                    <div class="grid size-9 shrink-0 place-items-center rounded-md bg-muted"><Database class="size-4 text-muted-foreground" /></div>
                    <div class="min-w-0 flex-1"><p class="truncate text-sm font-medium">{name}</p><p class="truncate text-xs text-muted-foreground">{field.type}{field.enum?.length ? ` · ${field.enum.join(", ")}` : ""}</p></div>
                    <Show when={field.required}><Badge variant="outline">Required</Badge></Show><Show when={field.unique}><Badge variant="secondary">Unique</Badge></Show>
                    <div class="flex shrink-0 items-center gap-1"><Button type="button" size="icon" variant="ghost" aria-label={`Move ${name} up`} disabled={index() === 0} onClick={() => moveField(name, -1)}>↑</Button><Button type="button" size="icon" variant="ghost" aria-label={`Move ${name} down`} disabled={index() === Object.keys(schema.attributes).length - 1} onClick={() => moveField(name, 1)}>↓</Button><Button type="button" size="icon" variant="ghost" aria-label={`Delete field ${name}`} onClick={() => updateDraft((current) => { const { [name]: _removed, ...attributes } = current.attributes; return { ...current, attributes }; })}><Trash2 class="size-4" /></Button></div>
                  </div>}</For>
                </div>
              </Show>
            </CardContent>
          </Card>
        </div>

        <Card class="h-fit">
          <CardHeader><CardTitle>Trailbase table schema</CardTitle><CardDescription>SQLite table metadata is derived from fields when the schema is saved.</CardDescription></CardHeader>
          <CardContent>
            <Show when={schema.tableSchema} fallback={<div class="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">Save this type to generate its Trailbase table schema.</div>}>
              <div class="space-y-3"><p class="font-mono text-sm">{schema.tableSchema?.name.name}</p><div class="divide-y divide-border rounded-md border border-border"><For each={schema.tableSchema?.columns ?? []}>{(column) => <div class="flex items-center justify-between gap-2 p-2.5 text-xs"><span class="font-medium">{column.name}</span><span class="text-muted-foreground">{column.type_name} · {column.affinity_type}</span></div>}</For></div><p class="text-xs text-muted-foreground">Strict SQLite table · Trailbase schema shape</p></div>
            </Show>
          </CardContent>
        </Card>
      </div>}</Show>
    </>}>
      <section class="overflow-hidden rounded-xl border border-border bg-background">
        <div class="flex min-h-14 items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div class="flex min-w-0 items-center gap-2"><h2 class="text-sm font-medium">Content types</h2><Badge variant="secondary" class="px-2 py-0.5 text-xs">{records().length}</Badge></div>
          <div class="flex shrink-0 items-center gap-2">
            <Button type="button" variant={filterOpen() ? "secondary" : "ghost"} size="sm" aria-expanded={filterOpen() ? "true" : "false"} onClick={() => setFilterOpen((open) => !open)}><ListFilter class="size-4" />Filter</Button>
            <div class="relative">
              <Button type="button" variant="outline" size="sm" aria-expanded={displayOpen() ? "true" : "false"} onClick={() => setDisplayOpen((open) => !open)}><SlidersHorizontal class="size-4" />Display</Button>
              <Show when={displayOpen()}><div class="absolute right-0 top-10 z-20 w-44 rounded-lg border border-border bg-background p-2 shadow-lg" role="group" aria-label="Display columns">
                <For each={[
                  { key: "kind" as const, label: "Kind" },
                  { key: "uid" as const, label: "UID" },
                  { key: "fields" as const, label: "Fields" },
                ]}>{(column) => <label class="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"><input type="checkbox" checked={columns()[column.key]} onChange={(event) => setColumns((current) => ({ ...current, [column.key]: event.currentTarget.checked }))} />{column.label}</label>}</For>
              </div></Show>
            </div>
            <Button class="shrink-0" type="button" size="sm" onClick={() => setCreateOpen(true)}><Plus class="size-4" />Create content type</Button>
          </div>
        </div>
        <Show when={filterOpen()}><div class="border-b border-border px-4 py-3"><label class="flex h-9 max-w-sm items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground"><Search class="size-4" /><input aria-label="Search content types" class="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground" placeholder="Filter content types..." value={search()} onInput={(event) => setSearch(event.currentTarget.value)} /></label></div></Show>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead class="text-muted-foreground"><tr class="border-b border-border">
              <th class="px-4 py-3 font-medium">Name</th>
              <Show when={columns().kind}><th class="px-4 py-3 font-medium">Kind</th></Show>
              <Show when={columns().uid}><th class="px-4 py-3 font-medium">UID</th></Show>
              <Show when={columns().fields}><th class="px-4 py-3 font-medium">Fields</th></Show>
              <th class="w-24 px-4 py-3"><span class="sr-only">Actions</span></th>
            </tr></thead>
            <tbody>
              <Show when={!loading()} fallback={<tr><td class="px-4 py-10 text-center text-sm text-muted-foreground" colspan={2 + Number(columns().kind) + Number(columns().uid) + Number(columns().fields)}>Loading content types…</td></tr>}>
                <Show when={visibleRecords().length > 0} fallback={<tr><td class="px-4 py-10 text-center" colspan={2 + Number(columns().kind) + Number(columns().uid) + Number(columns().fields)}><FilePlus2 class="mx-auto mb-2 size-6 text-muted-foreground" /><p class="font-medium">{search().trim() ? "No matching content types" : "No content types yet"}</p><p class="mt-1 text-sm text-muted-foreground">{search().trim() ? "Try another filter." : "Create a content type to begin modeling your data."}</p></td></tr>}>
                  <For each={visibleRecords()}>{(record) => <tr class="border-b border-border last:border-0 hover:bg-muted/30">
                    <td class="px-4 py-3"><div class="flex items-center gap-3"><span class="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><Database class="size-4" /></span><button class="min-w-0 text-left hover:underline" type="button" onClick={() => { setSelectedUid(record.uid); setDraft(record.schema); }}><span class="block truncate font-medium">{record.schema.info.displayName}</span><span class="block truncate text-xs uppercase text-muted-foreground">{record.schema.info.singularName}</span></button></div></td>
                    <Show when={columns().kind}><td class="px-4 py-3"><Badge variant="outline">{kindLabels[record.schema.kind]}</Badge></td></Show>
                    <Show when={columns().uid}><td class="px-4 py-3 font-mono text-xs text-muted-foreground">{record.uid}</td></Show>
                    <Show when={columns().fields}><td class="px-4 py-3">{Object.keys(record.schema.attributes).length}</td></Show>
                    <td class="px-4 py-3 text-right"><Button type="button" size="sm" variant="ghost" aria-label={`Edit ${record.schema.info.displayName}`} onClick={() => { setSelectedUid(record.uid); setDraft(record.schema); }}><Pencil class="size-4" />Edit</Button><Button type="button" size="icon" variant="ghost" aria-label={`Delete ${record.schema.info.displayName}`} onClick={() => void remove(record.uid)}><Trash2 class="size-4" /></Button></td>
                  </tr>}</For>
                </Show>
              </Show>
            </tbody>
          </table>
        </div>
      </section>
    </Show>

    <p class="min-h-5 text-sm text-muted-foreground" role="status" aria-live="polite">{status()}</p>
    <Show when={createOpen()}><div class="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/50 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setCreateOpen(false); }}><section class="w-full max-w-md rounded-xl border border-border bg-background p-6 text-foreground shadow-xl" role="dialog" aria-modal="true" aria-labelledby="content-type-dialog-title"><form class="grid gap-4" onSubmit={(event) => { event.preventDefault(); createContentType(); }}><header class="space-y-1"><h2 class="text-lg font-semibold" id="content-type-dialog-title">Create content type</h2><p class="text-sm text-muted-foreground">Choose the schema kind and give it a display name.</p></header><label class="grid gap-2 text-sm font-medium">Display name<Input aria-label="New content type name" placeholder="e.g. Article" value={newName()} onInput={(event) => setNewName(event.currentTarget.value)} required /></label><label class="grid gap-2 text-sm font-medium">Kind<select aria-label="New content type kind" class={selectClass} value={newKind()} onChange={(event) => setNewKind(event.currentTarget.value as ContentTypeSchema["kind"])}><For each={Object.entries(kindLabels)}>{([value, label]) => <option value={value}>{label}</option>}</For></select></label><footer class="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}><X class="size-4" />Cancel</Button><Button type="submit"><Plus class="size-4" />Create</Button></footer></form></section></div></Show>
  </div>;
}
