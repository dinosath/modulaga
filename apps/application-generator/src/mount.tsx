import { render } from "@solidjs/web";
import type { MicrofrontendRouteContext } from "../../../packages/contracts/src/microfrontend";
import ApplicationGeneratorApp from "./ApplicationGeneratorApp";
import "virtual:uno.css";

export function mount(container: HTMLElement, context: MicrofrontendRouteContext): () => void {
  return render(() => <ApplicationGeneratorApp context={context} />, container);
}
