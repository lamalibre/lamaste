/**
 * Slice 8 contracts: the `peers` manifest block, the endpoint matcher, the
 * `peer` caller and its path boundary, delegations, the `/peer` hook
 * surface and the approval digest.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ManifestSchema,
  PeersBlockSchema,
  RESERVED_API_PREFIXES,
  approvalDigest,
  generateCallerAssertionNonce,
  generateHostingSecret,
  generatePeerDelegationKey,
  matchPeerEndpoint,
  NonceStore,
  normalizePeersBlock,
  onwardPeerDelegation,
  parseCallerIdentity,
  parsePeerEndpointPath,
  peerEndpointAdmitsRoute,
  peerScopeProvider,
  peersBreaks,
  peersDiff,
  isAgentHalfPeerPath,
  isUnderAgentHalfPeer,
  PEER_DELEGATION_LIFETIME_MS,
  signCallerAssertion,
  signPeerDelegation,
  verifyCallerAssertion,
  verifyPeerDelegation,
} from '../dist/index.js';
import { isAgentHalfReservedPath } from '../dist/server/index.js';
import { parseRoutePattern } from '../dist/hooks/index.js';

const USER_ID = '8d0e6a5c-3f1b-4b7a-9c2d-1e4f5a6b7c8d';

function scope(endpoints, extra = {}) {
  return PeersBlockSchema.parse({
    provides: { 'directory:read': { description: 'Read', endpoints, ...extra } },
  }).provides['directory:read'];
}

function manifest(name, peers, extra = {}) {
  return {
    name,
    version: '1.0.0',
    hosting: 'agent',
    agent: {},
    peers,
    ...extra,
  };
}

// --- endpoint patterns and matching -----------------------------------------

test('endpoint paths: literals, :params, a final *', () => {
  assert.deepEqual(parsePeerEndpointPath('/units/:unitId/*'), [
    { kind: 'literal', value: 'units' },
    { kind: 'param', name: 'unitId' },
    { kind: 'rest' },
  ]);
  for (const bad of [
    'units',
    '/',
    '/a//b',
    '/a/',
    '/*/b',
    '/a/..',
    '/a/%2e',
    '/:x/:x',
    '/:1x',
    '/a?b=1',
    `/${'a'.repeat(200)}`,
  ]) {
    assert.ok('error' in parsePeerEndpointPath(bad), bad);
  }
});

test('an allowlisted :param reports its pattern — a sibling static route stays the provider’s to refuse', () => {
  const s = scope([{ method: 'GET', path: '/units/:unitId' }]);
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/42'), 'GET /units/:unitId');
  // `/units/export` matches the pattern too; the assertion names the
  // pattern, and the provider's route `/peer/units/export` is not it.
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/export'), 'GET /units/:unitId');
  assert.equal(peerEndpointAdmitsRoute('GET /units/:unitId', 'GET', '/peer/units/export'), false);
  assert.equal(peerEndpointAdmitsRoute('GET /units/:unitId', 'GET', '/peer/units/:id'), true);
  assert.equal(peerEndpointAdmitsRoute('GET /units/:unitId', 'GET', '/units/:unitId'), true);
  assert.equal(peerEndpointAdmitsRoute('GET /units/:unitId', 'HEAD', '/peer/units/:id'), true);
  assert.equal(peerEndpointAdmitsRoute('GET /units/:unitId', 'POST', '/peer/units/:id'), false);
  assert.equal(peerEndpointAdmitsRoute('GET /files/*', 'GET', '/peer/files/*'), true);
  assert.equal(peerEndpointAdmitsRoute('nonsense', 'GET', '/peer/x'), false);
});

