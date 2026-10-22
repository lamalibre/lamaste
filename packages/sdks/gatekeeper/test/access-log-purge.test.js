/**
 * Erasing a removed user (slice 6) purges Gatekeeper's access-request log of
 * them: `POST /api/access-log/purge { username, before? }` removes that
 * username's rows — logged before `before` when the panel names the time the
 * user was removed, since a later user may have the same username — and the
 * entries still queued for the log, so none of them is written after the
 * purge. The username travels in the body, never in a URL. `DELETE
 * /api/access-log` clears the whole log and refuses any query (an older
 * caller's narrowing query must not clear everything). Runs against the
 * build (`npm run build`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

let dir;
let app;
let db;
let logAccessRequest;

const entry = (username, timestamp, resourceId = 'reports') => ({
  timestamp,
  username,
  resourceType: 'tunnel',
  resourceId,
  resourceFqdn: `${resourceId}.example.com`,
});

function insert(e) {
  db.prepare(
    `INSERT INTO access_request_log (timestamp, username, resource_type, resource_id, resource_fqdn)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(e.timestamp, e.username, e.resourceType, e.resourceId, e.resourceFqdn);
}

const purge = (body) =>
  app.inject({
    method: 'POST',
    url: '/api/access-log/purge',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });

function usernames() {
  return db
    .prepare('SELECT username, timestamp FROM access_request_log ORDER BY id')
    .all()
    .map((r) => `${r.username}@${r.timestamp.slice(0, 10)}`);
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-purge-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const { getGatekeeperDb } = await import('../dist/lib/state-db.js');
  db = await getGatekeeperDb();
  const diagnostic = await import('../dist/server/routes/diagnostic.js');
  logAccessRequest = diagnostic.logAccessRequest;
  app = Fastify({ logger: false });
  app.decorate('getSettings', () => ({}));
  app.decorate('updateSettings', () => {});
  app.decorate('bustCache', () => {});
  await app.register(diagnostic.diagnosticRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

test('a username’s rows go, everyone else’s stay; before= keeps a later user’s', async () => {
  insert(entry('ayse', '2026-09-01T10:00:00.000Z'));
  insert(entry('mehmet', '2026-09-02T10:00:00.000Z'));
  insert(entry('ayse', '2026-09-03T10:00:00.000Z', 'wiki'));
  // A new ayse, after the first one was removed on 2026-09-10.
  insert(entry('ayse', '2026-09-20T10:00:00.000Z'));

  const purged = await purge({ username: 'ayse', before: '2026-09-10T00:00:00.000Z' });
  assert.equal(purged.statusCode, 200);
  assert.deepEqual(purged.json(), { ok: true, removed: 2 });
  assert.deepEqual(usernames(), ['mehmet@2026-09-02', 'ayse@2026-09-20']);

  // Without before: every row of the username.
  const all = await purge({ username: 'ayse' });
  assert.deepEqual(all.json(), { ok: true, removed: 1 });
  assert.deepEqual(usernames(), ['mehmet@2026-09-02']);

  // Nothing to purge is still an answer.
  const none = await purge({ username: 'zeynep' });
  assert.deepEqual(none.json(), { ok: true, removed: 0 });
});

test('entries still queued for the log are purged too: none is written afterwards', async () => {
  logAccessRequest(entry('zeynep', '2026-09-05T10:00:00.000Z'));
  logAccessRequest(entry('ali', '2026-09-05T11:00:00.000Z'));
  const purged = await purge({ username: 'zeynep' });
  assert.deepEqual(purged.json(), { ok: true, removed: 1 });
  // The drainer runs every 100 ms.
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.deepEqual(usernames(), ['mehmet@2026-09-02', 'ali@2026-09-05']);
});

test('the body is checked: a username, an ISO time, nothing else', async () => {
  for (const body of [
    {},
    { before: '2026-09-10T00:00:00.000Z' },
    { username: 'ayse', before: 'yesterday' },
    { username: 'ayse', extra: 1 },
    { username: 'a'.repeat(101) },
  ]) {
    const res = await purge(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
  assert.deepEqual(usernames(), ['mehmet@2026-09-02', 'ali@2026-09-05']);
});

test('DELETE with a query clears nothing: one user’s rows are purged by POST', async () => {
  for (const url of [
    '/api/access-log?username=mehmet',
    '/api/access-log?username=mehmet&before=2026-09-10T00:00:00.000Z',
    '/api/access-log?x=1',
  ]) {
    const res = await app.inject({ method: 'DELETE', url });
    assert.equal(res.statusCode, 400, url);
  }
  assert.deepEqual(usernames(), ['mehmet@2026-09-02', 'ali@2026-09-05']);
});

test('DELETE without a query clears the whole log, as before', async () => {
  const cleared = await app.inject({ method: 'DELETE', url: '/api/access-log' });
  assert.deepEqual(cleared.json(), { ok: true, removed: 2 });
  assert.deepEqual(usernames(), []);
});
