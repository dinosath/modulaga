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
  Database,
  ChevronDown,
  ChevronRight,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  Grid,
  ListFilter,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
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
import type { MicrofrontendBreadcrumb } from "../../../packages/contracts/src/microfrontend";
import { getApplicationCatalog, getWorkspaceConfig, updateWorkspaceConfig, type ApplicationCatalog, type ApplicationRelease, type ApplicationCatalogSnapshot } from "./workspace/api";
import { authConfigured, finishSignIn, getAccessToken, signOut, startSignIn } from "./workspace/auth";
import { defaultMenuItemButtonActions, isNavigationContainer, menuEntries, readNavigation, routePath, saveNavigation, type MenuItemActionKey, type NavigationEntry, type NavigationGroup, type NavigationLink, type WorkspaceNavigation } from "./config/navigation";
import { mountDeclaredRemote } from "./probe/federation";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";

const icons: Record<string, LucideIcon> = {
  grid: Grid,
  database: Database,
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
  edit: Pencil,
  eye: Eye,
  eyeOff: EyeOff,
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
  const [accessToken, setAccessToken] = createSignal(getAccessToken() ?? "");
  const [workspaceRevision, setWorkspaceRevision] = createSignal(0);
  const [activeRoute, setActiveRoute] = createSignal<string>();
  const [activeMenuEntryId, setActiveMenuEntryId] = createSignal<string>();
  const [remoteBreadcrumbs, setRemoteBreadcrumbs] = createSignal<MicrofrontendBreadcrumb[]>([]);
  const [remoteStatus, setRemoteStatus] = createSignal("Choose a configured page from the workspace menu.");
  const [navigation, setNavigation] = createSignal<WorkspaceNavigation>(readNavigation());
  const [catalog, setCatalog] = createSignal<Awaited<ReturnType<typeof getApplicationCatalog>>["catalog"]>();
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(navigation().shell?.sidebar.defaultCollapsed ?? false);
  const [expandedMenu, setExpandedMenu] = createSignal<Record<string, boolean>>({});
  const [openSidebarOptions, setOpenSidebarOptions] = createSignal<{ id: string; top: number; left: number; maxHeight: number }>();
  let remoteContainer: HTMLDivElement | undefined;
  let sidebarElement: HTMLElement | undefined;
  let sidebarOptionsTrigger: HTMLButtonElement | undefined;
  let sidebarOptionsPanel: HTMLDivElement | undefined;
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
      const config = snapshot.config;
      setNavigation(config);
      setWorkspaceRevision(snapshot.revision);
      setSidebarCollapsed(config.shell?.sidebar.defaultCollapsed ?? false);
      setWorkspaceStatus(`Configuration revision ${snapshot.revision}`);

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

  async function waitForRemoteContainer(generation: number) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (generation !== remoteGeneration) return undefined;
      if (remoteContainer?.isConnected) return remoteContainer;
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    throw new Error("The application mount container was not ready.");
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
      const container = await waitForRemoteContainer(generation);
      if (!container || generation !== remoteGeneration) return;
      const unmount = await mountDeclaredRemote(application.id, release, container, {
        workspaceId: navigation().workspace.id,
        installationId: installation.id,
        routeId: route.id,
        path: route.path,
        setBreadcrumbs: (items) => {
          if (generation === remoteGeneration) setRemoteBreadcrumbs(items);
        },
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
    setRemoteBreadcrumbs([]);
    setActiveRoute(undefined);
    setActiveMenuEntryId(undefined);
    setRemoteStatus("Choose a configured page from the workspace menu.");
  }

  function openRoute(routeId: string, updateHistory = true, menuEntryId?: string) {
    const route = navigation().routes.find((candidate) => candidate.id === routeId);
    if (!route) return;
    setActiveMenuEntryId(menuEntryId ?? findRouteMenuEntryId(routeId));
    const generation = clearRemote();
    setRemoteBreadcrumbs([]);
    setActiveRoute(routeId);
    setRemoteStatus("Resolving application…");
    if (updateHistory) window.history.pushState({}, "", route.path);
    void mountRouteRemote(routeId, generation);
  }

  function openConfiguredLink(link: NavigationLink) {
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

  function runMenuAction(entry: NavigationEntry, action: MenuItemActionKey) {
    const binding = entry.buttonActions?.[action] ?? defaultMenuItemButtonActions[action];
    if (action === "delete" && binding.type === "client" && binding.clientId === "workspace-menu" && binding.actionId === "delete") {
      if (!window.confirm(`Delete “${entry.label}” from the workspace menu?`)) return;
      const removeEntry = (items: NavigationEntry[]): NavigationEntry[] => items
        .filter((item) => item.id !== entry.id)
        .map((item) => isNavigationContainer(item) ? { ...item, children: removeEntry(item.children) } : item);
      const config = navigation();
      const next = { ...config, menus: config.menus.map((menu, index) => index === 0 ? { ...menu, entries: removeEntry(menu.entries) } : menu) };
      setOpenSidebarOptions(undefined);
      void updateWorkspaceConfig(next, workspaceRevision(), accessToken() || undefined).then((snapshot) => {
        setNavigation(snapshot.config);
        setWorkspaceRevision(snapshot.revision);
        saveNavigation(snapshot.config);
        setWorkspaceStatus(`Configuration revision ${snapshot.revision}`);
      }).catch((error: unknown) => setWorkspaceStatus(error instanceof Error ? error.message : "The menu item could not be deleted."));
      return;
    }
    const settingsPath = adminMenuSettingsPath();
    const route = settingsPath && navigation().routes.find((candidate) => candidate.path === settingsPath);
    if (!route) return;
    const returnPath = window.location.pathname;
    const query = new URLSearchParams({ menuAction: action, menuItemId: entry.id, returnPath, bindingType: binding.type });
    if (binding.type === "client") {
      query.set("clientId", binding.clientId);
      query.set("actionId", binding.actionId);
    } else {
      query.set("componentId", binding.componentId);
    }
    window.history.pushState({}, "", `${route.path}?${query.toString()}`);
    setOpenSidebarOptions(undefined);
    openRoute(route.id, false);
  }

  function renderSidebarActions(entry: NavigationEntry, indent = 0, section = false) {
    const buttons = entry.buttons;
    const actionCount = Number(buttons?.options !== false)
      + Number(buttons?.edit !== false)
      + Number(buttons?.visibility !== false)
      + Number(buttons?.delete !== false)
      + Number(isNavigationContainer(entry) && buttons?.add !== false);
    const actionWidth = actionCount * 28 + Math.max(0, actionCount - 1) * 2 + 4;
    const groupChevronWidth = entry.type === "group" && entry.chevron !== false ? 28 : 0;
    const fixedWidth = 16 + indent + (section ? 4 : 16) + (section ? 0 : 24) + groupChevronWidth;
    const labelWidth = entry.label.length * 7.5;
    const canShowInline = !sidebarCollapsed() && (navigation().shell?.sidebar.width ?? 256) - fixedWidth - actionWidth >= labelWidth;
    const showActions = !sidebarCollapsed() && (buttons?.options !== false || (canShowInline && (
      buttons?.edit !== false || buttons?.visibility !== false || buttons?.delete !== false ||
      (isNavigationContainer(entry) && buttons?.add !== false)
    )));
    const iconAction = (action: MenuItemActionKey, label: string, icon: string) =>
      <button class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" type="button" title={`${label} ${entry.label}`} aria-label={`${label} ${entry.label}`} onClick={(event) => { event.stopPropagation(); runMenuAction(entry, action); }}><Icon name={icon} class="size-4" /></button>;
    return <Show when={showActions}>
      <div class="sidebar-entry-actions relative flex shrink-0 items-center gap-0.5 pr-1" onClick={(event) => event.stopPropagation()}>
        <Show when={canShowInline && isNavigationContainer(entry) && buttons?.add !== false}>{iconAction("add", "Add menu item to", "plus")}</Show>
        <Show when={canShowInline && buttons?.edit !== false}>{iconAction("edit", "Edit", "edit")}</Show>
        <Show when={canShowInline && buttons?.visibility !== false}>{iconAction("visibility", entry.visible === false ? "Show" : "Hide", entry.visible === false ? "eye" : "eyeOff")}</Show>
        <Show when={canShowInline && buttons?.delete !== false}>{iconAction("delete", "Delete", "trash")}</Show>
        <Show when={buttons?.options !== false}>
          <button ref={sidebarOptionsTrigger} class="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" type="button" title={`More options for ${entry.label}`} aria-label={`More options for ${entry.label}`} aria-haspopup="menu" aria-controls="workspace-menu-options" aria-expanded={openSidebarOptions()?.id === entry.id ? "true" : "false"} onClick={(event) => {
            sidebarOptionsTrigger = event.currentTarget;
            const rect = event.currentTarget.getBoundingClientRect();
            const sidebarRight = sidebarElement?.getBoundingClientRect().right ?? rect.right;
            const top = Math.max(8, Math.min(rect.top, window.innerHeight - 360));
            setOpenSidebarOptions((current) => current?.id === entry.id ? undefined : { id: entry.id, top, left: sidebarRight + 8, maxHeight: Math.max(120, window.innerHeight - top - 8) });
          }}><Icon name="more" class="size-4" /></button>
          <Show when={openSidebarOptions()?.id === entry.id}>
            <Portal>
            <div ref={sidebarOptionsPanel} id="workspace-menu-options" role="menu" aria-label={`${entry.label} options`} class="fixed z-[1000] grid w-56 gap-0.5 overflow-y-auto rounded-md border border-border bg-background p-1 shadow-lg" style={{ top: `${openSidebarOptions()?.top ?? 8}px`, left: `${openSidebarOptions()?.left ?? 280}px`, "max-height": `${openSidebarOptions()?.maxHeight ?? window.innerHeight - 16}px` }}>
              <Show when={buttons?.edit !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "edit")}><Icon name="edit" />Edit</button></Show>
              <Show when={buttons?.visibility !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "visibility")}><Icon name={entry.visible === false ? "eye" : "eyeOff"} />{entry.visible === false ? "Show" : "Hide"}</button></Show>
              <Show when={buttons?.delete !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm text-destructive hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "delete")}><Icon name="trash" />Delete</button></Show>
              <Show when={isNavigationContainer(entry) && buttons?.add !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "add")}><Icon name="plus" />Add menu item</button></Show>
              <Show when={buttons?.moveUp !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "moveUp")}><Icon name="up" />Move up</button></Show>
              <Show when={buttons?.moveDown !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "moveDown")}><Icon name="downArrow" />Move down</button></Show>
              <Show when={buttons?.moveTo !== false}><button role="menuitem" class="flex min-h-8 items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent" type="button" onClick={() => runMenuAction(entry, "moveTo")}><Icon name="right" />Move to</button></Show>
              <Show when={buttons?.edit === false && buttons?.visibility === false && buttons?.delete === false && buttons?.add === false && buttons?.moveUp === false && buttons?.moveDown === false && buttons?.moveTo === false}><span class="px-2 py-1 text-xs text-muted-foreground">No actions configured</span></Show>
            </div>
            </Portal>
          </Show>
        </Show>
      </div>
    </Show>;
  }

  function renderSidebarLink(entry: NavigationLink, depth: number) {
    if (entry.type === "action") return null;
    const active = () => activeMenuEntryId() === entry.id;
    return <div class={`sidebar-entry-row group/menu-row relative flex min-w-0 items-center rounded-md transition-colors hover:bg-accent/70 ${active() ? "bg-accent" : ""}`} data-active={active() ? "true" : "false"} style={{ "padding-left": `${sidebarCollapsed() ? 0 : 8 + Math.max(0, depth - 1) * 16}px` }}><a
      class={`flex min-w-0 min-h-9 flex-1 items-center gap-2 rounded-md text-sm no-underline transition-colors ${sidebarCollapsed() ? "justify-center px-0" : "px-2"} ${active() ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/70"}`}
      title={entry.label}
      aria-label={entry.label}
      aria-current={active() ? "page" : undefined}
      href={menuHref(entry)}
      onClick={(event) => followMenuLink(entry, event)}
      target={entry.type === "external" ? "_blank" : undefined}
      rel={entry.type === "external" ? "noopener noreferrer" : undefined}
    ><Icon name={entry.icon ?? "grid"} class="size-4 shrink-0" /><Show when={!sidebarCollapsed()}><span class="min-w-12 flex-1 whitespace-normal break-words" title={entry.label}>{entry.label}</span></Show></a>{renderSidebarActions(entry, 8 + Math.max(0, depth - 1) * 16)}</div>;
  }

  function renderSidebarEntry(entry: NavigationEntry, depth = 0) {
    if (entry.visible === false) return null;
    if (entry.type === "section") {
      return <section class="mb-4" aria-label={`${entry.label} menu`}>
        <div class={`sidebar-entry-row group/menu-item group/header relative mb-1 flex min-h-9 items-center rounded-md transition-colors hover:bg-accent/70 ${sidebarCollapsed() ? "justify-center px-0" : "px-1"}`} data-active="false">
          <Show when={!sidebarCollapsed()}><h2 class="min-w-12 flex-1 whitespace-normal break-words px-1 py-2 text-[13px] font-medium text-muted-foreground" title={entry.label}>{entry.label}</h2></Show>
          {renderSidebarActions(entry, 0, true)}
        </div>
        <ul class="m-0 list-none p-0"><For each={entry.children}>{(child) => <li>{renderSidebarEntry(child, depth + 1)}</li>}</For></ul>
      </section>;
    }
    if (entry.type !== "group") return renderSidebarLink(entry, depth);
    const expanded = () => menuGroupExpanded(entry);
    return <div class="mb-0.5">
      <div class="sidebar-entry-row group/menu-item group/menu-row flex items-center rounded-md transition-colors hover:bg-accent/70" data-active={expanded() ? "true" : "false"} style={{ "padding-left": `${sidebarCollapsed() ? 0 : Math.max(0, depth - 1) * 16}px` }}>
        <button class={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md text-left text-sm text-foreground ${sidebarCollapsed() ? "justify-center px-0" : "px-2"}`} type="button" title={entry.label} aria-label={entry.label} aria-expanded={expanded() ? "true" : "false"} onClick={() => toggleMenuGroup(entry)}>
          <Icon name={entry.icon ?? "grid"} class="size-4 shrink-0" /><Show when={!sidebarCollapsed()}><span class="min-w-12 flex-1 whitespace-normal break-words" title={entry.label}>{entry.label}</span></Show>
        </button>
        <Show when={!sidebarCollapsed() && entry.chevron !== false}>
          <button class="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" type="button" title={`${expanded() ? "Collapse" : "Expand"} ${entry.label}`} aria-label={`${expanded() ? "Collapse" : "Expand"} ${entry.label}`} aria-expanded={expanded() ? "true" : "false"} onClick={() => toggleMenuGroup(entry)}>
            <Icon name="down" class={`size-4 transition-transform ${expanded() ? "rotate-0" : "-rotate-90"}`} />
          </button>
        </Show>
        {renderSidebarActions(entry, Math.max(0, depth - 1) * 16)}
      </div>
      <Show when={expanded()}><ul class="m-0 list-none p-0"><For each={entry.children}>{(child) => <li>{renderSidebarEntry(child, depth + 1)}</li>}</For></ul></Show>
    </div>;
  }

  function renderTopEntry(entry: NavigationEntry) {
    if (entry.visible === false) return null;
    if (isNavigationContainer(entry)) return <><span class="px-2 text-[13px] font-medium text-muted-foreground">{entry.label}</span><For each={entry.children}>{(child) => renderTopEntry(child)}</For></>;
    if (entry.type === "action") return null;
    return <a class="rounded-md px-2 py-1.5 text-[13px] text-muted-foreground no-underline hover:bg-accent hover:text-foreground" href={menuHref(entry)} onClick={(event) => followMenuLink(entry, event)} target={entry.type === "external" ? "_blank" : undefined} rel={entry.type === "external" ? "noopener noreferrer" : undefined}>{entry.label}</a>;
  }

  function findMenuEntryPath(id: string, entries = menuEntries(navigation()), ancestors: NavigationEntry[] = []): NavigationEntry[] | undefined {
    for (const entry of entries) {
      const path = [...ancestors, entry];
      if (entry.id === id) return path;
      if (isNavigationContainer(entry)) {
        const nested = findMenuEntryPath(id, entry.children, path);
        if (nested) return nested;
      }
    }
    return undefined;
  }

  const breadcrumbItems = () => {
    const route = navigation().routes.find((candidate) => candidate.id === activeRoute());
    if (route?.path === navigation().shell?.sidebar.adminMenuSettingsPath) {
      return [{ label: "Workspace Settings", icon: "grid" } satisfies MicrofrontendBreadcrumb];
    }
    const installation = route && navigation().installations.find((candidate) => candidate.id === route.installationId);
    const applicationName = installation
      ? catalog()?.apps.find((application) => application.id === installation.appId)?.name ?? installation.appId
      : undefined;
    const configuredPath = activeMenuEntryId() ? findMenuEntryPath(activeMenuEntryId()!) : undefined;
    const routeSegments = route?.path.split("/").filter(Boolean) ?? [];
    const firstRouteSegment = routeSegments[0];
    const routeSection = firstRouteSegment
      ? menuEntries(navigation()).find((entry) => entry.type === "section"
        && (entry.id.toLowerCase() === firstRouteSegment.toLowerCase()
          || entry.label.toLowerCase().replace(/\s+/g, "-") === firstRouteSegment.toLowerCase()))
        ?? (route?.path === navigation().shell?.sidebar.adminMenuSettingsPath
          ? menuEntries(navigation()).find((entry) => entry.type === "section" && (entry.id === "settings" || entry.label.toLowerCase() === "settings"))
          : undefined)
      : undefined;
    const routeTitle = routeSegments.at(-1)?.split(/[-_]/).map((part) => part ? part.slice(0, 1).toUpperCase() + part.slice(1) : "").join(" ");
    const baseItems: MicrofrontendBreadcrumb[] = configuredPath
      ? configuredPath.map((entry) => ({ label: entry.label, icon: entry.icon ?? "grid" }))
      : routeSection && routeTitle
        ? [{ label: routeSection.label, icon: routeSection.icon ?? "grid" }, { label: routeTitle, icon: "grid" }]
        : applicationName
          ? [{ label: applicationName, icon: "box" }]
          : routeSegments.map((label) => ({ label, icon: "grid" }));
    return [...baseItems, ...(activeRoute() ? remoteBreadcrumbs() : [])]
      .slice(-1 * (navigation().shell?.breadcrumbs.maxDepth ?? 5));
  };

  function adminMenuSettingsPath() {
    return navigation().shell?.sidebar.adminMenuSettingsPath;
  }

  function openAdminMenuSettings() {
    const route = navigation().routes.find((candidate) => candidate.path === adminMenuSettingsPath());
    if (route) openRoute(route.id);
  }

  function findRouteMenuEntryId(routeId: string, entries: NavigationEntry[] = menuEntries(navigation())): string | undefined {
    for (const entry of entries) {
      if (entry.type === "route" && entry.routeId === routeId) return entry.id;
      if (isNavigationContainer(entry)) {
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
    void refreshWorkspace().then(() => {
      const match = navigation().routes.find((route) => window.location.pathname === route.path);
      if (match) openRoute(match.id, false); else { setActiveMenuEntryId(undefined); clearActiveApplication(); }
    });
  }


  onSettled(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!openSidebarOptions()) return;
      const target = event.target;
      if (target instanceof Node && (sidebarOptionsPanel?.contains(target) || sidebarOptionsTrigger?.contains(target))) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && (focused === sidebarOptionsTrigger || sidebarOptionsPanel?.contains(focused))) focused.blur();
      setOpenSidebarOptions(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !openSidebarOptions()) return;
      event.preventDefault();
      const trigger = sidebarOptionsTrigger;
      setOpenSidebarOptions(undefined);
      trigger?.focus();
    };
    const closeOnViewportChange = () => setOpenSidebarOptions(undefined);
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("popstate", handlePopState);
    void finishSignIn().then((signedIn) => {
      if (signedIn) setAccessToken(getAccessToken() ?? "");
    }).catch((error: unknown) => setWorkspaceStatus(error instanceof Error ? error.message : "Ferriskey sign-in failed"));
    void refreshWorkspace().then(() => {
      const current = navigation().routes.find((route) => window.location.pathname === route.path);
      if (current) openRoute(current.id, false);
    });
    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
      clearRemote();
    };
  });

  return (
    <div class="flex h-dvh overflow-hidden bg-background font-sans text-foreground">
      <Show when={sidebarMenu()}>
        <aside ref={sidebarElement} class="sticky top-0 flex h-dvh min-h-0 shrink-0 flex-col self-start border-r border-border bg-muted/30" style={{ width: `${sidebarCollapsed() ? 48 : navigation().shell?.sidebar.width ?? 256}px` }}>
          <div class={`flex ${sidebarCollapsed() ? "h-24 shrink-0 flex-col px-0" : "h-[52px] items-center gap-2 px-3"}`}>
            <a class={`brand flex min-w-0 items-center gap-2.5 text-foreground no-underline ${sidebarCollapsed() ? "h-12 w-full shrink-0 justify-center" : "flex-1"}`} href="/" onClick={(event) => { event.preventDefault(); clearActiveApplication(); window.history.pushState({}, "", "/"); }}>
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-primary"><Icon name="box" class="size-4" /></span>
              <Show when={!sidebarCollapsed()}><span class="min-w-0 leading-tight"><strong class="block truncate text-[13px] font-semibold">Modulaga Admin</strong><span class="block truncate text-xs text-muted-foreground">Workspace shell</span></span></Show>
            </a>
            <Show when={adminMenuSettingsPath() && !sidebarCollapsed()}>
              <Button type="button" variant="ghost" size="icon" class={`shrink-0 ${sidebarCollapsed() ? "h-7 w-7" : ""}`} aria-label="Workspace settings" title="Workspace settings" aria-current={window.location.pathname === adminMenuSettingsPath() ? "page" : undefined} onClick={openAdminMenuSettings}><Icon name="settings" /></Button>
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

      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <header class="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
          <Show when={navigation().shell?.breadcrumbs.enabled && breadcrumbItems().length > 0} fallback={<span class="truncate text-sm font-medium">{navigation().workspace.name}</span>}>
            <nav class="flex min-w-0 items-center gap-2 overflow-x-auto whitespace-nowrap text-sm text-muted-foreground" aria-label="Breadcrumb">
              <For each={breadcrumbItems()}>{(item, index) => <>{index() > 0 && <span aria-hidden="true">{navigation().shell?.breadcrumbs.separator ?? "/"}</span>}<Show when={item.onClick} fallback={<span class="inline-flex items-center gap-1.5"><Icon name={item.icon ?? "grid"} class="size-4 shrink-0" />{item.label}</span>}><button type="button" class="inline-flex items-center gap-1.5 rounded-sm hover:text-foreground" onClick={item.onClick}><Icon name={item.icon ?? "grid"} class="size-4 shrink-0" />{item.label}</button></Show></>}</For>
            </nav>
          </Show>
          <Show when={!sidebarMenu()}>
            <nav class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Workspace menu">
              <For each={menuEntries(navigation())}>{(entry) => renderTopEntry(entry)}</For>
            </nav>
          </Show>
          <Show when={!sidebarMenu() && adminMenuSettingsPath()}>
            <Button variant="ghost" size="icon" type="button" aria-label="Workspace settings" title="Workspace settings" aria-current={window.location.pathname === adminMenuSettingsPath() ? "page" : undefined} onClick={openAdminMenuSettings}><Icon name="settings" /></Button>
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

        <main class="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 py-6 sm:px-6 lg:px-7">
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
              <Show when={remoteStatus() !== "Choose a configured page from the workspace menu." && !remoteStatus().endsWith(" mounted")}><p class="mb-4 text-sm text-muted-foreground" role="status" aria-live="polite">{remoteStatus()}</p></Show><div class="min-h-36" ref={(element) => { remoteContainer = element; }} data-testid="declared-remote-container" />
            </Show>
        </main>
        <footer class="flex h-7 items-center border-t border-border px-4 text-[10px] text-muted-foreground"><span>{workspaceStatus()}</span><span class="ml-auto hidden sm:inline">Modulaga workspace shell</span></footer>
      </div>
    </div>
  );
}
