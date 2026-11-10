/**
 * Slice 8, end to end in one process: a relay (peer channel manager, channel
 * server, gateway) and two agent halves on loopback ports — a consumer with
 * `createPeers` attached to its Fastify server, a provider with
 * `peerSurface`, `peerRoute` and an outbox over node:sqlite. Calls, the
 * relay's refusals, the provider's own guard, users, hops, a provider down,
 * a replaced channel with a call in flight, large and streamed bodies, and
 * events: delivery, gaps, the consumer restarting, uncommitted events.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import http2 from 'node:http2';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';

import {
  callAgentHalf,
  generateHostingSecret,
  peerSubscriptionEpoch,
  PeersBlockSchema,
} from '../dist/index.js';
import {
  createCallerAssertionVerifier,
  createPeerOutbox,
  createPeers,
  PeerCallError,
  peerRoute,
  peerSurface,
} from '../dist/agent/index.js';
import {
  createPeerChannelManager,
  createPeerChannelServer,
  createPeerGateway,
} from '../dist/server/index.js';
import { setPeerContext } from '../dist/agent/peer-context.js';

const PEERS = {
  provides: {
    'directory:read': {
      description: 'Read units',
      majors: [1],
      endpoints: [
        { method: 'GET', path: '/units/:unitId' },
        { method: 'POST', path: '/upload' },
        { method: 'GET', path: '/stream' },
        { method: 'GET', path: '/slow' },
        { method: 'GET', path: '/onward' },
        { method: 'GET', path: '/odd-headers' },
      ],
      events: ['unit.renamed', 'unit.closed'],
    },
  },
  consumes: {},
};
const PROVIDED = PeersBlockSchema.parse(PEERS).provides['directory:read'];

const USER = {
  userId: '0b6f1f0c-4b0a-4c8e-9d1e-1b2c3d4e5f60',
  username: 'alice',
  roles: ['viewer'],
};

let dir;
let relay;
let provider;
let consumer;
const state = {
  granted: true,
  providerUp: true,
  epochSeq: 1,
  subscribed: ['unit.closed', 'unit.renamed'],
  slowWaiters: [],
  slowCancelled: 0,
  consumerAllowed: true,
  recheckAllowed: true,
  delegationLifetimeMs: 5 * 60 * 1000,
  maxBodyBytes: 100 * 1024 * 1024,
  failGaps: 0,
  pullSlotTaken: false,
};
const denials = [];
/** The relay's event floors, as serverd keeps them: (consumer scope) → { epoch, streamId, floor }. */
const floors = new Map();
let gatewayOptions;

function releaseSlow() {
  for (const resolve of state.slowWaiters.splice(0)) resolve();
}

async function writeConfig(file, plugin, port, secret) {
  await writeFile(
    file,
    JSON.stringify({
      plugin,
      port,
      secret,
      issuedAt: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      acknowledged: true,
    }),
  );
}

async function startProvider() {
  const secret = generateHostingSecret();
  const configPath = path.join(dir, 'directory.json');
  const dbPath = path.join(dir, 'directory.db');
  const db = new DatabaseSync(dbPath);
  const app = Fastify();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.server.address().port;
  await writeConfig(configPath, 'directory', port, secret);
  // listen() before routes is not possible in Fastify: rebuild on the port.
  await app.close();
  const verifier = createCallerAssertionVerifier({ configPath, plugin: 'directory' });
  const outbox = await createPeerOutbox({ db, dbPath, peers: PEERS });
  const server = Fastify();
  await server.register(peerSurface({ verifier, outbox }));
  server.get(
    '/peer/units/:unitId',
    peerRoute(async (request, caller) => ({ unit: request.params.unitId, caller })),
  );
  // A static sibling the allowlisted parameter route also matches.
  server.get(
    '/peer/units/export',
    peerRoute(async () => ({ exported: true })),
  );
  // Headers that describe a connection, which an HTTP/2 answer refuses.
  server.get(
    '/peer/odd-headers',
    peerRoute(async (_request, _caller, reply) => {
      reply.header('host', 'elsewhere.invalid');
      reply.header('http2-settings', 'AAMAAABkAAQAAP__');
      return { odd: true };
    }),
  );
  server.removeContentTypeParser('application/octet-stream');
  server.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
    done(null, payload),
  );
  server.post(
    '/peer/upload',
    peerRoute(async (request) => {
      let bytes = 0;
      for await (const chunk of request.body) bytes += chunk.length;
      return { bytes };
    }),
  );
  server.get(
    '/peer/stream',
    peerRoute(async (_request, _caller, reply) => {
      reply.header('content-type', 'text/event-stream');
      return Readable.from(['data: one\n\n', 'data: two\n\n']);
    }),
  );
  server.get(
    '/peer/slow',
    peerRoute(async (_request, _caller, reply) => {
      // The relay cancelled the call: its connection closes unanswered.
      reply.raw.once('close', () => {
        if (!reply.raw.writableFinished) state.slowCancelled += 1;
      });
      await new Promise((resolve) => {
        state.slowWaiters.push(resolve);
      });
      return { slow: true };
    }),
  );
  server.get(
    '/peer/onward',
    peerRoute(async (request, caller) => ({
      hops: caller.hops,
      delegation: request.headers['x-lamalibre-delegation'] ?? null,
    })),
  );
  await server.listen({ port, host: '127.0.0.1' });
  return { server, port, secret, db, dbPath, outbox };
}

