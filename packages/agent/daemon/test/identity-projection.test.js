/**
 * Slice 6, the agent half's identity projection over `node:sqlite`: its two
 * tables appear without touching the plugin's `user_version`; a batch and
 * its cursor land in one transaction or not at all; a batch that does not
 * continue from the cursor is refused with what the projection holds; a
 * reset adopts a new directory; removals keep the last known attributes
 * while an erasure scrubs the row and runs the plugin's anonymiser on every
 * pass; a reconcile counts what differed, and its final batch removes the
 * rows it did not mention; replaying the same snapshot changes nothing; an
 * erasure is sticky — no later upsert or removal writes the user back, and a
 * reconcile that tries counts a mismatch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { createIdentityProjection, IdentityCursorConflictError } from '@lamalibre/lamaste/agent';

const DIR_A = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const DIR_B = 'b1b2c3d4-e5f6-4a7b-9c9d-0e1f2a3b4c5d';
const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-9222-222222222222';
const U3 = '33333333-3333-4333-a333-333333333333';
const U4 = '44444444-4444-4444-b444-444444444444';

function upsert(seq, userId, member = {}) {
  return {
    seq,
    kind: 'upsert',
    member: {
      userId,
      username: member.username ?? `user-${userId.slice(0, 4)}`,
      ...(member.displayName !== undefined ? { displayName: member.displayName } : {}),
      ...(member.email !== undefined ? { email: member.email } : {}),
      roles: member.roles ?? ['viewer'],
      status: member.status ?? 'active',
      version: member.version ?? 1,
    },
  };
}

function remove(seq, userId, reason, last) {
  return { seq, kind: 'remove', userId, reason, ...(last ? { last } : {}) };
}

function batch(fields) {
  return {
    protocol: 1,
    directoryId: DIR_A,
    from: 0,
    to: 0,
    reset: false,
    reconcile: false,
    pass: crypto.randomUUID(),
    final: false,
    changes: [],
    ...fields,
  };
}

/** A projection over a fresh in-memory database, recording what its hooks saw. */
function fresh(hooks = {}) {
  const db = new DatabaseSync(':memory:');
  const seen = { upserts: [], removes: [], erases: [] };
  const projection = createIdentityProjection({
    db,
    onUpsert: (user, tx) => {
      seen.upserts.push(user.userId);
      hooks.onUpsert?.(user, tx);
    },
    onRemove: (user, reason, tx) => {
      seen.removes.push([user.userId, reason]);
      hooks.onRemove?.(user, reason, tx);
    },
    onErase: (userId, tx) => {
      seen.erases.push(userId);
      hooks.onErase?.(userId, tx);
    },
  });
  return { db, projection, seen };
}

test('fresh: two tables, nothing held, and the plugin’s user_version left alone', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = 7');
  const projection = createIdentityProjection({ db });
  assert.deepEqual(projection.state(), { directoryId: null, cursor: 0 });
  assert.deepEqual(projection.listUsers(), []);
  assert.equal(projection.getUser(U1), null);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => r.name);
  assert.deepEqual(tables, ['lamaste_identity_cursor', 'lamaste_users']);
  // Opening it again on the same database is harmless.
  createIdentityProjection({ db });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 7);
});

test('a reset adopts the directory; upserts write the declared attributes; the cursor moves to `to`', () => {
  const { projection, seen } = fresh();
  const answer = projection.applyBatch(
    batch({
      reset: true,
      to: 10,
      changes: [
        upsert(3, U1, {
          username: 'ayse',
          displayName: 'Ayşe Yılmaz',
          email: 'ayse@example.com',
          roles: ['viewer', 'editor'],
        }),
        upsert(7, U2, { username: 'mehmet', status: 'disabled', version: 4 }),
      ],
    }),
  );
  assert.deepEqual(answer, { protocol: 1, directoryId: DIR_A, cursor: 10, mismatches: 0 });
  assert.deepEqual(projection.state(), { directoryId: DIR_A, cursor: 10 });
  const ayse = projection.getUser(U1);
  assert.equal(ayse.username, 'ayse');
  assert.equal(ayse.displayName, 'Ayşe Yılmaz');
  assert.equal(ayse.email, 'ayse@example.com');
  assert.deepEqual(ayse.roles, ['editor', 'viewer']);
  assert.equal(ayse.status, 'active');
  assert.equal(ayse.removedReason, null);
  assert.equal(ayse.version, 1);
  const mehmet = projection.getUser(U2);
  assert.equal(mehmet.displayName, null, 'an attribute the change does not carry is NULL');
  assert.equal(mehmet.email, null);
  assert.equal(mehmet.status, 'disabled');
  assert.equal(mehmet.version, 4);
  assert.deepEqual(
    projection.listUsers().map((u) => u.username),
    ['ayse', 'mehmet'],
  );
  assert.deepEqual(seen.upserts, [U1, U2]);

  // A plain batch continues from the cursor; narrowing the attributes drops them.
  const next = projection.applyBatch(
    batch({ from: 10, to: 12, changes: [upsert(11, U1, { username: 'ayse', version: 2 })] }),
  );
  assert.deepEqual(next, { protocol: 1, directoryId: DIR_A, cursor: 12 });
  assert.equal(projection.getUser(U1).displayName, null);
  assert.equal(projection.getUser(U1).email, null);
});

