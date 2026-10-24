import { Show, createSignal, onSettled } from "solid-js";
import { finishSignIn, getAccessToken, signOut, startSignIn, authConfigured } from "../../shell/src/workspace/auth";
import { getApplicationCatalog, getWorkspaceConfig, updateWorkspaceConfig, type CatalogApplication, type WorkspaceConfigSnapshot } from "../../shell/src/workspace/api";
import { defaultNavigation, isNavigationContainer, menuEntries, saveNavigation, type NavigationEntry, type WorkspaceNavigation } from "../../shell/src/config/navigation";
import NavigationStudio from "./NavigationStudio";
import { Button } from "../../shell/src/components/ui/button";

type SidebarCommand = { action: "add" | "moveUp" | "moveDown" | "moveTo"; itemId: string };

export default function StandaloneAdminPanel() {
  const [config, setConfig] = createSignal<WorkspaceNavigation>(defaultNavigation);
  const [revision, setRevision] = createSignal(0);
  const [status, setStatus] = createSignal("Loading workspace configuration…");
  const [applications, setApplications] = createSignal<CatalogApplication[]>([]);
  const [token, setToken] = createSignal(getAccessToken() ?? "");
  const [openEditItemId, setOpenEditItemId] = createSignal<string>();
  const [sidebarCommand, setSidebarCommand] = createSignal<SidebarCommand>();

  function commandEntry(items: NavigationEntry[], id: string): NavigationEntry | undefined {
    for (const entry of items) {
      if (entry.id === id) return entry;
      if (isNavigationContainer(entry)) {
        const nested = commandEntry(entry.children, id);
        if (nested) return nested;
      }
    }
    return undefined;
  }

  function updateCommandEntry(items: NavigationEntry[], id: string, transform: (entry: NavigationEntry) => NavigationEntry): NavigationEntry[] {
    return items.map((entry) => entry.id === id ? transform(entry) : isNavigationContainer(entry) ? { ...entry, children: updateCommandEntry(entry.children, id, transform) } : entry);
  }

  function removeCommandEntry(items: NavigationEntry[], id: string): NavigationEntry[] {
    return items.filter((entry) => entry.id !== id).map((entry) => isNavigationContainer(entry) ? { ...entry, children: removeCommandEntry(entry.children, id) } : entry);
  }

  function clearMenuCommand() {
    const url = new URL(window.location.href);
    url.searchParams.delete("menuAction");
    url.searchParams.delete("menuItemId");
    url.searchParams.delete("returnPath");
    url.searchParams.delete("bindingType");
    url.searchParams.delete("clientId");
    url.searchParams.delete("actionId");
    url.searchParams.delete("componentId");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function returnToSidebar(returnPath: string | null) {
    const destination = returnPath && returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
    window.history.replaceState({}, "", destination);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  async function processMenuCommand(snapshot: WorkspaceConfigSnapshot) {
    const url = new URL(window.location.href);
    const requestedAction = url.searchParams.get("menuAction");
    const bindingType = url.searchParams.get("bindingType");
    const componentId = url.searchParams.get("componentId");
    const clientId = url.searchParams.get("clientId");
    const actionId = url.searchParams.get("actionId");
    const id = url.searchParams.get("menuItemId");
    if (!requestedAction || !id) return;
    const returnPath = url.searchParams.get("returnPath");
    const entry = commandEntry(menuEntries(snapshot.config), id);
    if (!entry) {
      clearMenuCommand();
      setStatus("That menu item no longer exists.");
      return;
    }
    if (bindingType && bindingType !== "component" && bindingType !== "client") {
      clearMenuCommand();
      setStatus(`The menu button binding type “${bindingType}” is not registered.`);
      return;
    }
    if (bindingType === "component") {
      if (componentId !== "menu-item-editor") {
        clearMenuCommand();
        setStatus(`The menu component “${componentId ?? "unknown"}” is not registered.`);
        return;
      }
      if (requestedAction !== "edit") {
        clearMenuCommand();
        setStatus("The menu item editor component only supports the Edit button.");
        return;
      }
      setOpenEditItemId(id);
      clearMenuCommand();
      return;
    }
    const action = bindingType === "client"
      ? clientId === "workspace-menu" ? actionId : undefined
      : requestedAction;
    if (!action || !["edit", "visibility", "delete", "add", "moveUp", "moveDown", "moveTo"].includes(action)) {
      clearMenuCommand();
      setStatus(`The menu client action “${actionId ?? "unknown"}” is not registered.`);
      return;
    }
    if (action === "edit") {
      setOpenEditItemId(id);
      clearMenuCommand();
      return;
    }
    if (action === "add" || action === "moveUp" || action === "moveDown" || action === "moveTo") {
      setSidebarCommand({ action, itemId: id });
      clearMenuCommand();
      return;
    }
    if (action !== "visibility" && action !== "delete") {
      clearMenuCommand();
      return;
    }
    if (action === "delete" && !window.confirm(`Delete “${entry.label}” from the workspace menu?`)) {
      returnToSidebar(returnPath);
      return;
    }
    const nextEntries = action === "visibility"
      ? updateCommandEntry(menuEntries(snapshot.config), id, (current) => ({ ...current, visible: current.visible === false }))
      : removeCommandEntry(menuEntries(snapshot.config), id);
    const menu = snapshot.config.menus[0];
    if (!menu) return;
    const next = { ...snapshot.config, menus: snapshot.config.menus.map((candidate, index) => index === 0 ? { ...candidate, entries: nextEntries } : candidate) };
    try {
      await saveConfig(next);
      returnToSidebar(returnPath);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The menu item change could not be saved.");
      clearMenuCommand();
    }
  }

  async function loadConfig() {
    try {
      const snapshot = await getWorkspaceConfig();
      setConfig(snapshot.config);
      setRevision(snapshot.revision);
      saveNavigation(snapshot.config);
      setStatus(`Connected to workspace configuration · revision ${snapshot.revision}`);
      await processMenuCommand(snapshot);
      try {
        const catalog = await getApplicationCatalog();
        setApplications(catalog.catalog.apps);
      } catch {
        setStatus(`Workspace configuration connected · application catalog unavailable · revision ${snapshot.revision}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? `Using starter workspace · ${error.message}` : "Using starter workspace configuration.");
    }
  }

  async function saveConfig(next = config()): Promise<void> {
    const snapshot: WorkspaceConfigSnapshot = await updateWorkspaceConfig(next, revision(), token() || undefined);
    setConfig(snapshot.config);
    setRevision(snapshot.revision);
    setStatus(`Workspace configuration saved · revision ${snapshot.revision}`);
  }

  onSettled(() => {
    void finishSignIn().then((completed) => {
      if (completed) setToken(getAccessToken() ?? "");
    }).catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Sign-in failed."))
      .finally(() => void loadConfig());
  });

  return <div class="flex min-h-screen flex-col bg-background text-foreground">
    <main class="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
      <div class="mb-4 flex items-center justify-end gap-3">
        <Show when={!status().startsWith("Connected to workspace configuration · revision ")}>
          <p class="text-xs text-muted-foreground" role="status" aria-live="polite">{status()}</p>
        </Show>
        <Show when={authConfigured}><Button variant="outline" size="sm" type="button" onClick={() => token() ? (signOut(), setToken("")) : void startSignIn().catch((error: unknown) => setStatus(error instanceof Error ? error.message : "Sign-in failed."))}>{token() ? "Sign out" : "Sign in"}</Button></Show>
      </div>
      <NavigationStudio config={config} setConfig={setConfig} saveConfig={saveConfig} applications={applications} openEditItemId={openEditItemId} sidebarCommand={sidebarCommand} />
    </main>
  </div>;
}
