export type RuntimeConfig = {
  configApiUrl?: string;
  catalogApiUrl?: string;
  contentTypesApiUrl?: string;
  applicationGeneratorApiUrl?: string;
  workspaceId?: string;
  ferriskeyIssuer?: string;
  ferriskeyClientId?: string;
};

declare global {
  interface Window {
    MODULAGA_CONFIG?: RuntimeConfig;
  }
}

export const runtimeConfig: RuntimeConfig = typeof window === "undefined"
  ? {}
  : window.MODULAGA_CONFIG ?? {};
