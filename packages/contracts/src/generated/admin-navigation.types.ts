/* Generated from src/schemas. Do not edit directly. */

export type AdminNavigationScope =
  | {
      type: "deployment";
    }
  | {
      type: "tenant";
      tenantId: Identifier;
    };
export type Identifier = string;
export type AdminSectionNode = AdminSectionGroup | AdminViewLink;

export interface AdminNavigation {
  schemaVersion: 1;
  scope: AdminNavigationScope;
  registeredViews: RegisteredAdminView[];
  sections: AdminSectionNode[];
}
export interface RegisteredAdminView {
  id: Identifier;
  label: string;
  requiredCapabilities: string[];
}
export interface AdminSectionGroup {
  id: Identifier;
  type: "group";
  label: string;
  children: AdminSectionNode[];
}
export interface AdminViewLink {
  id: Identifier;
  type: "view";
  label: string;
  viewId: Identifier;
}