test('a batch that does not continue from the cursor is refused with what the projection holds', () => {
  const { db, projection } = fresh();
  // Fresh: a batch without reset has no directory to continue.
  assert.throws(
    () => projection.applyBatch(batch({ to: 3, changes: [upsert(1, U1)] })),
    (err) =>
      err instanceof IdentityCursorConflictError && err.cursor === 0 && err.directoryId === null,
  );
  projection.applyBatch(batch({ reset: true, to: 5, changes: [upsert(2, U1)] }));

  const before = db.prepare('SELECT COUNT(*) AS n FROM lamaste_users').get().n;
  for (const wrong of [
    batch({ from: 4, to: 9, changes: [upsert(6, U2)] }),
    batch({ from: 6, to: 9, changes: [upsert(7, U2)] }),
    // The same batch again: the cursor is past it.
    batch({ from: 0, to: 5, changes: [upsert(2, U1)] }),
    // Another directory without reset.
    batch({ directoryId: DIR_B, from: 5, to: 9, changes: [upsert(6, U2)] }),
  ]) {
    assert.throws(
      () => projection.applyBatch(wrong),
      (err) =>
        err instanceof IdentityCursorConflictError && err.cursor === 5 && err.directoryId === DIR_A,
    );
  }
  assert.deepEqual(projection.state(), { directoryId: DIR_A, cursor: 5 });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lamaste_users').get().n, before);
  assert.equal(projection.getUser(U2), null);
});

test('malformed batches are refused before anything is written', () => {
  const { projection } = fresh();
  const last = { username: 'ayse' };
  for (const bad of [
    batch({ reset: true, from: 2, to: 5 }),
    batch({ reset: true, to: 5, changes: [upsert(3, U1), upsert(2, U2)] }),
    batch({ reset: true, to: 5, changes: [upsert(3, U1), upsert(3, U2)] }),
    batch({ reset: true, to: 5, changes: [upsert(6, U1)] }),
    batch({ reset: true, to: 5, changes: [upsert(0, U1)] }),
    batch({ reset: true, from: 0, to: 5, changes: [remove(2, U1, 'erased', last)] }),
    batch({ reset: true, to: 5, changes: [remove(2, U1, 'deleted')] }),
    batch({ reset: true, to: 5, changes: [upsert(2, U1, { roles: [] })] }),
    batch({ reset: true, to: 5, changes: [upsert(2, 'not-a-uuid')] }),
    batch({ reset: true, to: 5, protocol: 2 }),
    batch({
      reset: true,
      to: 600,
      changes: Array.from({ length: 501 }, (_, i) => upsert(i + 1, U1)),
    }),
    { ...batch({ reset: true, to: 5 }), extra: true },
  ]) {
    assert.throws(() => projection.applyBatch(bad), TypeError);
  }
  assert.deepEqual(projection.state(), { directoryId: null, cursor: 0 });
});

