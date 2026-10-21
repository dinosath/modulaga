import { For, Show, createSignal } from "solid-js";
import type { LucideIcon } from "@lucide/solid";
import {
  Bell,
  Box,
  Briefcase,
  ChartNoAxesCombined,
  Grid,
  Monitor,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Truck,
  UserRound,
  UsersRound,
} from "@lucide/solid";
import { Dynamic } from "@solidjs/web";
import type { NavigationContainer, NavigationEntry, NavigationGroup, WorkspaceNavigation } from "../config/navigation";
import { isNavigationContainer } from "../config/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Route = WorkspaceNavigation["routes"][number];
type Props = {
  entries: NavigationEntry[];
  parentId?: string | undefined;
  item?: NavigationEntry | undefined;
  routes: Route[];
  onCancel: () => void;
  onSave: (item: NavigationEntry, parentId?: string) => void;
};

const iconOptions: { name: string; component: LucideIcon }[] = [
  { name: "grid", component: Grid },
  { name: "chart", component: ChartNoAxesCombined },
  { name: "bag", component: ShoppingBag },
  { name: "cart", component: ShoppingCart },
  { name: "users", component: UsersRound },
  { name: "truck", component: Truck },
  { name: "box", component: Box },
  { name: "briefcase", component: Briefcase },
  { name: "search", component: Search },
  { name: "bell", component: Bell },
  { name: "monitor", component: Monitor },
  { name: "settings", component: Settings },
  { name: "user", component: UserRound },
];

function findParentId(entries: NavigationEntry[], childId: string): string | undefined {
  for (const entry of entries) {
    if (!isNavigationContainer(entry)) continue;
    if (entry.children.some((child) => child.id === childId)) return entry.id;
    const found = findParentId(entry.children, childId);
    if (found) return found;
  }
  return undefined;
}

function collectDescendants(entry: NavigationEntry): Set<string> {
  const ids = new Set<string>([entry.id]);
  if (isNavigationContainer(entry)) for (const child of entry.children) for (const id of collectDescendants(child)) ids.add(id);
  return ids;
}

