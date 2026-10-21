import { For, Show, createSignal, onSettled } from "solid-js";
import type { LucideIcon } from "@lucide/solid";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bell,
  Box,
  Briefcase,
  ChartNoAxesCombined,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  Grid,
  ListFilter,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  TrendingDown,
  TrendingUp,
  Truck,
  UserRound,
  UsersRound,
} from "@lucide/solid";
import { Dynamic, Portal } from "@solidjs/web";
import { getApplicationCatalog, getWorkspaceConfig, updateWorkspaceConfig, type ApplicationCatalog, type ApplicationRelease, type ApplicationCatalogSnapshot } from "./workspace/api";
import { authConfigured, finishSignIn, getAccessToken, signOut, startSignIn } from "./workspace/auth";
import NavigationStudio from "../../admin-panel/src/NavigationStudio";
import { defaultNavigation, menuEntries, readNavigation, routePath, saveNavigation, type NavigationEntry, type NavigationGroup, type NavigationLink, type WorkspaceNavigation } from "./config/navigation";
import { mountDeclaredRemote } from "./probe/federation";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";

const icons: Record<string, LucideIcon> = {
  grid: Grid,
  chart: ChartNoAxesCombined,
  bag: ShoppingBag,
  cart: ShoppingCart,
  users: UsersRound,
  truck: Truck,
  box: Box,
  briefcase: Briefcase,
  search: Search,
  bell: Bell,
  monitor: Monitor,
  settings: Settings,
  user: UserRound,
  down: ChevronDown,
  rightChevron: ChevronRight,
  more: Ellipsis,
  download: Download,
  plus: Plus,
  up: ArrowUp,
  downArrow: ArrowDown,
  right: ArrowRight,
  trash: Trash2,
  panelOpen: PanelLeftOpen,
  panelClose: PanelLeftClose,
  filter: ListFilter,
  trendingUp: TrendingUp,
  trendingDown: TrendingDown,
};

function Icon(props: { name: string; class?: string }) {
  const icon = icons[props.name] ?? icons.grid;
  return <Dynamic component={icon} class={props.class ?? "size-4 shrink-0"} aria-hidden="true" />;
}

const metricFallbacks = [
  { label: "Monthly revenue", value: "$189,540.75", previous: "$148,230.00 previous month", change: "+27.9%", positive: true },
  { label: "Orders fulfilled", value: "21,847", previous: "18,452 previous month", change: "+18.4%", positive: true },
  { label: "New customers", value: "4,975", previous: "4,120 previous month", change: "+20.8%", positive: true },
  { label: "Refunds issued", value: "$8,473.00", previous: "$9,821.00 previous month", change: "−13.7%", positive: false },
];
const chartMonths = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const chartValues = [[44, 38], [39, 47], [55, 42], [48, 51], [62, 45], [42, 55]];
const recentOrders = [
  ["ORD-2024-001", "Sarah Johnson", "Delivered", "$2,499.00", "Jan 28, 2024"],
  ["ORD-2024-002", "Michael Chen", "Shipped", "$1,348.00", "Jan 27, 2024"],
  ["ORD-2024-003", "Emma Wilson", "Processing", "$1,198.00", "Jan 27, 2024"],
  ["ORD-2024-004", "James Rodriguez", "Delivered", "$799.00", "Jan 26, 2024"],
  ["ORD-2024-005", "Lisa Park", "Cancelled", "$599.00", "Jan 26, 2024"],
];

