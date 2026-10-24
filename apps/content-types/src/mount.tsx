import { render } from "@solidjs/web";
import type { MicrofrontendRouteContext } from "../../../packages/contracts/src/microfrontend";
import ContentTypesApp from "./ContentTypesApp";
import "virtual:uno.css";

export type ContentTypesMountContext = MicrofrontendRouteContext;

export function mount(container: HTMLElement, context: ContentTypesMountContext): () => void {
  return render(() => <ContentTypesApp context={context} />, container);
}
