/**
 * The panel tells the administrators when nginx may log query strings or
 * tell Authelia about them (lib/request-privacy-check.js): the installer's
 * http-level file missing or changed, or an enabled vhost of the relay
 * without the relay's access log — named — is audited and notified when it
 * starts, when what is wrong changes and once a day while it lasts; its
 * return is audited; `requestPrivacyStatus()` (on `GET /api/system/stats`)
 * says which.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ACCESS_LOG_DIRECTIVE,
  renderHttpsCatchAllVhost,
  renderRequestPrivacyConf,
} from '@lamalibre/lamaste';

let stateDir;
let file;
let sitesAvailable;
let sitesEnabled;
let lib;
let nginx;

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-request-privacy-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  file = path.join(stateDir, 'lamalibre-lamaste-request-privacy.conf');
  sitesAvailable = path.join(stateDir, 'sites-available');
  sitesEnabled = path.join(stateDir, 'sites-enabled');
  lib = {
    ...(await import('../src/lib/request-privacy-check.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/notifications.js')),
  };
  nginx = await import('../src/lib/nginx.js');
});

after(async () => {
  lib.resetRequestPrivacyCheck();
  await rm(stateDir, { recursive: true, force: true });
});

beforeEach(async () => {
  lib.resetRequestPrivacyCheck();
  await rm(sitesAvailable, { recursive: true, force: true });
  await rm(sitesEnabled, { recursive: true, force: true });
  await mkdir(sitesAvailable);
  await mkdir(sitesEnabled);
  await writeFile(file, renderRequestPrivacyConf());
  await lib.markNotificationsRead({ all: true });
});

/** Install and link a site, as nginx sees it. */
async function enable(name, text) {
  await writeFile(path.join(sitesAvailable, name), text);
  await symlink(path.join(sitesAvailable, name), path.join(sitesEnabled, name));
}

const withoutAccessLog = (text) => text.replaceAll(`\n    ${ACCESS_LOG_DIRECTIVE}`, '');
const paths = () => ({ file, sitesEnabled });

async function raised() {
  const { notifications } = await lib.listNotifications({ unreadOnly: true, limit: 50 });
  return notifications.filter((n) => n.message.includes('Panel Update to reinstall'));
}

const DAY = 24 * 60 * 60 * 1000;

/** What the last audit of a degraded guarantee recorded. */
async function lastDegraded() {
  const [entry] = await lib.listAudit({ action: 'relay.request-privacy.degraded', limit: 1 });
  return entry?.details;
}

test('a vhost logs without queries when each of its server blocks carries the directive', () => {
  const site = nginx.renderStaticSiteVhost(
    {
      id: '3f1d2c3a-1b2c-4d5e-8f90-123456789abc',
      fqdn: 'www.example.com',
      rootPath: '/var/www/lamaste/3f1d2c3a-1b2c-4d5e-8f90-123456789abc/',
      aliases: ['example.com'],
    },
    '/etc/letsencrypt/live/www.example.com',
    'example.com',
  ).config;
  assert.equal(lib.logsWithoutQueries(site), true);
  // Its alias block without it: one server block of two logs queries.
  const index = site.lastIndexOf(ACCESS_LOG_DIRECTIVE);
  assert.equal(
    lib.logsWithoutQueries(site.slice(0, index) + site.slice(index + ACCESS_LOG_DIRECTIVE.length)),
    false,
  );
  assert.equal(lib.logsWithoutQueries(withoutAccessLog(site)), false);
  assert.equal(lib.logsWithoutQueries(`# ${ACCESS_LOG_DIRECTIVE}\n`), false, 'no server block');
});

test('in place: nothing raised', async () => {
  await enable('lamalibre-lamaste-https-default', renderHttpsCatchAllVhost());
  await enable('lamalibre-lamaste-panel-domain', nginx.renderPanelVhost('example.com').config);
  // Another site of the machine is not the relay's to judge.
  await enable('default', 'server {\n    listen 80;\n}\n');
  assert.equal(await lib.checkRequestPrivacy(undefined, paths()), 'in-place');
  assert.equal(lib.requestPrivacyStatus().status, 'in-place');
  assert.deepEqual(await raised(), []);
});

