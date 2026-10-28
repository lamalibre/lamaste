import { readFile, writeFile, rename, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { PromiseChainMutex } from '@lamalibre/lamaste';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

function tunnelsPath() {
  return path.join(STATE_DIR, 'tunnels.json');
}

/**
 * Read the tunnels array from tunnels.json.
 * Returns an empty array if the file does not exist.
 */
export async function readTunnels() {
  try {
    const raw = await readFile(tunnelsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read tunnels state: ${err.message}`);
  }
}

/**
 * Write the tunnels array to tunnels.json atomically.
 *
 * 1. Write to a temp file in the same directory.
 * 2. fsync the temp file.
 * 3. Rename temp → tunnels.json (atomic on POSIX).
 */
export async function writeTunnels(tunnels) {
  const filePath = tunnelsPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(tunnels, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  // fsync the temp file to ensure data is flushed to disk
  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
  await hostsChanged();
}

/**
 * A tunnel or a site changed: the hosts that name external members are
 * rendered again shortly (lib/domains.js `scheduleHostRender`).
 */
async function hostsChanged() {
  const { scheduleHostRender } = await import('./domains.js');
  scheduleHostRender();
}

function sitesPath() {
  return path.join(STATE_DIR, 'sites.json');
}

/**
 * Read the sites array from sites.json.
 * Returns an empty array if the file does not exist.
 */
export async function readSites() {
  try {
    const raw = await readFile(sitesPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read sites state: ${err.message}`);
  }
}

/**
 * Write the sites array to sites.json atomically.
 *
 * 1. Write to a temp file in the same directory.
 * 2. fsync the temp file.
 * 3. Rename temp → sites.json (atomic on POSIX).
 */
export async function writeSites(sites) {
  const filePath = sitesPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(sites, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
  await hostsChanged();
}

/** Serializes every read-modify-write of sites.json in this process. */
const sitesMutex = new PromiseChainMutex();

/**
 * Run `fn` holding the sites lock: a read of sites.json, the decisions made
 * on it and the write that follows must not interleave with another. A
 * workflow that gives a site a hostname (creating it, adding an alias,
 * taking a tunnel's host) takes core's tunnel lock first, then this one —
 * always in that order — so a site and a tunnel never take one name at once.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withSitesLock(fn) {
  return sitesMutex.run(fn);
}

function invitationsPath() {
  return path.join(STATE_DIR, 'invitations.json');
}

/**
 * The invitations 4.8 kept in invitations.json — read once more by the
 * import into state.db (lib/invitations.js), which then deletes the file.
 * Null when there is no file; a file that is not an array reads as none.
 *
 * @returns {Promise<unknown[] | null>}
 */
export async function readLegacyInvitations() {
  let raw;
  try {
    raw = await readFile(invitationsPath(), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`Failed to read invitations.json: ${err.message}`);
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Delete invitations.json (its rows are in state.db); absent is fine. */
export async function removeLegacyInvitations() {
  await rm(invitationsPath(), { force: true });
}
