import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultNavigation,
  isNavigationContainer,
  menuEntries,
  primaryMenu,
  readNavigation,
  routePath,
  saveNavigation,
  type WorkspaceNavigation,
} from "./navigation";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("workspace navigation config", () => {
  it("selects the primary menu and configured route paths", () => {
    expect(primaryMenu(defaultNavigation)?.id).toBe("primary");
    expect(menuEntries(defaultNavigation).length).toBeGreaterThan(0);
    expect(routePath(defaultNavigation, "orders-analytics")).toBe("/orders/analytics");
    expect(routePath(defaultNavigation, "missing")).toBe("#");
  });

  it("uses the starter document when storage is empty, malformed, or invalid", () => {
    expect(readNavigation()).toBe(defaultNavigation);
    localStorage.setItem("modulaga.workspace-navigation.v1", "{");
    expect(readNavigation()).toBe(defaultNavigation);
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify({ schemaVersion: 2 }));
    expect(readNavigation()).toBe(defaultNavigation);
  });

  it("accepts valid saved workspace documents", () => {
    const saved = { ...defaultNavigation, workspace: { ...defaultNavigation.workspace, name: "Saved workspace" } };
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify(saved));
    expect(readNavigation().workspace.name).toBe("Saved workspace");
  });

  it("accepts nested Sections, Groups, and leaf routes", () => {
    const saved = structuredClone(defaultNavigation);
    const section = saved.menus[0]!.entries[0]!;
    expect(isNavigationContainer(section)).toBe(true);
    if (section.type !== "section") throw new Error("Expected a section");
    section.children.push({
      id: "issues",
      type: "group",
      label: "Issues",
      children: [{ id: "issue-list", type: "route", label: "Issue list", routeId: "orders-overview" }],
    });
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify(saved));
    expect(readNavigation().menus[0]?.entries[0]?.id).toBe("operations");
    expect(isNavigationContainer(readNavigation().menus[0]!.entries[0]!)).toBe(true);
  });

  it("rejects malformed menu entries and non-HTTPS external destinations", () => {
    const invalidEntry = { ...defaultNavigation, menus: [{ ...defaultNavigation.menus[0]!, entries: [{ id: "bad", type: "route", label: "Bad" }] }] } as unknown as WorkspaceNavigation;
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify(invalidEntry));
    expect(readNavigation()).toBe(defaultNavigation);
    const unsafeAction = { ...defaultNavigation, menus: [{ ...defaultNavigation.menus[0]!, entries: [{ id: "admin", type: "action", label: "Admin", action: "admin-panel", path: "//outside" }] }] } as unknown as WorkspaceNavigation;
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify(unsafeAction));
    expect(readNavigation()).toBe(defaultNavigation);
    const insecure = { ...defaultNavigation, menus: [{ ...defaultNavigation.menus[0]!, entries: [{ id: "external", type: "external", label: "Unsafe", href: "http://example.com" }] }] } as unknown as WorkspaceNavigation;
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify(insecure));
    expect(readNavigation()).toBe(defaultNavigation);
  });

  it("stores a formatted workspace document", () => {
    saveNavigation(defaultNavigation);
    expect(localStorage.getItem("modulaga.workspace-navigation.v1")).toContain("\n  \"schemaVersion\": 1");
  });
});
