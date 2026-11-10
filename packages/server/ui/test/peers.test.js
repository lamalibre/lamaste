/**
 * Calls and events between app plugins, in the panel's words: which applied
 * edges touch a plugin (once each, with the shelves granting it), why an
 * edge is pending, and what an administrator may paste as a shelf.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  breakReasonText,
  channelStateText,
  declaresPeers,
  edgesOf,
  parseShelfScopes,
  pendingReasonText,
} from '../src/admin/lib/peers.js';

const view = {
  shelves: [
    {
      shelfId: 'ops',
      edges: [
        {
          scope: 'dir:read',
          provider: 'dir',
          consumer: 'leave',
          state: 'pending',
          reason: 'consumer_not_approved',
        },
        { scope: 'notes:send', provider: 'notes', consumer: 'dir', state: 'effective' },
      ],
    },
    {
      shelfId: 'hr',
      edges: [{ scope: 'dir:read', provider: 'dir', consumer: 'leave', state: 'effective' }],
    },
  ],
};

test('edgesOf: into and out of a plugin, once per consumer and scope, effective if any shelf says so', () => {
  const { incoming, outgoing } = edgesOf(view, 'dir');
  assert.equal(incoming.length, 1);
  assert.deepEqual(incoming[0].shelves, ['ops', 'hr']);
  assert.equal(incoming[0].state, 'effective');
  assert.equal(incoming[0].reason, null);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].provider, 'notes');
  assert.deepEqual(edgesOf(undefined, 'dir'), { incoming: [], outgoing: [] });
});

test('reasons and states read in words; an unknown one shows as it came', () => {
  assert.match(pendingReasonText('major_mismatch'), /major/);
  assert.equal(pendingReasonText('something_new'), 'something_new');
  assert.match(breakReasonText('endpoints_removed'), /endpoints/);
  assert.equal(channelStateText(null), 'no channel');
  assert.equal(channelStateText({ state: 'attached' }), 'attached');
});

test('declaresPeers: only a block that provides or consumes something', () => {
  assert.equal(declaresPeers(null), false);
  assert.equal(declaresPeers({ provides: {}, consumes: {} }), false);
  assert.equal(declaresPeers({ provides: {}, consumes: { 'a:b': {} } }), true);
});

test('parseShelfScopes: a scopes block or a whole shelf manifest; anything else refused', () => {
  const scopes = { 'dir:read': { provider: 'dir', consumers: ['leave'] } };
  assert.deepEqual(parseShelfScopes(JSON.stringify(scopes)), { scopes });
  assert.deepEqual(parseShelfScopes(JSON.stringify({ id: 'ops', scopes })), { scopes });
  assert.ok(parseShelfScopes('{').error);
  assert.ok(parseShelfScopes('[]').error);
  assert.ok(parseShelfScopes('null').error);
});
