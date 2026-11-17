import { execa } from 'execa';
import { constants } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { writeFileNoFollow } from './ownership.js';

/**
 * The installer's http-level nginx files in `/etc/nginx/conf.d/` — included
 * by nginx's own `nginx.conf` before `sites-enabled`, so what they define
 * (maps, a log format) exists when a vhost names it. A vhost naming one
 * without its file fails `nginx -t`: each is installed before the panel
 * writes such a vhost.
 */

const OWNER = Object.freeze({ mode: 0o644, uid: 0, gid: 0 });

/** The installed file's text, or null when there is none; never through a symlink. */
async function readInstalled(file) {
  let fh;
  try {
    fh = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
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
 * Install or refresh one http-level file — root-owned 0644, written
 * atomically and never through a symlink — then test nginx and reload it.
 * Idempotent. On a failed `nginx -t` the previous file (or its absence) is
 * restored and the error thrown: the vhosts that need the file cannot be
 * written without it, so the caller stops. Run as root.
 *
 * @param {{ file: string, content: string, what: string, reload?: boolean }} spec
 *   `what` names the file in the error ("the map that …")
 * @returns {Promise<{ changed: boolean }>}
 */
export async function ensureHttpConf({ file, content, what, reload = true }) {
  const previous = await readInstalled(file);
  if (previous === content) return { changed: false };

  await mkdir(path.dirname(file), { recursive: true, mode: 0o755 });
  await writeFileNoFollow(file, content, OWNER);
  try {
    await execa('nginx', ['-t']);
  } catch (err) {
    if (previous === null) await rm(file, { force: true });
    else await writeFileNoFollow(file, previous, OWNER);
    throw new Error(`nginx rejected ${what}; left as it was:\n${err.stderr || err.message}`);
  }
  if (reload) await execa('systemctl', ['reload', 'nginx']);
  return { changed: true };
}
