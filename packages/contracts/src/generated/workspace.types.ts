/* Generated from src/schemas. Do not edit directly. */

export type Identifier = string;
export type MenuEntry = MenuGroup | InternalMenuEntry | ExternalMenuEntry | ActionMenuEntry;

export interface WorkspaceConfiguration {
  schemaVersion: 1;
  workspace: WorkspaceIdentity;
  welcomePage?: WelcomePageSettings;
  installations: WorkspaceInstallation[];
  routes: WorkspaceRoute[];
  menus: MenuDefinition[];
  menuPlacements: MenuPlacement[];
  layout: WorkspaceLayout;
  shell?: ShellSettings;
  dashboards?: DashboardDefinition[];
  theme?: ThemeReference;
}
export interface WorkspaceIdentity {
  id: Identifier;
  name: string;
}
export interface WelcomePageSettings {
  enabled: boolean;
  title: string;
  description: string;
  showDashboard: boolean;
}
export interface WorkspaceInstallation {
  id: Identifier;
  appId: Identifier;
  releaseId: string;
  basePath: string;
  settings: SchemaValidatedSettings;
}
export interface SchemaValidatedSettings {
  schemaId: Identifier;
  value: {
    [k: string]: unknown;
  };
}
export interface WorkspaceRoute {
  id: Identifier;
  installationId: Identifier;
  path: string;
}
export interface MenuDefinition {
  id: Identifier;
  name: string;
  entries: MenuEntry[];
}
export interface MenuGroup {
  id: Identifier;
  type: "group";
  label: string;
  icon?: string;
  visible?: boolean;
  chevron?: boolean;
  defaultExpanded?: boolean;
  children: MenuEntry[];
}
export interface InternalMenuEntry {
  id: Identifier;
  type: "route";
  label: string;
  icon?: string;
  routeId: Identifier;
  visible?: boolean;
}
export interface ExternalMenuEntry {
  id: Identifier;
  type: "external";
  label: string;
  icon?: string;
  href: string;
  visible?: boolean;
}
export interface ActionMenuEntry {
  id: Identifier;
  type: "action";
  label: string;
  icon?: string;
  visible?: boolean;
  action: "admin-panel";
  path: string;
}
export interface MenuPlacement {
  menuId: Identifier;
  region: "top" | "left" | "right" | "bottom";
  renderer: "tree" | "rail" | "horizontal" | "drawer";
  breakpoint?: "mobile" | "tablet" | "desktop";
}
export interface WorkspaceLayout {
  template: "single-column" | "split-pane" | "dashboard-grid";
  regions: LayoutRegion[];
}
export interface LayoutRegion {
  id: Identifier;
  order: number;
  instances: ComponentInstance[];
}
export interface ComponentInstance {
  id: Identifier;
  installationId: Identifier;
  componentId: Identifier;
  settings: SchemaValidatedSettings;
}
export interface ShellSettings {
  sidebar: SidebarSettings;
  breadcrumbs: BreadcrumbSettings;
}
export interface SidebarSettings {
  width: number;
  mode: "fixed" | "collapsible";
  defaultCollapsed: boolean;
  adminMenuSettingsPath?: string;
}
export interface BreadcrumbSettings {
  enabled: boolean;
  maxDepth: number;
  separator?: string;
}
export interface DashboardDefinition {
  id: Identifier;
  title: string;
  routeId: Identifier;
  columns: number;
  widgets: ComponentInstance[];
}
export interface ThemeReference {
  id: Identifier;
  version: string;
}
