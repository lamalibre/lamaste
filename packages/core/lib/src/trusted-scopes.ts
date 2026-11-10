/**
 * Trusted publisher scopes — the one place that decides whether an npm
 * package comes from a publisher this Lamaste trusts as first-party.
 *
 * Plugin code runs with real power: a server plugin runs unsandboxed in
 * the panel, a plugin's admin bundle runs in the panel's own document, an
 * agent plugin in the agent daemon, an agent half as a service account the
 * root helper creates. What bounds that is **who published the code**, and
 * Lamaste expresses it as a list of npm scopes:
 *
 *   - `@lamalibre` is always trusted (Lamaste itself is published under it).
 *   - An administrator may add further scopes whose publisher they trust
 *     exactly as much ("additional" scopes). A plugin never changes the list.
 *   - Everything else is refused. There is no wildcard and no per-plugin
 *     exception: third-party plugins wait for sandboxed plugin UIs.
 *
 * Matching is exact: a package's scope is the part before its first `/`,
 * parsed with a strict lowercase-ASCII syntax, and compared with `===`
 * against each trusted scope. `@lamalibre-evil/x`, `@LamaLibre/x` and
 * Unicode look-alikes are either not well-formed or a different scope.
 *
 * Browser-safe (zod only); the Rust twin is
 * `packages/clients/desktop/src-tauri/src/trusted_scopes.rs`, and both are
 * tested against `test/fixtures/trusted-scopes-cases.json`.
 */

import { z } from 'zod';

/** The scope that is always trusted: Lamaste's own publisher. */
export const BUILTIN_TRUSTED_SCOPE = '@lamalibre';

/** At most this many additional trusted scopes. */
export const MAX_ADDITIONAL_TRUSTED_SCOPES = 16;

/** An npm scope as npm writes it in `@scope:registry=` — `@` + lowercase ASCII, digits, hyphens. */
export const NPM_SCOPE_RE = /^@[a-z0-9][a-z0-9-]{0,49}$/;

/**
 * A scoped package name as plugin packages may carry it: `<scope>/<name>`,
 * `name` lowercase ASCII letters, digits, `.`, `_`, `-`, starting with a
 * letter or digit. No version suffix, no alias.
 */
export const SCOPED_PACKAGE_NAME_RE = /^(@[a-z0-9][a-z0-9-]{0,49})\/[a-z0-9][a-z0-9._-]{0,213}$/;

/**
 * A package spec an install accepts: a scoped package name, optionally
 * followed by `@<version-or-tag>`. Alias schemes (`@npm:`, `@github:`, …)
 * and anything else npm would resolve elsewhere do not match: `:` and `/`
 * are not allowed in the suffix.
 */
export const SCOPED_PACKAGE_SPEC_RE =
  /^(@[a-z0-9][a-z0-9-]{0,49})\/[a-z0-9][a-z0-9._-]{0,213}(@[A-Za-z0-9._-]+)?$/;

export const NpmScopeSchema = z
  .string()
  .regex(NPM_SCOPE_RE, 'An npm scope is @ followed by lowercase letters, digits and hyphens');

export const ScopedPackageNameSchema = z
  .string()
  .max(265)
  .regex(
    SCOPED_PACKAGE_NAME_RE,
    'A package name is @<scope>/<name> in lowercase letters, digits, ".", "_" and "-"',
  );

/**
 * The additional trusted scopes an administrator configured: unique, at
 * most {@link MAX_ADDITIONAL_TRUSTED_SCOPES}, never the built-in scope.
 */
export const AdditionalTrustedScopesSchema = z
  .array(NpmScopeSchema)
  .max(MAX_ADDITIONAL_TRUSTED_SCOPES)
  .refine((scopes) => new Set(scopes).size === scopes.length, 'Trusted scopes must be unique')
  .refine(
    (scopes) => !scopes.includes(BUILTIN_TRUSTED_SCOPE),
    `${BUILTIN_TRUSTED_SCOPE} is always trusted and is not listed`,
  );

/**
 * The effective list: the built-in scope, then the additional ones that
 * are well-formed (anything else is dropped — never trusted). Without
 * `additional`, the built-in scope alone.
 */
