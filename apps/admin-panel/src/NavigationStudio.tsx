import { For, Show, createEffect, createSignal, untrack } from "solid-js";
import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Ellipsis, Eye, EyeOff, GripVertical, Pencil, Plus, Trash2 } from "@lucide/solid";
import type { JSX } from "@solidjs/web";
import type { MenuButtonBinding, MenuItemActionKey, NavigationEntry, NavigationGroup, NavigationContainer, NavigationSection, NavigationLink, WorkspaceNavigation } from "../../shell/src/config/navigation";
import type { CatalogApplication } from "../../shell/src/workspace/api";
import { defaultMenuItemButtonActions, defaultNavigation, isNavigationContainer, menuEntries, routePath, saveNavigation } from "../../shell/src/config/navigation";
import { AddMenuItemDialog } from "../../shell/src/components/AddMenuItemDialog";
import { Badge } from "../../shell/src/components/ui/badge";
import { Button } from "../../shell/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shell/src/components/ui/card";
import { Input } from "../../shell/src/components/ui/input";

type SidebarCommand = { action: "add" | "moveUp" | "moveDown" | "moveTo"; itemId: string };
type Props = { config: () => WorkspaceNavigation; setConfig: (config: WorkspaceNavigation) => void; saveConfig: (config?: WorkspaceNavigation) => Promise<void>; applications?: () => CatalogApplication[]; openEditItemId?: () => string | undefined; sidebarCommand?: () => SidebarCommand | undefined };

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-item";
}

function safeExternalHref(href: string) {
  return href.startsWith("https://") && href.length <= 2048;
}