test('a removal keeps the last known attributes and no roles; a later upsert brings the member back', () => {
  const { projection, seen } = fresh();
  projection.applyBatch(
    batch({
      reset: true,
      to: 4,
      changes: [
        upsert(1, U1, { username: 'ayse', displayName: 'Ayşe', roles: ['viewer'], version: 3 }),
        upsert(2, U2, { username: 'mehmet' }),
      ],
    }),
  );
  projection.applyBatch(
    batch({
      from: 4,
      to: 8,
      changes: [
        remove(5, U1, 'unentitled', { username: 'ayse', displayName: 'Ayşe Y.' }),
        remove(6, U2, 'deleted', { username: 'mehmet' }),
        // Someone the projection never saw: a tombstone of their own.
        remove(7, U3, 'deleted', { username: 'zeynep', email: 'z@example.com' }),
      ],
    }),
  );
  const ayse = projection.getUser(U1);
  assert.equal(ayse.status, 'removed');
  assert.equal(ayse.removedReason, 'unentitled');
  assert.equal(ayse.displayName, 'Ayşe Y.');
  assert.deepEqual(ayse.roles, []);
  assert.equal(ayse.version, 3, 'the record version stays the last member version');
  assert.match(ayse.removedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(ayse.erasedAt, null);
  const zeynep = projection.getUser(U3);
  assert.equal(zeynep.status, 'removed');
  assert.equal(zeynep.version, 0);
  assert.equal(zeynep.email, 'z@example.com');
  assert.deepEqual(seen.removes, [
    [U1, 'unentitled'],
    [U2, 'deleted'],
    [U3, 'deleted'],
  ]);
  assert.deepEqual(projection.listUsers(), []);
  assert.deepEqual(
    projection.listUsers({ includeRemoved: true }).map((u) => u.username),
    ['ayse', 'mehmet', 'zeynep'],
  );

  // A later reason keeps the time the user stopped being a member.
  const removedAt = ayse.removedAt;
  projection.applyBatch(
    batch({ from: 8, to: 9, changes: [remove(9, U1, 'deleted', { username: 'ayse' })] }),
  );
  assert.equal(projection.getUser(U1).removedReason, 'deleted');
  assert.equal(projection.getUser(U1).removedAt, removedAt);

  // Entitled again: a member, nothing of the removal left.
  projection.applyBatch(
    batch({ from: 9, to: 11, changes: [upsert(10, U1, { username: 'ayse', version: 4 })] }),
  );
  const back = projection.getUser(U1);
  assert.equal(back.status, 'active');
  assert.equal(back.removedReason, null);
  assert.equal(back.removedAt, null);
  assert.deepEqual(back.roles, ['viewer']);
});

test('an erasure scrubs the row to the bare id and runs onErase once per change, in the transaction', () => {
  const { db, projection, seen } = fresh({
    onErase: (userId, tx) => {
      tx.prepare('UPDATE notes SET author = NULL, body = ? WHERE user_id = ?').run(
        '(erased)',
        userId,
      );
    },
  });
  db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, user_id TEXT, author TEXT, body TEXT)');
  db.prepare('INSERT INTO notes (user_id, author, body) VALUES (?, ?, ?)').run(
    U1,
    'Ayşe',
    'shift ok',
  );
  projection.applyBatch(
    batch({
      reset: true,
      to: 2,
      changes: [upsert(1, U1, { username: 'ayse', displayName: 'Ayşe', email: 'a@example.com' })],
    }),
  );
  projection.applyBatch(batch({ from: 2, to: 3, changes: [remove(3, U1, 'erased')] }));

  const erased = projection.getUser(U1);
  assert.equal(erased.userId, U1);
  assert.equal(erased.username, null);
  assert.equal(erased.displayName, null);
  assert.equal(erased.email, null);
  assert.deepEqual(erased.roles, []);
  assert.equal(erased.status, 'removed');
  assert.equal(erased.removedReason, 'erased');
  assert.match(erased.erasedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(seen.erases, [U1]);
  assert.deepEqual(
    { ...db.prepare('SELECT author, body FROM notes').get() },
    { author: null, body: '(erased)' },
  );
  const raw = db.prepare('SELECT * FROM lamaste_users WHERE user_id = ?').get(U1);
  assert.ok(!JSON.stringify(raw).includes('ayse'));
  assert.ok(!JSON.stringify(raw).includes('Ayşe'));
  assert.ok(!JSON.stringify(raw).includes('example.com'));

  // A replay carries the erasure again: onErase runs again (it must be
  // idempotent), the row stays scrubbed, the first erasure time stays.
  const erasedAt = erased.erasedAt;
  projection.applyBatch(
    batch({ reset: true, reconcile: true, final: true, to: 3, changes: [remove(3, U1, 'erased')] }),
  );
  assert.deepEqual(seen.erases, [U1, U1]);
  assert.equal(projection.getUser(U1).erasedAt, erasedAt);
});

test('a hook that throws rolls the whole batch back; an async hook is refused', () => {
  let failOn = U2;
  const { projection } = fresh({
    onUpsert: (user) => {
      if (user.userId === failOn) throw new Error('plugin table full');
    },
  });
  projection.applyBatch(batch({ reset: true, to: 1, changes: [upsert(1, U4)] }));
  assert.throws(
    () => projection.applyBatch(batch({ from: 1, to: 5, changes: [upsert(2, U1), upsert(3, U2)] })),
    /plugin table full/,
  );
  assert.deepEqual(projection.state(), { directoryId: DIR_A, cursor: 1 });
  assert.equal(projection.getUser(U1), null, 'nothing of the batch was kept');

  failOn = null;
  const asyncHooks = createIdentityProjection({
    db: new DatabaseSync(':memory:'),
    onUpsert: async () => {},
  });
  assert.throws(
    () => asyncHooks.applyBatch(batch({ reset: true, to: 1, changes: [upsert(1, U1)] })),
    /must be synchronous/,
  );
  assert.deepEqual(asyncHooks.state(), { directoryId: null, cursor: 0 });
  assert.equal(asyncHooks.getUser(U1), null);
});

test('a reconcile counts what differed; its final batch removes the rows the pass did not mention', () => {
  const { db, projection, seen } = fresh();
  projection.applyBatch(
    batch({
      reset: true,
      final: true,
      to: 10,
      changes: [
        upsert(1, U1, { username: 'ayse', displayName: 'Ayşe' }),
        upsert(2, U2, { username: 'mehmet', displayName: 'Mehmet' }),
        upsert(3, U3, { username: 'zeynep' }),
        remove(4, U4, 'deleted', { username: 'ali' }),
      ],
    }),
  );
  // Drift the feed missed: Mehmet's row is stale, and Zeynep was deleted
  // without the half hearing of it.
  db.prepare('UPDATE lamaste_users SET display_name = ? WHERE user_id = ?').run('Old', U2);
  seen.upserts.length = 0;
  seen.removes.length = 0;

  const pass = crypto.randomUUID();
  const first = projection.applyBatch(
    batch({
      reset: true,
      reconcile: true,
      pass,
      to: 6,
      changes: [
        upsert(1, U1, { username: 'ayse', displayName: 'Ayşe' }),
        upsert(2, U2, { username: 'mehmet', displayName: 'Mehmet' }),
      ],
    }),
  );
  assert.deepEqual(first, { protocol: 1, directoryId: DIR_A, cursor: 6, mismatches: 1 });
  assert.equal(projection.getUser(U2).displayName, 'Mehmet');
  assert.deepEqual(seen.upserts, [U2], 'only the row that changed');

  const last = projection.applyBatch(
    batch({
      reconcile: true,
      final: true,
      pass,
      from: 6,
      to: 14,
      changes: [remove(8, U4, 'deleted', { username: 'ali' })],
    }),
  );
  // Zeynep, not mentioned and still listed as a member: removed and counted.
  assert.deepEqual(last, { protocol: 1, directoryId: DIR_A, cursor: 14, mismatches: 1 });
  const zeynep = projection.getUser(U3);
  assert.equal(zeynep.status, 'removed');
  assert.equal(zeynep.removedReason, 'deleted');
  assert.equal(zeynep.username, 'zeynep', 'the last known attributes stay');
  assert.deepEqual(zeynep.roles, []);
  assert.deepEqual(seen.removes, [[U3, 'deleted']]);
  // Ali was already removed: unmentioned or not, he is left alone.
  assert.equal(projection.getUser(U4).status, 'removed');
  assert.deepEqual(
    projection.listUsers().map((u) => u.username),
    ['ayse', 'mehmet'],
  );
});

test('replaying the same snapshot changes nothing, finds no mismatch, calls no hook but onErase', () => {
  const { db, projection, seen } = fresh();
  const changes = [
    upsert(1, U1, { username: 'ayse', displayName: 'Ayşe', roles: ['viewer', 'admin'] }),
    upsert(2, U2, { username: 'mehmet', status: 'disabled', version: 2 }),
    remove(3, U3, 'unentitled', { username: 'zeynep' }),
    remove(4, U4, 'erased'),
  ];
  projection.applyBatch(batch({ reset: true, final: true, to: 4, changes }));
  const rows = db.prepare('SELECT * FROM lamaste_users ORDER BY user_id').all();
  const users = projection.listUsers({ includeRemoved: true });
  seen.upserts.length = 0;
  seen.removes.length = 0;
  seen.erases.length = 0;

  const answer = projection.applyBatch(
    batch({ reset: true, reconcile: true, final: true, to: 4, changes }),
  );
  assert.deepEqual(answer, { protocol: 1, directoryId: DIR_A, cursor: 4, mismatches: 0 });
  assert.deepEqual(projection.listUsers({ includeRemoved: true }), users);
  const after = db.prepare('SELECT * FROM lamaste_users ORDER BY user_id').all();
  // Only the pass stamp moved.
  assert.deepEqual(
    after.map(({ seen_pass: _seen, ...row }) => row),
    rows.map(({ seen_pass: _seen, ...row }) => row),
  );
  assert.deepEqual(seen.upserts, []);
  assert.deepEqual(seen.removes, []);
  assert.deepEqual(seen.erases, [U4]);
});

test('a reset to another directory: the new one is followed, the old one’s users leave at the end', () => {
  const { projection } = fresh();
  projection.applyBatch(
    batch({
      reset: true,
      to: 40,
      changes: [upsert(10, U1), upsert(20, U2, { username: 'mehmet' })],
    }),
  );
  const pass = crypto.randomUUID();
  const answer = projection.applyBatch(
    batch({
      directoryId: DIR_B,
      reset: true,
      final: true,
      pass,
      to: 3,
      changes: [upsert(2, U2, { username: 'mehmet' })],
    }),
  );
  assert.deepEqual(answer, { protocol: 1, directoryId: DIR_B, cursor: 3, mismatches: 1 });
  assert.deepEqual(projection.state(), { directoryId: DIR_B, cursor: 3 });
  assert.equal(projection.getUser(U1).status, 'removed');
  assert.equal(projection.getUser(U2).status, 'active');
  // The old directory's cursor means nothing now.
  assert.throws(
    () => projection.applyBatch(batch({ from: 40, to: 41, changes: [upsert(41, U3)] })),
    IdentityCursorConflictError,
  );
});

test('rows are updated in place, never replaced: the plugin’s foreign keys hold', () => {
  const { db, projection } = fresh();
  db.exec('PRAGMA foreign_keys = ON');
  projection.applyBatch(batch({ reset: true, to: 1, changes: [upsert(1, U1)] }));
  db.exec(`CREATE TABLE readings (
    id INTEGER PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES lamaste_users (user_id) ON DELETE CASCADE
  )`);
  db.prepare('INSERT INTO readings (user_id) VALUES (?)').run(U1);
  projection.applyBatch(
    batch({ from: 1, to: 3, changes: [upsert(2, U1, { username: 'ayse', version: 2 })] }),
  );
  projection.applyBatch(
    batch({ from: 3, to: 4, changes: [remove(4, U1, 'deleted', { username: 'ayse' })] }),
  );
  projection.applyBatch(batch({ from: 4, to: 5, changes: [remove(5, U1, 'erased')] }));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM readings').get().n, 1);
});

test('an erasure is sticky: no later upsert or removal writes the user back', () => {
  const { db, projection, seen } = fresh();
  projection.applyBatch(
    batch({
      reset: true,
      final: true,
      to: 2,
      changes: [
        upsert(1, U1, { username: 'ayse', displayName: 'Ayşe', email: 'a@example.com' }),
        upsert(2, U2, { username: 'mehmet' }),
      ],
    }),
  );
  projection.applyBatch(batch({ from: 2, to: 3, changes: [remove(3, U1, 'erased')] }));
  const erased = projection.getUser(U1);
  seen.upserts.length = 0;
  seen.removes.length = 0;
  seen.erases.length = 0;

  // What a relay restored from a backup taken before the erasure would send.
  projection.applyBatch(
    batch({
      from: 3,
      to: 6,
      changes: [
        upsert(4, U1, {
          username: 'ayse',
          displayName: 'Ayşe',
          email: 'a@example.com',
          version: 2,
        }),
        remove(5, U1, 'deleted', { username: 'ayse', displayName: 'Ayşe' }),
        remove(6, U1, 'unentitled', { username: 'ayse', email: 'a@example.com' }),
      ],
    }),
  );
  const after = projection.getUser(U1);
  assert.equal(after.username, null);
  assert.equal(after.displayName, null);
  assert.equal(after.email, null);
  assert.deepEqual(after.roles, []);
  assert.equal(after.status, 'removed');
  assert.equal(after.removedReason, 'erased');
  assert.equal(after.erasedAt, erased.erasedAt);
  assert.equal(after.version, erased.version);
  assert.deepEqual(seen.upserts, [], 'an erased row reaches no hook but onErase');
  assert.deepEqual(seen.removes, []);
  assert.deepEqual(seen.erases, []);
  assert.deepEqual(
    projection.listUsers().map((u) => u.userId),
    [U2],
  );
  const raw = JSON.stringify(db.prepare('SELECT * FROM lamaste_users WHERE user_id = ?').get(U1));
  assert.ok(!raw.includes('ayse') && !raw.includes('Ayşe') && !raw.includes('example.com'));
  assert.deepEqual(projection.state(), { directoryId: DIR_A, cursor: 6 });
});

test('a reconcile that contradicts an erasure counts it as a mismatch; the erasure itself does not', () => {
  const { projection, seen } = fresh();
  projection.applyBatch(
    batch({
      reset: true,
      final: true,
      to: 3,
      changes: [
        upsert(1, U1, { username: 'ayse' }),
        upsert(2, U2, { username: 'mehmet' }),
        remove(3, U3, 'erased'),
      ],
    }),
  );
  projection.applyBatch(batch({ from: 3, to: 4, changes: [remove(4, U1, 'erased')] }));
  seen.erases.length = 0;

  // A healthy replay repeats the erasures: no mismatch, onErase again.
  const healthy = projection.applyBatch(
    batch({
      reset: true,
      reconcile: true,
      final: true,
      to: 4,
      changes: [
        upsert(2, U2, { username: 'mehmet' }),
        remove(3, U3, 'erased'),
        remove(4, U1, 'erased'),
      ],
    }),
  );
  assert.equal(healthy.mismatches, 0);
  assert.deepEqual(seen.erases.sort(), [U1, U3].sort());

  // A restored relay's replay: Ayşe a member again, Zeynep's tombstone with
  // a name. Both contradict an erasure; neither is written.
  seen.erases.length = 0;
  const restored = projection.applyBatch(
    batch({
      reset: true,
      reconcile: true,
      final: true,
      to: 3,
      changes: [
        upsert(1, U1, { username: 'ayse', displayName: 'Ayşe' }),
        upsert(2, U2, { username: 'mehmet' }),
        remove(3, U3, 'deleted', { username: 'zeynep' }),
      ],
    }),
  );
  assert.equal(restored.mismatches, 2);
  assert.equal(projection.getUser(U1).username, null);
  assert.equal(projection.getUser(U1).status, 'removed');
  assert.equal(projection.getUser(U3).username, null);
  assert.equal(projection.getUser(U3).removedReason, 'erased');
  assert.deepEqual(seen.erases, [], 'nothing was scrubbed again: nothing had come back');
  assert.deepEqual(
    projection.listUsers().map((u) => u.userId),
    [U2],
  );
});

test('an erased row found holding anything but its id is scrubbed again, with onErase', () => {
  const { db, projection, seen } = fresh();
  projection.applyBatch(
    batch({ reset: true, final: true, to: 2, changes: [upsert(1, U1), remove(2, U2, 'erased')] }),
  );
  // What a projection written before erasure became sticky could hold.
  db.prepare(
    "UPDATE lamaste_users SET username = 'zeynep', roles = '[\"viewer\"]', status = 'active' WHERE user_id = ?",
  ).run(U2);
  seen.erases.length = 0;
  const answer = projection.applyBatch(
    batch({ reset: true, reconcile: true, final: true, to: 2, changes: [upsert(1, U1)] }),
  );
  // Not mentioned, listed as a member, erased: scrubbed, counted.
  assert.equal(answer.mismatches, 1);
  const row = projection.getUser(U2);
  assert.equal(row.username, null);
  assert.equal(row.status, 'removed');
  assert.equal(row.removedReason, 'erased');
  assert.deepEqual(row.roles, []);
  assert.deepEqual(seen.erases, [U2]);

  db.prepare("UPDATE lamaste_users SET email = 'z@example.com' WHERE user_id = ?").run(U2);
  seen.erases.length = 0;
  projection.applyBatch(
    batch({ from: 2, to: 3, changes: [remove(3, U2, 'deleted', { username: 'zeynep' })] }),
  );
  assert.equal(projection.getUser(U2).email, null);
  assert.equal(projection.getUser(U2).username, null);
  assert.deepEqual(seen.erases, [U2]);
});