async function startConsumer(opts = {}) {
  const secret = opts.secret ?? generateHostingSecret();
  const files = opts.files ?? 'leave';
  const configPath = path.join(dir, `${files}.json`);
  const dbPath = path.join(dir, `${files}.db`);
  const db = new DatabaseSync(dbPath);
  const probe = Fastify();
  await probe.listen({ port: opts.port ?? 0, host: '127.0.0.1' });
  const port = probe.server.address().port;
  await probe.close();
  await writeConfig(configPath, 'leave', port, secret);
  const received = [];
  const gaps = [];
  const peers = createPeers({
    configPath,
    plugin: 'leave',
    db,
    eventsWaitMs: 300,
    attachWaitMs: 3000,
    ...(opts.peers ?? {}),
    onGap: async (notice) => {
      if (state.failGaps > 0) {
        state.failGaps -= 1;
        throw new Error('the reconcile failed');
      }
      gaps.push(notice);
    },
  });
  const server = Fastify();
  server.get('/app/manager', async (request) =>
    peers.json('directory:read', 'GET', '/units/7', { onBehalfOf: request }),
  );
  await server.listen({ port, host: '127.0.0.1' });
  peers.attach(server.server);
  if (opts.subscribe !== false) {
    peers.on('directory:read', 'unit.renamed', (event, d) => {
      d.prepare('CREATE TABLE IF NOT EXISTS seen (seq INTEGER PRIMARY KEY)').run();
      d.prepare('INSERT OR IGNORE INTO seen (seq) VALUES (?)').run(event.seq);
      received.push(event);
    });
  }
  return { server, port, secret, peers, db, received, gaps };
}

async function waitFor(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-peers-'));
  provider = await startProvider();
  // Published before the consumer ever pulled: before its starting point.
  provider.db.exec('BEGIN');
  provider.outbox.publish({ scope: 'directory:read', type: 'unit.renamed', key: 'u0', data: {} });
  provider.db.exec('COMMIT');
  consumer = await startConsumer();

  gatewayOptions = {
    edge: (from, scope) =>
      state.granted && from === 'leave' && scope === 'directory:read'
        ? { provider: 'directory', major: 1, provided: PROVIDED }
        : null,
    providerTarget: (name) =>
      state.providerUp
        ? {
            kind: 'ok',
            target: {
              plugin: name,
              port: provider.port,
              secret: provider.secret,
              maxBodyBytes: state.maxBodyBytes,
            },
            provided: PROVIDED,
          }
        : { kind: 'unavailable', reason: 'down_app' },
    resolveDelegation: ({ consumer: holder, token }) =>
      holder === 'leave' && token === 'good-token'
        ? {
            ok: true,
            user: USER,
            root: 'leave',
            expiresAt: Date.now() + state.delegationLifetimeMs,
            onward: 'onward-token',
          }
        : { ok: false, code: 'delegation_invalid' },
    consumerAllowed: () => state.consumerAllowed,
    recheck: () => state.recheckAllowed,
    eventFloor: (from, scope, epoch, streamId) => {
      const row = floors.get(`${from} ${scope}`);
      return row && row.epoch === epoch && row.streamId === streamId ? row.floor : null;
    },
    recordEventFloor: (from, scope, epoch, streamId, floor) => {
      const key = `${from} ${scope}`;
      const row = floors.get(key);
      const same = row && row.epoch === epoch && row.streamId === streamId;
      floors.set(key, { epoch, streamId, floor: same ? Math.max(row.floor, floor) : floor });
    },
    maxInFlightPerProvider: 3,
    sweepMs: 100,
    subscription: (from, scope) =>
      from === 'leave' && scope === 'directory:read' && state.granted
        ? {
            provider: 'directory',
            types: state.subscribed,
            epoch: peerSubscriptionEpoch(state.epochSeq, state.subscribed),
          }
        : null,
    onDenied: (denial) => denials.push(denial),
    acquireEventsPull: () => (state.pullSlotTaken ? null : () => {}),
  };
  const gateway = createPeerGateway(gatewayOptions);
  const channels = createPeerChannelServer({ handle: gateway });
  relay = createPeerChannelManager({
    server: channels,
    resolve: async () => ({ consumer: 'leave', port: consumer.port, secret: consumer.secret }),
    minBackoffMs: 50,
    maxBackoffMs: 200,
  });
  relay.ensure('leave');
  await waitFor(() => consumer.peers.connected());
});

