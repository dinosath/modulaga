import initialWorkspace from "../../../../workspace-config/workspaces/default.json";

type NavigationBase = { id: string; label: string; icon?: string; visible?: boolean };
export type RouteMenuEntry = NavigationBase & { type: "route"; routeId: string };
export type ExternalMenuEntry = NavigationBase & { type: "external"; href: string };
export type ActionMenuEntry = NavigationBase & { type: "action"; action: "admin-panel"; path: string };
export type NavigationLink = RouteMenuEntry | ExternalMenuEntry | ActionMenuEntry;
export type NavigationSection = NavigationBase & { type: "section"; children: NavigationEntry[] };
export type NavigationGroup = NavigationBase & {
  type: "group";
  children: NavigationEntry[];
  chevron?: boolean;
  defaultExpanded?: boolean;
};
export type NavigationContainer = NavigationSection | NavigationGroup;
export type NavigationEntry = NavigationLink | NavigationContainer;
export type DashboardWidget = { id: string; installationId: string; componentId: string; settings: { schemaId: string; value: Record<string, unknown> } };

export type WorkspaceNavigation = {
  schemaVersion: 1;
  workspace: { id: string; name: string };
  welcomePage?: { enabled: boolean; title: string; description: string; showDashboard: boolean };
  installations: { id: string; appId: string; releaseId: string; basePath: string; settings: { schemaId: string; value: Record<string, unknown> } }[];
  routes: { id: string; installationId: string; path: string }[];
  menus: { id: string; name: string; entries: NavigationEntry[] }[];
  menuPlacements: { menuId: string; region: "top" | "left" | "right" | "bottom"; renderer: "tree" | "rail" | "horizontal" | "drawer"; breakpoint?: "mobile" | "tablet" | "desktop" }[];
  shell?: {
    sidebar: { width: number; mode: "fixed" | "collapsible"; defaultCollapsed: boolean; adminMenuSettingsPath?: string };
    breadcrumbs: { enabled: boolean; maxDepth: number; separator?: string };
  };
  dashboards?: { id: string; title: string; routeId: string; columns: number; widgets: DashboardWidget[] }[];
  layout: { template: "single-column" | "split-pane" | "dashboard-grid"; regions: { id: string; order: number; instances: unknown[] }[] };
  theme?: { id: string; version: string };
};

const storageKey = "modulaga.workspace-navigation.v1";
export const defaultNavigation = initialWorkspace as unknown as WorkspaceNavigation;
export const primaryMenu = (config: WorkspaceNavigation) => config.menus[0];
export const menuEntries = (config: WorkspaceNavigation) => primaryMenu(config)?.entries ?? [];

export function routePath(config: WorkspaceNavigation, routeId: string) {
  return config.routes.find((route) => route.id === routeId)?.path ?? "#";
}

function isNavigationEntry(value: unknown): value is NavigationEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as NavigationEntry;
  if (typeof entry.id !== "string" || !entry.id || typeof entry.label !== "string" || !entry.label) return false;
  if (entry.type === "group" || entry.type === "section") return Array.isArray(entry.children) && entry.children.every(isNavigationEntry);
  if (entry.type === "route") return typeof entry.routeId === "string";
  if (entry.type === "external") return typeof entry.href === "string" && entry.href.startsWith("https://");
  return entry.type === "action"
    && entry.action === "admin-panel"
    && typeof entry.path === "string"
    && entry.path.startsWith("/")
    && !entry.path.startsWith("//")
    && !entry.path.includes("?")
    && !entry.path.includes("#");
}

export const isNavigationContainer = (entry: NavigationEntry): entry is NavigationContainer =>
  entry.type === "section" || entry.type === "group";

function isWorkspaceNavigation(value: unknown): value is WorkspaceNavigation {
  if (!value || typeof value !== "object") return false;
  const config = value as WorkspaceNavigation;
  return config.schemaVersion === 1
    && typeof config.workspace?.id === "string"
    && typeof config.workspace.name === "string"
    && Array.isArray(config.routes)
    && Array.isArray(config.menus) && config.menus.length > 0
    && config.menus.every((menu) => Array.isArray(menu.entries) && menu.entries.every(isNavigationEntry));
}

export function readNavigation(): WorkspaceNavigation {
  try {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return defaultNavigation;
    const parsed: unknown = JSON.parse(saved);
    return isWorkspaceNavigation(parsed) ? parsed : defaultNavigation;
  } catch {
    return defaultNavigation;
  }
}

export function saveNavigation(config: WorkspaceNavigation) {
  localStorage.setItem(storageKey, JSON.stringify(config, null, 2));
}
