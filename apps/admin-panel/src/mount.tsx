import { render } from "@solidjs/web";
import AdminPanelApp from "./StandaloneAdminPanel";
import "./styles";

export function mount(container: HTMLElement): () => void {
  return render(() => <AdminPanelApp />, container);
}