after(async () => {
  relay?.close();
  await consumer?.peers.close();
  await consumer?.server.close();
  await provider?.server.close();
  provider?.outbox.close();
  await rm(dir, { recursive: true, force: true });
});

test('a granted call reaches the provider with the consumer as its peer caller', async () => {
  const body = await consumer.peers.json('directory:read', 'GET', '/units/42');
  assert.equal(body.unit, '42');
  assert.equal(body.caller.type, 'peer');
  assert.equal(body.caller.peer, 'leave');
  assert.equal(body.caller.scope, 'directory:read');
  assert.equal(body.caller.endpoint, 'GET /units/:unitId');
  assert.equal(body.caller.hops, 1);
  assert.equal(body.caller.user, undefined);
});

test('no edge: 403 not_granted, the same for an unknown scope', async () => {
  state.granted = false;
  try {
    await assert.rejects(consumer.peers.json('directory:read', 'GET', '/units/1'), (err) => {
      assert.ok(err instanceof PeerCallError);
      assert.equal(err.code, 'not_granted');
      assert.equal(err.status, 403);
      return true;
    });
  } finally {
    state.granted = true;
  }
  await assert.rejects(consumer.peers.json('payroll:read', 'GET', '/x'), { code: 'not_granted' });
  assert.ok(denials.some((d) => d.code === 'not_granted'));
});

test('an endpoint the provider does not declare: 403 endpoint_not_allowed', async () => {
  await assert.rejects(consumer.peers.json('directory:read', 'DELETE', '/units/1'), {
    code: 'endpoint_not_allowed',
  });
  await assert.rejects(consumer.peers.json('directory:read', 'GET', '/unlisted'), {
    code: 'endpoint_not_allowed',
  });
});

test("the allowlisted parameter route cannot run the provider's static sibling", async () => {
  // The relay matches /units/export to GET /units/:unitId; the provider's
  // router picks its static /peer/units/export, which peerRoute refuses.
  const response = await consumer.peers.call('directory:read', 'GET', '/units/export');
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /not the endpoint/);
});

test("the provider's guard: a /peer path no peerRoute serves answers 404", async () => {
  const res = await fetch(`http://127.0.0.1:${provider.port}/peer/unlisted`);
  assert.equal(res.status, 404);
});