export default function NavigationStudio(props: Props) {
  const [activeTab, setActiveTab] = createSignal<"menu" | "actions" | "settings" | "styles" | "applications" | "services">("menu");
  const [draggedEntryId, setDraggedEntryId] = createSignal<string>();
  const [dropTarget, setDropTarget] = createSignal<{ id: string; position: "before" | "after" }>();
  const [openGroupOptions, setOpenGroupOptions] = createSignal<string>();
  const [moveTreeFor, setMoveTreeFor] = createSignal<string>();
  const [menuDialog, setMenuDialog] = createSignal<{ kind: "create"; parentId: string } | { kind: "edit"; itemId: string }>();
  const [notice, setNotice] = createSignal("Changes update the workspace menu as you edit.");

  const entries = () => menuEntries(props.config());
  createEffect(() => props.openEditItemId?.(), (itemId) => {
    if (itemId && untrack(() => findEntry(itemId))) setMenuDialog({ kind: "edit", itemId });
  });
  createEffect(() => props.sidebarCommand?.(), (command) => {
    if (!command) return;
    const entry = untrack(() => findEntry(command.itemId));
    if (!entry) return;
    setActiveTab("menu");
    if (command.action === "add" && isNavigationContainer(entry)) {
      beginAddItem(entry);
      return;
    }
    if (command.action === "moveUp" || command.action === "moveDown") {
      moveEntryInTree(entry.id, command.action === "moveUp" ? -1 : 1);
      setNotice(`${entry.label} moved ${command.action === "moveUp" ? "up" : "down"}. Save changes to apply it to the workspace.`);
      return;
    }
    if (command.action === "moveTo") {
      setOpenGroupOptions(entry.id);
      setMoveTreeFor(entry.id);
    }
  });
  function setEntries(next: NavigationEntry[]) {
    const config = props.config();
    props.setConfig({ ...config, menus: config.menus.map((menu, index) => index === 0 ? { ...menu, entries: next } : menu) });
  }

  function mapTree(items: NavigationEntry[], id: string, update: (entry: NavigationEntry) => NavigationEntry): NavigationEntry[] {
    return items.map((entry) => {
      if (entry.id === id) return update(entry);
      return isNavigationContainer(entry) ? { ...entry, children: mapTree(entry.children, id, update) } : entry;
    });
  }

  function updateEntry(id: string, update: (entry: NavigationEntry) => NavigationEntry) {
    setEntries(mapTree(entries(), id, update));
  }

  const actionRows: { key: MenuItemActionKey; label: string }[] = [
    { key: "edit", label: "Edit" },
    { key: "visibility", label: "Visibility" },
    { key: "delete", label: "Delete" },
    { key: "add", label: "Add menu item" },
    { key: "moveUp", label: "Move up" },
    { key: "moveDown", label: "Move down" },
    { key: "moveTo", label: "Move to" },
  ];
  const clientActions = [
    { clientId: "workspace-menu", actionId: "edit", label: "Open item editor" },
    { clientId: "workspace-menu", actionId: "visibility", label: "Toggle visibility" },
    { clientId: "workspace-menu", actionId: "delete", label: "Delete item" },
    { clientId: "workspace-menu", actionId: "add", label: "Add menu item" },
    { clientId: "workspace-menu", actionId: "moveUp", label: "Move up" },
    { clientId: "workspace-menu", actionId: "moveDown", label: "Move down" },
    { clientId: "workspace-menu", actionId: "moveTo", label: "Move to" },
  ];
  function flattenEntries(items = entries(), depth = 0): { entry: NavigationEntry; depth: number }[] {
    return items.flatMap((entry) => [
      { entry, depth },
      ...(isNavigationContainer(entry) ? flattenEntries(entry.children, depth + 1) : []),
    ]);
  }
  function bindingValue(entry: NavigationEntry, key: MenuItemActionKey) {
    const binding = entry.buttonActions?.[key] ?? defaultMenuItemButtonActions[key];
    return binding.type === "component" ? `component:${binding.componentId}` : `client:${binding.clientId}:${binding.actionId}`;
  }
  function updateBinding(entryId: string, key: MenuItemActionKey, value: string) {
    const [type, target, action] = value.split(":");
    const binding: MenuButtonBinding = type === "component"
      ? { type: "component", componentId: target ?? "menu-item-editor" }
      : { type: "client", clientId: target ?? "workspace-menu", actionId: action ?? key };
    updateEntry(entryId, (entry) => ({ ...entry, buttonActions: { ...entry.buttonActions, [key]: binding } }));
  }

  function addSection() {
    const name = `Section ${entries().filter((entry) => entry.type === "section").length + 1}`;
    const section: NavigationSection = { id: `${slug(name)}-${Date.now()}`, type: "section", label: name, visible: true, buttons: { edit: true, visibility: true, delete: true, options: true }, children: [] };
    setEntries([...entries(), section]);
  }

  function beginAddItem(parent: NavigationContainer) {
    setOpenGroupOptions(undefined);
    setMenuDialog({ kind: "create", parentId: parent.id });
  }

  function findEntry(id: string, items = entries()): NavigationEntry | undefined {
    for (const entry of items) {
      if (entry.id === id) return entry;
      if (isNavigationContainer(entry)) {
        const nested = findEntry(id, entry.children);
        if (nested) return nested;
      }
    }
    return undefined;
  }

  function findParent(id: string, items = entries()): NavigationContainer | undefined {
    for (const entry of items) {
      if (!isNavigationContainer(entry)) continue;
      if (entry.children.some((child) => child.id === id)) return entry;
      const nested = findParent(id, entry.children);
      if (nested) return nested;
    }
    return undefined;
  }

  function saveDialogItem(item: NavigationEntry, parentId?: string) {
    const current = entries();
    const existing = findEntry(item.id, current);
    const withUpdates = existing ? mapTree(current, item.id, () => item) : current;
    if (existing && findParent(item.id, current)?.id === parentId) {
      setEntries(withUpdates);
      setMenuDialog(undefined);
      setNotice(`${item.label} updated.`);
      return;
    }
    if (!existing) {
      const insertNew = (items: NavigationEntry[]): NavigationEntry[] => {
        if (!parentId) return [...items, item];
        return items.map((entry) => entry.id === parentId && isNavigationContainer(entry)
          ? { ...entry, children: [...entry.children, item] }
          : isNavigationContainer(entry) ? { ...entry, children: insertNew(entry.children) } : entry);
      };
      setEntries(insertNew(withUpdates));
    } else {
      const remove = (items: NavigationEntry[]): NavigationEntry[] => items.filter((entry) => entry.id !== item.id).map((entry) => isNavigationContainer(entry) ? { ...entry, children: remove(entry.children) } : entry);
      const withoutItem = remove(withUpdates);
      if (!parentId) setEntries([...withoutItem, item]);
      else {
        const insert = (items: NavigationEntry[]): NavigationEntry[] => items.map((entry) => entry.id === parentId && isNavigationContainer(entry)
          ? { ...entry, children: [...entry.children, item] }
          : isNavigationContainer(entry) ? { ...entry, children: insert(entry.children) } : entry);
        setEntries(insert(withoutItem));
      }
    }
    setMenuDialog(undefined);
    setNotice(`${item.label} ${existing ? "updated" : "added"}.`);
  }

  function moveEntryInTree(id: string, direction: -1 | 1) {
    const reorder = (items: NavigationEntry[]): NavigationEntry[] => {
      const index = items.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        const destination = index + direction;
        if (destination < 0 || destination >= items.length) return items;
        const next = [...items];
        [next[index], next[destination]] = [next[destination]!, next[index]!];
        return next;
      }
      return items.map((entry) => isNavigationContainer(entry) ? { ...entry, children: reorder(entry.children) } : entry);
    };
    setEntries(reorder(entries()));
  }

  function containsEntry(entry: NavigationEntry, id: string): boolean {
    if (entry.id === id) return true;
    return isNavigationContainer(entry) && entry.children.some((child) => containsEntry(child, id));
  }

  function moveEntryTo(sourceId: string, targetGroupId?: string) {
    const current = entries();
    const findEntry = (items: NavigationEntry[]): NavigationEntry | undefined => {
      for (const entry of items) {
        if (entry.id === sourceId) return entry;
        if (isNavigationContainer(entry)) {
          const nested = findEntry(entry.children);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    const source = findEntry(current);
    if (!source || (!targetGroupId && source.type !== "section") || (targetGroupId && (containsEntry(source, targetGroupId) || source.id === targetGroupId)) || (source.type === "section" && targetGroupId)) return;

    const remove = (items: NavigationEntry[]): { entry?: NavigationEntry; entries: NavigationEntry[] } => {
      const index = items.findIndex((entry) => entry.id === sourceId);
      if (index >= 0) {
        const next = [...items];
        const [entry] = next.splice(index, 1);
        return entry ? { entry, entries: next } : { entries: items };
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (!isNavigationContainer(item)) continue;
        const result = remove(item.children);
        if (result.entry) {
          const next = [...items];
          next[index] = { ...item, children: result.entries };
          return { entry: result.entry, entries: next };
        }
      }
      return { entries: items };
    };

    const removed = remove(current);
    if (!removed.entry) return;
    if (!targetGroupId) {
      setEntries([...removed.entries, removed.entry]);
    } else {
      const insert = (items: NavigationEntry[]): NavigationEntry[] => items.map((entry) => {
        if (entry.id === targetGroupId && isNavigationContainer(entry)) return { ...entry, children: [...entry.children, removed.entry!] };
        return isNavigationContainer(entry) ? { ...entry, children: insert(entry.children) } : entry;
      });
      setEntries(insert(removed.entries));
    }
    setOpenGroupOptions(undefined);
    setMoveTreeFor(undefined);
  }

  function removeEntry(id: string) {
    const removeTree = (items: NavigationEntry[]): NavigationEntry[] => items.filter((entry) => entry.id !== id).map((entry) => isNavigationContainer(entry) ? { ...entry, children: removeTree(entry.children) } : entry);
    setEntries(removeTree(entries()));
  }

  function reorderEntry(sourceId: string, destinationId: string, position: "before" | "after") {
    if (sourceId === destinationId) return;
    const next = [...entries()];
    const sourceIndex = next.findIndex((entry) => entry.id === sourceId);
    if (sourceIndex < 0 || !next.some((entry) => entry.id === destinationId)) return;
    const [moved] = next.splice(sourceIndex, 1);
    const targetIndex = next.findIndex((entry) => entry.id === destinationId);
    if (moved && targetIndex >= 0) next.splice(targetIndex + (position === "after" ? 1 : 0), 0, moved);
    setEntries(next);
  }

  function updateSidebar(change: Partial<NonNullable<WorkspaceNavigation["shell"]>["sidebar"]>) {
    const config = props.config();
    const shell = config.shell ?? { sidebar: { width: 264, mode: "collapsible" as const, defaultCollapsed: false }, breadcrumbs: { enabled: true, maxDepth: 5, separator: "/" } };
    props.setConfig({ ...config, shell: { ...shell, sidebar: { ...shell.sidebar, ...change } } });
  }

  function updateBreadcrumbs(change: Partial<NonNullable<WorkspaceNavigation["shell"]>["breadcrumbs"]>) {
    const config = props.config();
    const shell = config.shell ?? { sidebar: { width: 264, mode: "collapsible" as const, defaultCollapsed: false }, breadcrumbs: { enabled: true, maxDepth: 5, separator: "/" } };
    props.setConfig({ ...config, shell: { ...shell, breadcrumbs: { ...shell.breadcrumbs, ...change } } });
  }

  function updateWelcomePage(change: Partial<NonNullable<WorkspaceNavigation["welcomePage"]>>) {
    const config = props.config();
    const welcomePage = config.welcomePage ?? {
      enabled: true,
      title: "Welcome to Modulaga",
      description: "Your workspace, apps, and dashboards in one place.",
      showDashboard: true,
    };
    props.setConfig({ ...config, welcomePage: { ...welcomePage, ...change } });
  }

  function updateMenuRegion(region: "left" | "top") {
    const config = props.config();
    const menuId = config.menus[0]?.id;
    if (!menuId) return;
    props.setConfig({
      ...config,
      menuPlacements: config.menuPlacements.map((placement) => placement.menuId === menuId ? { ...placement, region, renderer: region === "top" ? "horizontal" : "tree" } : placement),
    });
  }

  function updateDashboardWidget(id: string, key: "label" | "value", value: string) {
    const config = props.config();
    const dashboards = (config.dashboards ?? []).map((dashboard, index) => index !== 0 ? dashboard : {
      ...dashboard,
      widgets: dashboard.widgets.map((widget) => widget.id === id ? { ...widget, settings: { ...widget.settings, value: { ...widget.settings.value, [key]: value } } } : widget),
    });
    props.setConfig({ ...config, dashboards });
  }

  function addDashboardWidget() {
    const config = props.config();
    const dashboard = config.dashboards?.[0];
    const installation = config.installations[0];
    if (!dashboard || !installation || !config.dashboards) {
      setNotice("Add an application installation before adding a dashboard panel.");
      return;
    }
    const widget = { id: `stat-card-${Date.now()}`, installationId: installation.id, componentId: "stat-card", settings: { schemaId: "modulaga-stat-card", value: { label: "New metric", value: "0" } } };
    const dashboards = config.dashboards.map((item, index) => index === 0 ? { ...item, widgets: [...item.widgets, widget] } : item);
    props.setConfig({ ...config, dashboards });
    setNotice("Dashboard panel added to the workspace configuration.");
  }

  function removeDashboardWidget(id: string) {
    const config = props.config();
    if (!config.dashboards?.length) return;
    const dashboards = config.dashboards.map((item, index) => index === 0 ? { ...item, widgets: item.widgets.filter((widget) => widget.id !== id) } : item);
    props.setConfig({ ...config, dashboards });
  }

  async function save() {
    const welcomePage = props.config().welcomePage;
    if (welcomePage?.enabled && !welcomePage.title.trim()) {
      setNotice("Add a title before saving the welcome page.");
      return;
    }
    const validEntry = (entry: NavigationEntry): boolean => isNavigationContainer(entry)
      ? entry.children.every(validEntry)
      : entry.type === "route"
        ? props.config().routes.some((route) => route.id === entry.routeId)
        : entry.type === "external" ? safeExternalHref(entry.href) : entry.action === "admin-panel";
    const valid = entries().every(validEntry);
    if (!valid) {
      setNotice("Fix invalid destinations before saving. Routes must come from an installed app and external links must use HTTPS.");
      return;
    }
    try {
      await props.saveConfig();
      saveNavigation(props.config());
      setNotice("Workspace configuration saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Workspace configuration could not be saved.");
    }
  }

  async function reset() {
    localStorage.removeItem("modulaga.workspace-navigation.v1");
    props.setConfig(defaultNavigation);
    try {
      await props.saveConfig(defaultNavigation);
      setNotice("Starter workspace configuration restored.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Starter configuration could not be saved.");
    }
  }

  const destination = (entry: NavigationLink) => entry.type === "route" ? routePath(props.config(), entry.routeId) : entry.type === "external" ? entry.href : "Workspace settings action";

  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const fieldClass = "grid gap-2 text-sm font-medium text-foreground";
  const iconButtonClass = "inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40";
  const tabPanelId = () => `admin-${activeTab()}-panel`;
  const tabLabelId = () => `admin-${activeTab()}-tab`;
  function renderMoveTargetTree(items: NavigationEntry[], source: NavigationEntry, depth = 0): JSX.Element {
    const groups = items.filter(isNavigationContainer);
    return <ul class={depth === 0 ? "grid gap-1" : "ml-3 grid gap-1 border-l border-border pl-2"}>
      <For each={groups}>{(target) => <Show when={source.type !== "section" && target.id !== source.id && !containsEntry(source, target.id)}>
        <li>
          <button class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70" type="button" aria-label={`Move ${source.label} to ${target.label}`} onClick={() => moveEntryTo(source.id, target.id)}>
            <span class="min-w-0 flex-1 truncate">{target.label}</span><ChevronRight class="size-4 text-muted-foreground" />
          </button>
          {renderMoveTargetTree(target.children, source, depth + 1)}
        </li>
      </Show>}</For>
    </ul>;
  }

  function renderEntryActions(entry: NavigationEntry, index: number, siblings: NavigationEntry[]): JSX.Element {
    const kind = entry.type === "section" ? "section" : entry.type === "group" ? "group" : "entry";
    return <div class="relative">
      <Show when={entry.buttons?.options !== false}><button class={iconButtonClass} type="button" aria-label={`More options for ${entry.label}`} aria-expanded={openGroupOptions() === entry.id ? "true" : "false"} title="More options" onClick={() => { setOpenGroupOptions((current) => current === entry.id ? undefined : entry.id); setMoveTreeFor(undefined); }}><Ellipsis class="size-4" /></button></Show>
      <Show when={openGroupOptions() === entry.id}>
        <div class="absolute right-0 top-full z-20 mt-1 grid w-52 gap-0.5 rounded-md border border-border bg-background p-1 text-foreground shadow-md" aria-label={`${entry.label} options`}>
          <Show when={entry.buttons?.edit === false}><button class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70" type="button" onClick={() => { setMenuDialog({ kind: "edit", itemId: entry.id }); setOpenGroupOptions(undefined); }}>Edit {kind}</button></Show>
          <Show when={entry.buttons?.moveUp !== false}><button class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70 disabled:opacity-40" type="button" aria-label={`Move ${entry.label} up`} disabled={index === 0} onClick={() => { moveEntryInTree(entry.id, -1); setOpenGroupOptions(undefined); }}><ArrowUp class="size-4 text-muted-foreground" />Move up</button></Show>
          <Show when={entry.buttons?.moveDown !== false}><button class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70 disabled:opacity-40" type="button" aria-label={`Move ${entry.label} down`} disabled={index === siblings.length - 1} onClick={() => { moveEntryInTree(entry.id, 1); setOpenGroupOptions(undefined); }}><ArrowDown class="size-4 text-muted-foreground" />Move down</button></Show>
          <Show when={entry.buttons?.moveTo !== false}><button class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70" type="button" aria-expanded={moveTreeFor() === entry.id ? "true" : "false"} onClick={() => setMoveTreeFor((current) => current === entry.id ? undefined : entry.id)}><ArrowRight class="size-4 text-muted-foreground" /><span class="flex-1">Move to</span><ChevronRight class="size-4 text-muted-foreground" /></button></Show>
          <Show when={moveTreeFor() === entry.id}>
            <div class="my-1 grid max-h-48 gap-0.5 overflow-y-auto border-y border-border py-1" aria-label={`Move ${entry.label} to menu`}>
          <Show when={entry.type === "section"}><button class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70" type="button" onClick={() => moveEntryTo(entry.id)}>Workspace menu</button></Show>
              {renderMoveTargetTree(entries(), entry)}
            </div>
          </Show>
          <Show when={entry.buttons?.delete !== false}><div class="my-1 border-t border-border" /><button class="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm text-destructive hover:bg-accent/70" type="button" onClick={() => { removeEntry(entry.id); setOpenGroupOptions(undefined); }}><Trash2 class="size-4" />Delete {kind}</button></Show>
        </div>
      </Show>
    </div>;
  }

  function renderNestedEntry(entry: NavigationEntry, index: number, siblings: NavigationEntry[]): JSX.Element {
    const container = isNavigationContainer(entry);
    const kind = entry.type === "section" ? "Section" : entry.type === "group" ? "Group" : entry.type === "route" ? "Page" : entry.type === "external" ? "Link" : "Action";
    return <div class="rounded-md border border-border bg-background p-2">
      <div class="flex flex-wrap items-center gap-2">
        <Badge variant="outline" class="shrink-0">{kind}</Badge>
        <span class="min-w-32 flex-1 truncate px-2 text-sm font-medium" title={entry.label}>{entry.label}</span>
        <span class="hidden w-24 truncate text-xs text-muted-foreground sm:block">{entry.icon ?? "grid"}</span>
        <span class="hidden max-w-44 truncate text-xs text-muted-foreground md:block">{container ? `${entry.children.length} items` : destination(entry)}</span>
        <Show when={entry.buttons?.edit !== false}><button class={iconButtonClass} type="button" aria-label={`Edit ${kind.toLowerCase()} ${entry.label}`} title={`Edit ${entry.label}`} onClick={() => setMenuDialog({ kind: "edit", itemId: entry.id })}><Pencil class="size-4" /></button></Show>
        <Show when={entry.buttons?.visibility !== false}><button class={iconButtonClass} aria-label="Toggle visibility" aria-pressed={entry.visible !== false ? "true" : "false"} onClick={() => updateEntry(entry.id, (current) => ({ ...current, visible: current.visible === false }))}>{entry.visible === false ? <EyeOff class="size-4" /> : <Eye class="size-4" />}</button></Show>
        <Show when={entry.type === "group"}><label class="flex items-center gap-1 text-xs text-muted-foreground"><input aria-label={`${entry.label} show chevron`} type="checkbox" checked={(entry as NavigationGroup).chevron !== false} onChange={(event) => { const checked = event.currentTarget.checked; updateEntry(entry.id, (current) => current.type === "group" ? { ...current, chevron: checked } : current); }} />Chevron</label><label class="flex items-center gap-1 text-xs text-muted-foreground"><input aria-label={`${entry.label} expanded by default`} type="checkbox" checked={(entry as NavigationGroup).defaultExpanded !== false} onChange={(event) => { const checked = event.currentTarget.checked; updateEntry(entry.id, (current) => current.type === "group" ? { ...current, defaultExpanded: checked } : current); }} />Expanded</label></Show>
        <Show when={container}>
          <Show when={entry.buttons?.add !== false}><Button variant="outline" size="icon" type="button" aria-label={`Add to ${entry.label}`} title={`Add to ${entry.label}`} onClick={() => beginAddItem(entry as NavigationContainer)}><Plus class="size-4" /></Button></Show>
        </Show>
        <Show when={!container && entry.buttons?.delete !== false}><button class={`${iconButtonClass} text-destructive hover:text-destructive`} type="button" aria-label={`Delete entry ${entry.label}`} title="Delete entry" onClick={() => removeEntry(entry.id)}><Trash2 class="size-4" /></button></Show>
        {renderEntryActions(entry, index, siblings)}
      </div>
      <Show when={container}>
        <div class="mt-2 flex flex-col gap-2 border-l border-border pl-3">
          <For each={(entry as NavigationContainer).children}>{(child, childIndex) => renderNestedEntry(child, childIndex(), (entry as NavigationContainer).children)}</For>
          <Show when={(entry as NavigationContainer).children.length === 0}><p class="py-1 text-xs text-muted-foreground">No entries in this {kind.toLowerCase()}.</p></Show>
        </div>
      </Show>
    </div>;
  }

  return (
    <div class="min-h-full space-y-6 text-foreground">
      <div class="flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label="Workspace administration">
        <For each={[["menu", "Menu Editor"], ["actions", "Actions"], ["settings", "Settings"], ["styles", "Styles"], ["applications", "Applications"], ["services", "Services"]] as const}>{([tab, label]) => <button class={`border-b-2 px-4 py-3 text-sm font-medium ${activeTab() === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} id={`admin-${tab}-tab`} role="tab" aria-selected={activeTab() === tab ? "true" : "false"} aria-controls={`admin-${tab}-panel`} onClick={() => setActiveTab(tab)}>{label}</button>}</For>
      </div>

      <div class="grid items-start gap-5">
        <Card aria-label="Workspace administration">
          <div id={tabPanelId()} role="tabpanel" aria-labelledby={tabLabelId()}>
          <CardHeader class="flex-row items-start justify-between gap-4">
            <div class="space-y-1"><CardTitle>{activeTab() === "menu" ? "Menu structure" : activeTab() === "actions" ? "Menu actions" : activeTab() === "settings" ? "Workspace settings" : activeTab() === "styles" ? "Menu styles" : activeTab() === "applications" ? "Connected applications" : "Connected services"}</CardTitle><CardDescription>{activeTab() === "menu" ? "Drag items to reorder application pages and menu links." : activeTab() === "actions" ? "Choose which client action or UI component each menu button uses." : activeTab() === "settings" ? "Configure the shell layout and welcome page." : activeTab() === "styles" ? "Choose the visual theme used by the workspace shell." : activeTab() === "applications" ? "Applications currently installed in this workspace." : "Services connected through this workspace configuration."}</CardDescription></div>
            <Show when={activeTab() === "menu"}><Button variant="outline" size="sm" type="button" onClick={addSection}><Plus class="mr-1 size-4" />Add section</Button></Show>
          </CardHeader>
          <CardContent class="space-y-6">
            <Show when={activeTab() === "menu"}>
            <div class="space-y-2">
              <For each={entries()}>{(entry, index) => <div class={`menu-editor-item rounded-lg border border-border p-2 ${draggedEntryId() === entry.id ? "opacity-50" : ""} ${dropTarget()?.id === entry.id ? dropTarget()?.position === "before" ? "border-t-2 border-t-primary" : "border-b-2 border-b-primary" : ""}`} onDragOver={(event) => { event.preventDefault(); const transfer = event.dataTransfer; if (transfer && draggedEntryId() !== entry.id) { transfer.dropEffect = "move"; const bounds = event.currentTarget.getBoundingClientRect(); setDropTarget({ id: entry.id, position: event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before" }); } }} onDrop={(event) => { event.preventDefault(); const transfer = event.dataTransfer; const sourceId = transfer?.getData("text/plain") || draggedEntryId(); const bounds = event.currentTarget.getBoundingClientRect(); const position = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before"; if (sourceId) reorderEntry(sourceId, entry.id, position); setDraggedEntryId(undefined); setDropTarget(undefined); }}>
                <div class="flex items-start gap-2">
                  <span class="cursor-grab select-none touch-none px-1 pt-2 text-lg text-muted-foreground active:cursor-grabbing" aria-label="Drag to reorder" title="Drag to reorder" draggable="true" onDragStart={(event) => { setDraggedEntryId(entry.id); setDropTarget(undefined); if (event.dataTransfer) { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", entry.id); } }} onDragEnd={() => { setDraggedEntryId(undefined); setDropTarget(undefined); }}><GripVertical class="size-4" /></span>
                  <div class="min-w-0 flex-1">{renderNestedEntry(entry, index(), entries())}</div>
                </div>
              </div>}</For>
              <Show when={entries().length === 0}><p class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No menu sections yet. Add a section to get started.</p></Show>
            </div>

            </Show>

            <Show when={activeTab() === "actions"}>
              <section class="space-y-3" aria-label="Menu button action bindings">
                <p class="text-sm text-muted-foreground">Bindings are saved with menu items in workspace configuration. Button visibility is managed in each item’s editor.</p>
                <Show when={flattenEntries().length > 0} fallback={<p class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Add menu items before configuring their actions.</p>}>
                  <div class="space-y-3">
                    <For each={flattenEntries()}>{({ entry, depth }) => <article class="space-y-3 rounded-lg border border-border p-4" style={{ "margin-left": `${Math.min(depth, 5) * 12}px` }}>
                      <div><h2 class="font-medium">{entry.label}</h2><p class="text-xs capitalize text-muted-foreground">{entry.type}</p></div>
                      <div class="grid gap-3 sm:grid-cols-2">
                        <For each={actionRows}>{(row) => <Show when={entry.buttons?.[row.key] !== false && (row.key !== "add" || entry.type === "section" || entry.type === "group")}>
                          <label class={fieldClass}>{row.label} button handler
                            <select class={selectClass} aria-label={`${row.label} button handler for ${entry.label}`} value={bindingValue(entry, row.key)} onChange={(event) => updateBinding(entry.id, row.key, event.currentTarget.value)}>
                              <Show when={row.key === "edit"}><option value="component:menu-item-editor">Menu item editor modal component</option></Show>
                              <For each={clientActions}>{(option) => <option value={`client:${option.clientId}:${option.actionId}`}>Workspace menu client · {option.label}</option>}</For>
                            </select>
                          </label>
                        </Show>}</For>
                      </div>
                    </article>}</For>
                  </div>
                </Show>
              </section>
            </Show>

            <Show when={activeTab() === "settings"}>
            <section class="space-y-4" aria-label="Shell settings">
              <div class="space-y-1"><h2 class="font-semibold">Shell settings</h2><p class="text-sm text-muted-foreground">These values control the running workspace shell.</p></div>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class={fieldClass}>Sidebar width <span class="text-muted-foreground">{props.config().shell?.sidebar.width ?? 264}px</span>
                  <input aria-label="Sidebar width" class="w-full accent-primary" type="range" min="200" max="360" step="4" value={props.config().shell?.sidebar.width ?? 264} onInput={(event) => updateSidebar({ width: Number(event.currentTarget.value) })} />
                </label>
                <label class={fieldClass}>Sidebar mode<select class={selectClass} aria-label="Sidebar mode" value={props.config().shell?.sidebar.mode ?? "collapsible"} onChange={(event) => updateSidebar({ mode: event.currentTarget.value as "fixed" | "collapsible" })}><option value="collapsible">Collapsible</option><option value="fixed">Fixed</option></select></label>
                <label class={fieldClass}>Menu placement<select class={selectClass} aria-label="Menu placement" value={props.config().menuPlacements[0]?.region === "top" ? "top" : "left"} onChange={(event) => updateMenuRegion(event.currentTarget.value as "left" | "top")}><option value="left">Sidebar</option><option value="top">Top bar</option></select></label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.config().shell?.sidebar.defaultCollapsed ?? false} onChange={(event) => updateSidebar({ defaultCollapsed: event.currentTarget.checked })} /> Start with the sidebar collapsed</label>
                <label class="flex items-center gap-2 text-sm"><input type="checkbox" checked={props.config().shell?.breadcrumbs.enabled ?? true} onChange={(event) => updateBreadcrumbs({ enabled: event.currentTarget.checked })} /> Show breadcrumbs</label>
                <label class={fieldClass}>Breadcrumb depth<Input aria-label="Breadcrumb depth" type="number" min="1" max="8" value={props.config().shell?.breadcrumbs.maxDepth ?? 5} onInput={(event) => updateBreadcrumbs({ maxDepth: Number(event.currentTarget.value) })} /></label>
              </div>
            </section>

            <section class="space-y-4 border-t border-border pt-5" aria-label="Welcome page settings">
              <div class="space-y-1"><h2 class="font-semibold">Welcome page</h2><p class="text-sm text-muted-foreground">Configure the workspace landing page shown at the root URL.</p></div>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class={fieldClass}>Page title<Input aria-label="Welcome page title" maxlength={120} value={props.config().welcomePage?.title ?? "Welcome to Modulaga"} onInput={(event) => updateWelcomePage({ title: event.currentTarget.value })} /></label>
                <label class={fieldClass}>Description<textarea aria-label="Welcome page description" class="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" maxlength={500} value={props.config().welcomePage?.description ?? "Your workspace, apps, and dashboards in one place."} onInput={(event) => updateWelcomePage({ description: event.currentTarget.value })} /></label>
                <label class="flex items-center gap-2 text-sm"><input aria-label="Enable welcome page" type="checkbox" checked={props.config().welcomePage?.enabled ?? true} onChange={(event) => updateWelcomePage({ enabled: event.currentTarget.checked })} /> Show welcome heading</label>
                <label class="flex items-center gap-2 text-sm"><input aria-label="Show dashboard on welcome page" type="checkbox" checked={props.config().welcomePage?.showDashboard ?? true} onChange={(event) => updateWelcomePage({ showDashboard: event.currentTarget.checked })} /> Show dashboard panels</label>
              </div>
            </section>

            <section class="space-y-4 border-t border-border pt-5" aria-label="Dashboard settings">
              <div class="flex items-start justify-between gap-3"><div class="space-y-1"><h2 class="font-semibold">Dashboard</h2><p class="text-sm text-muted-foreground">Configure the starter dashboard and panels.</p></div><Button variant="outline" size="sm" type="button" onClick={addDashboardWidget}>Add stat card</Button></div>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class={fieldClass}>Dashboard title<Input aria-label="Dashboard title" value={props.config().dashboards?.[0]?.title ?? "Workspace overview"} onInput={(event) => { const config = props.config(); const dashboards = [...(config.dashboards ?? [])]; if (dashboards[0]) dashboards[0] = { ...dashboards[0], title: event.currentTarget.value }; props.setConfig({ ...config, dashboards }); }} /></label>
                <label class={fieldClass}>Grid columns<Input aria-label="Grid columns" type="number" min="1" max="12" value={props.config().dashboards?.[0]?.columns ?? 3} onInput={(event) => { const config = props.config(); const dashboards = [...(config.dashboards ?? [])]; if (dashboards[0]) dashboards[0] = { ...dashboards[0], columns: Math.min(12, Math.max(1, Number(event.currentTarget.value))) }; props.setConfig({ ...config, dashboards }); }} /></label>
              </div>
              <div class="space-y-2">
                <For each={props.config().dashboards?.[0]?.widgets ?? []}>{(widget) => <div class="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <label class={fieldClass}>Panel label<Input aria-label="Panel label" value={String(widget.settings.value.label ?? "")} onInput={(event) => updateDashboardWidget(widget.id, "label", event.currentTarget.value)} /></label>
                  <label class={fieldClass}>Panel value<Input aria-label="Panel value" value={String(widget.settings.value.value ?? "")} onInput={(event) => updateDashboardWidget(widget.id, "value", event.currentTarget.value)} /></label>
                  <Button variant="ghost" size="icon" type="button" aria-label={`Remove panel ${String(widget.settings.value.label ?? widget.id)}`} onClick={() => removeDashboardWidget(widget.id)}>×</Button>
                </div>}</For>
                <Show when={(props.config().dashboards?.[0]?.widgets.length ?? 0) === 0}><p class="text-sm text-muted-foreground">No panels placed on this dashboard yet.</p></Show>
              </div>
            </section>

            </Show>

            <Show when={activeTab() === "applications"}>
              <section class="space-y-3" aria-label="Connected applications">
                <Show when={(props.config().installations ?? []).length > 0} fallback={<p class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No applications are installed in this workspace.</p>}>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <For each={props.config().installations}>{(installation) => {
                      const application = () => props.applications?.().find((candidate) => candidate.id === installation.appId);
                      return <article class="rounded-lg border border-border p-4">
                        <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h2 class="truncate font-medium">{application()?.name ?? installation.appId}</h2><p class="mt-1 truncate text-xs text-muted-foreground">{application()?.description ?? "Installed workspace application"}</p></div><Badge variant="secondary">Connected</Badge></div>
                        <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt class="text-muted-foreground">Release</dt><dd class="truncate text-right">{installation.releaseId}</dd><dt class="text-muted-foreground">Base path</dt><dd class="truncate text-right">{installation.basePath}</dd></dl>
                      </article>;
                    }}</For>
                  </div>
                </Show>
              </section>
            </Show>

            <Show when={activeTab() === "services"}>
              <section class="space-y-3" aria-label="Connected services">
                <Show when={(props.config().services ?? []).length > 0} fallback={<p class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No services are connected in this workspace configuration.</p>}>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <For each={props.config().services ?? []}>{(service) => <article class="rounded-lg border border-border p-4">
                      <div class="flex items-start justify-between gap-3"><div class="min-w-0"><h2 class="truncate font-medium">{service.name}</h2><p class="mt-1 text-xs text-muted-foreground">{service.description ?? service.type}</p></div><Badge variant="secondary">Connected</Badge></div>
                      <dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs"><dt class="text-muted-foreground">Type</dt><dd class="text-right">{service.type}</dd><dt class="text-muted-foreground">Endpoint</dt><dd class="truncate text-right"><a class="underline underline-offset-2" href={service.url} target="_blank" rel="noopener noreferrer">{service.url}</a></dd></dl>
                    </article>}</For>
                  </div>
                </Show>
              </section>
            </Show>

            <Show when={activeTab() === "styles"}>
              <section class="space-y-4" aria-label="Menu styles settings">
                <div class="space-y-1"><h2 class="font-semibold">Workspace theme</h2><p class="text-sm text-muted-foreground">Choose the theme reference applied to the shell.</p></div>
                <div class="grid gap-4 sm:grid-cols-2">
                  <label class={fieldClass}>Theme ID<Input aria-label="Theme ID" value={props.config().theme?.id ?? "modulaga-default"} onInput={(event) => { const config = props.config(); props.setConfig({ ...config, theme: { id: event.currentTarget.value, version: config.theme?.version ?? "1.0.0" } }); }} /></label>
                  <label class={fieldClass}>Theme version<Input aria-label="Theme version" value={props.config().theme?.version ?? "1.0.0"} onInput={(event) => { const config = props.config(); props.setConfig({ ...config, theme: { id: config.theme?.id ?? "modulaga-default", version: event.currentTarget.value } }); }} /></label>
                </div>
              </section>
            </Show>

            <Show when={activeTab() === "menu"}>
            <p class="min-h-5 text-sm text-muted-foreground" role="status">{notice()}</p>
            </Show>
          </CardContent>
          </div>
        </Card>

      </div>

      <div class="flex justify-end gap-2 border-t border-border pt-4" aria-label="Workspace settings actions">
        <Button variant="ghost" type="button" onClick={reset}>Reset</Button>
        <Button type="button" onClick={save}>Save changes</Button>
      </div>

      <Show when={menuDialog()} keyed>
        {(dialog) => {
          const edited = dialog.kind === "edit" ? findEntry(dialog.itemId) : undefined;
          return <Show when={dialog.kind !== "edit" || edited}>
            <AddMenuItemDialog entries={entries()} parentId={dialog.kind === "create" ? dialog.parentId : findParent(dialog.itemId)?.id} item={edited} routes={props.config().routes} onCancel={() => setMenuDialog(undefined)} onSave={saveDialogItem} />
          </Show>;
        }}
      </Show>
    </div>
  );
}
