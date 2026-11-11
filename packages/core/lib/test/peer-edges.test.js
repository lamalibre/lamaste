import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PEER_EDGES_WAIT_MAX_MS,
  parsePeerEdgesAnswer,
  parsePeerEdgesRequest,
  peerEdgesAnswer,
} from '../dist/index.js';

const EDGE = {
  scope: 'directory:read',
  provider: 'directory',
  major: 1,
  required: true,
  events: ['unit.renamed', 'unit.closed'],
  effective: true,
  reason: null,
};

test('the answer is canonical: sorted by scope, events sorted, the digest of that', () => {
  const other = { ...EDGE, scope: 'archive:read', provider: 'archive', events: [] };
  const a = peerEdgesAnswer([EDGE, other]);
  const b = peerEdgesAnswer([other, { ...EDGE, events: ['unit.closed', 'unit.renamed'] }]);
  assert.equal(a.digest, b.digest);
  assert.deepEqual(
    a.consumes.map((e) => e.scope),
    ['archive:read', 'directory:read'],
  );
  assert.deepEqual(a.consumes[1].events, ['unit.closed', 'unit.renamed']);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
  assert.notEqual(
    peerEdgesAnswer([{ ...EDGE, required: false }]).digest,
    peerEdgesAnswer([EDGE]).digest,
  );
});

test('an answer is parsed only when well formed and its digest matches', () => {
  const answer = peerEdgesAnswer([
    EDGE,
    {
      ...EDGE,
      scope: 'mailer:send',
      provider: 'mailer',
      events: [],
      effective: false,
      reason: 'not_granted',
    },
  ]);
  assert.deepEqual(parsePeerEdgesAnswer(JSON.parse(JSON.stringify(answer))), answer);
  // A reason a newer relay adds is accepted.
  const newer = peerEdgesAnswer([
    { ...EDGE, effective: false, events: [], reason: 'some_new_reason' },
  ]);
  assert.ok(parsePeerEdgesAnswer(newer));

  const bad = [
    { ...answer, digest: '0'.repeat(64) },
    peerEdgesAnswer([{ ...EDGE, provider: 'elsewhere' }]),
    { digest: peerEdgesAnswer([EDGE]).digest, consumes: [{ ...EDGE, reason: 'not_granted' }] },
    peerEdgesAnswer([{ ...EDGE, effective: false, reason: null }]),
    peerEdgesAnswer([{ ...EDGE, effective: false, reason: 'Not Granted' }]),
    peerEdgesAnswer([{ ...EDGE, major: 0 }]),
    peerEdgesAnswer([EDGE, EDGE]),
    peerEdgesAnswer([{ ...EDGE, scope: 'not a scope' }]),
    null,
    { digest: answer.digest },
  ];
  for (const value of bad) assert.equal(parsePeerEdgesAnswer(value), null, JSON.stringify(value));
});

test('a request: a digest or null, a wait within bounds', () => {
  assert.deepEqual(parsePeerEdgesRequest({ digest: null, waitMs: 0 }), { digest: null, waitMs: 0 });
  const digest = 'a'.repeat(64);
  assert.deepEqual(parsePeerEdgesRequest({ digest, waitMs: PEER_EDGES_WAIT_MAX_MS }), {
    digest,
    waitMs: PEER_EDGES_WAIT_MAX_MS,
  });
  for (const value of [
    { digest: 'abc', waitMs: 0 },
    { digest: null, waitMs: PEER_EDGES_WAIT_MAX_MS + 1 },
    { digest: null, waitMs: -1 },
    { digest: null },
    [],
  ]) {
    assert.equal(parsePeerEdgesRequest(value), null);
  }
});
