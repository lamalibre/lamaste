/**
 * Whether an agent-hosted plugin's agent half can be reached, in words: a
 * hosting is an outage only while its health is `down` — the tunnel (the
 * hosting agent is offline, with its last sync) or the application (the
 * agent half does not answer) — and its panel pages load only while it is
 * active and not down, waiting while it is not hosted or being set up or
 * removed; its settings are writable on the same terms, and only once the
 * relay has read them. Every moment is measured against a `now` the caller
 * passes, never the clock.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatMoment,
  hostingOutage,
  outageMessage,
  panelAvailability,
  settingsHostingOutage,
  settingsReadOnlyReason,
} from '../src/admin/lib/hostingState.js';

/** A moment in the local time zone, as the panel's browser shows it (mid-October: no DST change). */
const local = (day, hours, minutes, seconds = 0) => new Date(2026, 9, day, hours, minutes, seconds);

const NOW = local(16, 14, 17, 12).getTime();
const SINCE = local(16, 14, 5, 12).toISOString(); // 12m before NOW
const LAST_SYNC = local(16, 14, 4, 12).toISOString(); // 13m before NOW

const clock = (iso) => new Date(iso).toLocaleTimeString();
const stamp = (iso) => new Date(iso).toLocaleString();

const AT_SINCE = `${clock(SINCE)} (12m ago)`;
const AT_LAST_SYNC = `${clock(LAST_SYNC)} (13m ago)`;

/** `agentHosting` on the plugin list: the hosting record with its health. */
const hosting = (health, extra = {}) => ({
  plugin: 'market-indicators',
  agentLabel: 'vm1',
  port: 21000,
  phase: 'active',
  health,
  agentLastSeenAt: LAST_SYNC,
  ...extra,
});

const DOWN_TUNNEL = {
  state: 'down',
  reason: 'tunnel',
  since: SINCE,
  lastError: 'connect ECONNREFUSED 127.0.0.1:21000',
};

/** An agent-hosted plugin with an agent half, as the plugin list carries it. */
const plugin = (agentHosting, extra = {}) => ({
  name: 'market-indicators',
  displayName: 'Market Indicators',
  hosting: 'agent',
  agent: { package: '@lamalibre/market-indicators-agent' },
  agentHosting,
  ...extra,
});

/** The settings view's `hosting`: flat, with the health monitor's state. */
const settingsHosting = (extra = {}) => ({
  agentLabel: 'vm1',
  phase: 'active',
  state: 'up',
  reason: null,
  since: SINCE,
  agentLastSeenAt: LAST_SYNC,
  ...extra,
});

test('a moment shows its time on the day of now, its date and time on another, and how long ago', () => {
  assert.equal(formatMoment(SINCE, NOW), AT_SINCE);
  assert.notEqual(clock(SINCE), stamp(SINCE), 'the time alone is not the date and time');

  const lateYesterday = local(15, 23, 55).toISOString();
  assert.equal(
    formatMoment(lateYesterday, local(16, 0, 5).getTime()),
    `${stamp(lateYesterday)} (10m ago)`,
    'ten minutes ago, but another day',
  );
  const twoDaysAgo = local(14, 14, 17, 12).toISOString();
  assert.equal(formatMoment(twoDaysAgo, NOW), `${stamp(twoDaysAgo)} (2d ago)`);

  const ahead = local(16, 14, 20).toISOString();
  assert.equal(formatMoment(ahead, NOW), `${clock(ahead)} (just now)`, 'a clock ahead of ours');
});

test('a moment that cannot be read is an unknown time', () => {
  for (const iso of ['', 'yesterday', null, undefined]) {
    assert.equal(formatMoment(iso, NOW), 'an unknown time', String(iso));
  }
});

test('a hosting is an outage only while its health is down — and only its label, reason and times are kept', () => {
  assert.deepEqual(hostingOutage(hosting(DOWN_TUNNEL)), {
    agentLabel: 'vm1',
    reason: 'tunnel',
    since: SINCE,
    agentLastSeenAt: LAST_SYNC,
  });
  assert.deepEqual(hostingOutage(hosting({ state: 'down' }, { agentLastSeenAt: undefined })), {
    agentLabel: 'vm1',
    reason: null,
    since: null,
    agentLastSeenAt: null,
  });
  for (const health of [
    { state: 'up', since: SINCE },
    { state: 'unknown', since: SINCE },
    undefined,
  ]) {
    assert.equal(hostingOutage(hosting(health)), null, JSON.stringify(health));
  }
  assert.equal(hostingOutage(null), null, 'not hosted');
  assert.equal(hostingOutage(undefined), null);
});

test('the settings view’s flat hosting is read the same way', () => {
  assert.deepEqual(
    settingsHostingOutage(settingsHosting({ state: 'down', reason: 'app', lastError: 'x' })),
    { agentLabel: 'vm1', reason: 'app', since: SINCE, agentLastSeenAt: LAST_SYNC },
  );
  assert.deepEqual(settingsHostingOutage({ agentLabel: 'vm1', state: 'down' }), {
    agentLabel: 'vm1',
    reason: null,
    since: null,
    agentLastSeenAt: null,
  });
  assert.equal(settingsHostingOutage(settingsHosting()), null);
  assert.equal(settingsHostingOutage(settingsHosting({ state: 'unknown' })), null);
  assert.equal(settingsHostingOutage(null), null);
});

