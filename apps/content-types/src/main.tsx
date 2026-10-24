import { mount } from "./mount";
import "../../shell/src/shell-layout.css";

const root = document.getElementById("root");
if (!root) throw new Error("Content types app root was not found.");
mount(root, { workspaceId: "standalone", installationId: "standalone", routeId: "standalone", path: "/", setBreadcrumbs: () => {} });
