/**
 * The local plugin host's trusted publisher scopes.
 *
 * The local plugin host (desktop, `127.0.0.1:9293`) has no relay, so no
 * administrator decides for it: the machine's user does, through
 * `lamaste-agent trusted-scopes --local`, and only through it — never a
 * plugin. The list is `~/.lamalibre/local/trusted-scopes.json`
 * (`{ "additional": ["@example"] }`, 0600 in the 0700 local directory).
 * No file, or one that does not parse, means `@lamalibre` alone: an
 * unreadable list never widens trust.
 *
 * The desktop's Rust pre-check reads the same file
 * (`trusted_scopes::local_trusted_scopes`).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { KeyedPromiseChainMutex, atomicWriteJSON } from '../file-helpers.js';
import {
  AdditionalTrustedScopesSchema,
  BUILTIN_TRUSTED_SCOPE,
  MAX_ADDITIONAL_TRUSTED_SCOPES,
  NpmScopeSchema,
  effectiveTrustedScopes,
} from '../trusted-scopes.js';
import { localDir, localPluginsFile } from './platform.js';

/** `~/.lamalibre/local/trusted-scopes.json`. */
export function localTrustedScopesFile(): string {
  return path.join(localDir(), 'trusted-scopes.json');
}

const mutex = new KeyedPromiseChainMutex();

/** The additional scopes the file lists; `[]` when it is missing or not valid. */
export async function readLocalAdditionalTrustedScopes(): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(localTrustedScopesFile(), 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { additional?: unknown };
    const result = AdditionalTrustedScopesSchema.safeParse(parsed?.additional ?? []);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

/** The local plugin host's effective trusted scopes. */
export async function localTrustedScopes(): Promise<readonly string[]> {
  return effectiveTrustedScopes(await readLocalAdditionalTrustedScopes());
}

/** A refused change of the local list; `code` says why. */
export class LocalTrustedScopeError extends Error {
  readonly code:
    | 'invalid_scope'
    | 'builtin_scope'
    | 'scope_already_trusted'
    | 'scope_not_trusted'
    | 'scope_in_use'
    | 'too_many_scopes';
  constructor(code: LocalTrustedScopeError['code'], message: string) {
    super(message);
    this.name = 'LocalTrustedScopeError';
    this.code = code;
  }
}

function checkScope(scope: string): void {
  if (!NpmScopeSchema.safeParse(scope).success) {
    throw new LocalTrustedScopeError(
      'invalid_scope',
      `"${scope}" is not an npm scope (@ followed by lowercase letters, digits and hyphens)`,
    );
  }
  if (scope === BUILTIN_TRUSTED_SCOPE) {
    throw new LocalTrustedScopeError(
      'builtin_scope',
      `${BUILTIN_TRUSTED_SCOPE} is always trusted and cannot be added or removed`,
    );
  }
}

async function write(additional: string[]): Promise<void> {
  await atomicWriteJSON(
    localTrustedScopesFile(),
    { additional },
    { mkdirp: true, dirMode: 0o700, mode: 0o600 },
  );
}

/** The local plugins' package names in `scope` (read straight from the local registry). */
async function localPluginPackagesOfScope(scope: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(localPluginsFile(), 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const parsed = JSON.parse(raw) as { plugins?: Array<{ packageName?: unknown }> };
  return (parsed.plugins ?? [])
    .map((p) => p.packageName)
    .filter((name): name is string => typeof name === 'string' && name.startsWith(`${scope}/`));
}

/** Add `scope` to the local list; returns the effective list. */
export function addLocalTrustedScope(scope: string): Promise<readonly string[]> {
  return mutex.run(localTrustedScopesFile(), async () => {
    checkScope(scope);
    const current = await readLocalAdditionalTrustedScopes();
    if (current.includes(scope)) {
      throw new LocalTrustedScopeError('scope_already_trusted', `${scope} is already trusted`);
    }
    if (current.length >= MAX_ADDITIONAL_TRUSTED_SCOPES) {
      throw new LocalTrustedScopeError(
        'too_many_scopes',
        `At most ${MAX_ADDITIONAL_TRUSTED_SCOPES} additional scopes can be trusted`,
      );
    }
    const next = [...current, scope];
    await write(next);
    return effectiveTrustedScopes(next);
  });
}

/** Remove `scope` from the local list; returns the effective list. */
export function removeLocalTrustedScope(scope: string): Promise<readonly string[]> {
  return mutex.run(localTrustedScopesFile(), async () => {
    checkScope(scope);
    const current = await readLocalAdditionalTrustedScopes();
    if (!current.includes(scope)) {
      throw new LocalTrustedScopeError('scope_not_trusted', `${scope} is not trusted`);
    }
    const inUse = await localPluginPackagesOfScope(scope);
    if (inUse.length > 0) {
      throw new LocalTrustedScopeError(
        'scope_in_use',
        `${scope} is still used by ${inUse.join(', ')} — uninstall ${inUse.length === 1 ? 'it' : 'them'} first`,
      );
    }
    const next = current.filter((s) => s !== scope);
    await write(next);
    return effectiveTrustedScopes(next);
  });
}