test('a /peer route peerRoute does not wrap fails the start; peerSurface after one fails', async () => {
  const verifier = createCallerAssertionVerifier({
    configPath: path.join(dir, 'directory.json'),
    plugin: 'directory',
  });
  const after = Fastify();
  await after.register(peerSurface({ verifier }));
  after.get('/admin/health', async () => ({ ok: true }));
  assert.throws(
    () => after.get('/peer/raw', async () => ({ raw: true })),
    /must be made with peerRoute/,
  );
  await after.close();

  const earlier = Fastify();
  earlier.get('/peer/raw', async () => ({ raw: true }));
  await assert.rejects(
    earlier.register(peerSurface({ verifier })).ready(),
    /before any \/peer route \(\/peer\/raw/,
  );
  await earlier.close().catch(() => {});

  // Routes elsewhere may come first, in any context.
  const fine = Fastify();
  fine.get('/admin/health', async () => ({ ok: true }));
  await fine.register(async (child) => {
    child.post('/admin/identity/notify', async () => ({}));
  });
  await fine.register(peerSurface({ verifier }));
  fine.get(
    '/peer/x',
    peerRoute(async () => ({})),
  );
  await fine.ready();
  await fine.close();
});

test('unsafe paths and too many hops are refused by the relay', async () => {
  await assert.rejects(consumer.peers.call('directory:read', 'GET', '/units/%2e%2e'), {
    code: 'bad_path',
  });
  // A call made while serving a request four hops deep would be the fifth.
  const deep = { headers: {} };
  setPeerContext(deep, { caller: {}, hops: 4 });
  await assert.rejects(consumer.peers.call('directory:read', 'GET', '/units/1', { from: deep }), {
    code: 'hop_limit',
    status: 508,
  });
  const third = { headers: {} };
  setPeerContext(third, { caller: {}, hops: 3 });
  const body = await consumer.peers.json('directory:read', 'GET', '/onward', { from: third });
  assert.equal(body.hops, 4);
});

test('a user is named only with a delegation the relay accepts', async () => {
  // Through the consumer's own /app route, with the relay's delegation header.
  const ok = await fetch(`http://127.0.0.1:${consumer.port}/app/manager`, {
    headers: { 'x-lamalibre-delegation': 'good-token' },
  }).then((r) => r.json());
  assert.deepEqual(ok.caller.user, USER);
  await assert.rejects(
    consumer.peers.call('directory:read', 'GET', '/units/1', {
      onBehalfOf: { headers: { 'x-lamalibre-delegation': 'forged' } },
    }),
    { code: 'delegation_invalid', status: 401 },
  );
  await assert.rejects(
    consumer.peers.call('directory:read', 'GET', '/units/1', { onBehalfOf: { headers: {} } }),
    { code: 'delegation_invalid' },
  );
});

test('the onward delegation reaches the provider; client-sent lamalibre headers do not', async () => {
  const body = await consumer.peers.json('directory:read', 'GET', '/onward', {
    onBehalfOf: { headers: { 'x-lamalibre-delegation': 'good-token' } },
    headers: { 'x-lamalibre-caller': 'forged' },
  });
  assert.equal(body.delegation, 'onward-token');
  assert.equal(body.hops, 1);
  const plain = await consumer.peers.json('directory:read', 'GET', '/onward');
  assert.equal(plain.delegation, null);
});

test('the provider down: 503 peer_unavailable with the reason and Retry-After', async () => {
  state.providerUp = false;
  try {
    await assert.rejects(consumer.peers.json('directory:read', 'GET', '/units/1'), (err) => {
      assert.equal(err.code, 'peer_unavailable');
      assert.equal(err.status, 503);
      assert.equal(err.reason, 'down_app');
      assert.equal(err.retryAfter, 10);
      return true;
    });
  } finally {
    state.providerUp = true;
  }
});

test('a large streamed body and a server-sent event stream cross the channel', async () => {
  const size = 32 * 1024 * 1024;
  function* chunks() {
    for (let sent = 0; sent < size; sent += 1 << 20) yield Buffer.alloc(1 << 20, 7);
  }
  const body = await consumer.peers.json('directory:read', 'POST', '/upload', {
    body: Readable.from(chunks()),
    headers: { 'content-type': 'application/octet-stream' },
  });
  assert.equal(body.bytes, size);
  const stream = await consumer.peers.call('directory:read', 'GET', '/stream');
  assert.equal(stream.status, 200);
  assert.match(String(stream.headers['content-type']), /text\/event-stream/);
  assert.equal(await stream.text(), 'data: one\n\ndata: two\n\n');
});

test('a replaced channel lets the call in flight finish; new calls take the new one', async () => {
  const slow = consumer.peers.json('directory:read', 'GET', '/slow');
  await waitFor(() => state.slowWaiters.length > 0);
  relay.replace('leave');
  await waitFor(
    () => relay.status('leave').state === 'attached' && relay.status('leave').since > 0,
  );
  await new Promise((r) => setTimeout(r, 200));
  const fresh = await consumer.peers.json('directory:read', 'GET', '/units/9');
  assert.equal(fresh.unit, '9');
  releaseSlow();
  assert.deepEqual(await slow, { slow: true });
});

test('events: a first pull is a gap at the head; published events then arrive once', async () => {
  await waitFor(() => consumer.gaps.length > 0);
  assert.equal(consumer.gaps[0].reason, 'initial');
  await waitFor(() => {
    const row = consumer.db.prepare('SELECT cursor, gap_reason FROM lamaste_peer_cursors').get();
    return row && row.cursor !== null && row.gap_reason === null;
  });
  provider.db.exec('BEGIN');
  provider.outbox.publish({
    scope: 'directory:read',
    type: 'unit.renamed',
    key: 'u1',
    data: { n: 1 },
  });
  provider.outbox.publish({ scope: 'directory:read', type: 'unit.closed', key: 'u2', data: {} });
  provider.outbox.publish({
    scope: 'directory:read',
    type: 'unit.renamed',
    key: 'u3',
    data: { n: 3 },
  });
  provider.db.exec('COMMIT');
  await waitFor(() => consumer.received.length >= 2);
  assert.deepEqual(
    consumer.received.map((e) => e.key),
    ['u1', 'u3'],
  );
  assert.equal(
    consumer.received.some((e) => e.key === 'u0'),
    false,
  );
});

test('an uncommitted event is never pulled; a rolled-back one never arrives', async () => {
  const before = consumer.received.length;
  provider.db.exec('BEGIN');
  provider.outbox.publish({
    scope: 'directory:read',
    type: 'unit.renamed',
    key: 'phantom',
    data: {},
  });
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(consumer.received.length, before);
  provider.db.exec('ROLLBACK');
  provider.db.exec('BEGIN');
  provider.outbox.publish({ scope: 'directory:read', type: 'unit.renamed', key: 'real', data: {} });
  provider.db.exec('COMMIT');
  await waitFor(() => consumer.received.some((e) => e.key === 'real'));
  assert.equal(
    consumer.received.some((e) => e.key === 'phantom'),
    false,
  );
});

test('a renewed grant is a gap: nothing from before it is replayed', async () => {
  const gapsBefore = consumer.gaps.length;
  state.epochSeq = 2;
  await waitFor(() => consumer.gaps.length > gapsBefore);
  assert.equal(consumer.gaps[consumer.gaps.length - 1].reason, 'granted');
  await waitFor(() => {
    const row = consumer.db.prepare('SELECT epoch, gap_reason FROM lamaste_peer_cursors').get();
    return row.gap_reason === null && row.epoch.startsWith('2:');
  });
});

test('events published while the consumer is down arrive after it restarts, in order', async () => {
  // Stop the consumer completely (its server, its channel, its database).
  await consumer.peers.close();
  await consumer.server.close();
  consumer.db.close();
  provider.db.exec('BEGIN');
  for (const key of ['d1', 'd2', 'd3']) {
    provider.outbox.publish({ scope: 'directory:read', type: 'unit.renamed', key, data: {} });
  }
  provider.db.exec('COMMIT');
  // Same port, same secret, same database file: the half restarted.
  consumer = await startConsumer({ port: consumer.port, secret: consumer.secret });
  relay.replace('leave');
  await waitFor(() => consumer.received.length >= 3);
  assert.deepEqual(
    consumer.received.map((e) => e.key),
    ['d1', 'd2', 'd3'],
  );
  assert.equal(consumer.gaps.length, 0);
});

test('a body over the provider limit is refused by the relay (413 too_large)', async () => {
  state.maxBodyBytes = 1024;
  try {
    await assert.rejects(
      consumer.peers.call('directory:read', 'POST', '/upload', {
        body: Buffer.alloc(4096),
        headers: { 'content-type': 'application/octet-stream' },
      }),
      { code: 'too_large', status: 413 },
    );
  } finally {
    state.maxBodyBytes = 100 * 1024 * 1024;
  }
});

test('HEAD reaches a GET endpoint, signed', async () => {
  const response = await consumer.peers.call('directory:read', 'HEAD', '/units/5');
  assert.equal(response.status, 200);
  response.body.resume();
});

test("Lamaste's readiness call: protocol 1 and the outbox position", async () => {
  const result = await callAgentHalf({
    plugin: 'directory',
    port: provider.port,
    secret: provider.secret,
    method: 'GET',
    path: '/admin/peers',
    timeoutMs: 5000,
    maxResponseBytes: 64 * 1024,
  });
  assert.ok(result.ok);
  assert.equal(result.status, 200);
  assert.equal(result.body.protocol, 1);
  assert.equal(result.body.consumer, false);
  assert.match(result.body.outbox.streamId, /^[0-9a-f-]{36}$/);
  assert.ok(result.body.outbox.head > 0);
});

test('a cursor behind the horizon is a gap; a failing reconcile is retried, nothing pulled meanwhile', async () => {
  const gapsBefore = consumer.gaps.length;
  const receivedBefore = consumer.received.length;
  state.failGaps = 2;
  const row = consumer.db.prepare('SELECT cursor FROM lamaste_peer_cursors').get();
  provider.db
    .prepare('UPDATE lamaste_peer_stream SET horizon = ? WHERE id = 1')
    .run(row.cursor + 1);
  provider.db.exec('BEGIN');
  provider.outbox.publish({ scope: 'directory:read', type: 'unit.renamed', key: 'h1', data: {} });
  provider.db.exec('COMMIT');
  await waitFor(() => consumer.gaps.length > gapsBefore, 15000);
  assert.equal(consumer.gaps[consumer.gaps.length - 1].reason, 'horizon');
  assert.equal(state.failGaps, 0);
  // The event published before the gap's resume point was not applied.
  assert.equal(consumer.received.length, receivedBefore);
  provider.db.prepare('UPDATE lamaste_peer_stream SET horizon = 0 WHERE id = 1').run();
  provider.db.exec('BEGIN');
  provider.outbox.publish({ scope: 'directory:read', type: 'unit.renamed', key: 'h2', data: {} });
  provider.db.exec('COMMIT');
  await waitFor(() => consumer.received.some((e) => e.key === 'h2'));
  assert.equal(
    consumer.received.some((e) => e.key === 'h1'),
    false,
  );
});

test('a gap pending at a crash is reconciled at the next start', async () => {
  await consumer.peers.close();
  await consumer.server.close();
  // A gap recorded, its reconcile never finished.
  consumer.db
    .prepare(
      `UPDATE lamaste_peer_cursors SET gap_reason = 'horizon', gap_resume_from = cursor,
         gap_epoch = epoch, gap_stream_id = stream_id`,
    )
    .run();
  consumer.db.close();
  consumer = await startConsumer({ port: consumer.port, secret: consumer.secret });
  relay.replace('leave');
  await waitFor(() => consumer.gaps.length > 0);
  assert.equal(consumer.gaps[0].reason, 'horizon');
  await waitFor(
    () =>
      consumer.db.prepare('SELECT gap_reason FROM lamaste_peer_cursors').get().gap_reason === null,
  );
});

test('an events pull while the slot is taken: 429 too_many_pulls, the loop backs off and resumes', async () => {
  await waitFor(() => {
    const row = consumer.db.prepare('SELECT cursor, gap_reason FROM lamaste_peer_cursors').get();
    return row && row.cursor !== null && row.gap_reason === null;
  });
  const before = consumer.received.length;
  state.pullSlotTaken = true;
  try {
    await new Promise((r) => setTimeout(r, 500));
    provider.db.exec('BEGIN');
    provider.outbox.publish({
      scope: 'directory:read',
      type: 'unit.renamed',
      key: 'slot',
      data: {},
    });
    provider.db.exec('COMMIT');
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(consumer.received.length, before, 'nothing pulled while refused');
  } finally {
    state.pullSlotTaken = false;
  }
  await waitFor(() => consumer.received.some((e) => e.key === 'slot'), 15_000);
});

// ---------------------------------------------------------------------------
// The security review's fixes
// ---------------------------------------------------------------------------

/**
 * The gateway as a consumer that does not use the SDK would meet it: any
 * stream it likes, over HTTP/2, as consumer `leave`.
 */
async function rawGateway() {
  const gateway = createPeerGateway(gatewayOptions);
  const server = http2.createServer((req, res) => void gateway(req, res, 'leave'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const session = http2.connect(`http://127.0.0.1:${server.address().port}`);
  const pull = (body) =>
    new Promise((resolve, reject) => {
      const stream = session.request({
        ':method': 'POST',
        ':path': '/.lamaste/events',
        'content-type': 'application/json',
      });
      let status = 0;
      let text = '';
      stream.on('response', (headers) => {
        status = headers[':status'];
      });
      stream.setEncoding('utf8');
      stream.on('data', (d) => (text += d));
      stream.on('end', () => resolve({ status, body: text ? JSON.parse(text) : null }));
      stream.on('error', reject);
      stream.end(JSON.stringify({ scope: 'directory:read', waitMs: 0, ...body }));
    });
  return {
    pull,
    close: async () => {
      session.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function publish(key) {
  provider.db.exec('BEGIN');
  provider.outbox.publish({ scope: 'directory:read', type: 'unit.renamed', key, data: {} });
  provider.db.exec('COMMIT');
}

test('the events floor: a cursor from before the gap the relay answered gets a gap, never events', async () => {
  const raw = await rawGateway();
  try {
    publish('before-grant-1');
    publish('before-grant-2');
    const first = await raw.pull({ after: null, epoch: null, streamId: null });
    assert.equal(first.status, 200);
    const { epoch, streamId, resumeFrom } = first.body.gap;
    assert.equal(first.body.gap.reason, 'initial');
    // The exploit: the epoch and stream it was just told, and a cursor from before.
    for (const after of [0, resumeFrom - 1]) {
      const stolen = await raw.pull({ after, epoch, streamId });
      assert.equal(stolen.status, 200);
      assert.equal(stolen.body.events, undefined, `no events from ${after}`);
      assert.equal(stolen.body.gap.reason, 'granted');
    }
    // At its floor it reads on.
    publish('after-grant');
    const fair = await raw.pull({ after: resumeFrom, epoch, streamId });
    assert.deepEqual(
      fair.body.events.map((e) => e.key),
      ['after-grant'],
    );
    // An epoch and stream the relay gave no gap for: a gap.
    floors.clear();
    const forged = await raw.pull({ after: resumeFrom, epoch, streamId });
    assert.equal(forged.body.gap.reason, 'initial');
  } finally {
    await raw.close();
  }
});

test('a pull held by the provider while the grant is revoked crosses nothing', async () => {
  const raw = await rawGateway();
  try {
    const first = await raw.pull({ after: null, epoch: null, streamId: null });
    const { epoch, streamId, resumeFrom } = first.body.gap;
    const held = raw.pull({ after: resumeFrom, epoch, streamId, waitMs: 3000 });
    await new Promise((r) => setTimeout(r, 300));
    state.granted = false;
    publish('while-revoked');
    const answer = await held;
    assert.equal(answer.status, 403);
    assert.equal(answer.body.peer.code, 'not_granted');
    assert.equal(answer.body.events, undefined);
  } finally {
    state.granted = true;
    await raw.close();
  }
});

test('a consumer that no longer qualifies gets nothing over a channel still open', async () => {
  state.consumerAllowed = false;
  try {
    await assert.rejects(consumer.peers.json('directory:read', 'GET', '/units/1'), {
      code: 'not_granted',
    });
    const raw = await rawGateway();
    try {
      const pulled = await raw.pull({ after: null, epoch: null, streamId: null });
      assert.equal(pulled.status, 403);
    } finally {
      await raw.close();
    }
  } finally {
    state.consumerAllowed = true;
  }
});

test('an open answer is ended once its call is no longer allowed', async () => {
  const cancelledBefore = state.slowCancelled;
  const slow = consumer.peers.json('directory:read', 'GET', '/slow');
  await waitFor(() => state.slowWaiters.length > 0);
  state.recheckAllowed = false;
  try {
    await assert.rejects(slow, (err) => {
      assert.ok(err instanceof PeerCallError);
      return true;
    });
    await waitFor(() => state.slowCancelled > cancelledBefore);
  } finally {
    state.recheckAllowed = true;
    releaseSlow();
  }
});

test('an open answer on behalf of a person ends when the delegation lapses', async () => {
  state.delegationLifetimeMs = 400;
  try {
    const request = { headers: { 'x-lamalibre-delegation': 'good-token' } };
    const started = Date.now();
    const slow = consumer.peers.json('directory:read', 'GET', '/slow', { onBehalfOf: request });
    await waitFor(() => state.slowWaiters.length > 0);
    await assert.rejects(slow);
    assert.ok(Date.now() - started < 3000, 'ended at its lapse, not later');
  } finally {
    state.delegationLifetimeMs = 5 * 60 * 1000;
    releaseSlow();
  }
});

test('a provider with its calls open: 503 peer_unavailable busy, then calls go again', async () => {
  const open = [1, 2, 3].map(() => consumer.peers.json('directory:read', 'GET', '/slow'));
  await waitFor(() => state.slowWaiters.length === 3);
  await assert.rejects(consumer.peers.json('directory:read', 'GET', '/units/1'), (err) => {
    assert.equal(err.code, 'peer_unavailable');
    assert.equal(err.reason, 'busy');
    assert.equal(err.retryAfter, 1);
    return true;
  });
  releaseSlow();
  await Promise.all(open);
  assert.equal((await consumer.peers.json('directory:read', 'GET', '/units/2')).unit, '2');
});

test("a provider's connection headers do not break the answer", async () => {
  const response = await consumer.peers.call('directory:read', 'GET', '/odd-headers');
  assert.equal(response.status, 200);
  assert.equal(response.headers['http2-settings'], undefined);
  assert.equal(response.headers['host'], undefined);
  assert.deepEqual(await response.json(), { odd: true });
});

/**
 * A TCP relay between the relay and a consumer half that can stop carrying
 * bytes without closing anything — what a channel through chisel looks like
 * when the agent's chisel client reconnects.
 */
async function startStallingProxy(targetPort) {
  const pairs = new Set();
  const server = net.createServer((inbound) => {
    const outbound = net.connect(targetPort, '127.0.0.1');
    const pair = { inbound, outbound, stalled: false };
    pairs.add(pair);
    const carry = (from, to) =>
      from.on('data', (chunk) => {
        if (!pair.stalled) to.write(chunk);
      });
    carry(inbound, outbound);
    carry(outbound, inbound);
    const end = () => {
      pairs.delete(pair);
      inbound.destroy();
      outbound.destroy();
    };
    inbound.on('error', end).on('close', end);
    outbound.on('error', end).on('close', end);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    /** Stop carrying bytes on every connection open now; new ones still work. */
    stallOpen() {
      for (const pair of pairs) pair.stalled = true;
    },
    close() {
      for (const pair of pairs) {
        pair.inbound.destroy();
        pair.outbound.destroy();
      }
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

test('a channel that dies without a FIN fails its calls at once and is replaced', async () => {
  const second = await startConsumer({
    files: 'leave-stall',
    subscribe: false,
    peers: { pingIntervalMs: 200, pingTimeoutMs: 400 },
  });
  const proxy = await startStallingProxy(second.port);
  const channels = createPeerChannelServer({ handle: createPeerGateway(gatewayOptions) });
  const stallRelay = createPeerChannelManager({
    server: channels,
    resolve: async () => ({ consumer: 'leave', port: proxy.port, secret: second.secret }),
    minBackoffMs: 50,
    maxBackoffMs: 200,
  });
  try {
    stallRelay.ensure('leave');
    await waitFor(() => second.peers.connected());
    assert.equal((await second.peers.json('directory:read', 'GET', '/units/1')).unit, '1');

    // The connection stops carrying anything; neither side sees it close.
    proxy.stallOpen();
    const started = Date.now();
    await assert.rejects(
      () => second.peers.json('directory:read', 'GET', '/units/2'),
      (err) => err instanceof PeerCallError && err.code === 'relay_unavailable',
    );
    assert.ok(Date.now() - started < 3_000, 'the call failed within the PING timeout');

    // The relay attaches anew (a fresh connection carries bytes again): the
    // dead session is dropped on this side too, and calls work again.
    stallRelay.replace('leave');
    await waitFor(async () => {
      try {
        return (await second.peers.json('directory:read', 'GET', '/units/3')).unit === '3';
      } catch {
        return false;
      }
    });
  } finally {
    stallRelay.close();
    await second.peers.close();
    await second.server.close();
    await proxy.close();
  }
});
