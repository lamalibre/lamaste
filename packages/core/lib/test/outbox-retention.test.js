/**
 * The provider's outbox on its own: publishing inside the application's
 * transaction, declared scopes and types only, the size limit, pulls by
 * scope and type with `to` past filtered events, retention, and renewing
 * the stream after a restore.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createPeerOutbox, renewPeerOutboxStream } from '../dist/agent/index.js';

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

const STREAM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('renewing the stream: a new id, the horizon at the head, events kept', async () => {
  await withOutbox(async (outbox) => {
    outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'a' });
    outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'b' });
    const before = outbox.state();
    const renewed = outbox.renewStream();
    assert.match(renewed.streamId, STREAM_ID);
    assert.notEqual(renewed.streamId, before.streamId);
    assert.deepEqual(renewed, { streamId: renewed.streamId, head: 2, horizon: 2 });
    assert.deepEqual(outbox.state(), renewed);
    // Nothing deleted or renumbered; the next event continues the sequence.
    const all = await outbox.pull({
      scope: 'notices:send',
      types: ['notice.sent'],
      after: 0,
      max: 10,
      waitMs: 0,
    });
    assert.deepEqual(
      all.events.map((e) => [e.seq, e.key]),
      [
        [1, 'a'],
        [2, 'b'],
      ],
    );
    assert.equal(outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'c' }), 3);
    // A new event moves the head, not the renewal's horizon.
    assert.deepEqual(outbox.state(), { streamId: renewed.streamId, head: 3, horizon: 2 });
  });
});

test('renewing an empty outbox: a new id at head 0', async () => {
  await withOutbox(async (outbox) => {
    const before = outbox.state();
    const renewed = outbox.renewStream();
    assert.notEqual(renewed.streamId, before.streamId);
    assert.equal(renewed.head, 0);
    assert.equal(renewed.horizon, 0);
  });
});

test('a pull held open answers at once when the stream is renewed', async () => {
  await withOutbox(async (outbox) => {
    const before = outbox.state();
    const started = Date.now();
    const pending = outbox.pull({
      scope: 'notices:send',
      types: ['notice.sent'],
      after: 0,
      max: 10,
      waitMs: 10_000,
    });
    await new Promise((r) => setTimeout(r, 100));
    const renewed = outbox.renewStream();
    const answer = await pending;
    assert.equal(answer.streamId, renewed.streamId);
    assert.notEqual(answer.streamId, before.streamId);
    assert.equal(answer.events.length, 0);
    assert.ok(Date.now() - started < 2000, 'not held to the end of its wait');
  });
});

test('renewing inside the application transaction is refused, and changes nothing', async () => {
  await withOutbox(async (outbox, db) => {
    const before = outbox.state();
    db.exec('BEGIN');
    try {
      assert.throws(() => outbox.renewStream(), /outside the application/);
    } finally {
      db.exec('ROLLBACK');
    }
    assert.deepEqual(outbox.state(), before);
  });
});

test('a restore script renews the stream with no outbox open; the next outbox keeps it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-outbox-'));
  try {
    const dbPath = path.join(dir, 'app.db');
    // A database that never had an outbox: nothing to renew, nothing created.
    const bare = new DatabaseSync(dbPath);
    assert.equal(renewPeerOutboxStream(bare), null);
    assert.equal(
      bare.prepare("SELECT name FROM sqlite_master WHERE name = 'lamaste_peer_stream'").get(),
      undefined,
    );
    bare.close();

    // An outbox, its database "restored" (closed and reopened), renewed while stopped.
    let db = new DatabaseSync(dbPath);
    let outbox = await createPeerOutbox({ db, dbPath, peers: PEERS });
    outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'x' });
    const original = outbox.state().streamId;
    outbox.close();
    db.close();

    const script = new DatabaseSync(dbPath);
    const renewed = renewPeerOutboxStream(script);
    script.close();
    assert.notEqual(renewed.streamId, original);
    assert.equal(renewed.head, 1);

    db = new DatabaseSync(dbPath);
    outbox = await createPeerOutbox({ db, dbPath, peers: PEERS });
    try {
      assert.equal(outbox.state().streamId, renewed.streamId);
      assert.equal(outbox.state().horizon, 1);
    } finally {
      outbox.close();
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a pull from past the head (a restored database) answers `to` at the head, never past it', async () => {
  await withOutbox(async (outbox) => {
    outbox.publish({ scope: 'notices:send', type: 'notice.sent', key: 'a' });
    const started = Date.now();
    const answer = await outbox.pull({
      scope: 'notices:send',
      types: ['notice.sent'],
      after: 7,
      max: 10,
      waitMs: 10_000,
    });
    assert.ok(Date.now() - started < 2000, 'answered at once, not held');
    assert.equal(answer.head, 1);
    assert.equal(answer.to, 1);
    assert.deepEqual(answer.events, []);
  });
});

test("renewing while another connection holds the write lock: SQLite's busy error, not the nesting one", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-outbox-'));
  const dbPath = path.join(dir, 'app.db');
  const db = new DatabaseSync(dbPath);
  const outbox = await createPeerOutbox({ db, dbPath, peers: PEERS });
  const other = new DatabaseSync(dbPath);
  try {
    const before = outbox.state();
    other.exec('BEGIN IMMEDIATE');
    assert.throws(
      () => renewPeerOutboxStream(db),
      (err) => /locked|busy/i.test(err.message) && !/outside the application/.test(err.message),
    );
    other.exec('ROLLBACK');
    assert.deepEqual(outbox.state(), before);
  } finally {
    other.close();
    outbox.close();
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
