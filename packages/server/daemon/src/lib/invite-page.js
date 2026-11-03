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

import {
  UNAVAILABLE_PAGE_STOCK_DIR,
  renderInvitationsPage,
  renderInvitePage,
  renderUnavailablePage,
} from '@lamalibre/lamaste/server';

/** Where the stock page lives: the auth vhost's `@invite` fallback root. */
export const INVITE_DIR = '/var/www/lamaste/invite';
/**
 * Where the stock inviter's page of delegated invitations lives — what
 * `auth.<domain>/invitations/<route>` serves for a domain without a brand
 * (the auth vhost's `@invitations` fallback root), written the same way.
 */
export const INVITATIONS_DIR = '/var/www/lamaste/invitations';
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
 * Write `html` as `<dir>/index.html` unless the installed file is already
 * it. A write goes through a temporary file beside it (exclusive, 0640,
 * fsynced) and one rename: nginx serves the old page or the new one.
 */
async function writeStockPage(html, dir, what, logger) {
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
  logger?.info({ file: dest }, `${what} written`);
  return { written: true };
}

/**
 * Write the stock invitation page unless the installed one is already it.
 *
 * @param {{ dir?: string, logger?: { info: (obj: object, msg: string) => void } }} [opts]
 * @returns {Promise<{ written: boolean }>}
 */
export function writeInvitePage({ dir = INVITE_DIR, logger } = {}) {
  return writeStockPage(renderInvitePage(null), dir, 'Stock invitation page', logger);
}

/**
 * Write the stock inviter's page unless the installed one is already it.
 *
 * @param {{ dir?: string, logger?: { info: (obj: object, msg: string) => void } }} [opts]
 * @returns {Promise<{ written: boolean }>}
 */
export function writeInvitationsPage({ dir = INVITATIONS_DIR, logger } = {}) {
  return writeStockPage(renderInvitationsPage(null), dir, 'Stock inviter page', logger);
}

/**
 * Write the stock "not available" page of plugin sites unless the installed
 * one is already it — what a not-served web surface on a domain without a
 * rendering answers its 503 with (packages/core/docs/page-language-design.md
 * §2, P8): English, no brand.
 *
 * @param {{ dir?: string, logger?: { info: (obj: object, msg: string) => void } }} [opts]
 * @returns {Promise<{ written: boolean }>}
 */
export function writeUnavailablePage({ dir = UNAVAILABLE_PAGE_STOCK_DIR, logger } = {}) {
  return writeStockPage(
    renderUnavailablePage({ brand: null, language: 'en', domain: null }),
    dir,
    'Stock "not available" page',
    logger,
  );
}
