/**
 * The provider's outbox on its own: publishing inside the application's
 * transaction, declared scopes and types only, the size limit, pulls by
 * scope and type with `to` past filtered events, and retention.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createPeerOutbox } from '../dist/agent/index.js';

const PEERS = {
  provides: {
    'notices:send': {
      description: 'Send notices',
      endpoints: [{ method: 'POST', path: '/notices' }],
      events: ['notice.sent', 'notice.failed'],
    },
    'notices:read': {
      description: 'Read notices',
      endpoints: [{ method: 'GET', path: '/notices/:id' }],
      events: ['notice.read'],
    },
  },
};

async function withOutbox(fn, now) {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-outbox-'));
  const dbPath = path.join(dir, 'app.db');
  const db = new DatabaseSync(dbPath);
  const outbox = await createPeerOutbox({ db, dbPath, peers: PEERS, now });
  try {
    await fn(outbox, db);
  } finally {
    outbox.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test('only declared scopes and types; data within its limit', async () => {
  await withOutbox(async (outbox) => {
    assert.throws(() => outbox.publish({ scope: 'other:x', type: 'notice.sent' }), /no scope/);
    assert.throws(
      () => outbox.publish({ scope: 'notices:send', type: 'notice.read' }),
      /declares no event/,
    );
    assert.throws(
      () =>
        outbox.publish({ scope: 'notices:send', type: 'notice.sent', data: 'x'.repeat(17_000) }),
      /at most/,
    );
    assert.equal(outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'a' }), 1);
  });
});

test('a pull filters by scope and type and moves `to` past what it filtered out', async () => {
  await withOutbox(async (outbox) => {
    outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: '1' });
    outbox.publish({ scope: 'notices:read', type: 'notice.read', key: '2' });
    outbox.publish({ scope: 'notices:send', type: 'notice.failed', key: '3' });
    outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: '4' });
    const answer = await outbox.pull({
      scope: 'notices:send',
      types: ['notice.sent'],
      after: 0,
      max: 256,
      waitMs: 0,
    });
    assert.deepEqual(
      answer.events.map((e) => e.key),
      ['1', '4'],
    );
    assert.equal(answer.to, 4);
    assert.equal(answer.head, 4);
    const capped = await outbox.pull({
      scope: 'notices:send',
      types: ['notice.sent', 'notice.failed'],
      after: 0,
      max: 2,
      waitMs: 0,
    });
    assert.deepEqual(
      capped.events.map((e) => e.seq),
      [1, 3],
    );
    assert.equal(capped.to, 3);
  });
});

test('a waiting pull returns as soon as an event of its scope commits', async () => {
  await withOutbox(async (outbox, db) => {
    const started = Date.now();
    const pending = outbox.pull({
      scope: 'notices:send',
      types: ['notice.sent'],
      after: 0,
      max: 10,
      waitMs: 5000,
    });
    setTimeout(() => {
      db.exec('BEGIN');
      outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'late' });
      db.exec('COMMIT');
    }, 100);
    const answer = await pending;
    assert.equal(answer.events[0].key, 'late');
    assert.ok(Date.now() - started < 2000);
  });
});

test('retention prunes old events, never the newest, and raises the horizon', async () => {
  let clock = Date.parse('2026-01-01T00:00:00Z');
  await withOutbox(
    async (outbox) => {
      outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'old1' });
      outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'old2' });
      clock += 10 * 24 * 60 * 60_000;
      assert.equal(outbox.prune(), 1);
      assert.deepEqual(outbox.state().horizon, 1);
      assert.equal(outbox.state().head, 2);
      outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'new' });
      assert.equal(outbox.prune(), 1);
      assert.equal(outbox.state().horizon, 2);
      assert.equal(outbox.state().head, 3);
    },
    () => clock,
  );
});
