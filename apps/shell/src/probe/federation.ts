import { createInstance } from "@module-federation/enhanced/runtime";
import type { ApplicationRelease } from "../workspace/api";

type RemoteModule = {
  mount(container: HTMLElement, context: MicrofrontendRouteContext): () => void;
};

export type MicrofrontendRouteContext = {
  workspaceId: string;
  installationId: string;
  routeId: string;
  path: string;
};

const noop = () => {};

function validateRelease(release: ApplicationRelease) {
  const manifest = new URL(release.manifestUrl);
  const localHttp = manifest.protocol === "http:"
    && ["localhost", "127.0.0.1", "::1"].includes(manifest.hostname);
  if (manifest.protocol !== "https:" && !localHttp) {
    throw new Error("Microfrontend manifests must use HTTPS outside local development.");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(release.remoteName)) {
    throw new Error("Microfrontend remote name is invalid.");
  }
  if (!/^\.\/[A-Za-z0-9_./-]{1,126}$/.test(release.exposedModule)) {
    throw new Error("Microfrontend exposed module is invalid.");
  }
  return manifest.href;
}

export async function mountDeclaredRemote(
  applicationId: string,
  release: ApplicationRelease,
  container: HTMLElement,
  context: MicrofrontendRouteContext,
  shouldMount: () => boolean = () => true,
): Promise<() => void> {
  const entry = validateRelease(release);
  const federation = createInstance({
    name: `modulaga_${applicationId.replaceAll("-", "_")}`,
    remotes: [{ name: release.remoteName, entry }],
  });
  const exposedModule = release.exposedModule.replace(/^\.\//, "");
  const remote = await federation.loadRemote(`${release.remoteName}/${exposedModule}`) as RemoteModule | null;

  if (!remote || typeof remote.mount !== "function") {
    throw new Error("Federated application has an invalid mount module.");
  }
  if (!shouldMount()) return noop;
  return remote.mount(container, context);
}
