/**
 * A user's agent-side plugin grant is browser access, kept until it is
 * revoked. Before 4.7 it was created consumed and the retention sweep (run
 * on every new grant) deleted it 90 days later, with no audit entry — the
 * same defect as Gatekeeper's access grants. Only a local grant, consumed by
 * its desktop enrolment, is ever pruned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { consumeGrant, createGrant, listGrants } from '@lamalibre/lamaste/server';

const silent = { info() {} };
const longAgo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();

async function withStore(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-user-access-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('an agent-side grant is created unconsumed and cannot be consumed', async () => {
  await withStore(async (dir) => {
    const grant = await createGrant(dir, 'ayse', '@lamalibre/herd-server', silent, {
      target: 'agent:herd-1',
    });
    assert.equal(grant.used, false);
    assert.equal(grant.usedAt, null);
    await assert.rejects(consumeGrant(dir, grant.grantId, 'ayse', silent), (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'NOT_CONSUMABLE');
      return true;
    });
  });
});

test('a grant stored consumed by 4.6 survives the sweep, read as unconsumed; an old consumed local grant goes', async () => {
  await withStore(async (dir) => {
    const stored = {
      grants: [
        {
          grantId: 'agent-old',
          username: 'ayse',
          pluginName: '@lamalibre/herd-server',
          target: 'agent:herd-1',
          used: true,
          createdAt: longAgo,
          usedAt: longAgo,
        },
        {
          grantId: 'local-old',
          username: 'ayse',
          pluginName: '@lamalibre/shell-server',
          target: 'local',
          used: true,
          createdAt: longAgo,
          usedAt: longAgo,
        },
        {
          grantId: 'local-open',
          username: 'ayse',
          pluginName: '@lamalibre/sync-server',
          target: 'local',
          used: false,
          createdAt: longAgo,
          usedAt: null,
        },
      ],
      otpTokens: {},
    };
    await writeFile(path.join(dir, 'user-plugin-access.json'), JSON.stringify(stored));

    // A new grant runs the retention sweep.
    await createGrant(dir, 'mehmet', '@lamalibre/herd-server', silent, { target: 'agent:herd-1' });

    const byId = new Map((await listGrants(dir)).map((g) => [g.grantId, g]));
    assert.ok(byId.has('agent-old'), 'the 4.6 agent-side grant is still access');
    assert.equal(byId.get('agent-old').used, false);
    assert.equal(byId.get('agent-old').usedAt, null);
    assert.equal(byId.has('local-old'), false, 'a consumed local grant past retention is pruned');
    assert.ok(byId.has('local-open'), 'an unconsumed local grant stays');

    const onDisk = JSON.parse(await readFile(path.join(dir, 'user-plugin-access.json'), 'utf8'));
    assert.equal(onDisk.grants.find((g) => g.grantId === 'agent-old').used, false);
  });
});
