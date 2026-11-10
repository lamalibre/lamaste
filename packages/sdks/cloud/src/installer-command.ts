/**
 * The remote command that runs the Lamaste installer on a relay over SSH —
 * a fresh install (provisioner) or the redeploy of an update (updater).
 * `create-lamaste` is fetched from the hosted Feria: the registry
 * Lamaste's packages are published to. A relay's own npm configuration is
 * not asked — a fresh droplet's names nothing for `@lamalibre`, and an
 * existing relay may run code that still reads npmjs; the installer itself
 * then resolves `@lamalibre` for its own npm calls as root's npm
 * configuration says (the hosted Feria unless it names another registry).
 */

import { LAMALIBRE_REGISTRY_URL, lamalibreRegistryArg } from '@lamalibre/lamaste';

/** `MAJOR.MINOR.PATCH` or `latest` — nothing else reaches a remote shell. */
const INSTALLER_VERSION_RE = /^(?:\d{1,4}\.\d{1,4}\.\d{1,6}|latest)$/;

/**
 * `npx --yes --@lamalibre:registry=<hosted Feria> @lamalibre/create-lamaste@<version> [--json] --yes`.
 * @throws when `version` is not a plain version (it goes into a shell command line)
 */
export function installerCommand(version: string, options: { json?: boolean } = {}): string {
  if (!INSTALLER_VERSION_RE.test(version)) {
    throw new Error(`Invalid installer version: ${JSON.stringify(version.slice(0, 40))}`);
  }
  return [
    'npx',
    '--yes',
    lamalibreRegistryArg(LAMALIBRE_REGISTRY_URL),
    `@lamalibre/create-lamaste@${version}`,
    ...(options.json ? ['--json'] : []),
    '--yes',
  ].join(' ');
}
