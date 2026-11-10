/**
 * `lamaste-server peers` and the removal flags of `plugins`: `apply` checks
 * its arguments and reads a shelf's scope graph (the manifest's `scopes`
 * block or the whole manifest) before asking the panel; `list` prints each
 * edge with its state; `--break-peers` is its own flag, never implied by
 * `--force`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseApplyArgs, scopesFromText, shelfLines } from '../src/commands/peers.js';
import { removalQuery } from '../src/commands/plugins.js';

test('apply: a shelf id that is a DNS label and a file, in either order', () => {
  assert.deepEqual(parseApplyArgs(['ops', '--file', 's.json']), {
    ok: true,
    shelfId: 'ops',
    file: 's.json',
  });
  assert.deepEqual(parseApplyArgs(['--file', 's.json', 'ops']).shelfId, 'ops');
  for (const args of [
    [],
    ['ops'],
    ['--file', 's.json'],
    ['ops', 'x', '--file', 'f'],
    ['Ops', '--file', 'f'],
  ]) {
    assert.equal(parseApplyArgs(args).ok, false, JSON.stringify(args));
  }
});

test('the scope graph: a scopes block or a whole shelf manifest; nothing else', () => {
  const scopes = { 'dir:read': { provider: 'dir', consumers: ['leave'] } };
  assert.deepEqual(scopesFromText(JSON.stringify(scopes)), { ok: true, scopes });
  assert.deepEqual(scopesFromText(JSON.stringify({ id: 'ops', scopes })), { ok: true, scopes });
  for (const text of ['{', '[]', 'null', '"x"']) assert.equal(scopesFromText(text).ok, false, text);
});

test('list: each edge with its state, a pending one with the reason', () => {
  const lines = shelfLines({
    shelfId: 'ops',
    appliedAt: '2026-11-10T10:00:00.000Z',
    appliedBy: 'admin',
    edges: [
      { consumer: 'leave', scope: 'dir:read', provider: 'dir', state: 'effective' },
      {
        consumer: 'old',
        scope: 'dir:read',
        provider: 'dir',
        state: 'pending',
        reason: 'major_mismatch',
      },
    ],
  });
  assert.match(lines[0], /^ops {2}applied .* by admin$/);
  assert.match(lines[1], /leave → dir:read \(dir\) {2}effective/);
  assert.match(lines[2], /pending: major_mismatch/);
  assert.deepEqual(shelfLines({ shelfId: 'x', appliedAt: 't', edges: [] }).slice(1), [
    '    (no edges)',
  ]);
});

test('removal flags: only those set; --break-peers is its own', () => {
  assert.equal(removalQuery({}), '');
  assert.equal(removalQuery({ force: true }), '?force=true');
  assert.equal(removalQuery({ breakPeers: true }), '?breakPeers=true');
  assert.equal(
    removalQuery({ force: true, purge: true, breakPeers: true }),
    '?force=true&purge=true&breakPeers=true',
  );
});
