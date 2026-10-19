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

export interface InstallNpmrc {
  /** Registry base URL, e.g. `https://feria.samplepark.tr/`. */
  registryUrl: string;
  /** Bearer token for that registry. */
  token: string;
  /** npm scope routed to the registry (default `@lamalibre`). */
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

/** The two lines an isolated install userconfig holds. */
export function renderInstallNpmrc(npmrc: InstallNpmrc): string {
  const registryUrl = new URL(npmrc.registryUrl).href;
  const scope = npmrc.scope ?? '@lamalibre';
  if (!/^@[a-z0-9][a-z0-9-]*$/.test(scope)) throw new Error(`Invalid npm scope: ${scope}`);
  if (/\s/.test(npmrc.token)) throw new Error('registry token must not contain whitespace');
  return `${scope}:registry=${registryUrl}\n${npmNerfDart(registryUrl)}:_authToken=${npmrc.token}\n`;
}

/**
 * Run `fn` with the environment npm needs to use an isolated userconfig
 * holding `npmrc` (a 0600 file of a random name in `dataDir`), and delete
 * that file afterwards — success or failure. Without `npmrc`, `fn` runs
 * with an empty environment addition.
 */
export async function withInstallNpmrc<T>(
  dataDir: string,
  npmrc: InstallNpmrc | undefined,
  fn: (env: Record<string, string>) => Promise<T>,
): Promise<T> {
  if (!npmrc) return fn({});
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
