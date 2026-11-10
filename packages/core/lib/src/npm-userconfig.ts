/**
 * A registry credential for one npm invocation, written to a throw-away
 * userconfig (`npm_config_userconfig`) so the token never enters the
 * process owner's `~/.npmrc` — on a developer machine that file may hold
 * the developer's own, far more powerful token — and is gone once npm
 * has run. Shared by the agent (a brokered one-hour token per install)
 * and the panel (its own registry service token for its installs, update
 * staging and agent-half pinning).
 *
 * npm reads `userconfig` from the environment case-insensitively
 * (`npm_config_userconfig` and `NPM_CONFIG_USERCONFIG` are the same key)
 * and, since npm 7, sends `_authToken` on every request to the registry it
 * is configured for — scoped packuments and tarballs included — so no
 * `always-auth` is needed.
 */

import { randomBytes } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { lamalibreRegistryNpmEnv } from './npm-registry-config.js';
import { BUILTIN_TRUSTED_SCOPE, isNpmScope } from './trusted-scopes.js';

export interface InstallNpmrc {
  /** Registry base URL, e.g. `https://feria.samplepark.tr/`. */
  registryUrl: string;
  /** Bearer token for that registry. */
  token: string;
  /**
   * npm scopes routed to the registry — the trusted publisher scopes: the
   * registry Lamaste holds a credential for serves every one of them.
   */
  scopes?: readonly string[] | undefined;
  /**
   * One scope, as the panel's broker answered before it sent `scopes`.
   * Used only when `scopes` is absent. Default (both absent): `@lamalibre`.
   */
  scope?: string | undefined;
}

/** The environment variable npm reads the userconfig path from. */
export const NPM_USERCONFIG_ENV = 'npm_config_userconfig';

/**
 * npm's "nerf dart" — the key it uses to look up `_authToken` for a
 * registry: protocol stripped, path cut at the last slash.
 */
export function npmNerfDart(registryUrl: string): string {
  const url = new URL(registryUrl);
  const dir = new URL('.', `${url.protocol}//${url.host}${url.pathname}`);
  return `//${dir.host}${dir.pathname}`;
}

/**
 * The lines an isolated install userconfig holds: one `<scope>:registry=`
 * line per routed scope, then the registry's `_authToken`. Every scope is
 * checked against the npm scope syntax, so nothing but a scope line can
 * come from it.
 */
export function renderInstallNpmrc(npmrc: InstallNpmrc): string {
  const registryUrl = new URL(npmrc.registryUrl).href;
  const scopes = npmrc.scopes ?? [npmrc.scope ?? BUILTIN_TRUSTED_SCOPE];
  if (scopes.length === 0) throw new Error('No npm scope to route to the registry');
  for (const scope of scopes) {
    if (!isNpmScope(scope)) throw new Error(`Invalid npm scope: ${JSON.stringify(scope)}`);
  }
  if (/\s/.test(npmrc.token)) throw new Error('registry token must not contain whitespace');
  const lines = [...new Set(scopes)].map((scope) => `${scope}:registry=${registryUrl}\n`);
  return `${lines.join('')}${npmNerfDart(registryUrl)}:_authToken=${npmrc.token}\n`;
}

/**
 * Run `fn` with the environment npm needs to use an isolated userconfig
 * holding `npmrc` (a 0600 file of a random name in `dataDir`), and delete
 * that file afterwards — success or failure. Without `npmrc`, `fn` runs
 * with the machine's npm configuration plus `@lamalibre` routed to the
 * registry `resolveLamalibreRegistry` chooses (the hosted Feria unless
 * npm's configuration names another) — never npm's default registry.
 */
export async function withInstallNpmrc<T>(
  dataDir: string,
  npmrc: InstallNpmrc | undefined,
  fn: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  if (!npmrc) return fn(await lamalibreRegistryNpmEnv({ cwd: dataDir }));
  const file = path.join(dataDir, `.npmrc-install-${randomBytes(8).toString('hex')}`);
  await writeFile(file, renderInstallNpmrc(npmrc), { encoding: 'utf-8', mode: 0o600 });
  try {
    return await fn({ [NPM_USERCONFIG_ENV]: file });
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}

/**
 * The HTTP status a failed npm call reports for the registry (`E401`,
 * `E403`, `E404`, … in its output), or null when the failure is not one
 * the registry answered with a status. Reads `stderr` and `stdout` of an
 * execa-style error; npm prints no credential there.
 */
export function npmRegistryStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const { stderr, stdout } = err as { stderr?: unknown; stdout?: unknown };
  const output = `${typeof stderr === 'string' ? stderr : ''}\n${typeof stdout === 'string' ? stdout : ''}`;
  const match = /\bE([1-5][0-9]{2})\b/.exec(output);
  return match ? Number(match[1]) : null;
}
