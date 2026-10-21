import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultNavigation,
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

  it("rejects malformed menu entries and non-HTTPS external destinations", () => {
    const invalidEntry = { ...defaultNavigation, menus: [{ ...defaultNavigation.menus[0]!, entries: [{ id: "bad", type: "route", label: "Bad" }] }] } as unknown as WorkspaceNavigation;
    localStorage.setItem("modulaga.workspace-navigation.v1", JSON.stringify(invalidEntry));
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
