/**
 * Whether the relay's port-443 catch-all is in place (4.14.1), and telling
 * the administrators when it is not.
 *
 * create-lamaste installs `lamalibre-lamaste-https-default` (core
 * `renderHttpsCatchAllVhost`) so that a hostname no site serves is refused
 * at the TLS handshake. The installer skips it when another nginx site
 * already owns port 443's default server, and then nginx answers such a
 * name with that site — or, should the other site go, with the relay's
 * first 443 vhost again: its certificate and its sign-in redirect. A relay
 * must never stay in that state silently, so the panel reads the enabled
 * site at start and every {@link CHECK_INTERVAL_MS}:
 *
 * - `installed` — the site is enabled and is what this release renders;
 * - `missing` — not enabled;
 * - `changed` — enabled with other content (edited by hand, or left by
 *   another release);
 * - `unreadable` — it could not be read.
 *
 * Anything but `installed` is audited (`relay.https-catch-all.missing`, the
 * status) and notified to the administrators (critical) when it starts and
 * again every {@link REMIND_INTERVAL_MS} while it lasts; a return to
 * `installed` is audited (`relay.https-catch-all.restored`). The status
 * rides on `GET /api/system/stats` (`httpsCatchAll`), which the Dashboard
 * shows. The site is world-readable (`/etc/nginx` 0755, the file 0644):
 * the panel reads, never writes it.
 */

import { readFile } from 'node:fs/promises';

import {
  HTTPS_CATCH_ALL_ENABLED_PATH,
  HTTPS_CATCH_ALL_SITE,
  renderHttpsCatchAllVhost,
} from '@lamalibre/lamaste';

import { listAudit, recordAuditBestEffort } from './audit.js';
import { notifyAdminsBestEffort } from './notifications.js';

/** How often the site is read. */
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;

/** How often the administrators are told again while it is not in place. */
export const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** @typedef {'installed' | 'missing' | 'changed' | 'unreadable'} CatchAllStatus */

/** @type {{ status: CatchAllStatus | null, checkedAt: string | null }} */
let current = { status: null, checkedAt: null };
let notifiedAt = 0;
let timer = null;

/**
 * Read the enabled site.
 *
 * @param {string} [enabledPath]
 * @returns {Promise<CatchAllStatus>}
 */
export async function readHttpsCatchAll(enabledPath = HTTPS_CATCH_ALL_ENABLED_PATH) {
  try {
    const text = await readFile(enabledPath, 'utf8');
    return text === renderHttpsCatchAllVhost() ? 'installed' : 'changed';
  } catch (err) {
    return err?.code === 'ENOENT' ? 'missing' : 'unreadable';
  }
}

const WHY = {
  missing: 'is not enabled',
  changed: 'is enabled with other content than this release writes',
  unreadable: 'could not be read',
};

/**
 * Whether the catch-all was last recorded as not in place: known in memory
 * after a check, otherwise (the first check since a start — a Panel Update
 * restarts the panel) from the audit log, so its return is audited however
 * it came back.
 */
async function lastAuditedMissing(before, logger) {
  if (before !== null) return true;
  try {
    const [missing] = await listAudit({ action: 'relay.https-catch-all.missing', limit: 1 });
    if (!missing) return false;
    const [restored] = await listAudit({ action: 'relay.https-catch-all.restored', limit: 1 });
    return !restored || restored.id < missing.id;
  } catch (err) {
    logger?.warn({ err: err?.message }, 'Could not read the audit log');
    return false;
  }
}

/**
 * Check once: remember the status, audit and notify as the module says.
 * Never throws.
 *
 * @param {import('pino').Logger} [logger]
 * @param {{ enabledPath?: string, now?: number }} [options]
 * @returns {Promise<CatchAllStatus>}
 */
export async function checkHttpsCatchAll(logger, options = {}) {
  const now = options.now ?? Date.now();
  const status = await readHttpsCatchAll(options.enabledPath);
  const before = current.status;
  current = { status, checkedAt: new Date(now).toISOString() };
  if (status === 'installed') {
    notifiedAt = 0;
    if (before !== 'installed' && (await lastAuditedMissing(before, logger))) {
      await recordAuditBestEffort(
        {
          actor: 'lamaste',
          action: 'relay.https-catch-all.restored',
          details: { before: before ?? 'missing' },
        },
        logger,
      );
    }
    return status;
  }
  const started = before !== status;
  if (!started && now - notifiedAt < REMIND_INTERVAL_MS) return status;
  notifiedAt = now;
  logger?.warn(
    { status, site: HTTPS_CATCH_ALL_SITE },
    "The relay's HTTPS catch-all is not in place",
  );
  await recordAuditBestEffort(
    { actor: 'lamaste', action: 'relay.https-catch-all.missing', details: { status } },
    logger,
  );
  await notifyAdminsBestEffort(
    {
      source: 'lamaste',
      level: 'critical',
      message:
        `The relay's HTTPS catch-all (/etc/nginx/sites-enabled/${HTTPS_CATCH_ALL_SITE}) ${WHY[status]}: ` +
        "a hostname no site serves — a typo under a wildcard DNS record — gets another site's certificate and sign-in redirect. " +
        "Another nginx site may own port 443's default server (find it with `grep -rn default_server /etc/nginx/sites-enabled/`); " +
        'remove that, then run the Panel Update to install the catch-all.',
    },
    logger,
  );
  return status;
}

/** What `GET /api/system/stats` carries: the last status and when it was read (null before the first check). */
export function httpsCatchAllStatus() {
  return { ...current };
}

/** Check at start and every {@link CHECK_INTERVAL_MS}. Idempotent. */
export function startHttpsCatchAllCheck(logger) {
  if (timer) return;
  void checkHttpsCatchAll(logger);
  timer = setInterval(() => void checkHttpsCatchAll(logger), CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopHttpsCatchAllCheck() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Forget what was checked and notified (tests). */
export function resetHttpsCatchAllCheck() {
  stopHttpsCatchAllCheck();
  current = { status: null, checkedAt: null };
  notifiedAt = 0;
}
