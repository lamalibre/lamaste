/**
 * Sign-in events to the plugins that declare they want them
 * (native-apps-design.md D7).
 *
 * A sign-in is a native grant made by an authorization-code exchange
 * (`native-grants.js` emits `sign-in` on `nativeSignIns`): `{ userId, at,
 * client: { kind: 'native', clientId } }`. It is queued
 * (`native_sign_in_events`) for every plugin the client's host serves whose
 * installed version declares `identity.signInEvents`, is approved, and
 * holds the user as an active member of its audience at that moment — a
 * plugin never hears of anyone it does not already know.
 *
 * Delivery is per plugin, one at a time, at least once: oldest first, at
 * most {@link SIGN_IN_EVENTS_BATCH_MAX} a batch, `POST
 * /admin/identity/sign-ins { protocol: 1, from, to, events }` with the
 * events sealed to the request (core `sealSignInEvents`, under a key from
 * the installation secret), only while the hosting is active and not down
 * — the identity feed's preconditions. A batch the half acknowledges
 * (`{ acknowledged: to }`) is deleted. A failed call backs off (30 s,
 * doubling, at most 10 minutes); events older than
 * {@link SIGN_IN_EVENT_RETENTION_MS} are dropped undelivered, counted in
 * one audit line per plugin and sweep. Erasing a user deletes their queued
 * events (`lib/directory.js`).
 */

import {
  AGENT_HALF_SIGN_IN_EVENTS_PATH,
  KeyedPromiseChainMutex,
  SIGN_IN_EVENTS_BATCH_MAX,
  SIGN_IN_EVENTS_PROTOCOL_VERSION,
  SIGN_IN_EVENT_RETENTION_MS,
  callAgentHalf,
  sealSignInEvents,
} from '@lamalibre/lamaste';
import { pluginHostingPhase, signingSecretFor } from '@lamalibre/lamaste/server';

import { recordAuditBestEffort } from './audit.js';
import { readAudienceRow } from './audience.js';
import { installedVersionApproved } from './plugin-hooks.js';
import { findPlugin, findPluginByRoute } from './plugins.js';
import { getStateDb } from './state-db.js';

/** How long the half may take to take a batch. */
const SIGN_INS_TIMEOUT_MS = 10_000;

/** The largest answer read from the half. */
const SIGN_INS_ANSWER_MAX_BYTES = 4096;

/** First retry after a failure; doubles up to {@link BACKOFF_MAX_MS}. */
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

/** How often queued events are looked at. */
const TICK_INTERVAL_MS = 30_000;

const deliveries = new KeyedPromiseChainMutex();
/** Per plugin: `{ delayMs, nextAt }` after a failure. */
const backoff = new Map();

let deps = null;

/**
 * Replace the clock and the half's call (tests).
 *
 * @param {{ now?: () => number, call?: Function, hostingOf?: Function } | null} override
 */
export function setSignInEventsDepsForTests(override) {
  deps = override;
  backoff.clear();
}

const now = () => (deps?.now ? deps.now() : Date.now());

async function hostingOf(plugin) {
  if (deps?.hostingOf) return deps.hostingOf(plugin);
  const { ownHosting } = await import('./plugin-hosting.js');
  return ownHosting(plugin);
}

/** Whether the installed `plugin` wants sign-in events and may get them now. */
async function wantsSignIns(plugin) {
  return (
    plugin?.identity?.signInEvents === true &&
    (await installedVersionApproved(plugin).catch(() => false))
  );
}

/** The routes the host of native client `clientId` serves, or none. */
async function hostRoutesOf(clientId) {
  const { findResolvedNativeClient } = await import('./native-apps.js');
  const client = await findResolvedNativeClient(clientId);
  if (!client?.served || !client.host) return [];
  return [...client.host.served];
}

/** Whether user `userId` is an active member of `plugin`'s audience. */
async function activeMember(plugin, userId) {
  const row = await readAudienceRow(plugin.name, userId);
  const member = row?.change?.kind === 'upsert' ? row.change.member : null;
  return member?.status === 'active' && member.userId === userId;
}

/**
 * Queue a sign-in for every plugin that should hear of it (see the module
 * comment) and start their delivery. Returns the plugins it was queued for.
 *
 * @param {{ clientId: string, userId: string, at: number }} signIn
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<string[]>}
 */
