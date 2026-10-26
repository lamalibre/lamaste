/**
 * Grants are access, kept until revoked: only a local plugin grant is ever
 * consumed — by its desktop enrolment — and only consumed local plugin
 * grants are swept 90 days later. Tunnel, site and agent-side plugin grants
 * used to be created consumed and were deleted silently by that sweep;
 * migration 0004 un-consumes them. Runs against the build (`npm run build`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

let dir;
let grants;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-retention-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  grants = await import('../dist/lib/grants.js');
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const LONG_AGO = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString();

test('access grants are created unused; a local plugin grant starts unused too', async () => {
  for (const [resourceType, resourceId, context] of [
    ['tunnel', 't1', {}],
    ['site', 's1', {}],
    ['oidc-client', 'feria-cli', {}],
    ['plugin', 'herd', { target: 'agent:r730' }],
    ['plugin', 'shell', { target: 'local' }],
  ]) {
    const grant = await grants.createGrant({
      principalType: 'user',
      principalId: 'ext',
      resourceType,
      resourceId,
      context,
    });
    assert.equal(grant.used, false, resourceType);
    assert.equal(grant.usedAt, null, resourceType);
  }
});

test('the retention sweep deletes consumed local plugin grants only', async () => {
  const old = { used: true, createdAt: LONG_AGO, usedAt: LONG_AGO };
  const local = await grants.createGrant(
    {
      principalType: 'user',
      principalId: 'dev',
      resourceType: 'plugin',
      resourceId: 'old-local',
      context: { target: 'local' },
    },
    old,
  );
  // A grant written consumed by an older Gatekeeper and not yet migrated.
  const tunnel = await grants.createGrant(
    { principalType: 'user', principalId: 'dev', resourceType: 'tunnel', resourceId: 'old-t' },
    old,
  );
  // Any write sweeps.
  await grants.createGrant({
    principalType: 'user',
    principalId: 'dev',
    resourceType: 'tunnel',
    resourceId: 'trigger',
  });
  assert.equal(await grants.getGrant(local.grantId), null, 'a consumed local grant goes');
  assert.notEqual(await grants.getGrant(tunnel.grantId), null, 'access is never swept');
});

test('migration 0004 un-consumes every grant but local plugin grants', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrations = path.join(here, '..', 'src', 'lib', 'migrations', 'gatekeeper');
  const db = new DatabaseSync(':memory:');
  db.exec(await readFile(path.join(migrations, '0002_access_grants.sql'), 'utf-8'));
  const insert = db.prepare(
    `INSERT INTO access_grants
       (grant_id, principal_type, principal_id, resource_type, resource_id, context, used, created_at, used_at)
     VALUES (?, 'user', 'u', ?, ?, ?, 1, ?, ?)`,
  );
  insert.run('tunnel', 'tunnel', 't', '{}', LONG_AGO, LONG_AGO);
  insert.run('oidc', 'oidc-client', 'c', '{}', LONG_AGO, LONG_AGO);
  insert.run('agent', 'plugin', 'p', '{"target":"agent:r730"}', LONG_AGO, LONG_AGO);
  insert.run('local', 'plugin', 'p', '{"target":"local"}', LONG_AGO, LONG_AGO);
  insert.run('legacy-local', 'plugin', 'p', '{}', LONG_AGO, LONG_AGO);
  db.exec(await readFile(path.join(migrations, '0004_unconsume_access_grants.sql'), 'utf-8'));
  const used = Object.fromEntries(
    db
      .prepare('SELECT grant_id, used, used_at FROM access_grants')
      .all()
      .map((r) => [r.grant_id, [r.used, r.used_at]]),
  );
  assert.deepEqual(used, {
    tunnel: [0, null],
    oidc: [0, null],
    agent: [0, null],
    local: [1, LONG_AGO],
    'legacy-local': [1, LONG_AGO],
  });
});

test('only a local plugin grant can be consumed', async () => {
  const tunnel = await grants.createGrant({
    principalType: 'user',
    principalId: 'eve',
    resourceType: 'tunnel',
    resourceId: 'consume-t',
  });
  await assert.rejects(grants.consumeGrant(tunnel.grantId, 'eve'), { statusCode: 409 });
  const agent = await grants.createGrant({
    principalType: 'user',
    principalId: 'eve',
    resourceType: 'plugin',
    resourceId: 'consume-agent',
    context: { target: 'agent:r730' },
  });
  await assert.rejects(grants.consumeGrant(agent.grantId, 'eve'), { statusCode: 409 });
  const local = await grants.createGrant({
    principalType: 'user',
    principalId: 'eve',
    resourceType: 'plugin',
    resourceId: 'consume-local',
    context: { target: 'local' },
  });
  assert.equal((await grants.consumeGrant(local.grantId, 'eve')).used, true);
});