export function effectiveTrustedScopes(additional?: readonly unknown[] | null): readonly string[] {
  const out = [BUILTIN_TRUSTED_SCOPE];
  // At most as many entries as a configuration may hold, read as the
  // desktop's twin reads them (the first ones, before filtering).
  for (const scope of (additional ?? []).slice(0, MAX_ADDITIONAL_TRUSTED_SCOPES)) {
    if (typeof scope === 'string' && NPM_SCOPE_RE.test(scope) && !out.includes(scope)) {
      out.push(scope);
    }
  }
  return out;
}

/** Whether `value` is a well-formed npm scope. */
export function isNpmScope(value: unknown): value is string {
  return typeof value === 'string' && NPM_SCOPE_RE.test(value);
}

/**
 * The scope of a well-formed scoped package name or spec (a version suffix
 * is allowed); null for anything else — an unscoped name, an alias, an
 * upper-case or non-ASCII character, a path segment.
 */
export function packageScope(nameOrSpec: unknown): string | null {
  if (typeof nameOrSpec !== 'string' || nameOrSpec.length > 300) return null;
  const match = SCOPED_PACKAGE_SPEC_RE.exec(nameOrSpec);
  return match ? (match[1] ?? null) : null;
}

/**
 * Whether `nameOrSpec` is a well-formed scoped package name (or name with a
 * version suffix) whose scope equals one of `trusted`.
 */
export function isTrustedPackage(nameOrSpec: unknown, trusted: readonly string[]): boolean {
  const scope = packageScope(nameOrSpec);
  if (scope === null) return false;
  for (const candidate of trusted) {
    if (candidate === scope) return true;
  }
  return false;
}

/** A package from a scope this Lamaste does not trust (or not a well-formed scoped name at all). */
export class UntrustedScopeError extends Error {
  readonly code = 'untrusted_scope';
  readonly statusCode = 400;
  readonly packageName: string;
  readonly scope: string | null;
  readonly trustedScopes: readonly string[];

  constructor(packageName: string, scope: string | null, trusted: readonly string[]) {
    super(
      scope === null
        ? `"${String(packageName).slice(0, 300)}" is not a scoped npm package name (@<scope>/<name>, lowercase)`
        : `Package "${packageName}" is from ${scope}, which is not a trusted publisher scope (trusted: ${trusted.join(', ')})`,
    );
    this.name = 'UntrustedScopeError';
    this.packageName = String(packageName).slice(0, 300);
    this.scope = scope;
    this.trustedScopes = [...trusted];
  }
}

/** Throws {@link UntrustedScopeError} unless {@link isTrustedPackage}. */
export function assertTrustedPackage(nameOrSpec: string, trusted: readonly string[]): void {
  if (!isTrustedPackage(nameOrSpec, trusted)) {
    throw new UntrustedScopeError(nameOrSpec, packageScope(nameOrSpec), trusted);
  }
}

/** The package names a plugin manifest refers to. */
export interface ManifestPackageRefs {
  readonly packages?: { readonly server?: string | undefined; readonly agent?: string | undefined };
  readonly agent?: { readonly package?: string | undefined } | undefined;
}

/**
 * A manifest accepted for install or update: the installed package and
 * every package the manifest names (`packages.server`, `packages.agent`,
 * `agent.package`) are trusted **and in the installed package's own
 * scope** — a publisher names only its own packages, so trusting one scope
 * never lets its manifest pull in another publisher's code.
 */
export function assertManifestPackagesTrusted(
  manifest: ManifestPackageRefs,
  packageName: string,
  trusted: readonly string[],
): void {
  assertTrustedPackage(packageName, trusted);
  const ownScope = packageScope(packageName);
  const named = [manifest.packages?.server, manifest.packages?.agent, manifest.agent?.package];
  for (const ref of named) {
    if (ref === undefined) continue;
    assertTrustedPackage(ref, trusted);
    const scope = packageScope(ref);
    if (scope !== ownScope) {
      throw Object.assign(new UntrustedScopeError(ref, scope, trusted), {
        message: `The manifest of ${packageName} names ${ref}, which is not in ${ownScope ?? 'its scope'}: a plugin names only packages of its own scope`,
      });
    }
  }
}
