/**
 * Where `@lamalibre/*` packages come from — the one rule every path that
 * installs or version-checks Lamaste itself (installers, self-update,
 * plugin installs without a registry credential, the desktop, the cloud
 * provisioner) follows:
 *
 *   1. npm's own configuration names a registry for `@lamalibre`
 *      (`@lamalibre:registry`, in any npmrc, the environment or the command
 *      line) → that registry. This is how a development Feria takes over:
 *      `feria-server setup` writes the line, rodeo's VMs carry it.
 *   2. It names a public registry (npmjs and its mirrors) → refused. npmjs is
 *      no longer a source of Lamaste's packages (since 4.14); a stale
 *      configuration must not silently install old releases from there.
 *   3. Nothing configured → the hosted Feria, `LAMALIBRE_REGISTRY_URL`.
 *
 * The chosen registry is then passed explicitly (`--@lamalibre:registry=`
 * on a command line, or `npm_config_@lamalibre:registry` in npm's
 * environment), never left to npm's default registry. Only the
 * `@lamalibre` scope is routed: third-party dependencies keep coming from
 * the machine's default registry (the hosted Feria proxies only for token
 * holders).
 *
 * Pure (no I/O) — the `npm config get` that reads the configuration lives
 * in `npm-registry-config.ts`, exported from the agent and server subpaths.
 * Twins: `branding.rs` (desktop) and `lamaste-priv` (root helper) implement
 * the same rule; their tests use `test/fixtures/lamalibre-registry-cases.json`.
 */

import { LAMALIBRE_REGISTRY_URL } from './branding.js';
import { BUILTIN_TRUSTED_SCOPE } from './trusted-scopes.js';

/** The npm configuration key routing Lamaste's scope. */
export const LAMALIBRE_REGISTRY_CONFIG_KEY = `${BUILTIN_TRUSTED_SCOPE}:registry`;

/** The environment variable npm reads {@link LAMALIBRE_REGISTRY_CONFIG_KEY} from. */
export const LAMALIBRE_REGISTRY_ENV = `npm_config_${LAMALIBRE_REGISTRY_CONFIG_KEY}`;

/**
 * Public registries where anyone may publish under any unclaimed name (or
 * mirrors of one): never a source of a trusted scope.
 */
export const PUBLIC_NPM_REGISTRY_HOSTS: ReadonlySet<string> = new Set([
  'registry.npmjs.org',
  'registry.npmjs.com',
  'registry.yarnpkg.com',
  'registry.npmmirror.com',
]);

/** True when `url` is on a public registry host ({@link PUBLIC_NPM_REGISTRY_HOSTS}). */
export function isPublicNpmRegistry(url: string): boolean {
  try {
    return PUBLIC_NPM_REGISTRY_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** The configuration names a registry Lamaste must not install itself from. */
export class LamalibreRegistryError extends Error {
  readonly code = 'lamalibre_registry_refused';
  constructor(message: string) {
    super(message);
    this.name = 'LamalibreRegistryError';
  }
}

/**
 * The registry to install `@lamalibre` packages from, given what npm's
 * configuration reports for {@link LAMALIBRE_REGISTRY_CONFIG_KEY}
 * (`npm config get` prints `undefined` for an unset key). Normalised to
 * end in `/`.
 *
 * @throws LamalibreRegistryError for a public registry or a value that is
 *   not an http(s) URL
 */
export function chooseLamalibreRegistry(configured: string | null | undefined): string {
  const value = (configured ?? '').trim();
  if (value === '' || value === 'undefined' || value === 'null') return LAMALIBRE_REGISTRY_URL;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LamalibreRegistryError(
      `npm's ${LAMALIBRE_REGISTRY_CONFIG_KEY} is not a URL (${JSON.stringify(value.slice(0, 200))}) — ` +
        `remove it, or set it to ${LAMALIBRE_REGISTRY_URL}`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new LamalibreRegistryError(
      `npm's ${LAMALIBRE_REGISTRY_CONFIG_KEY} is not an http(s) URL — remove it, or set it to ${LAMALIBRE_REGISTRY_URL}`,
    );
  }
  if (url.username !== '' || url.password !== '') {
    throw new LamalibreRegistryError(
      `npm's ${LAMALIBRE_REGISTRY_CONFIG_KEY} carries credentials in the URL — put the token in an _authToken line instead`,
    );
  }
  if (PUBLIC_NPM_REGISTRY_HOSTS.has(url.hostname.toLowerCase())) {
    throw new LamalibreRegistryError(
      `npm's ${LAMALIBRE_REGISTRY_CONFIG_KEY} names ${url.hostname}, which no longer carries Lamaste's packages — ` +
        `remove the line, or set it to ${LAMALIBRE_REGISTRY_URL}`,
    );
  }
  url.search = '';
  url.hash = '';
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

/** The npm command-line option routing `@lamalibre` to `registryUrl`. */
export function lamalibreRegistryArg(registryUrl: string): string {
  return `--${LAMALIBRE_REGISTRY_CONFIG_KEY}=${registryUrl}`;
}

/** npm's environment routing `@lamalibre` to `registryUrl` (merged into a child's env). */
export function lamalibreRegistryEnv(registryUrl: string): Record<string, string> {
  return { [LAMALIBRE_REGISTRY_ENV]: registryUrl };
}
