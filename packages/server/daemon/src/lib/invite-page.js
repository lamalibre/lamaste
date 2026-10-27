/**
 * The stock invitation page — `/var/www/lamaste/invite/index.html`, what
 * `auth.<domain>/invite/<token>` serves for a domain without a brand (a
 * branded domain's page is in its rendering, `invite/index.html` under
 * `/var/www/lamaste/auth/<domain>/`, which the auth vhost tries first).
 * The HTML is core's (`renderInvitePage(null)` of `@lamalibre/lamaste/server`),
 * so a change to the page reaches every relay: written at provisioning and
 * at every start once onboarding is complete, compared first — an identical
 * file is left alone, and only a write is logged.
 *
 * The web root belongs to the lamaste user (group www-data, setgid
 * directories), so no privileges are needed; the file is 0640 and nginx
 * reads it via the group.
 */

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import { renderInvitePage } from '@lamalibre/lamaste/server';

/** Where the stock page lives: the auth vhost's `@invite` fallback root. */
export const INVITE_DIR = '/var/www/lamaste/invite';
const INVITE_FILE = 'index.html';

/**
 * The installed page, or null when there is none (or it is not a regular
 * file — a link there is never followed, and is replaced).
 *
 * @param {string} file
 * @returns {Promise<string | null>}
 */
async function readInstalled(file) {
  let fh;
  try {
    fh = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch {
    return null;
  }
  try {
    if (!(await fh.stat()).isFile()) return null;
    return await fh.readFile('utf-8');
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * Write the stock invitation page unless the installed one is already it.
 * A write goes through a temporary file beside it (exclusive, 0640,
 * fsynced) and one rename: nginx serves the old page or the new one.
 *
 * @param {{ dir?: string, logger?: { info: (obj: object, msg: string) => void } }} [opts]
 * @returns {Promise<{ written: boolean }>}
 */
export async function writeInvitePage({ dir = INVITE_DIR, logger } = {}) {
  const html = renderInvitePage(null);
  const dest = path.join(dir, INVITE_FILE);
  if ((await readInstalled(dest)) === html) return { written: false };

  await mkdir(dir, { recursive: true, mode: 0o750 });
  const tmp = path.join(dir, `.index-${crypto.randomBytes(8).toString('hex')}.html`);
  try {
    const fh = await open(tmp, 'wx', 0o640);
    try {
      await fh.writeFile(html, 'utf-8');
      await fh.chmod(0o640);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  logger?.info({ file: dest }, 'Stock invitation page written');
  return { written: true };
}
