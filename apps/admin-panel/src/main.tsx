import { render } from "@solidjs/web";
import AdminPanelApp from "./StandaloneAdminPanel";
import "./styles";

const root = document.getElementById("root");
if (!root) throw new Error("Admin panel app root was not found.");
render(() => <AdminPanelApp />, root);
