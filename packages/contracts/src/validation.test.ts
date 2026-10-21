import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validateAdminNavigation,
  validateCatalog,
  validatePreferences,
  validateWorkspace,
} from "./index.js";

function fixture<T>(path: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8"),
  ) as T;
}

describe("configuration schemas", () => {
  it("accepts catalog, workspace, preference, and admin-navigation examples", () => {
    expect(validateCatalog(fixture("catalog.json"))).toBe(true);
    expect(validateWorkspace(fixture("workspaces/default.json"))).toBe(true);
    expect(validatePreferences(fixture("preferences/default.json"))).toBe(true);
    expect(validateAdminNavigation(fixture("admin-navigation.json"))).toBe(true);
  });

  it("rejects unsupported schema versions and releases without integrity metadata", () => {
    expect(validateCatalog(fixture("invalid/catalog-unsupported-version.json"))).toBe(
      false,
    );
    expect(validateCatalog(fixture("invalid/catalog-missing-integrity.json"))).toBe(
      false,
    );
  });

  it("rejects unsafe workspace paths, links, and arbitrary admin view configuration", () => {
    expect(
      validateWorkspace(fixture("invalid/workspace-invalid-base-path.json")),
    ).toBe(false);
    expect(
      validateWorkspace(fixture("invalid/workspace-unsafe-external-link.json")),
    ).toBe(false);
    expect(
      validateAdminNavigation(
        fixture("invalid/admin-navigation-arbitrary-view.json"),
      ),
    ).toBe(false);
  });

  it("accepts sections, expandable menu groups, and the shell admin action", () => {
    const workspace = fixture<Record<string, any>>("workspaces/default.json");
    workspace.menus[0].entries.push({
      id: "settings",
      type: "section",
      label: "Settings",
      icon: "settings",
      visible: true,
      children: [{ id: "admin-group", type: "group", label: "Admin", chevron: true, children: [{ id: "admin-panel", type: "action", label: "Admin Panel", action: "admin-panel", path: "/settings/admin-panel", icon: "settings", visible: true }] }],
    });
    expect(validateWorkspace(workspace)).toBe(true);
    workspace.menus[0].entries.at(-1).children[0].children[0].action = "unknown-action";
    expect(validateWorkspace(workspace)).toBe(false);
  });
});