export function AddMenuItemDialog(props: Props) {
  const editing = () => props.item !== undefined;
  const item = () => props.item;
  const existing = props.item;
  const initialType = existing?.type === "group" ? "group" : "entry";
  const [type, setType] = createSignal<"entry" | "group">(initialType);
  const [label, setLabel] = createSignal(existing?.label ?? "");
  const [icon, setIcon] = createSignal(existing?.icon ?? "grid");
  const [routeId, setRouteId] = createSignal(existing?.type === "route" ? existing.routeId : props.routes[0]?.id ?? "");
  const [href, setHref] = createSignal(existing?.type === "external" ? existing.href : "https://");
  const [actionPath, setActionPath] = createSignal(existing?.type === "action" ? existing.path : "/admin/menu");
  const [parentId, setParentId] = createSignal(findParentId(props.entries, item()?.id ?? "") ?? props.parentId ?? "");
  const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
  const excluded = () => item() ? collectDescendants(item()!) : new Set<string>();
  const parents = (): NavigationContainer[] => {
    const output: NavigationContainer[] = [];
    const walk = (entries: NavigationEntry[]) => entries.forEach((entry) => {
      if (!isNavigationContainer(entry) || excluded().has(entry.id)) return;
      output.push(entry);
      walk(entry.children);
    });
    walk(props.entries);
    return output;
  };

  const ParentTree = (treeProps: { entries: NavigationEntry[]; depth: number }) =>
    <For each={treeProps.entries}>{(entry) => <Show when={isNavigationContainer(entry) && !excluded().has(entry.id)}>
      <div>
        <label role="treeitem" aria-selected={parentId() === entry.id ? "true" : "false"} class={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md text-left text-sm transition-colors ${parentId() === entry.id ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/70"}`} style={{ "padding-left": `${8 + treeProps.depth * 18}px`, "padding-right": "8px" }}>
          <input class="accent-primary" type="radio" name="menu-item-parent" value={entry.id} checked={parentId() === entry.id} onChange={() => setParentId(entry.id)} /><span class="truncate">{entry.label}</span>
        </label>
        <Show when={isNavigationContainer(entry) && entry.children.length > 0}><ParentTree entries={(entry as NavigationContainer).children} depth={treeProps.depth + 1} /></Show>
      </div>
    </Show>}</For>;

  function saveItem(form: HTMLFormElement) {
    const data = new FormData(form);
    const name = String(data.get("menu-item-label") ?? label()).trim();
    const selectedIcon = String(data.get("menu-item-icon") ?? icon());
    const selectedType = data.get("menu-item-type") === "group" ? "group" : type();
    const selectedRouteId = String(data.get("menu-item-route") ?? routeId());
    const selectedParentId = String(data.get("menu-item-parent") ?? parentId()) || undefined;
    if (!name) return;
    const existing = item();
    if (existing?.type === "section") {
      props.onSave({ ...existing, label: name }, undefined);
      return;
    }
    if (existing?.type === "group" || selectedType === "group") {
      const group: NavigationGroup = existing?.type === "group"
        ? { ...existing, label: name, icon: selectedIcon }
        : { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-item"}-${Date.now()}`, type: "group", label: name, icon: selectedIcon, visible: true, chevron: true, defaultExpanded: true, children: [] };
      props.onSave(group, selectedParentId);
      return;
    }
    if (existing?.type === "external") {
      props.onSave({ ...existing, label: name, icon: selectedIcon, href: String(data.get("menu-item-href") ?? href()).trim() }, selectedParentId);
      return;
    }
    if (existing?.type === "action") {
      props.onSave({ ...existing, label: name, icon: selectedIcon, path: String(data.get("menu-item-action-path") ?? actionPath()).trim() }, selectedParentId);
      return;
    }
    const route = props.routes.find((candidate) => candidate.id === selectedRouteId);
    if (!route) return;
    if (existing?.type === "route") props.onSave({ ...existing, label: name, icon: selectedIcon, routeId: route.id }, selectedParentId);
    else props.onSave({ id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "new-item"}-${Date.now()}`, type: "route", routeId: route.id, label: name, icon: selectedIcon, visible: true }, selectedParentId);
  }

  const fixedType = () => editing();
  const title = () => editing() ? `Edit ${item()?.type === "section" ? "section" : item()?.type === "group" ? "group" : "entry"}` : "Add menu item";
  const allowedParent = () => item()?.type === "section" || !parentId() || parents().some((entry) => entry.id === parentId());

  return <div class="fixed inset-0 z-[120] grid place-items-center overflow-y-auto bg-black/50 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) props.onCancel(); }} onKeyDown={(event) => { if (event.key === "Escape") props.onCancel(); }}>
    <section class="w-full max-w-lg rounded-xl border border-border bg-background p-6 text-foreground shadow-xl" role="dialog" aria-modal="true" aria-labelledby="add-menu-item-title" aria-describedby="add-menu-item-description">
      <form class="grid gap-4" onSubmit={(event) => { event.preventDefault(); saveItem(event.currentTarget); }}>
        <header class="space-y-1"><h2 id="add-menu-item-title" class="text-lg font-semibold tracking-tight">{title()}</h2><p id="add-menu-item-description" class="text-sm text-muted-foreground">{editing() ? "Update this item and choose where it belongs in the menu." : "Choose a group or an entry, then choose its parent."}</p></header>
        <Show when={!fixedType()}>
          <fieldset class="grid gap-2">
            <legend class="text-sm font-medium text-foreground">Menu item type</legend>
            <div class="grid grid-cols-2 gap-2">
              <label class={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${type() === "entry" ? "border-primary bg-accent" : "border-border hover:bg-accent/50"}`}><input type="radio" name="menu-item-type" aria-label="Entry" value="entry" checked={type() === "entry"} onChange={() => setType("entry")} /><span><span class="block font-medium">Entry</span><span class="block text-xs text-muted-foreground">Link to an application page</span></span></label>
              <label class={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${type() === "group" ? "border-primary bg-accent" : "border-border hover:bg-accent/50"}`}><input type="radio" name="menu-item-type" aria-label="Group" value="group" checked={type() === "group"} onChange={() => setType("group")} /><span><span class="block font-medium">Group</span><span class="block text-xs text-muted-foreground">Expandable menu with children</span></span></label>
            </div>
          </fieldset>
        </Show>
        <label class="grid gap-2 text-sm font-medium text-foreground">{item()?.type === "section" ? "Section name" : type() === "group" ? "Group name" : "Entry label"}<Input name="menu-item-label" aria-label="Menu item label" value={label()} onInput={(event) => setLabel(event.currentTarget.value)} placeholder={type() === "group" ? "e.g. Reports" : "e.g. Monthly report"} required /></label>
        <Show when={item()?.type !== "section"}>
          <fieldset class="grid gap-2">
            <legend class="text-sm font-medium text-foreground">Icon</legend>
            <input type="hidden" name="menu-item-icon" value={icon()} />
            <div class="grid max-h-44 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-1" role="group" aria-label="Choose menu item icon">
              <Show when={icon() && !iconOptions.some((option) => option.name === icon())}>
                <button type="button" aria-pressed="true" class="flex min-h-9 items-center gap-2 rounded-md bg-accent px-2 text-left text-sm text-accent-foreground"><Dynamic component={Grid} class="size-4 shrink-0" aria-hidden="true" /><span class="truncate">{icon()}</span></button>
              </Show>
              <For each={iconOptions}>{(option) => <button type="button" aria-pressed={icon() === option.name ? "true" : "false"} class={`flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors ${icon() === option.name ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/70"}`} onClick={() => setIcon(option.name)}><Dynamic component={option.component} class="size-4 shrink-0" aria-hidden="true" /><span>{option.name}</span></button>}</For>
            </div>
          </fieldset>
        </Show>
        <Show when={item()?.type !== "section"}>
          <fieldset class="grid gap-1">
            <legend class="text-sm font-medium text-foreground">Parent menu</legend>
            <div class="max-h-48 overflow-y-auto rounded-md border border-border p-1" role="tree" aria-label="Choose parent menu">
              <Show when={item()?.type !== "section"}><label role="treeitem" aria-selected={!parentId() ? "true" : "false"} class={`flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-sm ${!parentId() ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/70"}`}><input class="accent-primary" type="radio" name="menu-item-parent" value="" checked={!parentId()} onChange={() => setParentId("")} />Workspace root</label></Show>
              <ParentTree entries={props.entries} depth={0} />
            </div>
            <Show when={parentId() && !allowedParent()}><p class="text-xs text-destructive">Choose a valid section or group parent.</p></Show>
          </fieldset>
        </Show>
        <Show when={type() === "entry" && item()?.type !== "external" && item()?.type !== "action"}>
          <label class="grid gap-2 text-sm font-medium text-foreground">Application page<select name="menu-item-route" class={selectClass} aria-label="Application page" value={routeId()} onChange={(event) => setRouteId(event.currentTarget.value)} required><For each={props.routes}>{(route) => <option value={route.id}>{route.path}</option>}</For></select></label>
          <Show when={props.routes.length === 0}><p class="text-sm text-destructive">Install an application with a page route before adding an entry.</p></Show>
        </Show>
        <Show when={item()?.type === "external"}><label class="grid gap-2 text-sm font-medium text-foreground">HTTPS destination<Input name="menu-item-href" aria-label="External destination" type="url" value={href()} onInput={(event) => setHref(event.currentTarget.value)} required /></label></Show>
        <Show when={item()?.type === "action"}><label class="grid gap-2 text-sm font-medium text-foreground">Application path<Input name="menu-item-action-path" aria-label="Action path" value={actionPath()} onInput={(event) => setActionPath(event.currentTarget.value)} required /></label></Show>
        <footer class="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={props.onCancel}>Cancel</Button><Button type="submit" disabled={!label().trim() || !allowedParent() || (type() === "entry" && item()?.type !== "external" && item()?.type !== "action" && !props.routes.some((route) => route.id === routeId()))}>{editing() ? "Save changes" : `Add ${type()}`}</Button></footer>
      </form>
    </section>
  </div>;
}
