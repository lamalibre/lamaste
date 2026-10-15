/**
 * The client address behind the relay's nginx. Every panel vhost appends
 * the address nginx accepted the connection from to X-Forwarded-For
 * ($proxy_add_x_forwarded_for) and proxies to the panel on 127.0.0.1, which
 * trusts exactly that one loopback hop (`trustLocalNginxHop`). So
 * `request.ip` — what push-install IP policies check — is the real client,
 * never 127.0.0.1 and never what the client wrote into the header itself.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import Fastify from 'fastify';

import { isLoopbackAddress, trustLocalNginxHop } from '../src/lib/trust-proxy.js';
import { isIpAllowed } from '../src/lib/ip-utils.js';

let app;

before(async () => {
  app = Fastify({ logger: false, trustProxy: trustLocalNginxHop });
  app.get('/ip', async (request) => ({ ip: request.ip }));
  await app.ready();
});

after(() => app.close());

const ipOf = async (remoteAddress, xff) =>
  (
    await app.inject({
      method: 'GET',
      url: '/ip',
      remoteAddress,
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
    })
  ).json().ip;

test('through nginx: the address nginx appended, not loopback', async () => {
  assert.equal(await ipOf('127.0.0.1', '198.51.100.7'), '198.51.100.7');
  assert.equal(await ipOf('::1', '2001:db8::7'), '2001:db8::7');
  assert.equal(await ipOf('::ffff:127.0.0.1', '198.51.100.7'), '198.51.100.7');
});

test('a client-written X-Forwarded-For entry is not trusted', async () => {
  // The client sent "X-Forwarded-For: 10.0.0.1"; nginx appended its real address.
  assert.equal(await ipOf('127.0.0.1', '10.0.0.1, 198.51.100.7'), '198.51.100.7');
  assert.equal(await ipOf('127.0.0.1', '127.0.0.1, 198.51.100.7'), '198.51.100.7');
  // A client on the relay itself, through nginx, is loopback — whatever it wrote.
  assert.equal(await ipOf('127.0.0.1', '203.0.113.9, 127.0.0.1'), '127.0.0.1');
});

test('only a loopback peer is trusted as the proxy', async () => {
  assert.equal(await ipOf('192.0.2.10', '198.51.100.7'), '192.0.2.10');
  assert.equal(await ipOf('127.0.0.1'), '127.0.0.1');
});

test('the push-install IP gate sees the real client', async () => {
  const ip = await ipOf('127.0.0.1', '10.0.0.1, 198.51.100.7');
  assert.equal(isIpAllowed(ip, ['198.51.100.0/24'], []), true);
  assert.equal(isIpAllowed(ip, [], ['198.51.100.7']), false);
  assert.equal(isIpAllowed(ip, ['10.0.0.1'], []), false);
});

test('loopback addresses', () => {
  for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1']) {
    assert.equal(isLoopbackAddress(a), true, a);
  }
  for (const a of ['10.0.0.1', '::2', '::ffff:10.0.0.1', '128.0.0.1', '', undefined, 'localhost']) {
    assert.equal(isLoopbackAddress(a), false, String(a));
  }
});
