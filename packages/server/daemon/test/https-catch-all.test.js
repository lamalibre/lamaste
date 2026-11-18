/**
 * The panel tells the administrators when the relay's port-443 catch-all is
 * not in place (lib/https-catch-all.js): a missing, changed or unreadable
 * site is audited and notified (critical) when it starts and once a day
 * while it lasts; its return is audited; `httpsCatchAllStatus()` (on
 * `GET /api/system/stats`) says which.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { renderHttpsCatchAllVhost } from '@lamalibre/lamaste';

let stateDir;
let site;
let lib;

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-catch-all-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  site = path.join(stateDir, 'lamalibre-lamaste-https-default');
  lib = {
    ...(await import('../src/lib/https-catch-all.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/notifications.js')),
  };
});

after(async () => {
  lib.resetHttpsCatchAllCheck();
  await rm(stateDir, { recursive: true, force: true });
});

beforeEach(async () => {
  lib.resetHttpsCatchAllCheck();
  await rm(site, { force: true });
  await lib.markNotificationsRead({ all: true });
});

async function catchAllNotifications() {
  const { notifications } = await lib.listNotifications({ unreadOnly: true, limit: 50 });
  return notifications.filter((n) => n.message.includes('lamalibre-lamaste-https-default'));
}

async function audits(action) {
  return lib.listAudit({ action, limit: 50 });
}

const DAY = 24 * 60 * 60 * 1000;

test('in place: nothing raised', async () => {
  await writeFile(site, renderHttpsCatchAllVhost());
  assert.equal(await lib.checkHttpsCatchAll(undefined, { enabledPath: site }), 'installed');
  assert.equal(lib.httpsCatchAllStatus().status, 'installed');
  assert.ok(lib.httpsCatchAllStatus().checkedAt);
  assert.deepEqual(await catchAllNotifications(), []);
});

test('missing: audited and notified (critical) once, again after a day, restored audited', async () => {
  const before = (await audits('relay.https-catch-all.missing')).length;
  const t0 = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 }), 'missing');
  assert.equal(lib.httpsCatchAllStatus().status, 'missing');
  let raised = await catchAllNotifications();
  assert.equal(raised.length, 1);
  assert.equal(raised[0].level, 'critical');
  assert.match(raised[0].message, /is not enabled/);
  assert.match(raised[0].message, /grep -rn default_server/);
  const audited = await audits('relay.https-catch-all.missing');
  assert.equal(audited.length, before + 1);
  assert.equal(audited[0].details.status, 'missing');

  // Checked again within the day: no second notification.
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + 10 * 60 * 1000 });
  assert.equal((await catchAllNotifications()).length, 1);
  // A day later, still missing: told again.
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + DAY + 1 });
  assert.equal((await catchAllNotifications()).length, 2);

  // Installed (a Panel Update after the conflict was removed): the return is audited.
  await writeFile(site, renderHttpsCatchAllVhost());
  const restoredBefore = (await audits('relay.https-catch-all.restored')).length;
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + DAY + 2 });
  assert.equal(lib.httpsCatchAllStatus().status, 'installed');
  assert.equal((await audits('relay.https-catch-all.restored')).length, restoredBefore + 1);
  assert.equal((await catchAllNotifications()).length, 2, 'nothing new while it is in place');
});

test('another status is raised at once, even within the day', async () => {
  const t0 = Date.parse('2026-11-13T00:00:00Z');
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 });
  await writeFile(site, renderHttpsCatchAllVhost().replace('return 444;', 'return 301 https://x;'));
  assert.equal(
    await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + 1000 }),
    'changed',
  );
  const raised = await catchAllNotifications();
  assert.equal(raised.length, 2);
  assert.match(raised[0].message + raised[1].message, /other content/);
});

test(
  'unreadable: raised too',
  { skip: process.getuid?.() === 0 ? 'root reads anything' : false },
  async () => {
    await writeFile(site, renderHttpsCatchAllVhost());
    await chmod(site, 0o000);
    try {
      assert.equal(await lib.checkHttpsCatchAll(undefined, { enabledPath: site }), 'unreadable');
      assert.match((await catchAllNotifications())[0].message, /could not be read/);
    } finally {
      await chmod(site, 0o644);
    }
  },
);

test('restored after a restart: the audit log says it was missing', async () => {
  const t0 = Date.parse('2026-11-14T00:00:00Z');
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 });
  // The panel restarts (memory gone) after the catch-all came back.
  lib.resetHttpsCatchAllCheck();
  await writeFile(site, renderHttpsCatchAllVhost());
  const before = (await audits('relay.https-catch-all.restored')).length;
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + 1000 });
  assert.equal((await audits('relay.https-catch-all.restored')).length, before + 1);
  // Another restart: nothing more to say.
  lib.resetHttpsCatchAllCheck();
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + 2000 });
  assert.equal((await audits('relay.https-catch-all.restored')).length, before + 1);
});

test('a restart while still missing tells nobody again', async () => {
  const t0 = Date.now();
  // Something else first, so this breakage starts fresh.
  await writeFile(site, renderHttpsCatchAllVhost().replace('return 444;', 'return 400;'));
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 });
  await rm(site, { force: true });
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + 1000 });
  const told = (await catchAllNotifications()).length;
  lib.resetHttpsCatchAllCheck();
  await lib.checkHttpsCatchAll(undefined, { enabledPath: site, now: t0 + 2000 });
  assert.equal((await catchAllNotifications()).length, told, 'same breakage after a restart');
  const audited = await audits('relay.https-catch-all.missing');
  assert.match(audited[0].details.noticeKey, /^[0-9a-f]{32}$/);
});
