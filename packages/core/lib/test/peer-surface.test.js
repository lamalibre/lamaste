/**
 * The provider's peer surface on its own (no relay): `peerRoute` verifies
 * the `peer` caller in its route's `onRequest` hook — before Fastify reads
 * or parses the body — exactly once, checks the endpoint and the declared
 * scope there, and `peerSurface` refuses a `/peer` route that lost
 * peerRoute's hooks.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import Fastify from 'fastify';

import {
  CALLER_ASSERTION_HEADER,
  RESPONDER_HEADER,
  generateHostingSecret,
  signCallerAssertion,
} from '../dist/index.js';
import {
  createCallerAssertionVerifier,
  peerCallerOf,
  peerContextOf,
  peerRoute,
  peerSurface,
} from '../dist/agent/index.js';

const PLUGIN = 'directory';
const READ = 'directory:read';
const WRITE = 'directory:write';

let dir;
let configPath;
let secret;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'peer-surface-'));
  configPath = path.join(dir, 'directory.json');
  secret = generateHostingSecret();
  const now = new Date().toISOString();
  await writeFile(
    configPath,
    JSON.stringify({
      plugin: PLUGIN,
      port: 21001,
      secret,
      issuedAt: now,
      fetchedAt: now,
      acknowledged: true,
    }),
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function peerAssertion({ method, path: urlPath, endpoint, scope = READ, caller }) {
  return signCallerAssertion(
    {
      plugin: PLUGIN,
      method,
      path: urlPath,
      caller: caller ?? { type: 'peer', peer: 'leave', scope, major: 1, endpoint, hops: 1 },
    },
    secret,
  );
}

/** A verifier that counts its calls. */
function countingVerifier() {
  const inner = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const counts = { verify: 0 };
  return {
    counts,
    verifier: {
      port: () => inner.port(),
      verify(...args) {
        counts.verify += 1;
        return inner.verify(...args);
      },
    },
  };
}

/**
 * A provider whose JSON parser counts what it parsed and whose
 * `preParsing` hook records the caller it saw.
 */
async function provider(register) {
  const { verifier, counts } = countingVerifier();
  const seen = { parsed: 0, preParsingCaller: [] };
  const app = Fastify();
  await app.register(peerSurface({ verifier }));
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    seen.parsed += 1;
    done(null, JSON.parse(body));
  });
  app.addHook('preParsing', async (request, _reply, payload) => {
    seen.preParsingCaller.push(peerCallerOf(request));
    return payload;
  });
  register(app);
  await app.ready();
  return { app, counts, seen };
}

function routes(app) {
  app.post(
    '/peer/units/:unitId',
    peerRoute(
      async (request, caller) => ({
        unit: request.params.unitId,
        body: request.body,
        scope: caller.scope,
        context: peerContextOf(request)?.hops ?? null,
      }),
      { scope: READ },
    ),
  );
  app.post(
    '/peer/either',
    peerRoute(async (_request, caller) => ({ scope: caller.scope }), { scope: [READ, WRITE] }),
  );
  app.post(
    '/peer/any',
    peerRoute(async (_request, caller) => ({ scope: caller.scope })),
  );
}

function post(app, url, assertion, body = { name: 'x' }) {
  const headers = { 'content-type': 'application/json' };
  if (assertion !== null) headers[CALLER_ASSERTION_HEADER] = assertion;
  return app.inject({ method: 'POST', url, headers, payload: JSON.stringify(body) });
}

test('a verified peer call is verified once, before its body is parsed', async () => {
  const { app, counts, seen } = await provider(routes);
  const res = await post(
    app,
    '/peer/units/7',
    peerAssertion({ method: 'POST', path: '/peer/units/7', endpoint: 'POST /units/:unitId' }),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { unit: '7', body: { name: 'x' }, scope: READ, context: 1 });
  assert.equal(counts.verify, 1);
  assert.equal(seen.parsed, 1);
  assert.equal(seen.preParsingCaller.length, 1);
  assert.equal(seen.preParsingCaller[0]?.scope, READ);
  assert.ok(res.headers[RESPONDER_HEADER], 'the answer is signed');
  await app.close();
});

