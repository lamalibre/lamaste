/**
 * Per-agent chisel credential storage.
 *
 * The chisel tunnel server requires per-agent authentication. Each agent
 * receives a unique credential from the panel during enrollment (and on
 * demand via `lamaste-agent chisel refresh-credential`). The credential
 * is stored at:
 *
 *     ~/.lamalibre/lamaste/agents/<label>/chisel.json   (mode 0600)
 *
 * Format:
 *
 *     {
 *       "user": "agent-<label>",
 *       "password": "<hex>",
 *       "fetchedAt": "2026-04-17T12:34:56.000Z"
 *     }
 *
 * The credential is later passed to `chisel client` via
 * `--auth <user>:<password>` when the per-agent service config is generated.
 */

import { mkdir, readFile, writeFile, rename, open } from 'node:fs/promises';
import path from 'node:path';
import { agentDataDir } from '@lamalibre/lamaste/agent';

/**
 * Path to the per-agent chisel credential file.
 * @param {string} label
 * @returns {string}
 */
export function chiselCredentialPath(label) {
  return path.join(agentDataDir(label), 'chisel.json');
}

/**
 * Load a persisted chisel credential. Returns null if not stored yet.
 *
 * @param {string} label
 * @returns {Promise<{ user: string, password: string, fetchedAt?: string } | null>}
 */
export async function loadChiselCredential(label) {
  try {
    const raw = await readFile(chiselCredentialPath(label), 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.user !== 'string' ||
      typeof parsed.password !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Atomically save a chisel credential (temp -> fsync -> rename, mode 0600).
 *
 * @param {string} label
 * @param {{ user: string, password: string }} credential
 */
export async function saveChiselCredential(label, credential) {
  if (
    !credential ||
    typeof credential.user !== 'string' ||
    typeof credential.password !== 'string'
  ) {
    throw new Error('saveChiselCredential: credential must have string user and password');
  }
  const dir = agentDataDir(label);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = chiselCredentialPath(label);
  const tmp = filePath + '.tmp';
  const payload = {
    user: credential.user,
    password: credential.password,
    fetchedAt: new Date().toISOString(),
  };
  await writeFile(tmp, JSON.stringify(payload, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: 0o600,
  });
  const fd = await open(tmp, 'r');
  await fd.sync();
  await fd.close();
  await rename(tmp, filePath);
}
