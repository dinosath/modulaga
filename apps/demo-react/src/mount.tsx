import { createRoot } from "react-dom/client";
import RemoteApp from "./RemoteApp";
import "./remote.css";

type MountContext = { route: { id: string; path: string } };

export function mount(container: HTMLElement, context: MountContext = { route: { id: "standalone", path: "/" } }): () => void {
  const root = createRoot(container);
  root.render(<RemoteApp route={context.route} />);

  return () => root.unmount();
}
