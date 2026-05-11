/**
 * Per-user agentd authentication token.
 *
 * The agent panel HTTP daemon listens on `127.0.0.1:9393`. On a multi-user
 * machine any local OS user can reach that port, so binding to loopback is
 * not — by itself — an authentication mechanism. The previous implementation
 * shortcut authentication for any request whose `Origin` header matched a
 * localhost regex; this was forgeable by any local process via curl, which
 * could then impersonate the agent.
 *
 * To close that hole the desktop client (and any other process running as the
 * agent's owning user) authenticates to the daemon with a shared bearer token
 * stored at:
 *
 *     ~/.lamalibre/lamaste/agentd.token   (mode 0600, file)
 *     ~/.lamalibre/lamaste/               (mode 0700, parent dir)
 *
 * The file contains a JSON object so the format can grow:
 *
 *     { "token": "<64 hex chars>", "createdAt": "2026-04-17T12:34:56.000Z" }
 *
 * Filesystem permissions are the trust boundary — only the agent's owning
 * user can read the token, so only that user can authenticate to the daemon
 * over loopback. The daemon never logs the token value, only the file path.
 *
 * The token is shared across all agent labels owned by the same OS user
 * (a single `lamaste-agentd` process serves a single label, but the same
 * user may run several daemons; one token authenticates the user, and the
 * daemon attributes the call to its own `--label`).
 */

import { mkdir, readFile, rename, open, chmod } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { LAMASTE_DIR } from '@lamalibre/lamaste/agent';

/** Absolute path to the agentd token file. */
export function agentdTokenPath() {
  return path.join(LAMASTE_DIR, 'agentd.token');
}

/**
 * Load the persisted agentd token, or generate and persist a new one if the
 * file does not exist. The file (and its parent directory) is created with
 * restrictive permissions on first run.
 *
 * Returns the bare token string (hex). Never logs the value.
 *
 * @returns {Promise<string>}
 */
export async function loadOrCreateAgentdToken() {
  const filePath = agentdTokenPath();
  const dir = path.dirname(filePath);

  // Ensure parent dir exists with restrictive permissions. mkdir() does not
  // tighten an existing directory's mode, so apply 0o700 explicitly afterwards
  // (best-effort — chmod can fail on shared dirs but the file mode is the
  // hard guarantee).
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await chmod(dir, 0o700);
  } catch {
    // ignore — file mode 0o600 below is the load-bearing protection
  }

  // Try to read an existing token.
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.token === 'string'
      && /^[0-9a-f]{64,}$/i.test(parsed.token)) {
      return parsed.token;
    }
    // File exists but is malformed — fall through and rewrite.
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }

  // Generate a fresh 256-bit token and write it atomically with mode 0600.
  const token = randomBytes(32).toString('hex');
  const payload = JSON.stringify({
    token,
    createdAt: new Date().toISOString(),
  }, null, 2) + '\n';

  const tmp = filePath + '.tmp';
  // O_EXCL ensures we don't overwrite a concurrent write or race a symlink.
  // If a stale .tmp exists from a previous crash, retry once after unlinking.
  let handle;
  try {
    handle = await open(tmp, 'wx', 0o600);
  } catch (err) {
    if (err && err.code === 'EEXIST') {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmp).catch(() => {});
      handle = await open(tmp, 'wx', 0o600);
    } else {
      throw err;
    }
  }
  try {
    await handle.writeFile(payload, 'utf-8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmp, filePath);
  // Belt-and-braces: ensure the final file is 0o600 even if rename inherited
  // a more permissive umask under exotic mounts.
  try {
    await chmod(filePath, 0o600);
  } catch {
    // best-effort
  }

  return token;
}

/**
 * Constant-time comparison of a presented token against the canonical token.
 * Returns false on any error, mismatched length, or value mismatch.
 *
 * @param {string | undefined | null} presented
 * @param {string} canonical
 * @returns {boolean}
 */
export function verifyAgentdToken(presented, canonical) {
  if (typeof presented !== 'string' || typeof canonical !== 'string') return false;
  if (presented.length !== canonical.length) return false;
  // Equal-length Buffers required by timingSafeEqual.
  const a = Buffer.from(presented, 'utf-8');
  const b = Buffer.from(canonical, 'utf-8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Extract the token portion of an `Authorization: Bearer <token>` header.
 *
 * @param {string | string[] | undefined} header
 * @returns {string | null}
 */
export function extractBearerToken(header) {
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return null;
  const match = value.match(/^Bearer\s+([A-Za-z0-9._-]+)\s*$/);
  return match ? match[1] : null;
}
