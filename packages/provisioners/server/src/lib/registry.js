/**
 * The registry the installer's npm calls take `@lamalibre/*` packages from:
 * the hosted Feria, unless root's npm configuration names another registry
 * for the scope (a development Feria — rodeo's VMs carry one). A
 * configuration naming npmjs is refused: npmjs no longer carries Lamaste's
 * packages. The rule is core's (`resolveLamalibreRegistry`); it is read
 * once per run, from `/` so no project `.npmrc` of a deploy directory can
 * change it halfway through.
 */

import { lamalibreRegistryEnv } from '@lamalibre/lamaste';
import { resolveLamalibreRegistry } from '@lamalibre/lamaste/server';

/** @type {Promise<string> | null} */
let resolved = null;

/** The registry this run installs `@lamalibre` packages from (resolved once). */
export function lamalibreRegistry() {
  if (resolved === null) {
    resolved = resolveLamalibreRegistry({ cwd: '/' });
    // A failed read is not cached: the next caller sees the same error afresh.
    resolved.catch(() => {
      resolved = null;
    });
  }
  return resolved;
}

/**
 * The environment an installer `npm` call runs with (merged over the
 * process's by execa): `npm_config_@lamalibre:registry` set to
 * {@link lamalibreRegistry}.
 * @returns {Promise<Record<string, string>>}
 */
export async function lamalibreNpmEnv() {
  return lamalibreRegistryEnv(await lamalibreRegistry());
}
