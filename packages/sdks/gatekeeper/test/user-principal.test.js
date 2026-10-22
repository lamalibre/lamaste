/**
 * A user principal removed everywhere (slice 6): Gatekeeper keys users by
 * username, which a later user may reuse, so the panel removes everything
 * under a username when it deletes the user — every grant naming the user
 * (any resource type, with roles or without) and its membership of every
 * Lamaste group — in one transaction. A group, or a group grant, that only
 * shares the name is left alone; a second removal removes nothing. The
 * username travels in the body of a POST, never in a URL (request logs keep
 * URLs). Runs against the build (`npm run build`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';

let dir;
let app;
let lib;
let invalidations = 0;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-principal-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  lib = {
    ...(await import('../dist/lib/grants.js')),
    ...(await import('../dist/lib/groups.js')),
    ...(await import('../dist/lib/cache-bust.js')),
  };
  lib.registerCacheInvalidator(() => {
    invalidations += 1;
  });
  const { principalRoutes } = await import('../dist/server/routes/principals.js');
  app = Fastify({ logger: false });
  await app.register(principalRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

const remove = (body) =>
  app.inject({
    method: 'POST',
    url: '/api/principals/user/remove',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });

const grant = (principalType, principalId, resourceType, resourceId, context = {}) =>
  lib.createGrant({ principalType, principalId, resourceType, resourceId, context });

test('every grant to the user and every membership goes, in one call; the rest stays', async () => {
  await grant('user', 'ayse', 'tunnel', 'reports-id');
  await grant('user', 'ayse', 'plugin', 'market-indicators', { roles: ['viewer'] });
  await grant('user', 'ayse', 'plugin', 'herd', { target: 'local' });
  await grant('user', 'mehmet', 'tunnel', 'reports-id');
  await grant('group', 'ops', 'plugin', 'market-indicators', { roles: ['editor'] });
  // A group that shares the username's name is not the user.
  await lib.createGroup('ayse');
  await grant('group', 'ayse', 'tunnel', 'wiki-id');
  await lib.createGroup('ops');
  await lib.createGroup('devs');
  await lib.createGroup('qa');
  await lib.addMembers('ops', ['ayse', 'mehmet']);
  await lib.addMembers('devs', ['ayse']);
  await lib.addMembers('qa', ['mehmet']);

  const before = invalidations;
  const res = await remove({ username: 'ayse' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, grantsRemoved: 3, groupsLeft: 2 });
  assert.ok(invalidations > before, 'the authorization cache is told');

  const grants = await lib.listGrants();
  assert.deepEqual(
    grants.map((g) => `${g.principalType}:${g.principalId}:${g.resourceId}`).sort(),
    ['group:ayse:wiki-id', 'group:ops:market-indicators', 'user:mehmet:reports-id'],
  );
  assert.deepEqual((await lib.getGroup('ops')).members, ['mehmet']);
  assert.deepEqual((await lib.getGroup('devs')).members, []);
  assert.deepEqual((await lib.getGroup('qa')).members, ['mehmet']);
  assert.ok(await lib.getGroup('ayse'), 'the group named ayse stays');
  assert.deepEqual(await lib.getGroupsForUser('ayse'), []);
});

test('a second removal, or of a username Gatekeeper never knew, removes nothing', async () => {
  const before = invalidations;
  for (const username of ['ayse', 'nobody']) {
    const res = await remove({ username });
    assert.deepEqual(res.json(), { ok: true, grantsRemoved: 0, groupsLeft: 0 });
  }
  assert.equal(invalidations, before, 'nothing changed, nothing to invalidate');
});

test('a body that is not { username } is refused; the URL form is gone', async () => {
  for (const body of [
    {},
    { username: '' },
    { username: 'a'.repeat(101) },
    { username: 'ayse', x: 1 },
  ]) {
    const res = await remove(body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.ok(!res.body.includes('ayse'), 'the refusal names nobody');
  }
  const old = await app.inject({ method: 'DELETE', url: '/api/principals/user/mehmet' });
  assert.equal(old.statusCode, 404);
  assert.equal((await lib.listGrants()).length, 3);
});
