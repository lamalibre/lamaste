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

// User filesystem roots
export const userEcosystemRoot = (): string => path.join(homedir(), `.${ORG}`);
export const userProductRoot = (): string => path.join(homedir(), `.${ORG}`, PROJECT);

// System filesystem roots
export const etcEcosystemRoot = (): string => `/etc/${ORG}`;
export const etcProductRoot = (): string => `/etc/${ORG}/${PROJECT}`;
