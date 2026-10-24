import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";
import { Boxes, Check, CircleAlert, FileCode2, LoaderCircle, Pencil, Plus, RefreshCw, Rocket, Trash2 } from "@lucide/solid";
import type { MicrofrontendRouteContext } from "../../../packages/contracts/src/microfrontend";
import { authConfigured, finishSignIn, getAccessToken, signOut, startSignIn } from "../../shell/src/workspace/auth";
import { Badge } from "../../shell/src/components/ui/badge";
import { Button } from "../../shell/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shell/src/components/ui/card";
import { Input } from "../../shell/src/components/ui/input";
import { createTemplate, deleteGenerationRun, deleteTemplate, getGenerationRun, inspectTemplate, listGenerationRuns, listTemplates, startGeneration, updateTemplate, type ApplicationTemplate, type BakerQuestion, type GenerationRun, type TemplateInspection } from "./api";

type Page = "generate.template" | "generate.answers" | "templates.list" | "templates.create" | "templates.edit" | "runs.list" | "runs.detail";
const defaultAnswer = (question: BakerQuestion): unknown => question.default ?? (question.type === "bool" ? false : question.multiselect ? [] : question.choices?.[0] ?? (question.type === "json" || question.type === "yaml" ? {} : ""));

export default function ApplicationGeneratorApp(props: { context: MicrofrontendRouteContext }) {
  const generatorBasePath = props.context.path.replace(/\/templates(?:\/(?:create|edit))?\/?$/, "");
  const initialPage: Page = props.context.path.endsWith("/templates/create") ? "templates.create"
    : props.context.path.endsWith("/templates/edit") ? "templates.edit"
      : props.context.path.endsWith("/templates") ? "templates.list" : "generate.template";
  const [page, setPage] = createSignal<Page>(initialPage);
  const [templates, setTemplates] = createSignal<ApplicationTemplate[]>([]);
  const [runs, setRuns] = createSignal<GenerationRun[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = createSignal("");
  const [templateSource, setTemplateSource] = createSignal<"saved" | "url">("saved");
  const [templateName, setTemplateName] = createSignal("");
  const [templateUrl, setTemplateUrl] = createSignal("");
  const [templateDescription, setTemplateDescription] = createSignal("");
  const [templateIcon, setTemplateIcon] = createSignal("");
  const [templateEditId, setTemplateEditId] = createSignal("");
  const [inspection, setInspection] = createSignal<TemplateInspection>();
  const [questionAnswers, setQuestionAnswers] = createSignal<Record<string, unknown>>({});
  const [complexDrafts, setComplexDrafts] = createSignal<Record<string, string>>({});
  const [destinationType, setDestinationType] = createSignal("local");
  const [destination, setDestination] = createSignal("");
  const [branch, setBranch] = createSignal("");
  const [runId, setRunId] = createSignal("");
  const [activeRun, setActiveRun] = createSignal<GenerationRun>();
  const [busy, setBusy] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");
  const [token, setToken] = createSignal(getAccessToken() ?? "");
  let runTimer: number | undefined;

  function navigatePage(next: Page, templateId = "") {
    setPage(next);
    const suffix = next === "templates.list" ? "/templates"
      : next === "templates.create" ? "/templates/create"
        : next === "templates.edit" ? `/templates/edit${templateId ? `?id=${encodeURIComponent(templateId)}` : ""}`
          : "";
    const path = `${generatorBasePath}${suffix}`;
    if (window.location.pathname + window.location.search !== path) window.history.pushState({}, "", path);
  }

  async function refresh() {
    setLoading(true); setError("");
    try {
      const [savedTemplates, savedRuns] = await Promise.all([listTemplates(), listGenerationRuns()]);
      setTemplates(savedTemplates); setRuns(savedRuns);
      if (!selectedTemplateId() && savedTemplates.length) setSelectedTemplateId(savedTemplates[0]!.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load application generator data."); }
    finally { setLoading(false); }
  }

  onSettled(() => {
    props.context.setBreadcrumbs([{ label: "Application generator", icon: "boxes" }]);
    void finishSignIn().then((completed) => { if (completed) setToken(getAccessToken() ?? ""); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Sign-in failed."))
      .finally(() => void refresh().then(() => {
        if (initialPage === "templates.edit") {
          const id = new URLSearchParams(window.location.search).get("id");
          const template = templates().find((item) => item.id === id);
          if (template) void editSavedTemplate(template);
          else navigatePage("templates.list");
        }
      }));
  });
  onCleanup(() => { if (runTimer !== undefined) window.clearInterval(runTimer); });

  function questionsFromJson(raw: string): Record<string, BakerQuestion> {
    const parsed = JSON.parse(raw || "{}") as Record<string, BakerQuestion>;
    return parsed;
  }

  function useInspection(result: TemplateInspection) {
    setInspection(result);
    const initial = Object.fromEntries(Object.entries(result.questions).map(([key, question]) => [key, defaultAnswer(question)]));
    setQuestionAnswers(initial); setComplexDrafts({});
  }

  async function inspectSource(source: string) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await inspectTemplate(source.trim()); useInspection(result); setNotice(`Valid Baker template: ${Object.keys(result.questions).length} question${Object.keys(result.questions).length === 1 ? "" : "s"} loaded.`); }
    catch (reason) { setInspection(undefined); setError(reason instanceof Error ? reason.message : "Could not load baker.yaml from this template."); }
    finally { setBusy(false); }
  }

  function startNewTemplate() {
    setTemplateEditId(""); setTemplateName(""); setTemplateUrl(""); setTemplateDescription(""); setTemplateIcon(""); setInspection(undefined); setError(""); setNotice(""); navigatePage("templates.create");
  }

  async function editSavedTemplate(template: ApplicationTemplate) {
    setTemplateEditId(template.id); setTemplateName(template.name); setTemplateUrl(template.url); setTemplateDescription(template.description); setTemplateIcon(template.icon);
    setError(""); setNotice("");
    try { const manifest = await inspectTemplate(template.url); useInspection(manifest); }
    catch (reason) { setInspection(undefined); setError(reason instanceof Error ? reason.message : "Could not load baker.yaml from this template."); }
    navigatePage("templates.edit", template.id);
  }

  async function saveTemplate(event: SubmitEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const input = { name: templateName().trim(), url: templateUrl().trim(), description: templateDescription().trim(), icon: templateIcon().trim() };
      const saved = templateEditId() ? await updateTemplate({ id: templateEditId(), ...input }) : await createTemplate(input);
      setTemplates((current) => [...current.filter((item) => item.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name)));
      setNotice(`${saved.name} was saved.`); navigatePage("templates.list");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the template."); }
    finally { setBusy(false); }
  }

  async function removeTemplate(template: ApplicationTemplate) {
    if (!window.confirm(`Delete the template “${template.name}”?`)) return;
    setBusy(true); setError("");
    try { await deleteTemplate(template.id); setTemplates((current) => current.filter((item) => item.id !== template.id)); setNotice(`${template.name} was deleted.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the template."); }
    finally { setBusy(false); }
  }

  async function proceedToAnswers() {
    setError(""); setNotice("");
    if (templateSource() === "saved") {
      const selected = templates().find((item) => item.id === selectedTemplateId());
      if (!selected) { setError("Choose a saved template or add a template URL."); return; }
      if (inspection()?.url === selected.url) { navigatePage("generate.answers"); return; }
      await inspectSource(selected.url);
      if (!inspection()) return;
    } else {
      if (!inspection() || inspection()?.url !== templateUrl().trim()) { await inspectSource(templateUrl()); if (!inspection()) return; }
      setTemplateName(templateName().trim() || "New template");
    }
    navigatePage("generate.answers");
  }

  function setAnswer(key: string, value: unknown) { setQuestionAnswers((current) => ({ ...current, [key]: value })); }

  function renderQuestion(key: string, question: BakerQuestion) {
    const help = question.help?.trim() || key.replaceAll("_", " ");
    const current = () => questionAnswers()[key] ?? defaultAnswer(question);
    const selectedChoices = () => Array.isArray(current()) ? current() as string[] : [];
    return <fieldset class="grid gap-2 rounded-lg border border-border p-4" aria-label={key}>
      <legend class="px-1 text-sm font-medium">{help}</legend>
      <Show when={question.ask_if}><p class="text-xs text-muted-foreground">Conditional question: {question.ask_if}</p></Show>
      <Show when={question.multiselect && question.choices?.length}>
        <div class="grid gap-2 sm:grid-cols-2"><For each={question.choices ?? []}>{(choice) => <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="size-4 accent-foreground" checked={selectedChoices().includes(choice)} onChange={(event) => { const values = selectedChoices(); setAnswer(key, event.currentTarget.checked ? [...values, choice] : values.filter((item) => item !== choice)); }} />{choice}</label>}</For></div>
      </Show>
      <Show when={!question.multiselect && question.choices?.length}>
        <select class="min-h-9 rounded-md border border-input bg-background px-3 text-sm" value={String(current() ?? "")} onChange={(event) => setAnswer(key, event.currentTarget.value)}><For each={question.choices ?? []}>{(choice) => <option value={choice}>{choice}</option>}</For></select>
      </Show>
      <Show when={question.type === "bool"}>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="size-4 accent-foreground" checked={Boolean(current())} onChange={(event) => setAnswer(key, event.currentTarget.checked)} />Enabled</label>
      </Show>
      <Show when={question.type === "json" || question.type === "yaml"}>
        <textarea class="min-h-32 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${key} ${question.type} value`} value={complexDrafts()[key] ?? JSON.stringify(current(), null, 2)} onInput={(event) => { const raw = event.currentTarget.value; setComplexDrafts((values) => ({ ...values, [key]: raw })); if (question.type === "yaml") { setAnswer(key, raw); return; } try { setAnswer(key, JSON.parse(raw)); setError(""); } catch { setError(`${key} must contain valid JSON.`); } }} />
        <p class="text-xs text-muted-foreground">Enter a {question.type === "yaml" ? "YAML document (JSON is also valid YAML)" : "JSON value"}. Baker will validate it against the template.</p>
      </Show>
      <Show when={(!question.type || question.type === "str") && !question.choices?.length}>
        <Input value={String(current() ?? "")} onInput={(event) => setAnswer(key, event.currentTarget.value)} />
      </Show>
    </fieldset>;
  }

  async function createRun(event: SubmitEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const saved = templateSource() === "saved" ? templates().find((item) => item.id === selectedTemplateId()) : undefined;
    const selectedInspection = inspection();
    if (!selectedInspection) { setError("Check the template URL before generating."); setBusy(false); return; }
    try {
      const run = await startGeneration({ templateId: saved?.id ?? "", templateName: saved?.name ?? templateName().trim(), templateUrl: saved?.url ?? selectedInspection.url, answers: questionAnswers(), destinationType: destinationType(), destination: destination().trim(), branch: branch().trim() });
      setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]); openRun(run.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start generation."); }
    finally { setBusy(false); }
  }

  async function loadRun(id: string) {
    try { const run = await getGenerationRun(id); setActiveRun(run); setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]); if (["succeeded", "failed", "cancelled"].includes(run.status) && runTimer !== undefined) { window.clearInterval(runTimer); runTimer = undefined; } }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load generation run."); }
  }
  function openRun(id: string) {
    if (runTimer !== undefined) window.clearInterval(runTimer);
    setRunId(id); setActiveRun(runs().find((run) => run.id === id)); setPage("runs.detail"); void loadRun(id);
    runTimer = window.setInterval(() => void loadRun(id), 2000);
  }
  async function removeRun(run: GenerationRun) {
    if (["queued", "running"].includes(run.status)) { setError("An active generation run cannot be deleted."); return; }
    if (!window.confirm(`Delete the run for ${run.templateName}?`)) return;
    setBusy(true); setError("");
    try {
      await deleteGenerationRun(run.id);
      setRuns((current) => current.filter((item) => item.id !== run.id));
      if (runTimer !== undefined) { window.clearInterval(runTimer); runTimer = undefined; }
      setActiveRun(undefined); setPage("runs.list"); setNotice("Generation run deleted.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete generation run."); }
    finally { setBusy(false); }
  }
  function configuration(run: GenerationRun) {
    try { return JSON.stringify(JSON.parse(run.configurationJson || "{}"), null, 2); }
    catch { return "The saved generation configuration is malformed."; }
  }

  const currentQuestions = () => inspection()?.questions ?? {};
  const editingTemplate = () => page() === "templates.edit";

  return <main class="mx-auto w-full max-w-6xl space-y-6 p-5 sm:p-8">
    <header class="flex flex-wrap items-start justify-between gap-4"><div><p class="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><Boxes class="size-4" />Applications / Generator</p><h1 class="text-3xl font-semibold tracking-tight">Application generator</h1><p class="mt-1 text-sm text-muted-foreground">Choose a Baker template, configure it, and track generated output.</p></div><div class="flex items-center gap-2"><Show when={authConfigured}><Button variant="outline" onClick={() => token() ? (signOut(), setToken("")) : void startSignIn().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Sign-in failed."))}>{token() ? "Sign out" : "Sign in"}</Button></Show><Button variant="outline" onClick={() => void refresh()}><RefreshCw class="size-4" />Refresh</Button></div></header>
    <nav class="flex flex-wrap gap-2 border-b border-border pb-2" aria-label="Application generator pages"><Button type="button" variant={page().startsWith("generate") ? "secondary" : "ghost"} onClick={() => { setError(""); if (runTimer !== undefined) { window.clearInterval(runTimer); runTimer = undefined; } navigatePage("generate.template"); }}>Generate</Button><Button type="button" variant={page().startsWith("templates") ? "secondary" : "ghost"} onClick={() => { setError(""); if (runTimer !== undefined) { window.clearInterval(runTimer); runTimer = undefined; } navigatePage("templates.list"); }}>Templates</Button><Button type="button" variant={page().startsWith("runs") ? "secondary" : "ghost"} onClick={() => { setError(""); if (runTimer !== undefined) { window.clearInterval(runTimer); runTimer = undefined; } navigatePage("runs.list"); }}>Runs</Button></nav>
    <Show when={error()}><div class="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert"><CircleAlert class="mt-0.5 size-4 shrink-0" /><span>{error()}</span></div></Show>
    <Show when={notice()}><div class="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm" role="status"><Check class="mt-0.5 size-4 shrink-0" /><span>{notice()}</span></div></Show>

    <Show when={page() === "templates.list"}>
      <section class="space-y-4"><div class="flex items-center justify-between gap-3"><div><h2 class="text-2xl font-semibold">Templates</h2><p class="text-sm text-muted-foreground">Manage validated Baker template sources.</p></div><Button onClick={startNewTemplate}><Plus class="size-4" />Create template</Button></div><Show when={!loading()} fallback={<div class="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading templates…</div>}><Show when={templates().length} fallback={<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No templates saved yet.</div>}><div class="divide-y divide-border overflow-hidden rounded-lg border border-border"><For each={templates()}>{(template) => <article class="flex flex-wrap items-center gap-4 p-4"><div class="min-w-0 flex-1"><h3 class="font-medium">{template.name}</h3><a class="block truncate text-sm text-primary hover:underline" href={template.url} target="_blank" rel="noopener noreferrer">{template.url}</a><p class="mt-1 text-xs text-muted-foreground">{template.description || "No description"}{template.icon ? ` · ${template.icon}` : ""}</p><p class="mt-1 text-xs text-muted-foreground">{Object.keys(questionsFromJson(template.questionsJson)).length} Baker questions</p></div><Button type="button" variant="outline" onClick={() => void editSavedTemplate(template)}><Pencil class="size-4" />Edit</Button><Button type="button" variant="ghost" disabled={busy()} aria-label={`Delete ${template.name}`} onClick={() => void removeTemplate(template)}><Trash2 class="size-4" />Delete</Button></article>}</For></div></Show></Show></section>
    </Show>

    <Show when={page() === "templates.create" || page() === "templates.edit"}>
      <section class="mx-auto max-w-2xl"><Card><CardHeader><CardTitle>{editingTemplate() ? "Update template" : "Create template"}</CardTitle><CardDescription>Enter a template source and validate its baker.yaml before saving.</CardDescription></CardHeader><CardContent><form class="space-y-4" onSubmit={(event) => void saveTemplate(event)}>
        <label class="grid gap-2 text-sm font-medium">Name<Input required maxlength="80" value={templateName()} onInput={(event) => setTemplateName(event.currentTarget.value)} /></label>
        <label class="grid gap-2 text-sm font-medium">Template URL<Input required type="url" placeholder="https://github.com/owner/template" value={templateUrl()} onInput={(event) => { setTemplateUrl(event.currentTarget.value); setInspection(undefined); }} onBlur={() => { if (templateUrl().trim()) void inspectSource(templateUrl()); }} /></label>
        <div class="flex items-center gap-3"><Button type="button" variant="outline" disabled={busy() || !templateUrl().trim()} onClick={() => void inspectSource(templateUrl())}><Show when={busy()} fallback={<FileCode2 class="size-4" />}><LoaderCircle class="size-4 animate-spin" /></Show>Check baker.yaml</Button><Show when={inspection()}><Badge variant="secondary">Valid · {Object.keys(inspection()!.questions).length} questions</Badge></Show></div>
        <label class="grid gap-2 text-sm font-medium">Description <span class="font-normal text-muted-foreground">Optional</span><textarea class="min-h-20 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" maxlength="2000" value={templateDescription()} onInput={(event) => setTemplateDescription(event.currentTarget.value)} /></label>
        <label class="grid gap-2 text-sm font-medium">Icon <span class="font-normal text-muted-foreground">Optional Lucide icon name</span><Input maxlength="80" value={templateIcon()} onInput={(event) => setTemplateIcon(event.currentTarget.value)} /></label>
        <div class="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => navigatePage("templates.list")}>Cancel</Button><Button type="submit" disabled={busy() || !inspection() || inspection()?.url !== templateUrl().trim() || !templateName().trim()}>{editingTemplate() ? "Save changes" : "Save template"}</Button></div>
      </form></CardContent></Card></section>
    </Show>

    <Show when={page() === "generate.template"}>
      <section class="mx-auto max-w-3xl"><Card><CardHeader><CardTitle>Choose a Baker template</CardTitle><CardDescription>Select a saved template or inspect a new repository URL to load its Baker questions.</CardDescription></CardHeader><CardContent><div class="space-y-4">
        <div class="flex gap-2"><Button type="button" variant={templateSource() === "saved" ? "secondary" : "outline"} onClick={() => { setTemplateSource("saved"); setInspection(undefined); }}>Saved template</Button><Button type="button" variant={templateSource() === "url" ? "secondary" : "outline"} onClick={() => { setTemplateSource("url"); setInspection(undefined); }}>New URL</Button></div>
        <Show when={templateSource() === "saved"} fallback={<div class="space-y-3"><label class="grid gap-2 text-sm font-medium">Template name<Input required placeholder="New template" value={templateName()} onInput={(event) => setTemplateName(event.currentTarget.value)} /></label><label class="grid gap-2 text-sm font-medium">Template URL<Input required type="url" placeholder="https://github.com/owner/template" value={templateUrl()} onInput={(event) => { setTemplateUrl(event.currentTarget.value); setInspection(undefined); }} onBlur={() => { if (templateUrl().trim()) void inspectSource(templateUrl()); }} /></label><Button type="button" variant="outline" disabled={busy() || !templateUrl().trim()} onClick={() => void inspectSource(templateUrl())}><FileCode2 class="size-4" />Check template URL</Button><Show when={inspection()}><Badge variant="secondary">Baker manifest loaded · {Object.keys(inspection()!.questions).length} questions</Badge></Show></div>}>
          <Show when={templates().length} fallback={<div class="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">No saved templates yet. Use New URL or create one from Templates.</div>}><label class="grid gap-2 text-sm font-medium">Template<select class="min-h-10 rounded-md border border-input bg-background px-3 text-sm" value={selectedTemplateId()} onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}><For each={templates()}>{(template) => <option value={template.id}>{template.name} — {template.url}</option>}</For></select></label></Show>
        </Show>
        <div class="flex justify-end"><Button type="button" disabled={busy() || (templateSource() === "saved" && !templates().length) || (templateSource() === "url" && (!inspection() || inspection()?.url !== templateUrl().trim()))} onClick={() => void proceedToAnswers()}>Next: configure template</Button></div>
      </div></CardContent></Card></section>
    </Show>

    <Show when={page() === "generate.answers"}>
      <form class="space-y-5" onSubmit={(event) => void createRun(event)}><div class="flex flex-wrap items-start justify-between gap-3"><div><h2 class="text-2xl font-semibold">Configure generation</h2><p class="text-sm text-muted-foreground">{inspection()?.url}</p></div><Badge variant="outline">{Object.keys(currentQuestions()).length} Baker questions</Badge></div>
        <div class="grid gap-3 md:grid-cols-2"><For each={Object.entries(currentQuestions())}>{([key, question]) => renderQuestion(key, question)}</For></div>
        <Card><CardHeader><CardTitle>Output destination</CardTitle><CardDescription>Generated source goes to an approved local folder or a branch in an existing Git repository.</CardDescription></CardHeader><CardContent class="space-y-4"><label class="grid gap-2 text-sm font-medium">Destination type<select class="min-h-10 rounded-md border border-input bg-background px-3 text-sm" value={destinationType()} onChange={(event) => { setDestinationType(event.currentTarget.value); setDestination(""); }}><option value="local">Local folder</option><option value="github">GitHub repository</option><option value="gitlab">GitLab repository</option></select></label>
          <Show when={destinationType() === "local"} fallback={<><label class="grid gap-2 text-sm font-medium">Existing repository URL<Input required type="url" placeholder={destinationType() === "github" ? "https://github.com/org/repository" : "https://gitlab.com/group/repository"} value={destination()} onInput={(event) => setDestination(event.currentTarget.value)} /></label><label class="grid gap-2 text-sm font-medium">Output branch<Input placeholder="modulaga/generated-app" value={branch()} onInput={(event) => setBranch(event.currentTarget.value)} /><span class="font-normal text-muted-foreground">Leave blank to use a unique generation branch. Runner Git credentials need push access.</span></label></>}><label class="grid gap-2 text-sm font-medium">Folder name <span class="font-normal text-muted-foreground">Optional; saved under the configured generator output directory</span><Input placeholder="generated-app" value={destination()} onInput={(event) => setDestination(event.currentTarget.value)} /></label></Show>
        </CardContent></Card>
        <div class="flex justify-between"><Button type="button" variant="outline" onClick={() => navigatePage("generate.template")}>Back</Button><Button type="submit" disabled={busy() || !!error()}><Show when={busy()} fallback={<Rocket class="size-4" />}><LoaderCircle class="size-4 animate-spin" /></Show>Generate</Button></div>
      </form>
    </Show>

    <Show when={page() === "runs.list"}>
      <section class="space-y-4"><div class="flex items-center justify-between"><div><h2 class="text-2xl font-semibold">Generation runs</h2><p class="text-sm text-muted-foreground">Saved configurations, delivery destinations, and Baker logs.</p></div><Badge variant="secondary">{runs().length}</Badge></div><Show when={runs().length} fallback={<div class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No generation runs yet.</div>}><div class="divide-y divide-border overflow-hidden rounded-lg border border-border"><For each={runs()}>{(run) => <button type="button" class="flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-muted/40" onClick={() => openRun(run.id)}><span class="min-w-0 flex-1"><strong class="block truncate text-sm">{run.templateName}</strong><span class="block truncate text-xs text-muted-foreground">{run.templateUrl}</span><span class="mt-1 block truncate text-xs text-muted-foreground">Output: {run.outputPath || run.destination}</span></span><Badge variant={run.status === "succeeded" ? "secondary" : "outline"}>{run.status}</Badge><span class="text-xs text-muted-foreground">{run.createdAt}</span></button>}</For></div></Show></section>
    </Show>

    <Show when={page() === "runs.detail"}>
      <Show when={activeRun()} fallback={<div class="flex items-center gap-2 py-8 text-sm text-muted-foreground"><LoaderCircle class="size-4 animate-spin" />Loading run…</div>}>{(run) => <section class="space-y-5"><div class="flex flex-wrap items-start justify-between gap-3"><div><Button type="button" variant="ghost" class="mb-2 px-0" onClick={() => { if (runTimer !== undefined) { window.clearInterval(runTimer); runTimer = undefined; } setPage("runs.list"); }}>← All runs</Button><h2 class="text-2xl font-semibold">{run().templateName}</h2><p class="text-sm text-muted-foreground">{run().templateUrl}</p></div><div class="flex items-center gap-2"><Badge variant={run().status === "succeeded" ? "secondary" : "outline"}>{run().status}</Badge><Show when={!['queued', 'running'].includes(run().status)}><Button type="button" variant="outline" disabled={busy()} onClick={() => void removeRun(run())}><Trash2 class="size-4" />Delete run</Button></Show></div></div><div class="grid gap-4 md:grid-cols-2"><Card><CardHeader><CardTitle>Output destination</CardTitle></CardHeader><CardContent class="space-y-1 text-sm"><p><strong>Type:</strong> {run().destinationType}</p><p class="break-all"><strong>Target:</strong> {run().destination}</p><p class="break-all"><strong>Output:</strong> {run().outputPath || "Pending"}</p></CardContent></Card><Card><CardHeader><CardTitle>Saved generation configuration</CardTitle></CardHeader><CardContent><pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{configuration(run())}</pre></CardContent></Card></div><Card><CardHeader><div class="flex items-center justify-between"><div><CardTitle>Baker run logs</CardTitle><CardDescription>Live Baker output and delivery results.</CardDescription></div><Button type="button" variant="outline" size="sm" onClick={() => void loadRun(runId())}><RefreshCw class="size-4" />Refresh</Button></div></CardHeader><CardContent><pre class="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-4 font-mono text-xs">{run().logs || "Waiting for runner logs…"}</pre></CardContent></Card></section>}</Show>
    </Show>
  </main>;
}
