/**
 * Migration 0010 on a relay that already has plugins: every row gets its
 * route (`derivePluginRoute` of its name), and where plugins installed
 * before the rule share one, the plugin installed first keeps it and the
 * others hold none — so the unique index can be created and the relay
 * starts. The retained-data table starts empty.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { derivePluginRoute } from '@lamalibre/lamaste';

const MIGRATIONS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'lib',
  'migrations',
  'state',
);

test('0010: routes are backfilled; a shared route stays with the plugin installed first', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-migration-0010-'));
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { ensureMigrations } = await import('../src/lib/state-db.js');
    const before = path.join(dir, 'before');
    await mkdir(before);
    for (const file of await readdir(MIGRATIONS)) {
      if (file < '0010') await copyFile(path.join(MIGRATIONS, file), path.join(before, file));
    }
    const db = new DatabaseSync(path.join(dir, 'state.db'));
    await ensureMigrations(db, before);
    const insert = db.prepare(
      `INSERT INTO plugins (name, package_name, version, status, installed_at)
       VALUES (?, ?, '1.0.0', 'disabled', ?)`,
    );
    insert.run('fx', '@lamalibre/fx', '2026-01-02T00:00:00.000Z');
    insert.run('fx-server', '@lamalibre/fx-server', '2026-01-03T00:00:00.000Z');
    insert.run('gx-server', '@lamalibre/gx-server', '2026-01-01T00:00:00.000Z');
    insert.run('gx-agent', '@lamalibre/gx-agent', '2026-01-01T00:00:00.000Z');
    insert.run('herd-server', '@lamalibre/herd-server', '2026-01-05T00:00:00.000Z');
    insert.run('serverless', '@lamalibre/serverless', '2026-01-06T00:00:00.000Z');

    await ensureMigrations(db, MIGRATIONS);
    const routes = Object.fromEntries(
      db
        .prepare('SELECT name, route FROM plugins')
        .all()
        .map((r) => [r.name, r.route]),
    );
    assert.deepEqual(routes, {
      fx: 'fx',
      'fx-server': null, // installed after fx
      'gx-agent': 'gx', // same install time: the first name keeps it
      'gx-server': null,
      'herd-server': 'herd',
      serverless: 'serverless',
    });
    // The SQL agrees with derivePluginRoute wherever a route was kept.
    for (const [name, route] of Object.entries(routes)) {
      if (route !== null) assert.equal(route, derivePluginRoute(name));
    }
    // From now on the index holds: a second plugin on a route is refused.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO plugins (name, route, package_name, version, status, installed_at)
             VALUES ('herd-agent', 'herd', '@lamalibre/herd-agent', '1.0.0', 'disabled', '2026')`,
          )
          .run(),
      /UNIQUE/,
    );
    assert.deepEqual(db.prepare('SELECT * FROM retained_agent_data').all(), []);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
