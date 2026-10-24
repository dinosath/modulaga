import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@solidjs/web";
import { defaultNavigation } from "./config/navigation";
import type { MicrofrontendRouteContext } from "../../../packages/contracts/src/microfrontend";

const { getConfig, getCatalog, mountRemote, updateConfig } = vi.hoisted(() => ({ getConfig: vi.fn(), getCatalog: vi.fn(), mountRemote: vi.fn(), updateConfig: vi.fn() }));
vi.mock("./workspace/api", () => ({ getWorkspaceConfig: getConfig, getApplicationCatalog: getCatalog, updateWorkspaceConfig: updateConfig }));
vi.mock("./workspace/auth", () => ({ authConfigured: false, finishSignIn: vi.fn().mockResolvedValue(false), getAccessToken: vi.fn(), signOut: vi.fn(), startSignIn: vi.fn() }));
vi.mock("./probe/federation", () => ({ mountDeclaredRemote: mountRemote }));

import App from "./App";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  window.history.replaceState({}, "", "/");
  getConfig.mockReset();
  getCatalog.mockReset();
  mountRemote.mockReset();
  updateConfig.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shell app", () => {
  it("renders the shell identity and dashboard from workspace configuration", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    expect(document.querySelector(".brand")?.textContent).toContain("Modulaga");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Welcome to Modulaga"));
    expect(document.body.textContent).toContain("Your workspace, apps, and dashboards in one place.");
    expect(document.body.textContent).toContain("Active users");
    expect(document.body.textContent).toContain("Default workspace");
  });

  it("falls back to the bundled workspace when the configuration service is unavailable", async () => {
    getConfig.mockRejectedValue(new Error("API unavailable"));
    getCatalog.mockRejectedValue(new Error("Catalog API unavailable"));
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.body.textContent).toContain("Using bundled configuration"));
    expect(document.body.textContent).toContain("Default workspace");
  });

  it("waits for the route mount target before mounting a configured microfrontend", async () => {
    window.history.replaceState({}, "", "/content-types");
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({
      catalog: {
        schemaVersion: 1,
        apps: [{
          id: "content-types",
          name: "Content types",
          releases: [{
            id: "content-types@static",
            version: "0.1.0",
            manifestUrl: "http://127.0.0.1:4175/mf-manifest.json",
            remoteName: "content_types",
            exposedModule: "./mount",
          }],
        }],
      },
      revision: 1,
    });
    mountRemote.mockImplementation(async (_appId: string, _release: unknown, container: HTMLElement, context: MicrofrontendRouteContext) => {
      expect(container).toBeInstanceOf(HTMLElement);
      expect(container.isConnected).toBe(true);
      context.setBreadcrumbs([
        { label: "All content types", icon: "database" },
        { label: "Article", icon: "database" },
      ]);
      return () => undefined;
    });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(mountRemote).toHaveBeenCalledOnce());
    expect(mountRemote).toHaveBeenCalledOnce();
    expect(document.querySelector("main h1")).toBeNull();
    expect(document.body.textContent).not.toContain("/content-types");
    expect(document.body.textContent).not.toContain("0.1.0 mounted");
    expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).toBe("Settings/Content types/All content types/Article");
    expect(document.querySelectorAll('header [aria-label="Breadcrumb"] svg')).toHaveLength(4);
  });

  it("shows the configured section and group hierarchy in route breadcrumbs", async () => {
    const config = {
      ...defaultNavigation,
      menus: defaultNavigation.menus.map((menu) => ({
        ...menu,
        entries: menu.entries.map((entry) => entry.id === "settings" && entry.type === "section"
          ? {
              ...entry,
              children: [{
                id: "content-management",
                type: "group" as const,
                label: "Content management",
                children: [{
                  id: "schemas",
                  type: "group" as const,
                  label: "Schemas",
                  children: [{ id: "content-types-link", type: "route" as const, label: "Content types", routeId: "content-types-overview" }],
                }],
              }],
            }
          : entry),
      })),
    };
    window.history.replaceState({}, "", "/content-types");
    getConfig.mockResolvedValue({ config, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).toContain("Content types"));
    expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).toBe(
      "Settings/Content management/Schemas/Content types",
    );
    expect(document.querySelectorAll('header [aria-label="Breadcrumb"] svg')).toHaveLength(4);
    expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).not.toContain("Default workspace");
    expect(document.querySelector('main [aria-label="Breadcrumb"]')).toBeNull();
  });

  it("keeps the matching menu section in breadcrumbs for routes without a menu entry", async () => {
    window.history.replaceState({}, "", "/workspace-settings");
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({
      catalog: {
        schemaVersion: 1,
        apps: [{ id: "admin-panel", name: "Admin panel", releases: [{ id: "admin-panel@static", version: "0.1.0", manifestUrl: "http://127.0.0.1:4176/mf-manifest.json", remoteName: "admin_panel", exposedModule: "./mount" }] }],
      },
      revision: 1,
    });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).toBe("Workspace Settings"));
    expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).not.toContain("Admin panel");
    expect(document.querySelector('header [aria-label="Breadcrumb"]')?.textContent).not.toContain("Settings/");
  });

  it("opens workspace editing from the sidebar settings gear", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    const editButton = document.querySelector('[aria-label="Admin menu settings"]') as HTMLButtonElement;
    expect(editButton).not.toBeNull();
    expect([...document.querySelectorAll('[aria-label="Workspace menu"] > section h2')].map((heading) => heading.textContent)).toEqual(["Operations", "Settings"]);
    expect(document.querySelector('[aria-label="Workspace menu"] [aria-label="Admin Panel"]')).toBeNull();
    expect(document.querySelector('[aria-label="User profile"]')).toBeNull();
    expect(document.querySelector("header [aria-label='Edit workspace']")).toBeNull();
    editButton.click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Navigation configuration"]')).not.toBeNull());
    expect(window.location.pathname).toBe(defaultNavigation.shell?.sidebar.adminMenuSettingsPath);
    expect(document.querySelector('[aria-label="User profile"]')).toBeNull();
  });

  it("uses the shared Group and Entry create dialog from the sidebar plus button", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Add entry to Operations"]')).not.toBeNull());
    (document.querySelector('[aria-label="Add entry to Operations"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Add menu item"));
    expect(document.querySelector('[role="dialog"] legend')?.textContent).toBe("Menu item type");
    expect(document.querySelector('[role="dialog"] [aria-label="Entry"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"] [aria-label="Group"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"] [role="tree"][aria-label="Choose parent menu"]')).not.toBeNull();
    expect(document.querySelector('[role="dialog"] [role="treeitem"][aria-selected="true"]')?.textContent).toContain("Operations");
  });

  it("opens the shared prefilled editor from a sidebar item options menu", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Settings for entry Orders"]')).not.toBeNull());
    expect(document.querySelector('[aria-label="Edit entry Orders"]')).toBeNull();
    (document.querySelector('[aria-label="Settings for entry Orders"]') as HTMLButtonElement).click();
    (document.querySelector('[role="menuitem"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Edit entry"));
    expect((document.querySelector('[role="dialog"] [aria-label="Menu item label"]') as HTMLInputElement).value).toBe("Orders");
    expect(document.querySelector('[role="dialog"] [role="treeitem"] input:checked')?.parentElement?.textContent).toContain("Operations");
  });

  it("routes Edit through its configured modal component binding", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Edit Orders"]')).not.toBeNull());
    (document.querySelector('[aria-label="Edit Orders"]') as HTMLButtonElement).click();
    const query = new URLSearchParams(window.location.search);
    expect(query.get("menuAction")).toBe("edit");
    expect(query.get("menuItemId")).toBe("orders-link");
    expect(query.get("bindingType")).toBe("component");
    expect(query.get("componentId")).toBe("menu-item-editor");
  });

  it("deletes a menu item from the sidebar without navigating into workspace settings", async () => {
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 4 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    updateConfig.mockImplementation(async (config: typeof defaultNavigation) => ({ config, revision: 5 }));
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Delete Orders"]')).not.toBeNull());
    await vi.waitFor(() => expect(document.body.textContent).toContain("Configuration revision 4"));
    (document.querySelector('[aria-label="Delete Orders"]') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(updateConfig).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Orders"]')).toBeNull());
    expect(updateConfig.mock.calls[0]?.[1]).toBe(4);
    expect(window.location.pathname).toBe("/");
  });

  it("portals sidebar options beside the sidebar instead of over its rows", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="More options for Orders"]')).not.toBeNull());
    const sidebar = document.querySelector("aside") as HTMLElement;
    const trigger = document.querySelector('[aria-label="More options for Orders"]') as HTMLButtonElement;
    vi.spyOn(sidebar, "getBoundingClientRect").mockReturnValue({ left: 0, right: 264, top: 0, bottom: 800, width: 264, height: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ left: 200, right: 228, top: 100, bottom: 128, width: 28, height: 28, x: 200, y: 100, toJSON: () => ({}) } as DOMRect);

    trigger.click();
    await vi.waitFor(() => expect(document.querySelector('[role="menu"][aria-label="Orders options"]')).not.toBeNull());
    const popup = document.querySelector('[role="menu"][aria-label="Orders options"]') as HTMLElement;
    expect(sidebar.contains(popup)).toBe(false);
    expect(popup.parentElement).toBe(document.body);
    expect(popup.style.left).toBe("272px");
    expect(popup.style.top).toBe("100px");
  });

  it("closes the sidebar options popup and releases its focus on outside pointer", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="More options for Orders"]')).not.toBeNull());
    (document.querySelector('[aria-label="More options for Orders"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="menu"] [role="menuitem"]')).not.toBeNull());
    const item = document.querySelector('[role="menu"] [role="menuitem"]') as HTMLButtonElement;
    item.focus();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    await vi.waitFor(() => expect(document.querySelector('[role="menu"][aria-label="Orders options"]')).toBeNull());
    expect(document.activeElement).not.toBe(item);
  });

  it("closes the sidebar options popup with Escape and restores focus to its trigger", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="More options for Orders"]')).not.toBeNull());
    const trigger = document.querySelector('[aria-label="More options for Orders"]') as HTMLButtonElement;
    trigger.click();
    await vi.waitFor(() => expect(document.querySelector('[role="menu"][aria-label="Orders options"]')).not.toBeNull());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    await vi.waitFor(() => expect(document.querySelector('[role="menu"][aria-label="Orders options"]')).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps sidebar actions at the right edge and shows configured add, edit, and delete controls", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="More options for Orders"]')).not.toBeNull());
    const ordersLink = document.querySelector('a[aria-label="Orders"]') as HTMLAnchorElement;
    const ordersRow = ordersLink.parentElement as HTMLElement;
    expect(ordersLink.classList.contains("flex-1")).toBe(true);
    expect(ordersRow.lastElementChild?.querySelector('[aria-label="More options for Orders"]')).not.toBeNull();
    expect(ordersRow.querySelector('[aria-label="Edit Orders"]')).not.toBeNull();
    expect(ordersRow.querySelector('[aria-label="Delete Orders"]')).not.toBeNull();

    const operationsRow = document.querySelector('[aria-label="Operations menu"] > div') as HTMLElement;
    expect(operationsRow.querySelector('[aria-label="Add menu item to Operations"]')).not.toBeNull();
    expect(operationsRow.lastElementChild?.querySelector('[aria-label="More options for Operations"]')).not.toBeNull();

    const contentTypesLink = document.querySelector('a[aria-label="Content types"]') as HTMLAnchorElement;
    const contentTypesRow = contentTypesLink.parentElement as HTMLElement;
    expect(contentTypesLink.textContent).toBe("Content types");
    expect(contentTypesRow.querySelector('[aria-label="More options for Content types"]')).not.toBeNull();
    expect(contentTypesRow.querySelector('[aria-label="Edit Content types"]')).toBeNull();
    expect(contentTypesRow.querySelector('[aria-label="Delete Content types"]')).toBeNull();
  });

  it("marks sidebar action groups for conditional visibility and active rows", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('a[aria-label="Orders"]')).not.toBeNull());
    const link = document.querySelector('a[aria-label="Orders"]') as HTMLAnchorElement;
    const row = link.parentElement as HTMLElement;
    const actions = row.querySelector(".sidebar-entry-actions") as HTMLElement;
    expect(actions).not.toBeNull();
    expect(row.classList.contains("sidebar-entry-row")).toBe(true);
    expect(row.getAttribute("data-active")).toBe("false");

    link.focus();
    link.blur();
    link.click();
    await vi.waitFor(() => expect(row.getAttribute("data-active")).toBe("true"));
  });

  it("preserves menu labels and the options button at the narrowest sidebar width", async () => {
    const config = {
      ...defaultNavigation,
      shell: { ...defaultNavigation.shell!, sidebar: { ...defaultNavigation.shell!.sidebar, width: 200 } },
    };
    getConfig.mockResolvedValue({ config, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="More options for Application generator"]')).not.toBeNull());
    const link = document.querySelector('a[aria-label="Application generator"]') as HTMLAnchorElement;
    const row = link.parentElement as HTMLElement;
    expect(link.textContent).toBe("Application generator");
    expect(link.querySelector("span")?.classList.contains("whitespace-normal")).toBe(true);
    expect(row.lastElementChild?.querySelector('[aria-label="More options for Application generator"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="Edit Application generator"]')).toBeNull();
    expect(row.querySelector('[aria-label="Delete Application generator"]')).toBeNull();
  });

  it("respects per-item secondary-button settings without hiding More options", async () => {
    const config = {
      ...defaultNavigation,
      menus: defaultNavigation.menus.map((menu) => ({
        ...menu,
        entries: menu.entries.map((entry) => entry.id === "operations" && entry.type === "section"
          ? { ...entry, children: entry.children.map((child) => child.id === "orders-link" ? { ...child, buttons: { edit: false, visibility: false, delete: false, options: true } } : child) }
          : entry),
      })),
    };
    const operations = config.menus.flatMap((menu) => menu.entries).find((entry) => entry.id === "operations");
    expect(operations?.type).toBe("section");
    if (operations?.type !== "section") throw new Error("Operations section missing from fixture");
    expect(operations.children.find((child) => child.id === "orders-link")?.buttons).toEqual({
      edit: false,
      visibility: false,
      delete: false,
      options: true,
    });
    getConfig.mockResolvedValue({ config, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => {
      expect(document.querySelector('[aria-label="More options for Orders"]')).not.toBeNull();
      expect(document.querySelector('[aria-label="Edit Orders"]')).toBeNull();
    });
    const row = (document.querySelector('a[aria-label="Orders"]') as HTMLAnchorElement).parentElement as HTMLElement;
    expect(row.querySelector('[aria-label="More options for Orders"]')).not.toBeNull();
    expect(row.querySelector('[aria-label="Edit Orders"]')).toBeNull();
    expect(row.querySelector('[aria-label="Hide Orders"]')).toBeNull();
    expect(row.querySelector('[aria-label="Delete Orders"]')).toBeNull();
  });

  it("renders only entries returned by the workspace menu configuration", async () => {
    const config = {
      ...defaultNavigation,
      menus: defaultNavigation.menus.map((menu) => ({ ...menu, entries: menu.entries.filter((entry) => entry.id !== "operations") })),
    };
    getConfig.mockResolvedValue({ config, revision: 4 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Operations menu"]')).toBeNull());
    expect(document.querySelector('[aria-label="Admin Panel"]')).toBeNull();
    expect(document.querySelector('[aria-label="Workspace menu"]')?.textContent).toContain("Help center");
  });

  it("uses configured chevrons and expansion defaults for sidebar submenus", async () => {
    const config = {
      ...defaultNavigation,
      menus: defaultNavigation.menus.map((menu) => ({
        ...menu,
        entries: menu.entries.map((entry) => entry.id === "operations" && entry.type === "section"
          ? { ...entry, children: [{ id: "reports", type: "group" as const, label: "Reports", chevron: true, defaultExpanded: false, children: [{ id: "reports-page", type: "route" as const, label: "Reports page", routeId: "orders-overview" }] }] }
          : entry),
      })),
    };
    getConfig.mockResolvedValue({ config, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Reports"][aria-expanded="false"]')).not.toBeNull());
    (document.querySelector('[aria-label="Reports"][aria-expanded="false"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Workspace menu"]')?.textContent).toContain("Reports page"));
  });

  it("keeps workspace settings available in the top menu layout", async () => {
    const config = {
      ...defaultNavigation,
      menuPlacements: defaultNavigation.menuPlacements.map((placement, index) => index === 0 ? { ...placement, region: "top" as const } : placement),
    };
    getConfig.mockResolvedValue({ config, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Admin menu settings"]')).not.toBeNull());
    const editButton = document.querySelector('[aria-label="Admin menu settings"]') as HTMLButtonElement;
    editButton.click();
    await vi.waitFor(() => expect(document.querySelector('[aria-label="Navigation configuration"]')).not.toBeNull());
    expect(window.location.pathname).toBe(defaultNavigation.shell?.sidebar.adminMenuSettingsPath);
  });
});
