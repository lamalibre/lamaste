/**
 * Reads npm's configuration for `@lamalibre:registry` and applies the rule
 * of `lamalibre-registry.ts`. Node-only (spawns npm); exported from the
 * agent and server subpaths, not from the root (which UIs bundle).
 */

import { execFile } from 'node:child_process';
import path from 'node:path';

import {
  LAMALIBRE_REGISTRY_CONFIG_KEY,
  chooseLamalibreRegistry,
  lamalibreRegistryArg,
  lamalibreRegistryEnv,
} from './lamalibre-registry.js';

export interface LamalibreRegistryOptions {
  /** Directory npm runs in — a project `.npmrc` there counts. Default: this process's cwd. */
  cwd?: string | undefined;
  /** Environment for npm (merged over this process's), e.g. an `npm_config_userconfig`. */
  env?: Record<string, string> | undefined;
  /** npm executable. Default `npm` from PATH. */
  npm?: string | undefined;
  /** Default 30 s. */
  timeoutMs?: number | undefined;
}

/**
 * What npm's configuration says for `@lamalibre:registry` as npm would see
 * it in `cwd` — `undefined` (npm's own word) when nothing sets it.
 */
export function readConfiguredLamalibreRegistry(
  options: LamalibreRegistryOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      options.npm ?? 'npm',
      ['config', 'get', LAMALIBRE_REGISTRY_CONFIG_KEY],
      {
        cwd: options.cwd,
        // The npm the install itself will run (PATH's), with the one next
        // to the Node.js running this process as a fallback: timers and
        // service units run with a minimal PATH.
        env: {
          ...process.env,
          ...options.env,
          PATH: [options.env?.PATH ?? process.env.PATH, path.dirname(process.execPath)]
            .filter(Boolean)
            .join(path.delimiter),
        },
        timeout: options.timeoutMs ?? 30_000,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail =
            typeof stderr === 'string' && stderr.trim() !== '' ? `: ${stderr.trim()}` : '';
          reject(new Error(`npm config get ${LAMALIBRE_REGISTRY_CONFIG_KEY} failed${detail}`));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/**
 * The registry `@lamalibre` packages install from here: npm's configured
 * one, or the hosted Feria. Throws `LamalibreRegistryError` for a public
 * registry; an npm that cannot run fails the call (nothing would install).
 */
export async function resolveLamalibreRegistry(
  options: LamalibreRegistryOptions = {},
): Promise<string> {
  return chooseLamalibreRegistry(await readConfiguredLamalibreRegistry(options));
}

/** {@link resolveLamalibreRegistry} as npm environment (`npm_config_@lamalibre:registry`). */
export async function lamalibreRegistryNpmEnv(
  options: LamalibreRegistryOptions = {},
): Promise<Record<string, string>> {
  return lamalibreRegistryEnv(await resolveLamalibreRegistry(options));
}

/** {@link resolveLamalibreRegistry} as an npm command-line option. */
export async function lamalibreRegistryNpmArg(
  options: LamalibreRegistryOptions = {},
): Promise<string> {
  return lamalibreRegistryArg(await resolveLamalibreRegistry(options));
}
