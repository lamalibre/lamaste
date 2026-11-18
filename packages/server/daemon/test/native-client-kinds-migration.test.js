/**
 * Migration 0025 on a relay that already has native clients (4.14): every
 * client becomes a mobile client with each of its columns as it was, and
 * the unique key moves to (host_kind, host_id, kind) — a host may then hold
 * a desktop client beside its mobile one, never two of one kind.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'migrations',
  'state',
);

const COLUMNS = `client_id, host_kind, host_id, name, redirect_paths_json, access_token_minutes,
  idle_days, absolute_days, associations_json, enabled, created_at, updated_at, version`;

test('0025: 4.14 clients become mobile clients, column for column; one client of each kind per host', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-migration-0025-'));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { ensureMigrations } = await import('../src/lib/state-db.js');
    const before = path.join(dir, 'before');
    await mkdir(before);
    for (const file of await readdir(MIGRATIONS)) {
      if (file < '0025') await copyFile(path.join(MIGRATIONS, file), path.join(before, file));
    }
    const db = new DatabaseSync(path.join(dir, 'state.db'));
    await ensureMigrations(db, before);
    const insert = db.prepare(
      `INSERT INTO native_clients (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run(
      'lamaste-native-mobile',
      'site',
      'site-a',
      'Mobile',
      '["/oauth/callback"]',
      15,
      30,
      90,
      '{"ios":{"teamId":"ABCDE12345","bundleIds":["com.example.app"]}}',
      1,
      1000,
      2000,
      3,
    );
    insert.run(
      'lamaste-native-ops',
      'tunnel',
      'tunnel-b',
      'Ops',
      '["/cb"]',
      5,
      7,
      30,
      '{}',
      0,
      10,
      20,
      1,
    );
    const old = db.prepare(`SELECT ${COLUMNS} FROM native_clients ORDER BY client_id`).all();

    await ensureMigrations(db, MIGRATIONS);
    const rows = db.prepare('SELECT * FROM native_clients ORDER BY client_id').all();
    assert.deepEqual(
      rows.map((r) => [r.client_id, r.kind, r.loopback_paths_json]),
      [
        ['lamaste-native-mobile', 'mobile', '[]'],
        ['lamaste-native-ops', 'mobile', '[]'],
      ],
    );
    // Every 4.14 column carried over as it was.
    assert.deepEqual(
      db.prepare(`SELECT ${COLUMNS} FROM native_clients ORDER BY client_id`).all(),
      old,
    );

    const add = (id, kind) =>
      db
        .prepare(
          `INSERT INTO native_clients (client_id, kind, host_kind, host_id, name,
             loopback_paths_json, access_token_minutes, idle_days, absolute_days,
             created_at, updated_at)
           VALUES (?, ?, 'site', 'site-a', 'Desk', '["/callback"]', 15, 30, 90, 1, 1)`,
        )
        .run(id, kind);
    // A desktop client beside the mobile one; a second of either kind is refused.
    add('lamaste-native-desk', 'desktop');
    assert.throws(() => add('lamaste-native-desk2', 'desktop'), /UNIQUE/);
    assert.throws(() => add('lamaste-native-mobile2', 'mobile'), /UNIQUE/);
    assert.throws(() => add('lamaste-native-other', 'watch'), /CHECK/);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
