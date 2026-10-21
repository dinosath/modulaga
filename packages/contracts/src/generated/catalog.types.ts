/* Generated from src/schemas. Do not edit directly. */

export type Identifier = string;
export type Semver = string;

export interface Catalog {
  schemaVersion: 1;
  apps: CatalogApp[];
}
export interface CatalogApp {
  id: Identifier;
  name: string;
  publisher: CatalogPublisher;
  description: string;
  iconUrl?: string;
  tags: string[];
  /**
   * @minItems 1
   */
  releases: [CatalogRelease, ...CatalogRelease[]];
}
export interface CatalogPublisher {
  id: Identifier;
  name: string;
  homepage?: string;
}
export interface CatalogRelease {
  id: string;
  version: Semver;
  publishedAt?: string;
  manifestUrl: string;
  remoteName: string;
  exposedModule: string;
  integrity: string;
  requiredCapabilities: string[];
  compatibility: ReleaseCompatibility;
}
export interface ReleaseCompatibility {
  lifecycleContractVersion: Semver;
  minimumShellVersion: Semver;
  federationFormat: "module-federation";
  remoteType: "module";
  designSystemVersion: Semver;
}