export default function App() {
  const [workspaceStatus, setWorkspaceStatus] = createSignal("Loading workspace configuration...");
  const [revision, setRevision] = createSignal(0);
  const [accessToken, setAccessToken] = createSignal(getAccessToken() ?? "");
  const [activeRoute, setActiveRoute] = createSignal<string>();
  const [activeMenuEntryId, setActiveMenuEntryId] = createSignal<string>();
  const [remoteStatus, setRemoteStatus] = createSignal("Choose a configured page from the workspace menu.");
  const [studioOpen, setStudioOpen] = createSignal(false);
  const [navigation, setNavigation] = createSignal<WorkspaceNavigation>(readNavigation());
  const [catalog, setCatalog] = createSignal<Awaited<ReturnType<typeof getApplicationCatalog>>["catalog"]>();
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(navigation().shell?.sidebar.defaultCollapsed ?? false);
  const [expandedMenu, setExpandedMenu] = createSignal<Record<string, boolean>>({});
  const [sidebarOptionsFor, setSidebarOptionsFor] = createSignal<string>();
  const [sidebarOptionsPosition, setSidebarOptionsPosition] = createSignal<{ top: number; left: number }>({ top: 0, left: 0 });
  const [sidebarMoveTreeFor, setSidebarMoveTreeFor] = createSignal<string>();
  const [sidebarAddEntryTo, setSidebarAddEntryTo] = createSignal<string>();
  const [sidebarNewRouteId, setSidebarNewRouteId] = createSignal("");
  const [sidebarNewEntryLabel, setSidebarNewEntryLabel] = createSignal("");
  const [sidebarNewEntryIcon, setSidebarNewEntryIcon] = createSignal("");
  let remoteContainer!: HTMLDivElement;
  let disposeRemote: (() => void) | undefined;
  let remoteGeneration = 0;
  let catalogLoading: Promise<ApplicationCatalogSnapshot> | undefined;

  async function refreshWorkspace() {
    catalogLoading = getApplicationCatalog();
    const [workspaceResult, catalogResult] = await Promise.allSettled([
      getWorkspaceConfig(),
      catalogLoading,
    ]);
    if (workspaceResult.status === "fulfilled") {
      const snapshot = workspaceResult.value;
      const config = migrateAdminPanelMenuEntry(snapshot.config);
      setNavigation(config);
      setRevision(snapshot.revision);
      setSidebarCollapsed(config.shell?.sidebar.defaultCollapsed ?? false);
      setWorkspaceStatus(`Configuration revision ${snapshot.revision}`);
      if (config !== snapshot.config) {
        saveNavigation(config);
        void updateWorkspaceConfig(config, snapshot.revision, accessToken() || undefined).then((saved) => {
          setNavigation(saved.config);
          setRevision(saved.revision);
          setWorkspaceStatus(`Configuration revision ${saved.revision}`);
        }).catch((error: unknown) => {
          setWorkspaceStatus(error instanceof Error ? `Admin menu settings moved locally; configuration sync failed: ${error.message}` : "Admin menu settings moved locally; configuration sync failed.");
        });
      }
    } else {
      setWorkspaceStatus(`Using bundled configuration · ${workspaceResult.reason instanceof Error ? workspaceResult.reason.message : "API unavailable"}`);
    }
    setCatalog(catalogResult.status === "fulfilled" ? catalogResult.value.catalog : undefined);
    return workspaceResult.status === "fulfilled" ? workspaceResult.value.config : navigation();
  }

  function clearRemote() {
    remoteGeneration += 1;
    disposeRemote?.();
    disposeRemote = undefined;
    remoteContainer?.replaceChildren();
    return remoteGeneration;
  }

  async function mountRouteRemote(routeId: string, generation: number) {
    const route = navigation().routes.find((candidate) => candidate.id === routeId);
    const installation = route && navigation().installations.find((candidate) => candidate.id === route.installationId);
    if (!route || !installation) {
      setRemoteStatus("This route does not reference an installed application.");
      return;
    }
    let availableCatalog: ApplicationCatalog | undefined = catalog();
    if (!availableCatalog && catalogLoading) {
      setRemoteStatus("Loading the application catalog…");
      availableCatalog = await catalogLoading.then((snapshot) => snapshot.catalog).catch(() => undefined);
    }
    if (generation !== remoteGeneration) return;
    const application = availableCatalog?.apps.find((candidate) => candidate.id === installation.appId);
    const release: ApplicationRelease | undefined = application?.releases.find((candidate) => candidate.id === installation.releaseId);
    if (!application || !release) {
      setRemoteStatus(`The pinned release ${installation.releaseId} is missing from the application catalog.`);
      return;
    }
    setRemoteStatus(`Loading ${application.name} ${release.version}…`);
    try {
      const unmount = await mountDeclaredRemote(application.id, release, remoteContainer, {
        workspaceId: navigation().workspace.id,
        installationId: installation.id,
        routeId: route.id,
        path: route.path,
      }, () => generation === remoteGeneration);
      if (generation !== remoteGeneration) {
        unmount();
        return;
      }
      disposeRemote = unmount;
      setRemoteStatus(`${application.name} ${release.version} mounted`);
    } catch (error) {
      if (generation === remoteGeneration) {
        setRemoteStatus(error instanceof Error ? `Could not load ${application.name}: ${error.message}` : `Could not load ${application.name}.`);
      }
    }
  }

  function clearActiveApplication() {
    clearRemote();
    setActiveRoute(undefined);
    setActiveMenuEntryId(undefined);
    setStudioOpen(false);
    setRemoteStatus("Choose a configured page from the workspace menu.");
  }

  function openRoute(routeId: string, updateHistory = true, menuEntryId?: string) {
    const route = navigation().routes.find((candidate) => candidate.id === routeId);
    if (!route) return;
    setActiveMenuEntryId(menuEntryId ?? findRouteMenuEntryId(routeId));
    const generation = clearRemote();
    setStudioOpen(false);
    setActiveRoute(routeId);
    setRemoteStatus(`Resolving the application for ${route.path}…`);
    if (updateHistory) window.history.pushState({}, "", route.path);
    void mountRouteRemote(routeId, generation);
  }

  function openConfiguredLink(link: NavigationLink) {
    if (link.type === "action" && link.action === "admin-panel") {
      clearActiveApplication();
      setActiveMenuEntryId(link.id);
      setStudioOpen(true);
      if (window.location.pathname !== link.path) window.history.pushState({}, "", link.path);
      return;
    }
    if (link.type === "external") return;
    if (link.type === "route") openRoute(link.routeId, true, link.id);
  }

  const primaryMenuPlacement = () => navigation().menuPlacements.find((placement) => placement.menuId === navigation().menus[0]?.id);
  const sidebarMenu = () => !primaryMenuPlacement() || primaryMenuPlacement()?.region === "left";

  function menuHref(link: NavigationLink) {
    if (link.type === "route") return routePath(navigation(), link.routeId);
    return link.type === "external" ? link.href : link.path;
  }
  function followMenuLink(link: NavigationLink, event: MouseEvent) {
    if (link.type === "external") return;
    event.preventDefault();
    openConfiguredLink(link);
  }

  function toggleMenuGroup(entry: NavigationGroup) {
    setExpandedMenu((current) => ({ ...current, [entry.id]: !(current[entry.id] ?? entry.defaultExpanded ?? true) }));
  }

  function menuGroupExpanded(entry: NavigationGroup) {
    return expandedMenu()[entry.id] ?? entry.defaultExpanded ?? true;
  }

  function persistMenuEntries(entries: NavigationEntry[]) {
    const config = {
      ...navigation(),
      menus: navigation().menus.map((menu, index) => index === 0 ? { ...menu, entries } : menu),
    };
    setNavigation(config);
    saveNavigation(config);
    void saveConfiguration(config).catch((error: unknown) => {
      setWorkspaceStatus(error instanceof Error ? error.message : "Workspace menu could not be saved.");
    });
  }

  function updateMenuEntry(id: string, update: (entry: NavigationEntry) => NavigationEntry) {
    const updateTree = (items: NavigationEntry[]): NavigationEntry[] => items.map((entry) => {
      if (entry.id === id) return update(entry);
      return entry.type === "group" ? { ...entry, children: updateTree(entry.children) } : entry;
    });
    persistMenuEntries(updateTree(menuEntries(navigation())));
  }

  function findMenuSiblings(id: string, items = menuEntries(navigation())): NavigationEntry[] | undefined {
    if (items.some((entry) => entry.id === id)) return items;
    for (const entry of items) {
      if (entry.type !== "group") continue;
      const nested = findMenuSiblings(id, entry.children);
      if (nested) return nested;
    }
    return undefined;
  }

  function moveMenuEntry(id: string, direction: -1 | 1) {
    const move = (items: NavigationEntry[]): NavigationEntry[] => {
      const index = items.findIndex((entry) => entry.id === id);
      if (index >= 0) {
        const nextIndex = index + direction;
        if (nextIndex < 0 || nextIndex >= items.length) return items;
        const next = [...items];
        [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
        return next;
      }
      return items.map((entry) => entry.type === "group" ? { ...entry, children: move(entry.children) } : entry);
    };
    persistMenuEntries(move(menuEntries(navigation())));
    setSidebarOptionsFor(undefined);
  }

  function containsMenuEntry(entry: NavigationEntry, id: string): boolean {
    return entry.id === id || (entry.type === "group" && entry.children.some((child) => containsMenuEntry(child, id)));
  }

  function moveMenuGroupTo(groupId: string, destinationId?: string) {
    const current = menuEntries(navigation());
    const find = (items: NavigationEntry[]): NavigationEntry | undefined => {
      for (const entry of items) {
        if (entry.id === groupId) return entry;
        if (entry.type === "group") {
          const nested = find(entry.children);
          if (nested) return nested;
        }
      }
      return undefined;
    };
    const source = find(current);
    if (!source || source.type !== "group" || (destinationId && containsMenuEntry(source, destinationId))) return;
    const remove = (items: NavigationEntry[]): { entry?: NavigationEntry; entries: NavigationEntry[] } => {
      const index = items.findIndex((entry) => entry.id === groupId);
      if (index >= 0) {
        const next = [...items];
        const [entry] = next.splice(index, 1);
        return entry ? { entry, entries: next } : { entries: items };
      }
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (item.type !== "group") continue;
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
    if (!removed.entry || removed.entry.type !== "group") return;
    if (!destinationId) {
      persistMenuEntries([...removed.entries, removed.entry]);
    } else {
      const insert = (items: NavigationEntry[]): NavigationEntry[] => items.map((entry) => {
        if (entry.id === destinationId && entry.type === "group") return { ...entry, children: [...entry.children, removed.entry!] };
        return entry.type === "group" ? { ...entry, children: insert(entry.children) } : entry;
      });
      persistMenuEntries(insert(removed.entries));
    }
    setSidebarOptionsFor(undefined);
    setSidebarMoveTreeFor(undefined);
  }

  function removeMenuGroup(id: string) {
    const remove = (items: NavigationEntry[]): NavigationEntry[] => items.filter((entry) => entry.id !== id).map((entry) => entry.type === "group" ? { ...entry, children: remove(entry.children) } : entry);
    persistMenuEntries(remove(menuEntries(navigation())));
    setSidebarOptionsFor(undefined);
  }

  function beginSidebarAddEntry(groupId: string) {
    setSidebarOptionsFor(undefined);
    setSidebarMoveTreeFor(undefined);
    setSidebarAddEntryTo(groupId);
    setSidebarNewRouteId(navigation().routes[0]?.id ?? "");
    setSidebarNewEntryLabel("");
    setSidebarNewEntryIcon("");
  }

  function closeSidebarAddEntry() {
    setSidebarAddEntryTo(undefined);
    setSidebarNewEntryLabel("");
    setSidebarNewEntryIcon("");
  }

  function addSidebarEntry(event: SubmitEvent) {
    event.preventDefault();
    const groupId = sidebarAddEntryTo();
    const route = navigation().routes.find((candidate) => candidate.id === sidebarNewRouteId());
    const label = sidebarNewEntryLabel().trim();
    if (!groupId || !route || !label) return;
    const icon = sidebarNewEntryIcon().trim();
    const entry: NavigationEntry = { id: `${route.id}-${Date.now()}`, type: "route", routeId: route.id, label, ...(icon ? { icon } : {}), visible: true };
    updateMenuEntry(groupId, (group) => group.type === "group" ? { ...group, children: [...group.children, entry] } : group);
    closeSidebarAddEntry();
  }

  function configuredMenuGroups(entries = menuEntries(navigation())): NavigationGroup[] {
    return entries.flatMap((entry) => entry.type === "group" ? [entry, ...configuredMenuGroups(entry.children)] : []);
  }

  function configuredIcons() {
    const collect = (entries: NavigationEntry[]): string[] => entries.flatMap((entry) => [
      ...(entry.icon ? [entry.icon] : []),
      ...(entry.type === "group" ? collect(entry.children) : []),
    ]);
    return [...new Set(collect(menuEntries(navigation())))];
  }

  function renderSidebarGroupActions(group: NavigationGroup) {
    const siblings = findMenuSiblings(group.id) ?? [];
    const position = siblings.findIndex((entry) => entry.id === group.id);
    const collectMoveTargets = (items: NavigationEntry[], depth = 0): { id: string; label: string; depth: number }[] => items.flatMap((entry) => {
      if (entry.type !== "group" || entry.id === group.id || containsMenuEntry(group, entry.id)) return [];
      return [{ id: entry.id, label: entry.label, depth }, ...collectMoveTargets(entry.children, depth + 1)];
    });
    const targets = collectMoveTargets(menuEntries(navigation()));
    return <Show when={!sidebarCollapsed()}>
      <div class="relative ml-auto flex shrink-0 items-center gap-0.5">
        <Button type="button" variant="ghost" size="icon" class="size-7 text-muted-foreground" aria-label={`Add entry to ${group.label}`} title={`Add entry to ${group.label}`} onClick={(event) => { event.stopPropagation(); beginSidebarAddEntry(group.id); }}><Icon name="plus" class="size-3.5" /></Button>
        <Button type="button" variant="ghost" size="icon" class="size-7 text-muted-foreground" aria-label={`More options for ${group.label}`} title={`More options for ${group.label}`} aria-expanded={sidebarOptionsFor() === group.id ? "true" : "false"} onClick={(event) => {
          event.stopPropagation();
          if (sidebarOptionsFor() === group.id) {
            setSidebarOptionsFor(undefined);
            return;
          }
          const bounds = event.currentTarget.getBoundingClientRect();
          const width = 208;
          setSidebarOptionsPosition({
            top: Math.max(8, Math.min(bounds.top, window.innerHeight - 300)),
            left: Math.max(8, Math.min(bounds.right + 8, window.innerWidth - width - 8)),
          });
          setSidebarOptionsFor(group.id);
          setSidebarMoveTreeFor(undefined);
          setSidebarAddEntryTo(undefined);
        }}><Icon name="more" class="size-4" /></Button>
        <Show when={sidebarOptionsFor() === group.id}>
          <Portal>
          <div class="fixed z-[110] w-52 rounded-md border border-border bg-background p-1 text-foreground shadow-md" style={{ top: `${sidebarOptionsPosition().top}px`, left: `${sidebarOptionsPosition().left}px` }} role="menu" aria-label={`${group.label} options`} onClick={(event) => event.stopPropagation()}>
            <button class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70 disabled:cursor-not-allowed disabled:opacity-40" type="button" role="menuitem" disabled={position <= 0} onClick={() => moveMenuEntry(group.id, -1)}><Icon name="up" class="size-4 text-muted-foreground" />Move up</button>
            <button class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70 disabled:cursor-not-allowed disabled:opacity-40" type="button" role="menuitem" disabled={position < 0 || position >= siblings.length - 1} onClick={() => moveMenuEntry(group.id, 1)}><Icon name="downArrow" class="size-4 text-muted-foreground" />Move down</button>
            <button class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70" type="button" role="menuitem" aria-expanded={sidebarMoveTreeFor() === group.id ? "true" : "false"} onClick={() => setSidebarMoveTreeFor((current) => current === group.id ? undefined : group.id)}><Icon name="right" class="size-4 text-muted-foreground" /><span class="flex-1">Move to</span><Icon name="rightChevron" class="size-4 text-muted-foreground" /></button>
            <Show when={sidebarMoveTreeFor() === group.id}>
              <div class="my-1 max-h-48 overflow-y-auto border-y border-border py-1" role="group" aria-label="Move group to menu">
                <button class="flex min-h-9 w-full items-center rounded-md px-2 text-left text-sm text-foreground hover:bg-accent/70" type="button" onClick={() => moveMenuGroupTo(group.id)}>Workspace menu</button>
                <For each={targets}>{(target) => <button class="flex min-h-9 w-full items-center rounded-md pr-2 text-left text-sm text-foreground hover:bg-accent/70" style={{ "padding-left": `${8 + target.depth * 12}px` }} type="button" onClick={() => moveMenuGroupTo(group.id, target.id)}><span class="mr-2 text-muted-foreground">↳</span>{target.label}</button>}</For>
              </div>
            </Show>
            <div class="my-1 border-t border-border" />
            <button class="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-destructive hover:bg-accent/70" type="button" role="menuitem" onClick={() => removeMenuGroup(group.id)}><Icon name="trash" class="size-4" />Delete group</button>
          </div>
          </Portal>
        </Show>
      </div>
    </Show>;
  }

  function renderSidebarLink(entry: NavigationLink, depth: number) {
    const icon = <Icon name={entry.icon ?? (entry.type === "action" ? "settings" : "grid")} class="size-4 shrink-0" />;
    return <a
      class={`flex w-full min-h-9 items-center gap-2 rounded-md text-sm no-underline transition-colors ${sidebarCollapsed() ? "justify-center px-0" : "px-2"} ${activeMenuEntryId() === entry.id ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/70"}`}
      style={{ "padding-left": `${sidebarCollapsed() ? 0 : 8 + Math.max(0, depth - 1) * 16}px` }}
      title={entry.label}
      aria-label={entry.label}
      aria-current={activeMenuEntryId() === entry.id ? "page" : undefined}
      href={menuHref(entry)}
      onClick={(event) => followMenuLink(entry, event)}
      target={entry.type === "external" ? "_blank" : undefined}
      rel={entry.type === "external" ? "noopener noreferrer" : undefined}
    >{icon}<Show when={!sidebarCollapsed()}><span class="min-w-0 flex-1 truncate">{entry.label}</span></Show></a>;
  }

  function renderSidebarEntry(entry: NavigationEntry, depth = 0) {
    if (entry.visible === false) return null;
    if (entry.type !== "group") return renderSidebarLink(entry, depth);
    if (depth === 0) {
      const expanded = () => menuGroupExpanded(entry);
      return <section class="mb-4" aria-label={`${entry.label} menu`}>
        <div class={`group/header relative mb-1 flex min-h-9 items-center rounded-md ${sidebarCollapsed() ? "justify-center px-0" : "px-1"}`}>
          <Show when={entry.chevron === true} fallback={<Show when={!sidebarCollapsed()}><h2 class="min-w-0 flex-1 truncate px-1 py-1 text-[13px] font-medium text-muted-foreground">{entry.label}</h2></Show>}>
            <button class={`flex min-w-0 items-center gap-2 rounded-md py-1 text-left text-[13px] font-medium text-muted-foreground hover:bg-accent/70 ${sidebarCollapsed() ? "h-9 w-full justify-center px-0" : "flex-1 px-1"}`} type="button" aria-expanded={expanded() ? "true" : "false"} onClick={() => toggleMenuGroup(entry)}><Show when={entry.icon}><Icon name={entry.icon ?? "grid"} class="size-4" /></Show><Show when={!sidebarCollapsed()}><span class="min-w-0 flex-1 truncate">{entry.label}</span><Icon name="down" class={`size-4 transition-transform ${expanded() ? "rotate-0" : "-rotate-90"}`} /></Show></button>
          </Show>
          {renderSidebarGroupActions(entry)}
        </div>
        <Show when={entry.chevron !== true || expanded()}><ul class="m-0 list-none p-0"><For each={entry.children}>{(child) => <li>{renderSidebarEntry(child, depth + 1)}</li>}</For></ul></Show>
      </section>;
    }
    const expanded = () => menuGroupExpanded(entry);
    return <div class="mb-0.5">
      <div class="flex items-center" style={{ "padding-left": `${sidebarCollapsed() ? 0 : Math.max(0, depth - 1) * 16}px` }}>
        <button class={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm text-foreground hover:bg-accent/70 ${sidebarCollapsed() ? "justify-center px-0" : "px-2"}`} type="button" title={entry.label} aria-label={entry.label} aria-expanded={expanded() ? "true" : "false"} onClick={() => toggleMenuGroup(entry)}>
          <Icon name={entry.icon ?? "grid"} class="size-4 shrink-0" /><Show when={!sidebarCollapsed()}><span class="min-w-0 flex-1 truncate">{entry.label}</span><Show when={entry.chevron !== false}><Icon name="down" class={`size-4 transition-transform ${expanded() ? "rotate-0" : "-rotate-90"}`} /></Show></Show>
        </button>
        {renderSidebarGroupActions(entry)}
      </div>
      <Show when={expanded()}><ul class="m-0 list-none p-0"><For each={entry.children}>{(child) => <li>{renderSidebarEntry(child, depth + 1)}</li>}</For></ul></Show>
    </div>;
  }

  function renderTopEntry(entry: NavigationEntry) {
    if (entry.visible === false) return null;
    if (entry.type === "group") return <><span class="px-2 text-[13px] font-medium text-muted-foreground">{entry.label}</span><For each={entry.children}>{(child) => renderTopEntry(child)}</For></>;
    if (entry.type === "action") return <a class={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] no-underline ${studioOpen() ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`} aria-label={entry.label} aria-current={studioOpen() ? "page" : undefined} href={menuHref(entry)} onClick={(event) => followMenuLink(entry, event)}><Icon name={entry.icon ?? "settings"} />{entry.label}</a>;
    return <a class="rounded-md px-2 py-1.5 text-[13px] text-muted-foreground no-underline hover:bg-accent hover:text-foreground" href={menuHref(entry)} onClick={(event) => followMenuLink(entry, event)} target={entry.type === "external" ? "_blank" : undefined} rel={entry.type === "external" ? "noopener noreferrer" : undefined}>{entry.label}</a>;
  }

  const breadcrumbSegments = () => {
    const route = navigation().routes.find((candidate) => candidate.id === activeRoute());
    const segments = route?.path.split("/").filter(Boolean) ?? [];
    return segments.slice(-1 * (navigation().shell?.breadcrumbs.maxDepth ?? 5));
  };

  function findAdminPanelEntry(entries: NavigationEntry[] = menuEntries(navigation())): Extract<NavigationEntry, { type: "action" }> | undefined {
    for (const entry of entries) {
      if (entry.type === "action" && entry.action === "admin-panel") return entry;
      if (entry.type === "group") {
        const nested = findAdminPanelEntry(entry.children);
        if (nested) return nested;
      }
    }
    return undefined;
  }

  function migrateAdminPanelMenuEntry(config: WorkspaceNavigation): WorkspaceNavigation {
    const legacyEntry = findAdminPanelEntry(menuEntries(config));
    const sidebar = config.shell?.sidebar ?? defaultNavigation.shell?.sidebar;
    if (!sidebar) return config;
    let removedLegacyEntry = false;
    const removeLegacyEntries = (entries: NavigationEntry[]): NavigationEntry[] => {
      const cleaned: NavigationEntry[] = [];
      for (const entry of entries) {
        if (entry.type === "action" && entry.action === "admin-panel") {
          removedLegacyEntry = true;
          continue;
        }
        if (entry.type !== "group") {
          cleaned.push(entry);
          continue;
        }
        const children = removeLegacyEntries(entry.children);
        if (children.length === 0 && children.length !== entry.children.length) continue;
        cleaned.push(children.length === entry.children.length ? entry : { ...entry, children });
      }
      return cleaned;
    };
    const menus = config.menus.map((menu) => ({ ...menu, entries: removeLegacyEntries(menu.entries) }));
    const adminMenuSettingsPath = sidebar.adminMenuSettingsPath ?? legacyEntry?.path;
    if (!removedLegacyEntry && adminMenuSettingsPath === sidebar.adminMenuSettingsPath) return config;
    const shell = config.shell ?? defaultNavigation.shell;
    if (!shell) return config;
    return {
      ...config,
      menus,
      shell: { ...shell, sidebar: { ...sidebar, ...(adminMenuSettingsPath ? { adminMenuSettingsPath } : {}) } },
    };
  }

  function adminMenuSettingsPath() {
    return navigation().shell?.sidebar.adminMenuSettingsPath ?? findAdminPanelEntry()?.path;
  }

  function openAdminMenuSettings() {
    const path = adminMenuSettingsPath();
    if (!path) return;
    clearActiveApplication();
    setStudioOpen(true);
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  }

  function findRouteMenuEntryId(routeId: string, entries: NavigationEntry[] = menuEntries(navigation())): string | undefined {
    for (const entry of entries) {
      if (entry.type === "route" && entry.routeId === routeId) return entry.id;
      if (entry.type === "group") {
        const nested = findRouteMenuEntryId(routeId, entry.children);
        if (nested) return nested;
      }
    }
    return undefined;
  }

  const dashboardMetrics = () => metricFallbacks.map((metric, index) => {
    const widget = navigation().dashboards?.[0]?.widgets[index];
    return { ...metric, label: String(widget?.settings.value.label ?? metric.label), value: String(widget?.settings.value.value ?? metric.value) };
  });

  function handlePopState() {
    const adminPath = adminMenuSettingsPath();
    if (adminPath && window.location.pathname === adminPath) {
      clearActiveApplication();
      setStudioOpen(true);
      return;
    }
    const match = navigation().routes.find((route) => window.location.pathname === route.path);
    if (match) openRoute(match.id, false); else { setActiveMenuEntryId(undefined); clearActiveApplication(); }
  }

  async function saveConfiguration(config = navigation()) {
    const saved = await updateWorkspaceConfig(config, revision(), accessToken() || undefined);
    setNavigation(saved.config);
    setRevision(saved.revision);
    setWorkspaceStatus(`Configuration revision ${saved.revision}`);
  }

  onSettled(() => {
    window.addEventListener("popstate", handlePopState);
    void finishSignIn().then((signedIn) => {
      if (signedIn) setAccessToken(getAccessToken() ?? "");
    }).catch((error: unknown) => setWorkspaceStatus(error instanceof Error ? error.message : "Ferriskey sign-in failed"));
    void refreshWorkspace().then(() => {
      const adminPath = adminMenuSettingsPath();
      if (adminPath && window.location.pathname === adminPath) {
        clearActiveApplication();
        setStudioOpen(true);
        return;
      }
      const current = navigation().routes.find((route) => window.location.pathname === route.path);
      if (current) openRoute(current.id, false);
    });
    return () => {
      window.removeEventListener("popstate", handlePopState);
      clearRemote();
    };
  });

  return (
    <div class="flex min-h-screen bg-background font-sans text-foreground">
      <Show when={sidebarMenu()}>
        <aside class="sticky top-0 flex h-screen min-h-0 shrink-0 flex-col self-start border-r border-border bg-muted/30" style={{ width: `${sidebarCollapsed() ? 48 : navigation().shell?.sidebar.width ?? 256}px` }}>
          <div class={`flex ${sidebarCollapsed() ? "h-24 shrink-0 flex-col px-0" : "h-[52px] items-center gap-2 px-3"}`}>
            <a class={`brand flex min-w-0 items-center gap-2.5 text-foreground no-underline ${sidebarCollapsed() ? "h-12 w-full shrink-0 justify-center" : "flex-1"}`} href="/" onClick={(event) => { event.preventDefault(); clearActiveApplication(); window.history.pushState({}, "", "/"); }}>
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary"><Icon name="box" class="size-4" /></span>
              <Show when={!sidebarCollapsed()}><span class="min-w-0 leading-tight"><strong class="block truncate text-[13px] font-semibold">Modulaga Admin</strong><span class="block truncate text-xs text-muted-foreground">Workspace shell</span></span></Show>
            </a>
            <Show when={adminMenuSettingsPath() && !sidebarCollapsed()}>
              <Button type="button" variant="ghost" size="icon" class={`shrink-0 ${sidebarCollapsed() ? "h-7 w-7" : ""}`} aria-label="Admin menu settings" title="Admin menu settings" aria-current={studioOpen() ? "page" : undefined} onClick={openAdminMenuSettings}><Icon name="settings" /></Button>
            </Show>
            <Show when={navigation().shell?.sidebar.mode === "collapsible"}>
              <Button type="button" variant="ghost" size="icon" class={sidebarCollapsed() ? "h-12 w-full rounded-none" : "shrink-0"} aria-label={sidebarCollapsed() ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}><Icon name={sidebarCollapsed() ? "panelOpen" : "panelClose"} /></Button>
            </Show>
          </div>
          <nav aria-label="Workspace menu" class="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-3">
            <For each={menuEntries(navigation())}>{(entry) => renderSidebarEntry(entry)}</For>
          </nav>
        </aside>
      </Show>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
          <span class="truncate text-sm font-medium">{navigation().workspace.name}</span>
          <Show when={!sidebarMenu()}>
            <nav class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Workspace menu">
              <For each={menuEntries(navigation())}>{(entry) => renderTopEntry(entry)}</For>
            </nav>
          </Show>
          <Show when={!sidebarMenu() && adminMenuSettingsPath()}>
            <Button variant="ghost" size="icon" type="button" aria-label="Admin menu settings" title="Admin menu settings" aria-current={studioOpen() ? "page" : undefined} onClick={openAdminMenuSettings}><Icon name="settings" /></Button>
          </Show>
          <div class="ml-auto flex items-center gap-1">
            <Button class="hidden sm:inline-flex" variant="outline" size="icon" type="button" aria-label="Search"><Icon name="search" /></Button>
            <Button variant="outline" size="icon" type="button" aria-label="Notifications"><Icon name="bell" /><span class="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-destructive text-[9px] text-white">2</span></Button>
            <Button class="hidden sm:inline-flex" variant="ghost" size="icon" type="button" aria-label="Display settings"><Icon name="monitor" /></Button>
            <Show when={authConfigured}>
              <Button variant="outline" size="sm" type="button" onClick={() => accessToken() ? (signOut(), setAccessToken("")) : void startSignIn().catch((error: unknown) => setWorkspaceStatus(error instanceof Error ? error.message : "Ferriskey sign-in failed"))}>{accessToken() ? "Sign out" : "Sign in"}</Button>
            </Show>
          </div>
        </header>

        <main class="min-w-0 flex-1 overflow-x-hidden px-5 py-6 sm:px-6 lg:px-7">
          <Show when={studioOpen()} fallback={
            <Show when={activeRoute()} fallback={
                <section aria-label="Configured dashboard" class="mx-auto max-w-[1600px]">
                  <div class="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                    <div><h1 class="text-2xl font-semibold tracking-tight">{navigation().welcomePage?.title ?? "Welcome back, John!"}</h1><p class="mt-2 text-base text-muted-foreground">{navigation().welcomePage?.description ?? "Today you have 12 orders to fulfill, 3 returns pending"}</p></div>
                    <div class="flex gap-2"><Button variant="outline" size="sm" type="button"><Icon name="download" />Export</Button><Button size="sm" type="button"><Icon name="plus" />Add Product</Button></div>
                  </div>
                  <Show when={navigation().welcomePage?.showDashboard ?? true}>
                  <section class="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4" aria-label="Key metrics">
                    <For each={dashboardMetrics()}>{(metric, index) => {
                      return <Card class="min-w-0 gap-3 rounded-xl border-border p-5 shadow-none">
                        <div class="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={index() === 0 ? "bag" : index() === 1 ? "cart" : index() === 2 ? "users" : "box"} />{metric.label}</div>
                        <p class="text-xs text-muted-foreground/80">{metric.previous}</p>
                        <strong class="text-[30px] font-semibold leading-none tracking-tight">{metric.value}</strong>
                        <p class={`flex items-center gap-1 text-xs ${metric.positive ? "text-emerald-600" : "text-red-600"}`}><Icon name={metric.positive ? "trendingUp" : "trendingDown"} class="size-3" />{metric.change}<span class="text-muted-foreground">vs last month</span></p>
                      </Card>;
                    }}</For>
                  </section>

                  <section class="mb-5 grid gap-5 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,0.9fr)]" aria-label="Revenue overview">
                    <Card class="gap-0 rounded-xl border-border p-5 shadow-none">
                      <div class="flex items-start justify-between gap-4"><div><h2 class="text-[26px] font-semibold tracking-tight">$276,000.00</h2><p class="mt-1 text-xs text-muted-foreground">Total Revenue (Last 6 Months)</p></div><div class="flex items-center gap-4 pt-1 text-xs text-muted-foreground"><span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-foreground" />This Year</span><span class="flex items-center gap-1.5"><span class="size-3 rounded-full bg-muted-foreground" />Prev Year</span><Button variant="ghost" size="icon" aria-label="More chart options"><Icon name="more" /></Button></div></div>
                      <div class="mt-6 grid grid-cols-[36px_minmax(0,1fr)] gap-2">
                        <div class="flex h-[230px] flex-col justify-between pb-5 text-xs text-muted-foreground"><span>$60K</span><span>$45K</span><span>$30K</span><span>$15K</span><span>$0</span></div>
                        <div class="relative grid h-[230px] grid-cols-6 items-end gap-3 border-b border-border px-2">
                          <div class="pointer-events-none absolute inset-0 flex flex-col justify-between pb-5">{[0, 1, 2, 3, 4].map(() => <span class="border-t border-border/50" />)}</div>
                          <For each={chartValues}>{(values) => <div class="relative z-10 flex h-full items-end justify-center gap-2 pb-0"><span class="w-5 rounded-t bg-foreground" style={{ height: `${values[0]! * 1.4}%` }} /><span class="w-5 rounded-t bg-muted-foreground/50" style={{ height: `${values[1]! * 1.4}%` }} /></div>}</For>
                        </div>
                        <span />
                        <div class="grid grid-cols-6 px-2 text-center text-[11px] text-muted-foreground"><For each={chartMonths}>{(month) => <span>{month}</span>}</For></div>
                      </div>
                    </Card>

                    <Card class="gap-0 rounded-xl border-border p-5 shadow-none">
                      <div class="flex items-center gap-2"><span class="grid size-8 place-items-center rounded-lg border border-border"><Icon name="users" /></span><h2 class="text-base font-medium">Revenue Channels</h2></div>
                      <div class="mt-7 flex items-baseline gap-2"><strong class="text-[30px] font-semibold tracking-tight">$98K</strong><span class="text-sm text-muted-foreground">total revenue</span></div>
                      <div class="mt-3 flex h-3 gap-1 overflow-hidden rounded-full"><span class="flex-[3] bg-foreground" /><span class="flex-1 bg-foreground/70" /><span class="flex-[0.6] bg-muted-foreground/70" /></div>
                      <div class="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground"><span><i class="mr-1.5 inline-block size-2 rounded-full bg-foreground" />Online</span><span><i class="mr-1.5 inline-block size-2 rounded-full bg-foreground/70" />In-Store</span><span><i class="mr-1.5 inline-block size-2 rounded-full bg-muted-foreground/70" />Marketplace</span></div>
                      <div class="mt-4 grid grid-cols-[1fr_auto_auto] gap-x-3 text-xs text-muted-foreground"><span>Channels</span><span>Number</span><span>Total</span></div>
                      <div class="mt-2 divide-y divide-border">
                        <For each={[["Website", "4,821", "+18.3%"], ["Mobile App", "3,147", "+12.7%"], ["Email", "1,893", "−8.4%"], ["Social", "762", "+31.2%"]]}>{(channel, index) => <div class="grid min-h-10 grid-cols-[1fr_auto_auto] items-center gap-x-3 text-sm"><span class="flex items-center gap-2"><span class="grid size-7 place-items-center rounded-full bg-muted text-[10px] text-muted-foreground">{channel[0]?.[0]}</span>{channel[0]}</span><span>{channel[1]}</span><span class={`flex items-center gap-1 ${index() === 2 ? "text-red-600" : "text-emerald-600"}`}><Icon name={index() === 2 ? "trendingDown" : "trendingUp"} class="size-3" />{channel[2]}</span></div>}</For>
                      </div>
                    </Card>
                  </section>

                  <Card class="gap-0 overflow-hidden rounded-xl border-border p-0 shadow-none">
                    <div class="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"><div class="flex items-center gap-3"><span class="grid size-8 place-items-center rounded-lg border border-border"><Icon name="cart" /></span><h2 class="text-base font-medium">Recent Orders</h2><Badge variant="secondary" class="px-2 py-0.5 text-xs">20</Badge></div><div class="flex gap-2"><label class="flex h-9 min-w-48 items-center gap-2 rounded-md border border-input px-3 text-sm text-muted-foreground"><Icon name="search" /><input class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Search orders" placeholder="Search orders..." /></label><Button variant="outline" size="sm" class="text-[13px]" type="button"><Icon name="filter" />Filter</Button></div></div>
                    <div class="overflow-x-auto px-5"><table class="w-full min-w-[720px] border-collapse text-left text-sm"><thead><tr class="border-y border-border bg-muted/40 text-muted-foreground"><th class="px-2 py-3 font-medium">#</th><th class="px-3 py-3 font-medium">Order</th><th class="px-3 py-3 font-medium">Customer</th><th class="px-3 py-3 font-medium">Status</th><th class="px-3 py-3 font-medium">Total</th><th class="px-3 py-3 font-medium">Date</th><th class="px-3 py-3" /></tr></thead><tbody><For each={recentOrders}>{(order, index) => <tr class="border-b border-border last:border-0"><td class="px-2 py-3.5">{index() + 1}</td><td class="px-3 py-3.5"><span class="block font-medium">{order[0]}</span><span class="mt-1 block text-xs text-muted-foreground">2 items</span></td><td class="px-3 py-3.5"><span class="flex items-center gap-2"><span class="grid size-6 place-items-center rounded-full bg-muted text-[9px] text-muted-foreground">{order[1]!.split(" ").map((name) => name[0] ?? "").join("")}</span>{order[1]}</span></td><td class="px-3 py-3.5"><Badge variant="outline" class={`px-2 py-0.5 text-xs ${order[2] === "Delivered" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : order[2] === "Shipped" ? "border-blue-200 bg-blue-50 text-blue-700" : order[2] === "Processing" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-red-200 bg-red-50 text-red-700"}`}>{order[2]}</Badge></td><td class="px-3 py-3.5">{order[3]}</td><td class="px-3 py-3.5 text-muted-foreground">{order[4]}</td><td class="px-3 py-3.5 text-right text-muted-foreground">•••</td></tr>}</For></tbody></table></div>
                  </Card>
                  </Show>
                </section>
            }>
              <Show when={navigation().shell?.breadcrumbs.enabled}><nav class="mb-5 flex items-center gap-2 text-sm text-muted-foreground" aria-label="Breadcrumb"><a class="text-muted-foreground no-underline hover:text-foreground" href="/" onClick={(event) => { event.preventDefault(); clearActiveApplication(); window.history.pushState({}, "", "/"); }}>{navigation().workspace.name}</a><For each={breadcrumbSegments()}>{(segment) => <><span aria-hidden="true">{navigation().shell?.breadcrumbs.separator ?? "/"}</span><span>{segment}</span></>}</For></nav></Show>
              <h1 class="mb-2 text-2xl font-semibold tracking-tight">{navigation().routes.find((route) => route.id === activeRoute())?.path ?? "Application"}</h1><p class="mb-6 text-sm text-muted-foreground" role="status" aria-live="polite">{remoteStatus()}</p><div class="min-h-36" ref={remoteContainer} data-testid="declared-remote-container" />
            </Show>
          }>
            <NavigationStudio config={navigation} setConfig={setNavigation} saveConfig={saveConfiguration} />
          </Show>
        </main>
        <footer class="flex h-7 items-center border-t border-border px-4 text-[10px] text-muted-foreground"><span>{workspaceStatus()}</span><span class="ml-auto hidden sm:inline">Modulaga workspace shell</span></footer>
      </div>
      <Show when={sidebarAddEntryTo()}>
        <div class="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/50 p-4" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeSidebarAddEntry(); }} onKeyDown={(event) => { if (event.key === "Escape") closeSidebarAddEntry(); }}>
          <section class="w-full max-w-md rounded-xl border border-border bg-background p-6 text-foreground shadow-xl" role="dialog" aria-modal="true" aria-labelledby="add-menu-entry-title" aria-describedby="add-menu-entry-description">
            <div class="mb-5 flex items-start justify-between gap-4">
              <div><h2 id="add-menu-entry-title" class="text-lg font-semibold tracking-tight">Add menu entry</h2><p id="add-menu-entry-description" class="mt-1 text-sm text-muted-foreground">Add a configured workspace route to the sidebar.</p></div>
              <Button type="button" variant="ghost" size="icon" class="-mr-2 -mt-2" aria-label="Close dialog" onClick={closeSidebarAddEntry}>×</Button>
            </div>
            <form class="space-y-4" onSubmit={addSidebarEntry}>
              <div class="space-y-2">
                <label class="text-sm font-medium" for="sidebar-entry-group">Menu group</label>
                <select id="sidebar-entry-group" class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" value={sidebarAddEntryTo()} onChange={(event) => setSidebarAddEntryTo(event.currentTarget.value)} required>
                  <For each={configuredMenuGroups()}>{(group) => <option value={group.id}>{group.label}</option>}</For>
                </select>
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium" for="sidebar-entry-label">Entry name</label>
                <input id="sidebar-entry-label" class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring" value={sidebarNewEntryLabel()} onInput={(event) => setSidebarNewEntryLabel(event.currentTarget.value)} placeholder="e.g. Reports" required />
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium" for="sidebar-entry-route">Route</label>
                <select id="sidebar-entry-route" class="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" value={sidebarNewRouteId()} onChange={(event) => setSidebarNewRouteId(event.currentTarget.value)} required>
                  <For each={navigation().routes}>{(route) => <option value={route.id}>{route.path}</option>}</For>
                </select>
              </div>
              <div class="space-y-2">
                <label class="text-sm font-medium" for="sidebar-entry-icon">Icon</label>
                <div class="flex items-center gap-2">
                  <span class="grid size-9 shrink-0 place-items-center rounded-md border border-input bg-muted/30"><Icon name={sidebarNewEntryIcon() || "grid"} /></span>
                  <input id="sidebar-entry-icon" list="sidebar-configured-icons" class="flex h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring" value={sidebarNewEntryIcon()} onInput={(event) => setSidebarNewEntryIcon(event.currentTarget.value)} placeholder="Icon name" />
                  <datalist id="sidebar-configured-icons"><For each={configuredIcons()}>{(icon) => <option value={icon} />}</For></datalist>
                </div>
                <p class="text-xs text-muted-foreground">Choose an icon name already used in this workspace menu.</p>
              </div>
              <div class="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={closeSidebarAddEntry}>Cancel</Button>
                <Button type="submit" disabled={!configuredMenuGroups().length || !navigation().routes.length || !sidebarNewEntryLabel().trim()}>Add entry</Button>
              </div>
            </form>
          </section>
        </div>
      </Show>
    </div>
  );
}
