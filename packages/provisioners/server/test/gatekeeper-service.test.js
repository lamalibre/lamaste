/**
 * Gatekeeper after a redeploy (src/lib/gatekeeper-service.js): started
 * before the panel without ever throwing, checked after the panel is up by
 * its health endpoint, and reported — masked, disabled at boot, failing to
 * start or not answering — as the redeploy's last step, never in the way of
 * the panel's restart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  GATEKEEPER_HEALTH_URL,
  GATEKEEPER_SERVICE,
  checkGatekeeper,
  gatekeeperHealthy,
  startGatekeeper,
} from '../src/lib/gatekeeper-service.js';

/** A stand-in for execa: answers by command line, records every call. */
function fakeRun(answers) {
  const calls = [];
  const run = async (cmd, args, opts = {}) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    const answer = answers[line] ?? { stdout: '' };
    if (answer.throws) {
      const err = new Error(answer.throws);
      err.stderr = answer.throws;
      throw err;
    }
    if (answer.exitCode && opts.reject !== false) throw new Error(`exit ${answer.exitCode}`);
    return { stdout: answer.stdout ?? '', exitCode: answer.exitCode ?? 0 };
  };
  return { run, calls };
}

const IS_ENABLED = `systemctl is-enabled ${GATEKEEPER_SERVICE}`;
const RESTART = `systemctl restart ${GATEKEEPER_SERVICE}`;
const noWait = async () => {};

test('started: restarted, its boot setting left as it is', async () => {
  const { run, calls } = fakeRun({ [IS_ENABLED]: { stdout: 'enabled\n' } });
  assert.deepEqual(await startGatekeeper({ run }), { state: 'started', enabled: 'enabled' });
  assert.deepEqual(calls, [IS_ENABLED, RESTART]);
  assert.ok(!calls.some((c) => c.includes(' enable ')), 'never re-enabled');
});

test('masked: left alone, never started; reported clearly, not thrown', async () => {
  const { run, calls } = fakeRun({ [IS_ENABLED]: { stdout: 'masked\n', exitCode: 1 } });
  const start = await startGatekeeper({ run });
  assert.equal(start.state, 'masked');
  assert.deepEqual(calls, [IS_ENABLED]);
  const report = await checkGatekeeper(start, { run, fetchImpl: async () => ({ ok: true }) });
  assert.equal(report.ok, false);
  assert.match(report.message, /masked/);
  assert.match(report.message, /systemctl unmask/);
});

test('a restart that fails never throws; the check reports it with the logs', async () => {
  const { run } = fakeRun({
    [IS_ENABLED]: { stdout: 'enabled' },
    [RESTART]: { throws: 'Job failed' },
    [`journalctl -u ${GATEKEEPER_SERVICE} -n 20 --no-pager`]: { stdout: 'boom at start' },
  });
  const start = await startGatekeeper({ run });
  assert.equal(start.state, 'start-failed');
  const report = await checkGatekeeper(start, { run });
  assert.equal(report.ok, false);
  assert.match(report.message, /could not be started \(Job failed\)/);
  assert.match(report.message, /the panel is running/);
  assert.match(report.message, /boom at start/);
});

test('readiness is the health endpoint, retried — not is-active', async () => {
  let asked = 0;
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    asked += 1;
    if (asked < 3) throw new Error('ECONNREFUSED');
    return { ok: true };
  };
  assert.equal(await gatekeeperHealthy({ fetchImpl, wait: noWait }), true);
  assert.equal(asked, 3);
  assert.ok(urls.every((u) => u === GATEKEEPER_HEALTH_URL));

  // Spawned but never serving: not ready, after every attempt.
  let tries = 0;
  const never = async () => {
    tries += 1;
    return { ok: false };
  };
  assert.equal(await gatekeeperHealthy({ fetchImpl: never, attempts: 4, wait: noWait }), false);
  assert.equal(tries, 4);

  const { run } = fakeRun({});
  const report = await checkGatekeeper(
    { state: 'started', enabled: 'enabled' },
    { run, fetchImpl: never, attempts: 2, wait: noWait },
  );
  assert.equal(report.ok, false);
  assert.match(report.message, /does not answer http:\/\/127\.0\.0\.1:9294\/health/);
});

test('disabled at boot: started and serving, with a warning', async () => {
  const report = await checkGatekeeper(
    { state: 'started', enabled: 'disabled' },
    { fetchImpl: async () => ({ ok: true }), wait: noWait },
  );
  assert.equal(report.ok, true);
  assert.match(report.warning, /disabled at boot/);
  assert.match(report.warning, /systemctl enable/);
  const enabled = await checkGatekeeper(
    { state: 'started', enabled: 'enabled' },
    { fetchImpl: async () => ({ ok: true }), wait: noWait },
  );
  assert.deepEqual(enabled, { ok: true, message: 'Gatekeeper is serving' });
});

test('the redeploy checks Gatekeeper last, after the panel has started', async () => {
  const { redeployTasks } = await import('../src/tasks/redeploy.js');
  let list = null;
  redeployTasks(
    {
      installDir: '/opt/lamalibre/lamaste',
      configDir: '/etc/lamalibre/lamaste',
      pkiDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'pki'),
    },
    {
      newListr(items) {
        list = items;
        return items;
      },
    },
  );
  const titles = list.map((t) => t.title);
  assert.equal(titles.at(-1), 'Checking gatekeeper');
  assert.ok(
    titles.indexOf('Reloading systemd and restarting panel') <
      titles.indexOf('Checking gatekeeper'),
  );
});
