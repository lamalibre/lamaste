/**
 * Gatekeeper authorizes the tunnel the vhost names. A tunnel vhost names its
 * tunnel in the subrequest's path (`/authz/tunnel/<fqdn>`) and writes the same
 * hostname into `X-Original-URL` and `Host` — never the client's Host header,
 * which for an absolute-form request line (`GET https://a.example.com/
 * HTTP/1.1` with `Host: b.example.com`) names another tunnel than the one
 * nginx serves. Gatekeeper authorizes the tunnel in the path, asks Authelia
 * about that URL, and refuses a request whose `Host` or URL names another
 * hostname. `/authz/check`, which vhosts written before this change call with
 * the client's Host in both headers, is refused outright: such a vhost closes
 * its tunnel instead of opening it. Runs against the build (`npm run build`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

let dir;
let app;
let previousDispatcher;
const sessions = new Map();
/** The X-Original-URL of every Authelia verification Gatekeeper made. */
const askedAuthelia = [];

const TUNNELS = [
  { id: 'granted-id', fqdn: 'granted.example.com', accessMode: 'restricted', enabled: true },
  { id: 'other-id', fqdn: 'other.example.com', accessMode: 'restricted', enabled: true },
  { id: 'open-id', fqdn: 'open.example.com', accessMode: 'authenticated', enabled: true },
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-host-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;

  // Authelia's verify endpoint: alice is logged in.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  mock
    .get('http://127.0.0.1:9091')
    .intercept({ path: '/api/authz/auth-request', method: 'GET' })
    .reply((opts) => {
      askedAuthelia.push(opts.headers['X-Original-URL']);
      return {
        statusCode: 200,
        data: '',
        responseOptions: { headers: { 'remote-user': 'alice', 'remote-groups': '' } },
      };
    })
    .persist();

  // alice may reach `granted` only.
  const { createGrant } = await import('../dist/lib/grants.js');
  await createGrant({
    principalType: 'user',
    principalId: 'alice',
    resourceType: 'tunnel',
    resourceId: 'granted-id',
  });

  const { authzRoutes } = await import('../dist/server/routes/authz.js');
  app = Fastify({ logger: false });
  app.decorate('getTunnels', () => TUNNELS);
  app.decorate('getSessionCache', () => sessions);
  app.decorate('getCacheVersion', () => 1);
  app.decorate('getSettings', () => ({}));
  app.decorate('getRelaySigner', () => null);
  await app.register(authzRoutes);
  await app.ready();
});

beforeEach(() => {
  sessions.clear();
  askedAuthelia.length = 0;
});

after(async () => {
  await app?.close();
  setGlobalDispatcher(previousDispatcher);
  await rm(dir, { recursive: true, force: true });
});

/**
 * The subrequest a tunnel vhost sends: the tunnel named in the path, `host`
 * and the URL's hostname.
 */
const check = (named, host = named, urlHost = named) =>
  app.inject({
    method: 'GET',
    url: `/authz/tunnel/${named}`,
    headers: {
      host,
      cookie: 'authelia_session=alice',
      'x-original-url': `https://${urlHost}/reports?year=2026`,
      'x-original-method': 'GET',
    },
  });

test('the tunnel the vhost names is the one authorized', async () => {
  const allowed = await check('granted.example.com');
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers['remote-user'], 'alice');

  // A grant on one tunnel opens no other.
  const denied = await check('other.example.com');
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.headers['remote-user'], undefined);
  assert.match(denied.body, /other\.example\.com/);

  // Authelia is asked about the URL of the tunnel named (once per session).
  sessions.clear();
  await check('other.example.com');
  assert.deepEqual(askedAuthelia, [
    'https://granted.example.com/reports?year=2026',
    'https://other.example.com/reports?year=2026',
  ]);
});

test('a Host or URL that names another tunnel than the path is refused before Authelia', async () => {
  for (const [named, host, urlHost] of [
    ['other.example.com', 'granted.example.com', 'granted.example.com'],
    ['other.example.com', 'other.example.com', 'granted.example.com'],
    ['other.example.com', 'granted.example.com', 'other.example.com'],
    ['granted.example.com', 'open.example.com', 'granted.example.com'],
  ]) {
    const res = await check(named, host, urlHost);
    assert.equal(res.statusCode, 401, `path ${named}, Host ${host}, URL ${urlHost}`);
    assert.equal(res.headers['remote-user'], undefined);
  }
  assert.deepEqual(askedAuthelia, []);
});

test('the tunnel vhosts of before — /authz/check — are refused, whatever they name', async () => {
  for (const host of ['granted.example.com', 'open.example.com']) {
    const res = await app.inject({
      method: 'GET',
      url: '/authz/check',
      headers: {
        host,
        cookie: 'authelia_session=alice',
        'x-original-url': `https://${host}/`,
        'x-original-method': 'GET',
      },
    });
    assert.equal(res.statusCode, 403, host);
    assert.equal(res.headers['remote-user'], undefined);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(askedAuthelia, []);
});

test('a path that is not a hostname is refused', async () => {
  for (const named of ['granted.example.com%2Fx', 'localhost', '..']) {
    const res = await app.inject({
      method: 'GET',
      url: `/authz/tunnel/${named}`,
      headers: {
        host: 'granted.example.com',
        cookie: 'authelia_session=alice',
        'x-original-url': 'https://granted.example.com/',
      },
    });
    assert.notEqual(res.statusCode, 200, named);
    assert.equal(res.headers['remote-user'], undefined);
  }
  assert.deepEqual(askedAuthelia, []);
});

test('a request without Host is refused', async () => {
  // Over a socket: inject() always sends a Host, and HTTP/1.1 requires one,
  // so this is HTTP/1.0 — the only way a request arrives without it.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address();
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.end(
        'GET /authz/tunnel/granted.example.com HTTP/1.0\r\n' +
          'Cookie: authelia_session=alice\r\n' +
          'X-Original-URL: https://granted.example.com/\r\n\r\n',
      );
    });
    let data = '';
    socket.on('data', (chunk) => (data += chunk));
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
  assert.match(response, /^HTTP\/1\.[01] 401 /);
  assert.deepEqual(askedAuthelia, []);
});

test('hostnames agree regardless of case, and of the port in Host', async () => {
  const res = await check('Granted.example.com', 'GRANTED.example.com:443', 'granted.example.com');
  assert.equal(res.statusCode, 200);
});
