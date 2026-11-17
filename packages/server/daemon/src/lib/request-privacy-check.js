/**
 * Whether nginx keeps queries out of its access log and out of Authelia on
 * this relay, and telling the administrators when it does not.
 *
 * The guarantee (core `request-privacy.ts`) has two parts the panel cannot
 * write itself: the http-level file create-lamaste installs
 * (`REQUEST_PRIVACY_FILE` — the log format and `$lamaste_request_path`),
 * and the server-level `access_log … lamaste_noquery;` in every enabled
 * vhost of the relay — the panel's, which its start-up reconcile rewrites,
 * and the installer's (the IP panel, the port-80 redirect, the 443
 * catch-all), which the redeploy refreshes. A vhost the reconcile leaves as
 * it is (state it cannot render, or one that disagrees with its state on
 * authentication), an orphan nobody re-renders, or an installer site whose
 * refresh failed keeps nginx's http-level `combined` log — queries,
 * referrers and Basic usernames included. So the panel reads, after its
 * start-up reconcile and every {@link CHECK_INTERVAL_MS}:
 *
 * - the file: `installed` (what this release renders), `missing`,
 *   `changed` or `unreadable`;
 * - every `lamalibre-lamaste-*` link in `sites-enabled`: the vhosts whose
 *   server blocks do not each carry the directive, by name.
 *
 * Anything wrong is audited (`relay.request-privacy.degraded`, with the
 * file's status and the vhosts' names) and notified to the administrators
 * (warning) when it starts, when what is wrong changes and once a day while
 * it lasts; its return is audited (`relay.request-privacy.restored`). The
 * status rides on `GET /api/system/stats` (`requestPrivacy`). Everything
 * read is world-readable (`/etc/nginx` 0755, the files 0644).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  ACCESS_LOG_DIRECTIVE,
  REQUEST_PRIVACY_FILE,
  renderRequestPrivacyConf,
} from '@lamalibre/lamaste';

import { createRelayNotice } from './relay-notice.js';

/** How often the file and the vhosts are read. */
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;

const SITES_ENABLED = '/etc/nginx/sites-enabled';
const RELAY_SITE_PREFIX = 'lamalibre-lamaste-';

/**
 * True when every server block of `text` carries the relay's access log at
 * its own level: as many `server {` lines as `access_log … lamaste_noquery;`
 * lines (comment lines aside) — how every generator writes them.
 *
 * @param {string} text
 */
export function logsWithoutQueries(text) {
  let servers = 0;
  let directives = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) continue;
    if (/^server\s*\{$/.test(line)) servers += 1;
    else if (line === ACCESS_LOG_DIRECTIVE) directives += 1;
  }
  return servers > 0 && directives === servers;
}

/**
 * Read the file and the enabled vhosts.
 *
 * @param {{ file?: string, sitesEnabled?: string }} [paths]
 * @returns {Promise<{ file: 'installed' | 'missing' | 'changed' | 'unreadable', vhosts: string[] }>}
 *   `vhosts`: the enabled vhosts of the relay that log queries (a name with
 *   ` (unreadable)` when it could not be read, `sites-enabled (unreadable)`
 *   when the directory could not be listed)
 */
export async function readRequestPrivacy({
  file = REQUEST_PRIVACY_FILE,
  sitesEnabled = SITES_ENABLED,
} = {}) {
  let fileStatus;
  try {
    fileStatus =
      (await readFile(file, 'utf8')) === renderRequestPrivacyConf() ? 'installed' : 'changed';
  } catch (err) {
    fileStatus = err?.code === 'ENOENT' ? 'missing' : 'unreadable';
  }

  let names;
  try {
    names = (await readdir(sitesEnabled))
      .filter((name) => name.startsWith(RELAY_SITE_PREFIX) && !name.endsWith('.bak'))
      .sort();
  } catch {
    return { file: fileStatus, vhosts: ['sites-enabled (unreadable)'] };
  }
  const vhosts = [];
  for (const name of names) {
    try {
      if (!logsWithoutQueries(await readFile(path.join(sitesEnabled, name), 'utf8'))) {
        vhosts.push(name);
      }
    } catch {
      vhosts.push(`${name} (unreadable)`);
    }
  }
  return { file: fileStatus, vhosts };
}

/** What a file not as this release writes it means — each case its own words. */
const FILE_WHY = {
  missing:
    'is missing: nginx refuses every vhost that names its log format or variable, so creating or changing a tunnel or site fails and the panel keeps the vhosts it had.',
  changed:
    'differs from what this release writes (edited by hand, or left by another release): what nginx logs and tells Authelia about a request is whatever it now says, not the path without its query.',
  unreadable: 'could not be read by the panel, so it cannot tell what nginx logs.',
};

const notice = createRelayNotice({
  okStatus: 'in-place',
  missingAction: 'relay.request-privacy.degraded',
  restoredAction: 'relay.request-privacy.restored',
  logMessage: 'nginx may log query strings or tell Authelia about them',
  level: 'warning',
  message: (_status, { file, vhosts }) => {
    const parts = [];
    if (file !== 'installed') {
      parts.push(`${REQUEST_PRIVACY_FILE} ${FILE_WHY[file]}`);
    }
    if (vhosts.length > 0) {
      parts.push(
        `These enabled vhosts lack the relay's access log and keep nginx's combined log, query strings and referrers included: ${vhosts.join(', ')}.`,
      );
    }
    parts.push(
      "Run the Panel Update to reinstall the installer's files and sites; the panel's start rewrites its own vhosts, and its log names any it leaves as they are.",
    );
    return parts.join(' ');
  },
});

/**
 * Check once: remember the status, audit and notify as the module says.
 * Never throws.
 *
 * @param {import('pino').Logger} [logger]
 * @param {{ file?: string, sitesEnabled?: string, now?: number }} [options]
 * @returns {Promise<'in-place' | 'degraded'>}
 */
export async function checkRequestPrivacy(logger, options = {}) {
  const read = await readRequestPrivacy(options);
  const status = read.file === 'installed' && read.vhosts.length === 0 ? 'in-place' : 'degraded';
  await notice.record(status, status === 'in-place' ? {} : read, logger, options.now ?? Date.now());
  return status;
}

/**
 * What `GET /api/system/stats` carries: the last status and when it was
 * read — never what was wrong. That route admits agent certificates with
 * `system:read` (every user-access enrolment holds it), and vhost names are
 * the relay's hostnames: administrators get them in the notification and
 * the audit log.
 */
export function requestPrivacyStatus() {
  const { status, checkedAt } = notice.current();
  return { status, checkedAt };
}

let timer = null;
let running = null;

/** One check at a time: a slow read is never overlapped by the next tick. */
function checkOnce(logger) {
  if (!running) {
    running = checkRequestPrivacy(logger).finally(() => {
      running = null;
    });
  }
  return running;
}

/** Check now and every {@link CHECK_INTERVAL_MS}. Idempotent. */
export function startRequestPrivacyCheck(logger) {
  if (timer) return;
  void checkOnce(logger);
  timer = setInterval(() => void checkOnce(logger), CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopRequestPrivacyCheck() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Forget what was checked and notified (tests). */
export function resetRequestPrivacyCheck() {
  stopRequestPrivacyCheck();
  notice.reset();
}
