/**
 * The relay's trusted publisher scopes — read side.
 *
 * `@lamalibre` is always trusted; an administrator may add further scopes
 * whose publisher they trust as much (`panel.json` `trustedScopes`,
 * changed only through `lib/trusted-scope-settings.js`). Every place in the
 * panel that decides whether a plugin package may be installed, updated,
 * pinned or pushed reads the list here, and checks it with the core helpers
 * (`@lamalibre/lamaste` `trusted-scopes.ts`).
 *
 * A package from an additional scope also needs the configured registry to
 * host that scope (serve it as a closed scope, never from an upstream):
 * without that, npm would resolve the name from wherever the scope happens
 * to be published — on npmjs, anyone's. See the design's R-B1.
 */

import {
  BUILTIN_TRUSTED_SCOPE,
  SCOPED_PACKAGE_SPEC_RE,
  UntrustedScopeError,
  assertManifestPackagesTrusted,
  effectiveTrustedScopes,
  isTrustedPackage,
  packageScope,
} from '@lamalibre/lamaste';
import { fetchRegistryHostedScopes } from '@lamalibre/lamaste/server';
import { getConfig } from './config.js';
import { readRegistryCredentialConfig } from './registry-credential.js';

/** The additional trusted scopes, as configured. */
export function additionalTrustedScopes() {
  const config = getConfig();
  return [...(config?.trustedScopes ?? [])];
}

/** The effective list: `@lamalibre`, then the additional scopes. */
export function getTrustedScopes() {
  return effectiveTrustedScopes(additionalTrustedScopes());
}

/** An error with the shape the routes send (`statusCode`, `code`). */
function refusal(message, statusCode, code, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

/** Turn a core UntrustedScopeError into the panel's 400 `untrusted_scope`. */
export function untrustedScopeRefusal(err) {
  return refusal(err.message, 400, 'untrusted_scope', {
    scope: err.scope,
    trustedScopes: err.trustedScopes,
  });
}

const HOSTED_CACHE_MS = 60_000;
/** @type {{ registryUrl: string, at: number, hosted: string[], retired: string[] } | null} */
let hostedCache = null;

/** Forget the cached hosted-scope list (the credential changed). */
export function resetRegistryHostedScopesCache() {
  hostedCache = null;
}

/**
 * The scopes the configured registry hosts, cached for a minute; null when
 * no registry credential is configured.
 * @param {{ fresh?: boolean }} [options]
 */
export async function registryHostedScopes({ fresh = false } = {}) {
  const credential = await readRegistryCredentialConfig();
  if (!credential) return null;
  const now = Date.now();
  if (
    !fresh &&
    hostedCache &&
    hostedCache.registryUrl === credential.registryUrl &&
    now - hostedCache.at < HOSTED_CACHE_MS
  ) {
    return hostedCache;
  }
  const { hosted, retired } = await fetchRegistryHostedScopes(credential.registryUrl);
  hostedCache = { registryUrl: credential.registryUrl, at: now, hosted, retired };
  return hostedCache;
}

/**
 * The trusted scopes an agent may route to the configured registry: the
 * built-in scope, and each additional one the registry hosts right now
 * (re-read at most once a minute). An agent installs a package of an
 * additional scope only through the routes this names, so a scope the
 * registry stopped hosting — or never hosted — is never asked of it
 * (a registry proxies what it does not host). Unreadable: the built-in only.
 */
export async function brokeredTrustedScopes() {
  const additional = additionalTrustedScopes();
  if (additional.length === 0) return [BUILTIN_TRUSTED_SCOPE];
  let registry;
  try {
    registry = await registryHostedScopes();
  } catch {
    registry = null;
  }
  const hosted = new Set(registry?.hosted ?? []);
  return [BUILTIN_TRUSTED_SCOPE, ...additional.filter((scope) => hosted.has(scope))];
}

/**
 * Throws unless the configured registry hosts `scope`. The built-in scope
 * needs no check (it is Lamalibre's own on every registry Lamaste uses).
 * @param {string} scope
 * @param {{ fresh?: boolean }} [options]
 */
export async function assertRegistryHostsScope(scope, options = {}) {
  if (scope === BUILTIN_TRUSTED_SCOPE) return;
  let registry;
  try {
    registry = await registryHostedScopes(options);
  } catch (err) {
    throw refusal(
      `Cannot confirm that the registry hosts ${scope}: ${err.message}`,
      502,
      'registry_unreachable',
    );
  }
  if (!registry) {
    throw refusal(
      `${scope} is trusted, but no registry credential is configured: packages of an additional scope install only from the registry that hosts it (set the registry credential)`,
      409,
      'registry_credential_required',
    );
  }
  if (!registry.hosted.includes(scope)) {
    throw refusal(
      `The registry ${new URL(registry.registryUrl).host} does not host ${scope}${
        registry.retired.includes(scope) ? ' any more (retired)' : ''
      }: host it there first (feria-server scopes add ${scope} …)`,
      409,
      'registry_lacks_scope',
    );
  }
}

/** Reject npm alias references even if the pattern ever loosens. */
function assertNoAlias(spec) {
  const versionSuffix = spec.indexOf('@', 1);
  if (versionSuffix !== -1 && spec.slice(versionSuffix).includes(':')) {
    throw refusal('npm alias references are not permitted', 400, 'invalid_package');
  }
}

/**
 * A well-formed package spec with no alias — the syntax alone, for a
 * package already accepted (an update's revert).
 * @param {string} spec
 */
export function assertPackageSpecSyntax(spec) {
  if (
    typeof spec !== 'string' ||
    spec.length === 0 ||
    spec.length > 256 ||
    !SCOPED_PACKAGE_SPEC_RE.test(spec)
  ) {
    throw refusal('Invalid package name', 400, 'invalid_package');
  }
  assertNoAlias(spec);
}

/**
 * An install or update spec (`@scope/name` or `@scope/name@<version>`) the
 * panel may hand to npm: well-formed, no alias, from a trusted scope, and —
 * for an additional scope — hosted by the configured registry.
 * @param {string} spec
 */
export async function assertTrustedPackageSpec(spec) {
  if (typeof spec !== 'string' || spec.length === 0 || spec.length > 256) {
    throw refusal('Invalid package name', 400, 'invalid_package');
  }
  if (!SCOPED_PACKAGE_SPEC_RE.test(spec)) {
    throw refusal(
      'A plugin package is @<scope>/<name>[@<version>] in lowercase letters, digits, ".", "_" and "-" (alias schemes are rejected)',
      400,
      'invalid_package',
    );
  }
  assertNoAlias(spec);
  const trusted = getTrustedScopes();
  if (!isTrustedPackage(spec, trusted)) {
    throw untrustedScopeRefusal(new UntrustedScopeError(spec, packageScope(spec), trusted));
  }
  await assertRegistryHostsScope(/** @type {string} */ (packageScope(spec)));
}

/**
 * The manifest of `packageName`: names only trusted packages of the
 * plugin's own scope. Throws the panel's 400 `untrusted_scope`.
 * @param {object} manifest
 * @param {string} packageName bare name
 */
export function assertManifestTrusted(manifest, packageName) {
  try {
    assertManifestPackagesTrusted(manifest, packageName, getTrustedScopes());
  } catch (err) {
    if (err instanceof UntrustedScopeError) throw untrustedScopeRefusal(err);
    throw err;
  }
}
