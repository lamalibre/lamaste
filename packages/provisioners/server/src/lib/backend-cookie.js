import { execa } from 'execa';
import { constants } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { BACKEND_COOKIE_MAP_FILE, renderBackendCookieMap } from '@lamalibre/lamaste';
import { writeFileNoFollow } from './ownership.js';

/**
 * The http-level nginx map that keeps Authelia's session cookie from every
 * tunnel and agent backend (core `renderBackendCookieMap`: the cookie name
 * Authelia is configured with, stripped pair by pair, no `Cookie` header at
 * all when one is left). Every vhost the panel renders for a tunnel or an
 * agent panel sets `Cookie` from its variable, so nginx refuses those vhosts
 * (`nginx -t`) while the map is missing: it is installed before the panel
 * first writes one — on a fresh install with nginx's own configuration, on
 * a redeploy before the panel restarts and re-renders the vhosts it finds.
 */

const OWNER = Object.freeze({ mode: 0o644, uid: 0, gid: 0 });

/** The installed map's text, or null when there is none; never through a symlink. */
async function readInstalled() {
  let fh;
  try {
    fh = await open(BACKEND_COOKIE_MAP_FILE, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return await fh.readFile('utf8');
  } finally {
    await fh.close();
  }
}

/**
 * Install or refresh the map as {@link BACKEND_COOKIE_MAP_FILE} — root-owned
 * 0644, written atomically and never through a symlink — then test nginx
 * and reload it. Idempotent. On a failed `nginx -t` the previous file (or
 * its absence) is restored and the error thrown: without the map no tunnel
 * vhost can be written, so the caller stops. Run as root.
 *
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export async function ensureBackendCookieMap({ reload = true } = {}) {
  const content = renderBackendCookieMap();
  const previous = await readInstalled();
  if (previous === content) return { changed: false };

  await mkdir(path.dirname(BACKEND_COOKIE_MAP_FILE), { recursive: true, mode: 0o755 });
  await writeFileNoFollow(BACKEND_COOKIE_MAP_FILE, content, OWNER);
  try {
    await execa('nginx', ['-t']);
  } catch (err) {
    if (previous === null) await rm(BACKEND_COOKIE_MAP_FILE, { force: true });
    else await writeFileNoFollow(BACKEND_COOKIE_MAP_FILE, previous, OWNER);
    throw new Error(
      `nginx rejected the map that keeps Authelia's session cookie from tunnel backends; left as it was:\n${err.stderr || err.message}`,
    );
  }
  if (reload) await execa('systemctl', ['reload', 'nginx']);
  return { changed: true };
}