test('the most specific endpoint wins, as the provider’s router picks', () => {
  const s = scope([
    { method: 'GET', path: '/units/:unitId' },
    { method: 'GET', path: '/units/export' },
    { method: 'GET', path: '/units/*' },
  ]);
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/export'), 'GET /units/export');
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/7'), 'GET /units/:unitId');
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/7/members'), 'GET /units/*');
});

test('matching errs towards refusing: raw, case-sensitive, no escapes in literals, no unsafe segments', () => {
  const s = scope([
    { method: 'GET', path: '/units/:unitId' },
    { method: 'POST', path: '/people/lookup' },
  ]);
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/42?full=1'), 'GET /units/:unitId');
  assert.equal(matchPeerEndpoint(s, 1, 'HEAD', '/units/42'), 'GET /units/:unitId');
  assert.equal(matchPeerEndpoint(s, 1, 'get', '/units/42'), 'GET /units/:unitId');
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/Units/42'), null);
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/%75nits/42'), null);
  assert.equal(matchPeerEndpoint(s, 1, 'POST', '/people/%6cookup'), null);
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/a%40b'), 'GET /units/:unitId');
  for (const unsafe of [
    '/units/..',
    '/units/%2e%2e',
    '/units/a%2fb',
    '/units/a%5cb',
    '/units/a\\b',
    '/units/%252e',
    '/units/%zz',
    '/units/42/',
    '//units/42',
    'units/42',
  ]) {
    assert.equal(matchPeerEndpoint(s, 1, 'GET', unsafe), null, unsafe);
  }
  assert.equal(matchPeerEndpoint(s, 1, 'DELETE', '/units/42'), null);
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/people/lookup'), null);
});

test('majors: per scope, narrowed per endpoint', () => {
  const s = scope(
    [
      { method: 'GET', path: '/units/:unitId' },
      { method: 'POST', path: '/people/lookup', majors: [2] },
    ],
    { majors: [1, 2] },
  );
  assert.equal(matchPeerEndpoint(s, 1, 'GET', '/units/1'), 'GET /units/:unitId');
  assert.equal(matchPeerEndpoint(s, 2, 'GET', '/units/1'), 'GET /units/:unitId');
  assert.equal(matchPeerEndpoint(s, 1, 'POST', '/people/lookup'), null);
  assert.equal(matchPeerEndpoint(s, 2, 'POST', '/people/lookup'), 'POST /people/lookup');
  assert.equal(matchPeerEndpoint(s, 3, 'GET', '/units/1'), null);
});

// --- the manifest block -------------------------------------------------------

test('the block: defaults, refusals', () => {
  const block = PeersBlockSchema.parse({
    provides: {
      'directory:read': { description: 'Read', endpoints: [{ method: 'GET', path: '/x' }] },
    },
    consumes: { 'notices:send': { required: false, reason: 'Tell people' } },
  });
  assert.deepEqual(block.provides['directory:read'].majors, [1]);
  assert.deepEqual(block.provides['directory:read'].events, []);
  assert.equal(block.consumes['notices:send'].major, 1);

  const refused = [
    {},
    {
      provides: {
        'Directory:read': { description: 'x', endpoints: [{ method: 'GET', path: '/x' }] },
      },
    },
    { provides: { 'directory:read': { description: 'x', endpoints: [] } } },
    {
      provides: {
        'directory:read': {
          description: 'x',
          endpoints: [
            { method: 'GET', path: '/u/:a' },
            { method: 'GET', path: '/u/:b' },
          ],
        },
      },
    },
    {
      provides: {
        'directory:read': {
          description: 'x',
          majors: [1],
          endpoints: [{ method: 'GET', path: '/u', majors: [2] }],
        },
      },
    },
    {
      provides: {
        'directory:read': {
          description: 'x',
          endpoints: [{ method: 'GET', path: '/u' }],
          events: ['Person.Changed'],
        },
      },
    },
    {
      provides: {
        'directory:read': { description: 'x', endpoints: [{ method: 'TRACE', path: '/u' }] },
      },
    },
    { consumes: { 'notices:send': { required: true, reason: 'x', events: ['a', 'a'] } } },
    { consumes: { 'notices:send': { required: true, reason: 'bad‮text' } } },
    { other: {} },
  ];
  for (const raw of refused) {
    assert.equal(PeersBlockSchema.safeParse(raw).success, false, JSON.stringify(raw));
  }
});

test('the manifest: an agent half, own scopes provided, others consumed', () => {
  const peers = {
    provides: {
      'directory:read': { description: 'Read', endpoints: [{ method: 'GET', path: '/x' }] },
    },
    consumes: { 'notices:send': { required: true, reason: 'Tell people' } },
  };
  assert.equal(ManifestSchema.safeParse(manifest('directory', peers)).success, true);
  assert.equal(peerScopeProvider('notices:send'), 'notices');

  const parsed = ManifestSchema.parse(manifest('directory', peers));
  assert.deepEqual(Object.keys(parsed.peers.provides), ['directory:read']);

  // Another route's scope provided; its own consumed; no agent half.
  assert.equal(ManifestSchema.safeParse(manifest('people', peers)).success, false);
  assert.equal(
    ManifestSchema.safeParse(
      manifest('directory', { consumes: { 'directory:read': { required: true, reason: 'x' } } }),
    ).success,
    false,
  );
  assert.equal(
    ManifestSchema.safeParse({ name: 'directory', version: '1.0.0', hosting: 'agent', peers })
      .success,
    false,
  );
  assert.equal(
    ManifestSchema.safeParse({ name: 'directory', version: '1.0.0', peers }).success,
    false,
  );
});

test('peers is a reserved API prefix', () => {
  assert.ok(RESERVED_API_PREFIXES.includes('peers'));
});

// --- diff and breaks -------------------------------------------------------

const BEFORE = {
  provides: {
    'directory:read': {
      description: 'Read',
      majors: [1, 2],
      endpoints: [
        { method: 'GET', path: '/units/:unitId' },
        { method: 'POST', path: '/people/lookup', majors: [2] },
      ],
      events: ['person.unit-changed', 'unit.renamed'],
    },
  },
  consumes: { 'notices:send': { required: true, reason: 'x' } },
};

test('peersDiff: narrowing is not widening; a new endpoint, major, event, consume or subscription is', () => {
  const narrowed = structuredClone(BEFORE);
  narrowed.provides['directory:read'].events = ['unit.renamed'];
  narrowed.consumes['notices:send'].required = false;
  const d = peersDiff(BEFORE, narrowed);
  assert.equal(d.widened, false);
  assert.deepEqual(d.provides.eventsRemoved, [
    { scope: 'directory:read', type: 'person.unit-changed' },
  ]);
  assert.deepEqual(d.consumes.requiredChanged, [{ scope: 'notices:send', from: true, to: false }]);

  const widenings = [
    (b) => b.provides['directory:read'].endpoints.push({ method: 'GET', path: '/units' }),
    (b) => {
      b.provides['directory:read'].endpoints[1].majors = [1, 2];
    },
    (b) => b.provides['directory:read'].events.push('unit.removed'),
    (b) => {
      b.consumes['media:read'] = { required: false, reason: 'y' };
    },
    (b) => {
      b.consumes['notices:send'].events = ['notice.sent'];
    },
    (b) => {
      b.consumes['notices:send'].major = 2;
    },
  ];
  for (const change of widenings) {
    const after = structuredClone(BEFORE);
    change(after);
    assert.equal(peersDiff(BEFORE, after).widened, true, change.toString());
  }
  assert.equal(peersDiff(null, BEFORE).widened, true);
  assert.equal(peersDiff(BEFORE, null).widened, false);
  assert.deepEqual(peersDiff(BEFORE, structuredClone(BEFORE)).provides.endpointsAdded, []);
});

test('peersBreaks: what a provider update takes from the edges that use it', () => {
  const used = [
    { consumer: 'leave', scope: 'directory:read', major: 2, events: ['person.unit-changed'] },
    { consumer: 'expenses', scope: 'directory:read', major: 1, events: [] },
  ];
  const after = structuredClone(BEFORE);
  after.provides['directory:read'].endpoints = [{ method: 'GET', path: '/units/:unitId' }];
  after.provides['directory:read'].events = ['unit.renamed'];
  after.provides['directory:read'].majors = [2];
  assert.deepEqual(peersBreaks(BEFORE, after, used), [
    {
      consumer: 'leave',
      scope: 'directory:read',
      reason: 'endpoints_removed',
      major: 2,
      endpoints: ['POST /people/lookup'],
    },
    {
      consumer: 'leave',
      scope: 'directory:read',
      reason: 'events_removed',
      events: ['person.unit-changed'],
    },
    { consumer: 'expenses', scope: 'directory:read', reason: 'major_removed', major: 1 },
  ]);
  assert.deepEqual(peersBreaks(BEFORE, { consumes: BEFORE.consumes }, used.slice(1)), [
    { consumer: 'expenses', scope: 'directory:read', reason: 'scope_removed' },
  ]);
  assert.deepEqual(peersBreaks(BEFORE, BEFORE, used), []);
});

// --- the approval digest ---------------------------------------------------

const AGENT_HALF = {
  package: '@lamalibre/fixture-agent',
  version: '1.0.0',
  integrity: `sha512-${'A'.repeat(86)}==`,
  service: { entry: 'dist/agentd.mjs', memoryMax: null },
  systemPackages: [],
};

test('the digest covers peers only when declared, in canonical form', () => {
  const without = approvalDigest({ relay: null, agentHalf: AGENT_HALF });
  assert.equal(approvalDigest({ relay: null, agentHalf: AGENT_HALF, peers: null }), without);
  const withPeers = approvalDigest({ relay: null, agentHalf: AGENT_HALF, peers: BEFORE });
  assert.notEqual(withPeers, without);
  // Order does not matter; content does.
  const reordered = structuredClone(BEFORE);
  reordered.provides['directory:read'].endpoints.reverse();
  reordered.provides['directory:read'].events.reverse();
  reordered.provides['directory:read'].majors = [2, 1];
  assert.equal(approvalDigest({ relay: null, agentHalf: AGENT_HALF, peers: reordered }), withPeers);
  const changed = structuredClone(BEFORE);
  changed.consumes['notices:send'].reason = 'other';
  assert.notEqual(
    approvalDigest({ relay: null, agentHalf: AGENT_HALF, peers: changed }),
    withPeers,
  );
  // Pinned: a later release must not change what an approval of this covered.
  assert.equal(withPeers, PINNED_PEERS_DIGEST);
  assert.throws(() => approvalDigest({ relay: null, agentHalf: AGENT_HALF, peers: {} }));
  assert.deepEqual(normalizePeersBlock(reordered), normalizePeersBlock(BEFORE));
});

const PINNED_PEERS_DIGEST = '18b97a173bbc57dd958c02869e9e8071b632da35082c79f4e688605fa257cd76';

// --- the peer caller and its path boundary --------------------------------

const PEER_CALLER = {
  type: 'peer',
  peer: 'leave',
  scope: 'directory:read',
  major: 1,
  endpoint: 'GET /units/:unitId',
  hops: 1,
};

test('peer paths: /peer literally for a peer, never for anyone else, however spelled', () => {
  assert.ok(isAgentHalfPeerPath('/peer/units/1'));
  assert.ok(isAgentHalfPeerPath('/peer?x=1'));
  assert.ok(!isAgentHalfPeerPath('/peers/x'));
  assert.ok(!isAgentHalfPeerPath('/peer/%2e%2e/admin'));
  for (const p of ['/peer/x', '/Peer/x', '/%70eer/x', '/peers', '/peer.json', '/%zz']) {
    assert.ok(isUnderAgentHalfPeer(p), p);
  }
  assert.ok(!isUnderAgentHalfPeer('/admin/peers/attach'));
});

test('a peer caller parses strictly', () => {
  assert.deepEqual(parseCallerIdentity({ ...PEER_CALLER, extra: 1 }), PEER_CALLER);
  const withUser = {
    ...PEER_CALLER,
    user: { userId: USER_ID, username: 'ayse', roles: ['viewer'], email: 'x' },
  };
  assert.deepEqual(parseCallerIdentity(withUser), {
    ...PEER_CALLER,
    user: { userId: USER_ID, username: 'ayse', roles: ['viewer'] },
  });
  for (const bad of [
    { ...PEER_CALLER, hops: 0 },
    { ...PEER_CALLER, hops: 5 },
    { ...PEER_CALLER, hops: 1.5 },
    { ...PEER_CALLER, major: 0 },
    { ...PEER_CALLER, scope: 'directory' },
    { ...PEER_CALLER, peer: 'Leave' },
    { ...PEER_CALLER, endpoint: 'GET units' },
    { ...PEER_CALLER, endpoint: undefined },
    { ...PEER_CALLER, user: { userId: USER_ID, username: 'ayse', roles: [] } },
    { ...PEER_CALLER, user: { userId: 'x', username: 'ayse', roles: ['viewer'] } },
    { ...PEER_CALLER, user: null },
  ]) {
    assert.equal(parseCallerIdentity(bad), null, JSON.stringify(bad));
  }
});

test('signing and verifying: a peer only under /peer, nobody else there', () => {
  const secret = generateHostingSecret();
  const nonces = new NonceStore();
  const header = signCallerAssertion(
    { plugin: 'directory', caller: PEER_CALLER, method: 'GET', path: '/peer/units/1' },
    secret,
  );
  const ok = verifyCallerAssertion(header, {
    secrets: [secret],
    plugin: 'directory',
    method: 'GET',
    path: '/peer/units/1',
    nonces,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.payload.caller, PEER_CALLER);

  assert.throws(() =>
    signCallerAssertion(
      { plugin: 'directory', caller: PEER_CALLER, method: 'GET', path: '/admin/x' },
      secret,
    ),
  );
  for (const path of ['/peer/x', '/Peer/x', '/%70eer/x']) {
    assert.throws(
      () =>
        signCallerAssertion(
          { plugin: 'directory', caller: { type: 'admin' }, method: 'GET', path },
          secret,
        ),
      path,
    );
  }
  assert.throws(() =>
    signCallerAssertion(
      {
        plugin: 'directory',
        caller: { type: 'user', userId: USER_ID, username: 'ayse', roles: ['viewer'] },
        method: 'GET',
        path: '/peer/x',
      },
      secret,
    ),
  );
  // Lamaste's own routes for peers stay Lamaste's.
  assert.doesNotThrow(() =>
    signCallerAssertion(
      {
        plugin: 'directory',
        caller: { type: 'lamaste' },
        method: 'GET',
        path: '/admin/peers/attach',
      },
      secret,
    ),
  );
  assert.equal(generateCallerAssertionNonce().length, 32);
});

test('the forwarder never reaches /admin/peers*', () => {
  for (const p of ['/admin/peers', '/admin/peers/attach', '/admin/Peers/x', '/admin/%70eers']) {
    assert.ok(isAgentHalfReservedPath(p), p);
  }
  assert.ok(!isAgentHalfReservedPath('/admin/people'));
});

test('hook route patterns: the /peer surface', () => {
  const pattern = parseRoutePattern('POST /peer/people/*');
  assert.equal(pattern.surface, 'peer');
  assert.ok('error' in parseRoutePattern('GET /other/x'));
});

// --- delegations -----------------------------------------------------------

test('a delegation verifies for its holder only, until it expires', () => {
  const key = generatePeerDelegationKey('k1');
  const now = 1_800_000_000_000;
  const token = signPeerDelegation(
    { holder: 'leave', root: 'leave', userId: USER_ID, iat: now },
    key,
  );
  const ok = verifyPeerDelegation(token, { keys: [key], holder: 'leave', now: now + 1000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.exp, now + PEER_DELEGATION_LIFETIME_MS);
  assert.equal(ok.payload.depth, 0);

  const reasons = (t, opts) => {
    const r = verifyPeerDelegation(t, { keys: [key], holder: 'leave', now: now + 1000, ...opts });
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reasons(token, { holder: 'expenses' }), 'wrong_holder');
  assert.equal(reasons(token, { now: now + PEER_DELEGATION_LIFETIME_MS }), 'expired');
  assert.equal(reasons(token, { now: now - 60_000 }), 'future');
  assert.equal(reasons(token, { keys: [generatePeerDelegationKey('k2')] }), 'unknown_key');
  assert.equal(
    reasons(token, { keys: [{ kid: 'k1', secret: generatePeerDelegationKey().secret }] }),
    'bad_signature',
  );
  const [payload, mac] = token.split('.');
  const forged = JSON.parse(Buffer.from(payload, 'base64url').toString());
  forged.userId = '11111111-1111-4111-8111-111111111111';
  assert.equal(
    reasons(`${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`),
    'bad_signature',
  );
  for (const bad of ['', 'x', 'a.b.c', `${payload}.`, 42, null]) {
    assert.equal(reasons(bad), 'malformed');
  }
  // A lifetime beyond the maximum is not one the relay issues.
  const long = JSON.parse(Buffer.from(payload, 'base64url').toString());
  long.exp = long.iat + PEER_DELEGATION_LIFETIME_MS + 1;
  assert.equal(
    reasons(`${Buffer.from(JSON.stringify(long)).toString('base64url')}.${mac}`),
    'malformed',
  );
});

test('onward delegations: the provider holds them, deeper, never outliving the parent', () => {
  const key = generatePeerDelegationKey('k1');
  const now = 1_800_000_000_000;
  let token = signPeerDelegation(
    { holder: 'leave', root: 'leave', userId: USER_ID, iat: now },
    key,
  );
  let holder = 'leave';
  for (const next of ['directory', 'notices', 'media']) {
    const parent = verifyPeerDelegation(token, { keys: [key], holder, now: now + 60_000 });
    assert.equal(parent.ok, true);
    token = onwardPeerDelegation(parent.payload, next, key, now + 60_000);
    assert.ok(token, next);
    holder = next;
    const child = verifyPeerDelegation(token, { keys: [key], holder, now: now + 60_000 });
    assert.equal(child.payload.exp, now + PEER_DELEGATION_LIFETIME_MS);
    assert.equal(child.payload.root, 'leave');
  }
  const last = verifyPeerDelegation(token, { keys: [key], holder, now: now + 60_000 });
  assert.equal(last.payload.depth, 3);
  assert.equal(onwardPeerDelegation(last.payload, 'search', key, now + 60_000), null);
  assert.throws(() =>
    signPeerDelegation({ holder: 'a', root: 'a', userId: USER_ID, depth: 4 }, key),
  );
});
