/**
 * Pins a vendored package's dependencies on this monorepo's packages to the
 * exact versions it was built with.
 *
 * create-lamaste vendors serverd, the server CLI and Gatekeeper, then runs
 * `npm install` for them on the relay. Their manifests name the core
 * library with a caret range (`^4.6.0`), so an install of release X made
 * after X+1 shipped resolved X+1's core — and 4.6.0's serverd on 4.7.0's
 * core did not start. Pinned, create-lamaste@X always installs the core,
 * tickets and identity libraries of release X; third-party dependencies
 * keep their ranges.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * The name → version of every workspace package (`packages/<group>/<name>`).
 *
 * @param {string} monorepoRoot
 * @returns {Promise<Map<string, string>>}
 */
export async function workspaceVersions(monorepoRoot) {
  const versions = new Map();
  const packagesDir = join(monorepoRoot, 'packages');
  for (const group of await readdir(packagesDir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const entry of await readdir(join(packagesDir, group.name), { withFileTypes: true })) {
      const manifestPath = join(packagesDir, group.name, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const { name, version } = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (typeof name === 'string' && typeof version === 'string') versions.set(name, version);
    }
  }
  return versions;
}

/**
 * The manifest with each dependency on a workspace package set to that
 * package's exact version. Pure; throws on a workspace dependency whose
 * range the workspace's version does not satisfy as a caret or exact range
 * (the vendored code would then be pinned to something it was not written
 * against).
 *
 * @param {Record<string, unknown>} manifest
 * @param {Map<string, string>} versions
 * @returns {Record<string, unknown>}
 */
export function pinWorkspaceDependencies(manifest, versions) {
  const pinned = { ...manifest };
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (deps === null || typeof deps !== 'object') continue;
    const next = { ...deps };
    for (const [name, range] of Object.entries(deps)) {
      const version = versions.get(name);
      if (version === undefined) continue;
      if (range !== version && !caretAdmits(range, version)) {
        throw new Error(
          `${manifest.name}: ${field}.${name} is "${range}", the workspace has ${version}`,
        );
      }
      next[name] = version;
    }
    pinned[field] = next;
  }
  return pinned;
}

/** Whether `^a.b.c` admits `version` (same major, not lower). */
function caretAdmits(range, version) {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(String(range));
  const have = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || !have) return false;
  const [want, got] = [match.slice(1).map(Number), have.slice(1).map(Number)];
  if (want[0] !== got[0]) return false;
  for (let i = 1; i < 3; i++) if (got[i] !== want[i]) return got[i] > want[i];
  return true;
}

/**
 * Copy `source` (a package.json) to `dest` with its workspace dependencies
 * pinned.
 *
 * @param {string} source
 * @param {string} dest
 * @param {Map<string, string>} versions
 */
export async function writePinnedManifest(source, dest, versions) {
  const manifest = JSON.parse(await readFile(source, 'utf8'));
  await writeFile(
    dest,
    `${JSON.stringify(pinWorkspaceDependencies(manifest, versions), null, 2)}\n`,
  );
}