test('a tunnel outage says the hosting agent is offline, since when, and when it last synced', () => {
  const outage = hostingOutage(hosting(DOWN_TUNNEL));
  assert.equal(
    outageMessage(outage, NOW),
    `Hosting agent vm1 is offline since ${AT_SINCE} — last sync ${AT_LAST_SYNC}`,
  );
  assert.equal(
    outageMessage({ ...outage, agentLastSeenAt: null }, NOW),
    `Hosting agent vm1 is offline since ${AT_SINCE} — no sync recorded`,
  );
  assert.equal(
    outageMessage({ ...outage, since: null, agentLastSeenAt: null }, NOW),
    'Hosting agent vm1 is offline since an unknown time — no sync recorded',
  );
  assert.equal(outageMessage(outage, NOW).includes('ECONNREFUSED'), false, 'no error text');
});

test('an app outage says the agent half is not responding; another reason says the hosting is down', () => {
  const app = { agentLabel: 'vm1', reason: 'app', since: SINCE, agentLastSeenAt: LAST_SYNC };
  assert.equal(outageMessage(app, NOW), `The agent half is not responding since ${AT_SINCE}`);
  assert.equal(
    outageMessage({ ...app, since: null }, NOW),
    'The agent half is not responding since an unknown time',
  );
  assert.equal(
    outageMessage({ ...app, reason: null }, NOW),
    `The hosting on vm1 is down since ${AT_SINCE}`,
  );
  assert.equal(
    outageMessage({ ...app, reason: 'other', since: 'garbage' }, NOW),
    'The hosting on vm1 is down since an unknown time',
  );
});

test('a server plugin, one without an agent half, or a plugin list not read loads its pages', () => {
  assert.deepEqual(panelAvailability(undefined, NOW), { state: 'mount' });
  assert.deepEqual(
    panelAvailability(plugin(hosting(DOWN_TUNNEL), { hosting: 'server' }), NOW),
    { state: 'mount' },
    'a server plugin, whatever it carries',
  );
  assert.deepEqual(panelAvailability({ name: 'legacy' }, NOW), { state: 'mount' });
  assert.deepEqual(panelAvailability(plugin(null, { agent: null }), NOW), { state: 'mount' });
  assert.deepEqual(panelAvailability(plugin(null, { agent: undefined }), NOW), { state: 'mount' });
});

test('an agent half not hosted, or whose hosting is being set up or removed, waits and says so', () => {
  assert.deepEqual(panelAvailability(plugin(null), NOW), {
    state: 'waiting',
    message: 'Market Indicators is not hosted on an agent — host it on the Plugins page',
  });
  assert.deepEqual(panelAvailability(plugin(undefined, { displayName: '' }), NOW), {
    state: 'waiting',
    message: 'market-indicators is not hosted on an agent — host it on the Plugins page',
  });
  assert.deepEqual(panelAvailability(plugin(hosting(DOWN_TUNNEL, { phase: 'installing' })), NOW), {
    state: 'waiting',
    message: 'The hosting of Market Indicators on vm1 is being set up',
  });
  assert.deepEqual(
    panelAvailability(plugin(hosting({ state: 'up' }, { phase: 'removing' })), NOW),
    {
      state: 'waiting',
      message: 'The hosting of Market Indicators on vm1 is being removed',
    },
  );
});

test('a hosting that is down is offline with its outage; one up or unknown loads the pages', () => {
  assert.deepEqual(panelAvailability(plugin(hosting(DOWN_TUNNEL)), NOW), {
    state: 'offline',
    message: `Hosting agent vm1 is offline since ${AT_SINCE} — last sync ${AT_LAST_SYNC}`,
  });
  assert.deepEqual(
    panelAvailability(plugin(hosting({ state: 'down', reason: 'app', since: SINCE })), NOW),
    { state: 'offline', message: `The agent half is not responding since ${AT_SINCE}` },
  );
  assert.deepEqual(panelAvailability(plugin(hosting({ state: 'up', since: SINCE })), NOW), {
    state: 'mount',
  });
  assert.deepEqual(
    panelAvailability(plugin(hosting({ state: 'unknown', since: SINCE })), NOW),
    { state: 'mount' },
    'the forwarder decides',
  );
  assert.deepEqual(
    panelAvailability(plugin(hosting({ state: 'up' }, { phase: undefined })), NOW),
    { state: 'mount' },
    'a record without a phase is active',
  );
});

test('settings are read-only while not hosted, being set up or removed, or down — with the reason', () => {
  const view = (hostingOfView, revision = 3) => ({ hosting: hostingOfView, revision });
  assert.equal(settingsReadOnlyReason(view(null), NOW), 'Not hosted on an agent yet');
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting({ phase: 'installing' })), NOW),
    'The hosting on vm1 is being set up',
  );
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting({ phase: 'removing', state: 'down' })), NOW),
    'The hosting on vm1 is being removed',
  );
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting({ state: 'down', reason: 'tunnel' })), NOW),
    `Hosting agent vm1 is offline since ${AT_SINCE} — last sync ${AT_LAST_SYNC}`,
  );
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting({ state: 'down', reason: 'app' }), null), NOW),
    `The agent half is not responding since ${AT_SINCE}`,
    'the outage before the missing revision',
  );
});

test('settings are writable once read, while the hosting is active and up or unknown', () => {
  const view = (hostingOfView, revision) => ({ hosting: hostingOfView, revision });
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting(), null), NOW),
    'The settings could not be read from the agent half yet',
  );
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting(), undefined), NOW),
    'The settings could not be read from the agent half yet',
  );
  assert.equal(settingsReadOnlyReason(view(settingsHosting(), 3), NOW), null);
  assert.equal(settingsReadOnlyReason(view(settingsHosting(), 0), NOW), null, 'revision 0');
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting({ state: 'unknown' }), 0), NOW),
    null,
    'unknown, right after hosting, is writable',
  );
  assert.equal(
    settingsReadOnlyReason(view(settingsHosting({ phase: undefined }), 3), NOW),
    null,
    'no phase: active',
  );
});