test('no assertion, a forged one or a replay: 401 and the body is never parsed', async () => {
  const { app, seen } = await provider(routes);
  const assertion = peerAssertion({
    method: 'POST',
    path: '/peer/units/7',
    endpoint: 'POST /units/:unitId',
  });

  const none = await post(app, '/peer/units/7', null);
  assert.equal(none.statusCode, 401);

  const forged = await post(app, '/peer/units/7', `${assertion.slice(0, -4)}AAAA`);
  assert.equal(forged.statusCode, 401);

  const first = await post(app, '/peer/units/7', assertion);
  assert.equal(first.statusCode, 200);
  const parsedAfterFirst = seen.parsed;
  const replay = await post(app, '/peer/units/7', assertion);
  assert.equal(replay.statusCode, 401);
  assert.match(replay.json().error, /replay/i);
  assert.equal(replay.headers[RESPONDER_HEADER], undefined, 'an unverified request is not signed');

  assert.equal(parsedAfterFirst, 1, 'only the verified request was parsed');
  assert.equal(seen.parsed, 1);
  assert.deepEqual(
    seen.preParsingCaller.filter((c) => c === null),
    [],
    'preParsing never ran for a refused request',
  );
  await app.close();
});

test('a call under another scope: 403 before the body, signed', async () => {
  const { app, seen } = await provider(routes);
  const res = await post(
    app,
    '/peer/units/7',
    peerAssertion({
      method: 'POST',
      path: '/peer/units/7',
      endpoint: 'POST /units/:unitId',
      scope: WRITE,
    }),
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.json().error, /scope/);
  assert.ok(res.headers[RESPONDER_HEADER]);
  assert.equal(seen.parsed, 0);

  const either = await post(
    app,
    '/peer/either',
    peerAssertion({ method: 'POST', path: '/peer/either', endpoint: 'POST /either', scope: WRITE }),
  );
  assert.equal(either.statusCode, 200);
  assert.equal(either.json().scope, WRITE);

  const any = await post(
    app,
    '/peer/any',
    peerAssertion({ method: 'POST', path: '/peer/any', endpoint: 'POST /any', scope: WRITE }),
  );
  assert.equal(any.statusCode, 200);
  await app.close();
});

test('another endpoint or a caller that is not a peer: 403 before the body', async () => {
  const { app, seen } = await provider(routes);
  const wrongEndpoint = await post(
    app,
    '/peer/units/7',
    peerAssertion({ method: 'POST', path: '/peer/units/7', endpoint: 'POST /either' }),
  );
  assert.equal(wrongEndpoint.statusCode, 403);
  assert.equal(seen.parsed, 0);
  await app.close();
});

test('a scope that names nothing is refused when the route is made', () => {
  assert.throws(() => peerRoute(async () => ({}), { scope: [] }), /scope/);
  assert.throws(() => peerRoute(async () => ({}), { scope: '' }), /scope/);
});

