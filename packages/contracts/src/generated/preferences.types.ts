/* Generated from src/schemas. Do not edit directly. */

export interface WorkspacePreferences {
  schemaVersion: 1;
  userId: string;
  workspaceId: string;
  overrides: {
    themeId?: string;
    density?: "comfortable" | "compact";
    menuMode?: "tree" | "rail" | "horizontal" | "drawer";
    menuPlacement?: {
      region: "top" | "left" | "right" | "bottom";
      renderer: "tree" | "rail" | "horizontal" | "drawer";
    };
    layoutTemplate?: "single-column" | "split-pane" | "dashboard-grid";
    hiddenMenuEntryIds?: string[];
    menuOrder?: string[];
    favorites?: string[];
  };
}