test('vhosts that log queries are named; audited and notified once, again when the set changes, restored audited', async () => {
  const t0 = Date.parse('2026-11-20T00:00:00Z');
  const before = (await lib.listAudit({ action: 'relay.request-privacy.degraded', limit: 50 }))
    .length;
  await enable(
    'lamalibre-lamaste-app-old.example.com',
    withoutAccessLog(
      nginx.renderTunnelVhost('restricted', 'old.example.com', 'example.com', 9400).config,
    ),
  );
  await enable('lamalibre-lamaste-https-default', renderHttpsCatchAllVhost());
  assert.equal(await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 }), 'degraded');
  const details = await lastDegraded();
  assert.equal(details.file, 'installed');
  assert.deepEqual(details.vhosts, ['lamalibre-lamaste-app-old.example.com']);
  // The stats route (open to agent certificates with system:read) gets the
  // status alone — never the vhosts, which name the relay's hostnames.
  assert.deepEqual(Object.keys(lib.requestPrivacyStatus()).sort(), ['checkedAt', 'status']);
  assert.equal(lib.requestPrivacyStatus().status, 'degraded');
  let notes = await raised();
  assert.equal(notes.length, 1);
  assert.equal(notes[0].level, 'warning');
  assert.match(notes[0].message, /lamalibre-lamaste-app-old\.example\.com/);
  assert.match(notes[0].message, /combined log, query strings and referrers included/);
  const audited = await lib.listAudit({ action: 'relay.request-privacy.degraded', limit: 50 });
  assert.equal(audited.length, before + 1);
  assert.deepEqual(audited[0].details.vhosts, ['lamalibre-lamaste-app-old.example.com']);

  // Within the day, the same: nothing more. Another vhost: told at once.
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + 1000 });
  assert.equal((await raised()).length, 1);
  await enable('lamalibre-lamaste-http-redirect', 'server {\n    listen 80 default_server;\n}\n');
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + 2000 });
  notes = await raised();
  assert.equal(notes.length, 2);
  assert.match(notes[0].message + notes[1].message, /lamalibre-lamaste-http-redirect/);
  // A day later, unchanged: told again.
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + 2000 + DAY });
  assert.equal((await raised()).length, 3);

  // Rewritten: the return is audited.
  await rm(path.join(sitesEnabled, 'lamalibre-lamaste-app-old.example.com'));
  await rm(path.join(sitesEnabled, 'lamalibre-lamaste-http-redirect'));
  const restored = (await lib.listAudit({ action: 'relay.request-privacy.restored', limit: 50 }))
    .length;
  assert.equal(
    await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + 3000 + DAY }),
    'in-place',
  );
  assert.equal(
    (await lib.listAudit({ action: 'relay.request-privacy.restored', limit: 50 })).length,
    restored + 1,
  );
});

test("the installer's file missing or changed is raised", async () => {
  await rm(file);
  assert.equal(await lib.checkRequestPrivacy(undefined, paths()), 'degraded');
  assert.equal((await lastDegraded()).file, 'missing');
  assert.match((await raised())[0].message, /request-privacy\.conf is missing: nginx refuses/);

  lib.resetRequestPrivacyCheck();
  await writeFile(file, renderRequestPrivacyConf().replace('"-"', '"$http_referer"'));
  assert.equal(await lib.checkRequestPrivacy(undefined, paths()), 'degraded');
  assert.equal((await lastDegraded()).file, 'changed');
  const changed = (await raised()).find((n) => n.message.includes('differs from'));
  assert.match(changed.message, /edited by hand, or left by another release/);
  assert.doesNotMatch(changed.message, /nginx refuses/);
});

test('a dangling link is named as unreadable', async () => {
  await symlink(
    path.join(sitesAvailable, 'lamalibre-lamaste-gone'),
    path.join(sitesEnabled, 'lamalibre-lamaste-gone'),
  );
  assert.equal(await lib.checkRequestPrivacy(undefined, paths()), 'degraded');
  assert.deepEqual((await lastDegraded()).vhosts, ['lamalibre-lamaste-gone (unreadable)']);
});

test('a restart while still degraded tells nobody again; a change or the reminder does', async () => {
  await enable(
    'lamalibre-lamaste-app-stale.example.com',
    withoutAccessLog(
      nginx.renderTunnelVhost('restricted', 'stale.example.com', 'example.com', 9401).config,
    ),
  );
  const t0 = Date.now();
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 });
  assert.equal((await raised()).length, 1);
  // The panel restarts (memory gone): the same thing still wrong.
  lib.resetRequestPrivacyCheck();
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + 1000 });
  assert.equal((await raised()).length, 1, 'not told twice for one breakage');
  // A day after the audit: the reminder is due, restart or not.
  lib.resetRequestPrivacyCheck();
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + DAY + 1000 });
  assert.equal((await raised()).length, 2);
  // Restarted again, and something else is wrong now: told at once.
  lib.resetRequestPrivacyCheck();
  await rm(file);
  await lib.checkRequestPrivacy(undefined, { ...paths(), now: t0 + DAY + 2000 });
  assert.equal((await raised()).length, 3);
});