test("a /peer route that lost peerRoute's hooks fails its registration", async () => {
  const { verifier } = countingVerifier();

  const replaced = Fastify();
  await replaced.register(peerSurface({ verifier }));
  assert.throws(
    () =>
      replaced.post('/peer/x', {
        ...peerRoute(async () => ({})),
        onRequest: async () => undefined,
      }),
    /onRequest hook first/,
  );
  await replaced.close();

  const unsigned = Fastify();
  await unsigned.register(peerSurface({ verifier }));
  assert.throws(
    () =>
      unsigned.post('/peer/x', {
        ...peerRoute(async () => ({})),
        onSend: async (_q, _r, p) => p,
      }),
    /onRequest hook first/,
  );
  await unsigned.close();

  // A hook of the plugin's own before peerRoute's would see an unverified request.
  const before = Fastify();
  await before.register(peerSurface({ verifier }));
  const first = peerRoute(async () => ({}));
  assert.throws(
    () =>
      before.post('/peer/x', {
        ...first,
        onRequest: [async () => undefined, first.onRequest],
      }),
    /onRequest hook first/,
  );
  await before.close();

  // Another peerRoute's hooks (another scope) on this route: refused.
  const borrowed = Fastify();
  await borrowed.register(peerSurface({ verifier }));
  const mineScope = peerRoute(async () => ({}), { scope: READ });
  const otherScope = peerRoute(async () => ({}), { scope: WRITE });
  assert.throws(
    () =>
      borrowed.post('/peer/x', {
        ...mineScope,
        onRequest: otherScope.onRequest,
        onSend: otherScope.onSend,
      }),
    /onRequest hook first/,
  );
  await borrowed.close();

  // Hooks of one's own beside peerRoute's, and a spread with other options, are fine.
  const added = Fastify();
  await added.register(peerSurface({ verifier }));
  const options = peerRoute(async () => ({ ok: true }));
  const mine = [];
  added.post('/peer/x', {
    ...options,
    bodyLimit: 1024,
    onRequest: [options.onRequest, async (request) => mine.push(peerCallerOf(request)?.peer)],
  });
  await added.ready();
  const res = await post(
    added,
    '/peer/x',
    peerAssertion({ method: 'POST', path: '/peer/x', endpoint: 'POST /x' }),
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(mine, ['leave']);
  await added.close();
});

test('a verifier wrapper that answers from an earlier check still works (one verify per request)', async () => {
  // How a plugin gated peer calls before 4.14.1: a scope hook verified first
  // and the wrapper given to peerSurface answered peerRoute with that result.
  const inner = createCallerAssertionVerifier({ configPath, plugin: PLUGIN });
  const cached = new WeakMap();
  const wrapper = {
    port: () => inner.port(),
    async verify(headers, method, urlPath, opts) {
      const hit = cached.get(headers);
      if (hit) {
        cached.delete(headers);
        return hit;
      }
      return inner.verify(headers, method, urlPath, opts);
    },
  };
  const app = Fastify();
  await app.register(peerSurface({ verifier: wrapper }));
  await app.register(async (scope) => {
    scope.addHook('onRequest', async (request) => {
      cached.set(
        request.headers,
        await inner.verify(request.headers, request.method, request.url, { body: null }),
      );
    });
    scope.post(
      '/peer/x',
      peerRoute(async () => ({ ok: true })),
    );
  });
  await app.ready();
  const res = await post(
    app,
    '/peer/x',
    peerAssertion({ method: 'POST', path: '/peer/x', endpoint: 'POST /x' }),
  );
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('a refused upload is not read to its end: the connection closes after the answer', async () => {
  const { app } = await provider(routes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address();
  const declared = 100 * 1024 * 1024;
  try {
    const result = await new Promise((resolve, reject) => {
      const socket = net.connect(port, '127.0.0.1');
      let answer = '';
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`the server kept the connection open: ${answer}`));
      }, 3000);
      socket.on('data', (chunk) => {
        answer += chunk.toString('latin1');
      });
      socket.on('error', () => {});
      socket.on('close', () => {
        clearTimeout(timer);
        resolve(answer);
      });
      socket.write(
        `POST /peer/units/7 HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${declared}\r\n\r\n`,
      );
      socket.write(Buffer.alloc(64 * 1024, 0x20));
    });
    assert.match(result, /^HTTP\/1\.1 401 /);
    assert.match(result, /\r\nconnection: close\r\n/i);
  } finally {
    app.server.closeAllConnections();
    await app.close();
  }
});

test('a refusal of a request without a body keeps the connection', async () => {
  const { app } = await provider(routes);
  const res = await app.inject({ method: 'GET', url: '/peer/nowhere' });
  assert.equal(res.statusCode, 404);
  assert.notEqual(res.headers.connection, 'close');
  const withBody = await post(app, '/peer/nowhere', null);
  assert.equal(withBody.statusCode, 404);
  assert.equal(withBody.headers.connection, 'close');
  await app.close();
});

test('a verifier that cannot verify yet: 503 before the body, the connection closed', async () => {
  const counts = { parsed: 0 };
  const app = Fastify();
  await app.register(
    peerSurface({
      verifier: {
        port: () => 21001,
        verify: async () => {
          throw new Error('no configuration yet');
        },
      },
    }),
  );
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    counts.parsed += 1;
    done(null, JSON.parse(body));
  });
  app.post(
    '/peer/x',
    peerRoute(async () => ({ ok: true })),
  );
  await app.ready();
  const res = await post(app, '/peer/x', 'anything');
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers.connection, 'close');
  assert.equal(res.headers[RESPONDER_HEADER], undefined);
  assert.equal(counts.parsed, 0);
  await app.close();
});
