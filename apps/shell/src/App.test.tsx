import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@solidjs/web";
import { defaultNavigation } from "./config/navigation";

const { getConfig, getCatalog } = vi.hoisted(() => ({ getConfig: vi.fn(), getCatalog: vi.fn() }));
vi.mock("./workspace/api", () => ({ getWorkspaceConfig: getConfig, getApplicationCatalog: getCatalog, updateWorkspaceConfig: vi.fn() }));
vi.mock("./workspace/auth", () => ({ authConfigured: false, finishSignIn: vi.fn().mockResolvedValue(false), getAccessToken: vi.fn(), signOut: vi.fn(), startSignIn: vi.fn() }));

import App from "./App";

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  window.history.replaceState({}, "", "/");
  getConfig.mockReset();
  getCatalog.mockReset();
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
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Admin Menu Settings"));
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

  it("opens the shared prefilled editor from a sidebar item edit button", async () => {
    getConfig.mockResolvedValue({ config: defaultNavigation, revision: 0 });
    getCatalog.mockResolvedValue({ catalog: { schemaVersion: 1, apps: [] }, revision: 1 });
    dispose = render(() => <App />, document.body);

    await vi.waitFor(() => expect(document.querySelector('[aria-label="Edit entry Orders"]')).not.toBeNull());
    (document.querySelector('[aria-label="Edit entry Orders"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe("Edit entry"));
    expect((document.querySelector('[role="dialog"] [aria-label="Menu item label"]') as HTMLInputElement).value).toBe("Orders");
    expect(document.querySelector('[role="dialog"] [role="treeitem"] input:checked')?.parentElement?.textContent).toContain("Operations");
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
    await vi.waitFor(() => expect(document.querySelector("h1")?.textContent).toBe("Admin Menu Settings"));
    expect(window.location.pathname).toBe(defaultNavigation.shell?.sidebar.adminMenuSettingsPath);
  });
});
