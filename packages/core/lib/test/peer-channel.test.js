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
  slowRelease: null,
  maxBodyBytes: 100 * 1024 * 1024,
  failGaps: 0,
};
const denials = [];

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
  // A /peer route nobody wrapped.
  server.get('/peer/raw', async () => ({ raw: true }));
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
    peerRoute(async () => {
      await new Promise((resolve) => {
        state.slowRelease = resolve;
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
  const configPath = path.join(dir, 'leave.json');
  const dbPath = path.join(dir, 'leave.db');
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

  const gateway = createPeerGateway({
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
        ? { ok: true, user: USER, onward: 'onward-token' }
        : { ok: false, code: 'delegation_invalid' },
    subscription: (from, scope) =>
      from === 'leave' && scope === 'directory:read' && state.granted
        ? {
            provider: 'directory',
            types: state.subscribed,
            epoch: peerSubscriptionEpoch(state.epochSeq, state.subscribed),
          }
        : null,
    onDenied: (denial) => denials.push(denial),
  });
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
  await assert.rejects(consumer.peers.json('directory:read', 'GET', '/raw'), {
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

test("the provider's guard refuses a /peer route peerRoute does not wrap", async () => {
  const res = await fetch(`http://127.0.0.1:${provider.port}/peer/raw`);
  assert.equal(res.status, 404);
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
  await waitFor(() => state.slowRelease !== null);
  relay.replace('leave');
  await waitFor(
    () => relay.status('leave').state === 'attached' && relay.status('leave').since > 0,
  );
  await new Promise((r) => setTimeout(r, 200));
  const fresh = await consumer.peers.json('directory:read', 'GET', '/units/9');
  assert.equal(fresh.unit, '9');
  state.slowRelease();
  state.slowRelease = null;
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
