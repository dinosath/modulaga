export type {
  Catalog,
  CatalogApp,
  CatalogPublisher,
  CatalogRelease,
  ReleaseCompatibility,
  Semver,
} from "./generated/catalog.types.js";
export type {
  ComponentInstance,
  DashboardDefinition,
  BreadcrumbSettings,
  ActionMenuEntry,
  ExternalMenuEntry,
  InternalMenuEntry,
  LayoutRegion,
  MenuDefinition,
  MenuButtonBinding,
  MenuItemButtonActions,
  MenuEntry,
  MenuGroup,
  MenuPlacement,
  MenuSection,
  ShellSettings,
  SidebarSettings,
  ThemeReference,
  WelcomePageSettings,
  WorkspaceConfiguration,
  WorkspaceIdentity,
  WorkspaceInstallation,
  WorkspaceLayout,
  WorkspaceRoute,
} from "./generated/workspace.types.js";
export type { WorkspacePreferences } from "./generated/preferences.types.js";
export type { MicrofrontendBreadcrumb, MicrofrontendRouteContext } from "./microfrontend.js";
export type {
  AdminNavigation,
  AdminNavigationScope,
  AdminSectionGroup,
  AdminSectionNode,
  AdminViewLink,
  RegisteredAdminView,
} from "./generated/admin-navigation.types.js";
export type {
  StandaloneValidator,
  ValidationIssue,
} from "./generated/validators.generated.cjs";
export {
  validateAdminNavigation,
  validateCatalog,
  validatePreferences,
  validateWorkspace,
} from "./generated/validators.generated.cjs";