export async function queueSignInEvent({ clientId, userId, at }, logger) {
  const plugins = [];
  for (const route of await hostRoutesOf(clientId)) {
    const plugin = await findPluginByRoute(route);
    if (!plugin || !(await wantsSignIns(plugin))) continue;
    if (!(await activeMember(plugin, userId))) continue;
    plugins.push(plugin.name);
  }
  if (plugins.length === 0) return [];
  const db = await getStateDb();
  const insert = db.prepare(
    'INSERT INTO native_sign_in_events (plugin, user_id, at, client_id) VALUES (?, ?, ?, ?)',
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const name of plugins) insert.run(name, userId, at, clientId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  for (const name of plugins) void deliverSignInEvents(name, { logger });
  return plugins;
}

/**
 * Drop plugin `name`'s queued events older than the retention, auditing
 * how many. Returns the count.
 */
async function dropExpired(name, logger) {
  const db = await getStateDb();
  const cutoff = now() - SIGN_IN_EVENT_RETENTION_MS;
  const { changes } = db
    .prepare('DELETE FROM native_sign_in_events WHERE plugin = ? AND at < ?')
    .run(name, cutoff);
  if (changes > 0) {
    await recordAuditBestEffort(
      {
        actor: 'lamaste',
        action: 'plugin.sign-in-events.dropped',
        plugin: name,
        details: { count: changes },
      },
      logger,
    );
  }
  return changes;
}

/** A batch of queued events as the half receives them. */
function eventsOf(rows) {
  return rows.map((row) => ({
    seq: row.seq,
    userId: row.user_id,
    at: new Date(row.at).toISOString(),
    client: { kind: 'native', clientId: row.client_id },
  }));
}

function failed(name, error, logger) {
  const previous = backoff.get(name);
  const delayMs = previous ? Math.min(previous.delayMs * 2, BACKOFF_MAX_MS) : BACKOFF_MIN_MS;
  backoff.set(name, { delayMs, nextAt: now() + delayMs });
  logger?.warn?.({ plugin: name, error }, 'Sign-in events not delivered');
  return { status: 'failed', error };
}

/**
 * Deliver plugin `name`'s queued events (see the module comment). One
 * delivery per plugin at a time; `force` ignores the backoff.
 *
 * @param {string} name
 * @param {{ logger?: import('pino').Logger, force?: boolean }} [opts]
 * @returns {Promise<{ status: 'delivered' | 'idle' | 'skipped' | 'waiting' | 'failed', delivered?: number, reason?: string, error?: string }>}
 */
export function deliverSignInEvents(name, { logger, force = false } = {}) {
  return deliveries.run(name, async () => {
    const waiting = backoff.get(name);
    if (!force && waiting && waiting.nextAt > now()) return { status: 'waiting' };
    await dropExpired(name, logger);
    const db = await getStateDb();
    const pending = () =>
      db
        .prepare('SELECT * FROM native_sign_in_events WHERE plugin = ? ORDER BY seq LIMIT ?')
        .all(name, SIGN_IN_EVENTS_BATCH_MAX);
    let rows = pending();
    if (rows.length === 0) return { status: 'idle' };

    const plugin = await findPlugin(name);
    if (!plugin || !(await wantsSignIns(plugin))) {
      // Its version no longer wants them (or it is gone): nothing queued is sent.
      db.prepare('DELETE FROM native_sign_in_events WHERE plugin = ?').run(name);
      return { status: 'skipped', reason: 'not_wanted' };
    }
    const record = await hostingOf(plugin);
    if (!record) return { status: 'skipped', reason: 'not_hosted' };
    if (pluginHostingPhase(record) !== 'active') {
      return { status: 'skipped', reason: 'hosting_not_active' };
    }
    if (record.health?.state === 'down') return { status: 'skipped', reason: 'down' };
    const secret = signingSecretFor(record);
    const call = deps?.call ?? callAgentHalf;

    let delivered = 0;
    while (rows.length > 0) {
      const events = eventsOf(rows);
      const envelope = { from: events[0].seq, to: events[events.length - 1].seq };
      const result = await call({
        plugin: record.plugin,
        port: record.port,
        secret,
        method: 'POST',
        path: AGENT_HALF_SIGN_IN_EVENTS_PATH,
        body: (nonce) => ({
          protocol: SIGN_IN_EVENTS_PROTOCOL_VERSION,
          ...envelope,
          events: sealSignInEvents({ secret, plugin: record.plugin, nonce, envelope, events }),
        }),
        timeoutMs: SIGN_INS_TIMEOUT_MS,
        maxResponseBytes: SIGN_INS_ANSWER_MAX_BYTES,
      });
      if (!result.ok) return failed(name, `${result.code}: ${result.error}`, logger);
      if (result.status !== 200) {
        return failed(name, `the agent half answered status ${result.status}`, logger);
      }
      if (result.body?.acknowledged !== envelope.to) {
        return failed(name, 'the agent half acknowledged another batch', logger);
      }
      db.prepare(
        'DELETE FROM native_sign_in_events WHERE plugin = ? AND seq >= ? AND seq <= ?',
      ).run(name, envelope.from, envelope.to);
      delivered += events.length;
      rows = pending();
    }
    backoff.delete(name);
    logger?.info?.({ plugin: name, delivered }, 'Sign-in events delivered');
    return { status: 'delivered', delivered };
  });
}

/** Deliver every plugin's queued events that are due. */
export async function signInEventsTick(logger) {
  try {
    const db = await getStateDb();
    const names = db
      .prepare('SELECT DISTINCT plugin FROM native_sign_in_events')
      .all()
      .map((r) => r.plugin);
    for (const name of names) await deliverSignInEvents(name, { logger });
  } catch (err) {
    logger?.warn?.({ err: err.message }, 'Sign-in events tick failed');
  }
}

let timer = null;
let listener = null;

/**
 * Listen for native sign-ins and deliver queued events every
 * {@link TICK_INTERVAL_MS}.
 *
 * @param {import('pino').Logger} logger
 */
export async function startSignInEventServices(logger) {
  if (timer) return;
  const { nativeSignIns } = await import('./native-grants.js');
  listener = (signIn) => {
    queueSignInEvent(signIn, logger).catch((err) =>
      logger?.warn?.({ err: err.message }, 'A sign-in event was not queued'),
    );
  };
  nativeSignIns.on('sign-in', listener);
  timer = setInterval(() => void signInEventsTick(logger), TICK_INTERVAL_MS);
  timer.unref();
  void signInEventsTick(logger);
}

export async function stopSignInEventServices() {
  if (timer) clearInterval(timer);
  timer = null;
  if (listener) {
    const { nativeSignIns } = await import('./native-grants.js');
    nativeSignIns.off('sign-in', listener);
    listener = null;
  }
}
