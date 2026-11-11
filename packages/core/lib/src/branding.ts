/**
 * Branding primitives — single source of truth for the lamalibre / lamaste
 * namespace split. Ecosystem-level surfaces use `ORG` (lamalibre); product-level
 * surfaces nest under `ORG.PROJECT` (lamalibre.lamaste).
 *
 * `LAMALIBRE_ORG` / `LAMALIBRE_PROJECT` env vars override defaults at runtime.
 */

import { homedir } from 'node:os';
import path from 'node:path';

export const ORG = process.env.LAMALIBRE_ORG ?? 'lamalibre';
export const PROJECT = process.env.LAMALIBRE_PROJECT ?? 'lamaste';

// macOS reverse-DNS (dot-separated, hierarchical)
export const ecosystemBundleId = (service: string): string => `com.${ORG}.${service}`;
export const productBundleId = (service: string): string => `com.${ORG}.${PROJECT}.${service}`;

// systemd / hyphen-separated unit names
export const ecosystemUnit = (service: string): string => `${ORG}-${service}`;
export const productUnit = (service: string): string => `${ORG}-${PROJECT}-${service}`;

// User filesystem roots — of this process's user, or of the user whose home is `home`
export const userEcosystemRoot = (): string => path.join(homedir(), `.${ORG}`);
export const userProductRoot = (home: string = homedir()): string =>
  path.join(home, `.${ORG}`, PROJECT);

// System filesystem roots
export const etcEcosystemRoot = (): string => `/etc/${ORG}`;
export const etcProductRoot = (): string => `/etc/${ORG}/${PROJECT}`;

/**
 * The registry Lamalibre's own `@lamalibre/*` packages are published to and
 * installed from: the hosted Feria, which serves them to anonymous readers.
 * Ecosystem-level — every Lamalibre product installs from it. npmjs is not a
 * source (no longer maintained since 4.14). Twins: `LAMALIBRE_REGISTRY_URL`
 * in the desktop's `branding.rs` and in the root helper `lamaste-priv`
 * (tests compare them). Where a path resolves it, an explicit
 * `@lamalibre:registry` in npm's configuration wins (a development Feria) —
 * see `lamalibre-registry.ts`.
 */
export const LAMALIBRE_REGISTRY_URL = 'https://feria.codelama.com.tr/';
