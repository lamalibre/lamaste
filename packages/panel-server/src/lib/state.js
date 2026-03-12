import { readFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';

const STATE_DIR = process.env.PORTLAMA_STATE_DIR || '/etc/portlama';

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
}

function invitationsPath() {
  return path.join(STATE_DIR, 'invitations.json');
}

/**
 * Read the invitations array from invitations.json.
 * Returns an empty array if the file does not exist.
 */
export async function readInvitations() {
  try {
    const raw = await readFile(invitationsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read invitations state: ${err.message}`);
  }
}

/**
 * Write the invitations array to invitations.json atomically.
 *
 * 1. Write to a temp file in the same directory.
 * 2. fsync the temp file.
 * 3. Rename temp → invitations.json (atomic on POSIX).
 */
export async function writeInvitations(invitations) {
  const filePath = invitationsPath();
  const tmpPath = `${filePath}.tmp`;

  const content = JSON.stringify(invitations, null, 2) + '\n';
  await writeFile(tmpPath, content, { encoding: 'utf-8', mode: 0o600 });

  const fd = await open(tmpPath, 'r');
  await fd.sync();
  await fd.close();

  await rename(tmpPath, filePath);
}
