/** A breadcrumb segment contributed by a mounted microfrontend. */
export type MicrofrontendBreadcrumb = {
  label: string;
  /** Icon key from the shell's configured Lucide icon set. */
  icon?: string;
  /** Optional action for breadcrumbs that navigate within the mounted app. */
  onClick?: () => void;
};

/** Runtime context passed to an application when the shell mounts its route. */
export type MicrofrontendRouteContext = {
  workspaceId: string;
  installationId: string;
  routeId: string;
  path: string;
  setBreadcrumbs: (items: MicrofrontendBreadcrumb[]) => void;
};
