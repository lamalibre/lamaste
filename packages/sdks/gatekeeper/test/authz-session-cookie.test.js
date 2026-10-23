/**
 * How Gatekeeper treats Authelia's session cookie and its own callers on
 * the authorization routes nginx calls (`/authz/tunnel/<fqdn>`,
 * `/authz/user-surface/<fqdn>`):
 *
 * - Authelia is sent the `authelia_session` cookie alone — never the
 *   browser's other cookies;
 * - a request carrying more than one `authelia_session` (another host under
 *   the domain can plant one with another path) is refused with 401 before
 *   Authelia is asked, on both routes;
 * - the session cache is keyed by the cookie's value and the tunnel host: a
 *   session Authelia accepted on one host is asked about again on another,
 *   and one it refuses there stays refused;
 * - the rate limit counts per client address (`X-Forwarded-For`, which nginx
 *   sets and Gatekeeper trusts from 127.0.0.1 only) and tunnel host — one
 *   client exhausting its bucket leaves the others theirs;
 * - a refusal for want of a grant logs the tunnel and the reason, never who
 *   was refused.
 *
 * Runs against the build (`npm run build`).
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { createRelaySigner, userSurfaceHosts } from '@lamalibre/lamaste';

let dir;
let app;
let previousDispatcher;
let tunnelInfoFromState;
let authzRoutes;
let signer;
const sessions = new Map();
/** Every verification Gatekeeper asked Authelia for: the URL and the Cookie it sent. */
const askedAuthelia = [];
/** The log lines the app wrote. */
const logLines = [];

const internal = (route, agentLabel) => ({
  id: `internal-${route}`,
  subdomain: null,
  fqdn: null,
  port: 21000,
  type: 'plugin',
  exposure: 'internal',
  enabled: true,
  pluginRoute: route,
  agentLabel,
});

const STATE = [
  {
    id: 'apps-id',
    subdomain: 'apps',
    fqdn: 'apps.example.com',
    port: 20001,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['fx'] },
  },
  {
    id: 'wiki-id',
    subdomain: 'wiki',
    fqdn: 'wiki.example.com',
    port: 20002,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    agentLabel: 'vm1',
  },
  {
    id: 'vault-id',
    subdomain: 'vault',
    fqdn: 'vault.example.com',
    port: 20003,
    type: 'app',
    accessMode: 'restricted',
    enabled: true,
    agentLabel: 'vm1',
    userSurface: { routes: ['camwatch'] },
  },
  internal('fx', 'vm1'),
  internal('camwatch', 'vm1'),
];

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lamaste-gatekeeper-cookie-'));
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = dir;
  const keyFile = path.join(dir, 'relay-signing-key.json');
  await createRelaySigner(keyFile, { create: true }).current();
  signer = createRelaySigner(keyFile, { create: false });

  // Authelia's verify endpoint: alice's session is good on every host but
  // wiki.example.com; any other cookie is refused.
  const mock = new MockAgent();
  mock.disableNetConnect();
  previousDispatcher = getGlobalDispatcher();
  setGlobalDispatcher(mock);
  mock
    .get('http://127.0.0.1:9091')
    .intercept({ path: '/api/authz/auth-request', method: 'GET' })
    .reply((opts) => {
      const url = opts.headers['X-Original-URL'];
      const cookie = opts.headers['Cookie'];
      askedAuthelia.push({ url, cookie });
      const ok = cookie === 'authelia_session=alice' && !url.startsWith('https://wiki.');
      return ok
        ? {
            statusCode: 200,
            data: '',
            responseOptions: { headers: { 'remote-user': 'alice', 'remote-groups': '' } },
          }
        : { statusCode: 401, data: '' };
    })
    .persist();

  ({ tunnelInfoFromState } = await import('../dist/lib/tunnels.js'));
  ({ authzRoutes } = await import('../dist/server/routes/authz.js'));
  const logs = new Writable({
    write(chunk, _enc, done) {
      logLines.push(chunk.toString('utf-8'));
      done();
    },
  });
  app = await gatekeeperApp({ logger: { level: 'info', stream: logs } });
});

/** Gatekeeper's authorization routes as `server/index.ts` registers them. */
async function gatekeeperApp({ logger = false, rateLimitPerClient } = {}) {
  const tunnels = tunnelInfoFromState(STATE);
  const instance = Fastify({ logger, trustProxy: '127.0.0.1' });
  await instance.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
    keyGenerator: () => 'gatekeeper-internal',
  });
  const hosts = userSurfaceHosts(STATE, []);
  instance.decorate('getTunnels', () => tunnels);
  instance.decorate('getUserSurfaceHosts', () => hosts);
  instance.decorate('getSessionCache', () => sessions);
  instance.decorate('getCacheVersion', () => 1);
  instance.decorate('getSettings', () => ({}));
  instance.decorate('getRelaySigner', () => signer);
  await instance.register(authzRoutes, rateLimitPerClient ? { rateLimitPerClient } : {});
  await instance.ready();
  return instance;
}

after(async () => {
  await app?.close();
  setGlobalDispatcher(previousDispatcher);
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  sessions.clear();
  askedAuthelia.length = 0;
  logLines.length = 0;
});

/** The subrequest a tunnel vhost's `location /` sends. */
function tunnelCheck(fqdn, cookie, { client = '198.51.100.7', target = '/', on = app } = {}) {
  return on.inject({
    method: 'GET',
    url: `/authz/tunnel/${fqdn}`,
    headers: {
      host: fqdn,
      'x-original-url': `https://${fqdn}${target}`,
      'x-original-method': 'GET',
      'x-forwarded-for': client,
      ...(cookie === null ? {} : { cookie }),
    },
  });
}

