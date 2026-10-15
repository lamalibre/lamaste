/**
 * Reading plugin packages: the installed copy under `<STATE_DIR>/node_modules`
 * and — for an update — a version not installed yet, fetched with `npm pack`
 * and read in memory (never extracted), so its manifest and relay hook
 * module can be shown and approved before anything of it is installed.
 *
 * The relay hook module is read with care: its path comes from the
 * manifest, so it must stay inside the package, be a regular file (not a
 * link) and be no larger than {@link HOOK_MODULE_MAX_BYTES}.
 *
 * An agent half Lamaste installs onto an agent is never fetched here: its
 * tarball's integrity is read from the registry ({@link pinAgentHalf}) and
 * pinned with the version, and the agent fetches the tarball itself and
 * installs it only when it matches.
 */

import { lstat, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import {
  AGENT_HALF_INTEGRITY_RE,
  AgentHalfVersionSchema,
  agentHalfOf,
  hookEntrySha256,
  relayHookSetNeedsEntry,
  relayHookSetOf,
} from '@lamalibre/lamaste';
import { readTarballFiles } from '@lamalibre/lamaste/server';
import { httpError } from './app-error.js';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

/** Mirrors lamaste-priv's MAX_HOOK_MODULE_BYTES. */
export const HOOK_MODULE_MAX_BYTES = 4 * 1024 * 1024;

const PACKAGE_RE = /^@lamalibre\/[a-z0-9][a-z0-9._-]{0,213}$/;
const VERSION_RE = /^[0-9A-Za-z.+-]{1,64}$/;

/** `@lamalibre/x@1.2.3` → `@lamalibre/x`. */
export function bareLamalibrePackageName(spec) {
  const at = spec.indexOf('@', 1);
  return at === -1 ? spec : spec.slice(0, at);
}

/** The installed package's directory (real path). */
export async function installedPackageDir(packageName) {
  const bare = bareLamalibrePackageName(packageName);
  if (!PACKAGE_RE.test(bare)) throw httpError('Invalid package name', 400);
  const require = createRequire(`${STATE_DIR}/`);
  const manifestPath = require.resolve(`${bare}/lamaste-plugin.json`);
  return realpath(path.dirname(manifestPath));
}

/**
 * The relay entry module's bytes, from an installed package directory.
 * Refuses a path that leaves the package, a link, or an oversized file.
 */
export async function readInstalledHookModule(packageDir, entry) {
  const resolved = path.resolve(packageDir, entry);
  if (!resolved.startsWith(`${packageDir}${path.sep}`)) {
    throw httpError('The relay hook module lies outside its package', 400);
  }
  const st = await lstat(resolved).catch(() => null);
  if (!st || !st.isFile()) {
    throw httpError(`The relay hook module "${entry}" is not a file in the package`, 400);
  }
  if (st.size > HOOK_MODULE_MAX_BYTES) {
    throw httpError(`The relay hook module is larger than ${HOOK_MODULE_MAX_BYTES} bytes`, 400);
  }
  // The real path, again: a directory link on the way would have been followed.
  if ((await realpath(resolved)) !== resolved) {
    throw httpError('The relay hook module path goes through a link', 400);
  }
  return readFile(resolved);
}

/**
 * For a validated manifest of an installed package: the relay entry
 * module's SHA-256, or null when the plugin has no relay hooks of its own.
 */
export async function installedHookEntrySha256(packageName, manifest) {
  const set = relayHookSetOf(manifest);
  if (!set || !relayHookSetNeedsEntry(set) || set.entry === null) return null;
  const dir = await installedPackageDir(packageName);
  return hookEntrySha256(await readInstalledHookModule(dir, set.entry));
}

/**
 * Fetch `<package>@<version>` from the registry STATE_DIR is configured
 * for (`npm pack`, as the panel's user) and read its manifest and, when
 * the manifest names one, its relay hook module — in memory only.
 *
 * @param {string} packageName bare `@lamalibre/<name>`
 * @param {string} version an exact version or a dist-tag (`latest`)
 * @returns {Promise<{ version: string, manifestRaw: unknown, readHookModule: (entry: string) => Buffer | null }>}
 */
export async function readRegistryPackage(packageName, version) {
  if (!PACKAGE_RE.test(packageName)) throw httpError('Invalid package name', 400);
  if (!VERSION_RE.test(version)) throw httpError('Invalid version', 400);
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-plugin-stage-'));
  try {
    let packed;
    try {
      const { stdout } = await execa(
        'npm',
        [
          'pack',
          `${packageName}@${version}`,
          '--json',
          '--ignore-scripts',
          '--pack-destination',
          dir,
        ],
        { cwd: STATE_DIR, timeout: 120000 },
      );
      packed = JSON.parse(stdout);
    } catch (err) {
      throw httpError(
        `Could not fetch ${packageName}@${version} from the registry: ${(err.stderr || err.message || '').split('\n')[0]}`,
        502,
      );
    }
    const info = Array.isArray(packed) ? packed[0] : null;
    if (!info || typeof info.filename !== 'string' || typeof info.version !== 'string') {
      throw httpError('npm pack returned no tarball', 502);
    }
    const tgz = await readFile(path.join(dir, path.basename(info.filename)));
    const manifestFile = 'package/lamaste-plugin.json';
    const first = readTarballFiles(tgz, new Set([manifestFile]));
    const manifestBytes = first.get(manifestFile);
    if (!manifestBytes)
      throw httpError(`${packageName}@${info.version} has no lamaste-plugin.json`, 400);
    let manifestRaw;
    try {
      manifestRaw = JSON.parse(manifestBytes.toString('utf-8'));
    } catch {
      throw httpError(`${packageName}@${info.version} has an unreadable lamaste-plugin.json`, 400);
    }
    return {
      version: info.version,
      manifestRaw,
      readHookModule(entry) {
        const normalized = path.posix.normalize(entry);
        if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) return null;
        const name = `package/${normalized}`;
        return (
          readTarballFiles(tgz, new Set([name]), {
            maxArchiveBytes: 64 * 1024 * 1024,
            maxFileBytes: HOOK_MODULE_MAX_BYTES,
          }).get(name) ?? null
        );
      },
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The first line of what a failed npm call said, for an error message (npm prints no credential). */
function npmFailureLine(err) {
  try {
    const summary = JSON.parse(err.stdout ?? '')?.error?.summary;
    if (typeof summary === 'string' && summary.length > 0) return summary.split('\n')[0];
  } catch {
    // Not JSON: fall back to standard error.
  }
  return (err.stderr || err.message || '').split('\n')[0];
}

/**
 * The npm Subresource Integrity of `<package>@<version>`'s tarball, as the
 * registry STATE_DIR is configured for publishes it — `npm view … dist.integrity`
 * as the panel's user, so the registry and credential are the ones plugin
 * installs use. Only a sha512 SRI is accepted: it is what the approval
 * binds and what the agent checks the tarball it fetches against.
 *
 * @param {string} packageName bare `@lamalibre/<name>`
 * @param {string} version an exact version
 * @returns {Promise<string>} `sha512-<base64>`
 */
export async function readRegistryIntegrity(packageName, version) {
  if (!PACKAGE_RE.test(packageName)) throw httpError('Invalid package name', 400);
  if (!AgentHalfVersionSchema.safeParse(version).success) throw httpError('Invalid version', 400);
  const spec = `${packageName}@${version}`;
  let stdout;
  try {
    ({ stdout } = await execa('npm', ['view', spec, 'dist.integrity', '--json'], {
      cwd: STATE_DIR,
      timeout: 60000,
    }));
  } catch (err) {
    if (/\bE404\b/.test(`${err.stderr ?? ''}\n${err.stdout ?? ''}`)) {
      throw httpError(
        `${spec} is not published on the registry the panel installs from — the agent package is published at the plugin's version`,
        400,
      );
    }
    throw httpError(`Could not read ${spec} from the registry: ${npmFailureLine(err)}`, 502);
  }
  let integrity = null;
  const text = stdout.trim();
  if (text !== '') {
    try {
      integrity = JSON.parse(text);
    } catch {
      throw httpError(`The registry answered for ${spec} with something npm could not read`, 502);
    }
  }
  if (typeof integrity !== 'string' || integrity === '') {
    throw httpError(
      `${spec} has no integrity on the registry — Lamaste installs an agent half only when its tarball is pinned by a sha512 integrity`,
      400,
    );
  }
  if (!AGENT_HALF_INTEGRITY_RE.test(integrity)) {
    const algorithm = /^([a-z0-9]{1,16})-/.exec(integrity)?.[1] ?? null;
    throw httpError(
      algorithm !== null && algorithm !== 'sha512'
        ? `${spec} is published with a ${algorithm} integrity — Lamaste installs an agent half only when its tarball is pinned by a sha512 integrity`
        : `${spec} has a malformed integrity on the registry — Lamaste installs an agent half only when its tarball is pinned by a sha512 integrity`,
      400,
    );
  }
  return integrity;
}

/**
 * Pin the agent half a validated manifest declares for its version:
 * `{ package, version, integrity }`, the integrity read from the registry
 * ({@link readRegistryIntegrity}). Null when Lamaste installs no agent half
 * (no `agent.package`).
 *
 * @param {import('@lamalibre/lamaste').ParsedManifest} manifest
 * @returns {Promise<{ package: string, version: string, integrity: string } | null>}
 */
export async function pinAgentHalf(manifest) {
  const declaration = agentHalfOf(manifest);
  if (!declaration) return null;
  if (!AgentHalfVersionSchema.safeParse(manifest.version).success) {
    throw httpError(
      `Version ${manifest.version} cannot version an agent half (semver without build metadata)`,
      400,
    );
  }
  const integrity = await readRegistryIntegrity(declaration.package, manifest.version);
  return { package: declaration.package, version: manifest.version, integrity };
}