/** The subrequest a user-surface location sends. */
function surfaceCheck(fqdn, target, cookie) {
  return app.inject({
    method: 'GET',
    url: `/authz/user-surface/${fqdn}`,
    headers: {
      host: fqdn,
      'x-original-url': `https://${fqdn}${target}`,
      'x-original-method': 'GET',
      'x-forwarded-for': '198.51.100.7',
      cookie,
    },
  });
}

test('Authelia is sent the session cookie alone — never the browser’s other cookies', async () => {
  for (const cookie of [
    'theme=dark; authelia_session=alice; csrf=abc',
    'authelia_session=alice',
    'a=1;authelia_session = alice ;b=2',
    'authelia_session_x=1; xauthelia_session=2; authelia_session=alice',
  ]) {
    sessions.clear();
    askedAuthelia.length = 0;
    const res = await tunnelCheck('apps.example.com', cookie);
    assert.equal(res.statusCode, 200, cookie);
    assert.deepEqual(
      askedAuthelia.map((a) => a.cookie),
      ['authelia_session=alice'],
      cookie,
    );
  }
});

test('more than one authelia_session cookie is refused with 401 before Authelia is asked', async () => {
  for (const cookie of [
    'authelia_session=alice; authelia_session=alice',
    'authelia_session=planted; x=1; authelia_session=alice',
    'authelia_session=alice;authelia_session =other',
    'authelia_session=; authelia_session=alice',
  ]) {
    const tunnel = await tunnelCheck('apps.example.com', cookie);
    assert.equal(tunnel.statusCode, 401, `tunnel: ${cookie}`);
    assert.equal(tunnel.headers['remote-user'], undefined);
    const surface = await surfaceCheck('apps.example.com', '/api/fx/app/me', cookie);
    assert.equal(surface.statusCode, 401, `user surface: ${cookie}`);
    assert.equal(surface.headers['x-lamalibre-relay-assertion'], undefined);
  }
  // An empty value is no session either.
  assert.equal((await tunnelCheck('apps.example.com', 'authelia_session=')).statusCode, 401);
  assert.deepEqual(askedAuthelia, []);
  assert.ok(logLines.some((l) => l.includes('duplicate_authelia_cookie')));

  // The one cookie alone passes.
  assert.equal((await tunnelCheck('apps.example.com', 'authelia_session=alice')).statusCode, 200);
});

test('the session cache is per host: a session accepted on one host is asked about again on another', async () => {
  assert.equal((await tunnelCheck('apps.example.com', 'authelia_session=alice')).statusCode, 200);
  assert.equal((await tunnelCheck('apps.example.com', 'authelia_session=alice')).statusCode, 200);
  assert.equal(askedAuthelia.length, 1, 'cached on its own host');

  // Authelia refuses the session on wiki: the entry cached for apps proves nothing there.
  const wiki = await tunnelCheck('wiki.example.com', 'authelia_session=alice');
  assert.equal(wiki.statusCode, 401);
  assert.deepEqual(
    askedAuthelia.map((a) => new URL(a.url).hostname),
    ['apps.example.com', 'wiki.example.com'],
  );
  assert.equal((await tunnelCheck('wiki.example.com', 'authelia_session=alice')).statusCode, 401);
});

test('the rate limit counts per client address and tunnel host — not one bucket for all', async () => {
  const limited = await gatekeeperApp({ rateLimitPerClient: 3 });
  try {
    const statuses = async (fqdn, client, n) => {
      const out = [];
      for (let i = 0; i < n; i += 1) {
        out.push(
          (await tunnelCheck(fqdn, 'authelia_session=alice', { client, on: limited })).statusCode,
        );
      }
      return out;
    };
    assert.deepEqual(await statuses('apps.example.com', '198.51.100.1', 4), [200, 200, 200, 429]);
    // Another client, and the same client on another host, keep their buckets.
    assert.deepEqual(await statuses('apps.example.com', '198.51.100.2', 3), [200, 200, 200]);
    assert.deepEqual(await statuses('vault.example.com', '198.51.100.1', 1), [403]);
    // The address is the one nginx set — never one further left a client wrote.
    const spoofed = await limited.inject({
      method: 'GET',
      url: '/authz/tunnel/apps.example.com',
      headers: {
        host: 'apps.example.com',
        'x-original-url': 'https://apps.example.com/',
        'x-forwarded-for': '203.0.113.9, 198.51.100.1',
        cookie: 'authelia_session=alice',
      },
    });
    assert.equal(spoofed.statusCode, 429, 'still 198.51.100.1, the hop nginx added');
  } finally {
    await limited.close();
  }
});

test('a refusal for want of a grant logs the tunnel and the reason — never the user', async () => {
  const tunnel = await tunnelCheck('vault.example.com', 'authelia_session=alice');
  assert.equal(tunnel.statusCode, 403);
  const surface = await surfaceCheck(
    'vault.example.com',
    '/api/camwatch/app/me',
    'authelia_session=alice',
  );
  assert.equal(surface.statusCode, 403);
  const denials = logLines.filter((l) => l.includes('no_matching_grant'));
  assert.equal(denials.length, 2);
  for (const line of denials) {
    assert.ok(line.includes('vault.example.com'), line);
    assert.ok(!line.includes('alice'), line);
  }
});
