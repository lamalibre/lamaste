/**
 * The panel's request logging carries no personal data: Fastify's own
 * request lines (every URL with its query, the client address) are off, and
 * one metadata line per request replaces them — the method, the route
 * pattern the request matched (never the path it was asked with), the
 * status, the duration and the caller's certificate role; the client
 * address only for certificate holders (administrators, agents), never for
 * a person (a user-surface or desktop user, a public route).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { logRequestMetadata } from '@lamalibre/lamaste';
import { panelRequestLogOptions } from '../src/lib/request-logging.js';

async function panel() {
  const lines = [];
  const app = Fastify({
    logger: { level: 'trace', stream: { write: (line) => lines.push(JSON.parse(line)) } },
    disableRequestLogging: true,
  });
  logRequestMetadata(app, panelRequestLogOptions);
  app.decorateRequest('certRole', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? null;
  });
  app.get('/api/users/:username', async () => ({ ok: true }));
  app.post('/api/demo/app/*', async (_request, reply) => reply.code(403).send({ error: 'no' }));
  await app.ready();
  return { app, lines };
}

test('one line per request: the route pattern, never the URL, its query or a person’s address', async () => {
  const { app, lines } = await panel();
  try {
    await app.inject({
      method: 'GET',
      url: '/api/users/ayse-distinctive?token=secret-query',
      remoteAddress: '198.51.100.23',
    });
    await app.inject({
      method: 'POST',
      url: '/api/demo/app/notes/ayse-distinctive',
      remoteAddress: '198.51.100.24',
    });
    await app.inject({ method: 'GET', url: '/nowhere/ayse-distinctive' });
    const text = lines.map((l) => JSON.stringify(l)).join('\n');
    for (const personal of ['ayse-distinctive', 'secret-query', '198.51.100.23', '198.51.100.24']) {
      assert.equal(text.includes(personal), false, `${personal} is in a log line`);
    }
    const requests = lines.filter((l) => l.msg === 'request completed');
    assert.deepEqual(
      requests.map(({ method, route, status, certRole }) => ({ method, route, status, certRole })),
      [
        { method: 'GET', route: '/api/users/:username', status: 200, certRole: null },
        { method: 'POST', route: '/api/demo/app/*', status: 403, certRole: null },
        { method: 'GET', route: '(unmatched)', status: 404, certRole: null },
      ],
    );
    for (const line of requests) assert.ok(Number.isInteger(line.durationMs));
    assert.equal(
      lines.some((l) => l.msg === 'incoming request' || l.req !== undefined),
      false,
      'Fastify’s own request lines are off',
    );
  } finally {
    await app.close();
  }
});

test('a certificate holder’s address is logged; a person’s never', async () => {
  const { app, lines } = await panel();
  try {
    await app.inject({
      method: 'GET',
      url: '/api/users/x1',
      remoteAddress: '203.0.113.7',
      headers: { 'x-test-role': 'admin' },
    });
    await app.inject({
      method: 'GET',
      url: '/api/users/x1',
      remoteAddress: '203.0.113.8',
      headers: { 'x-test-role': 'agent' },
    });
    await app.inject({
      method: 'GET',
      url: '/api/users/x1',
      remoteAddress: '203.0.113.9',
      headers: { 'x-test-role': 'user' },
    });
    const requests = lines.filter((l) => l.msg === 'request completed');
    assert.deepEqual(
      requests.map((l) => [l.certRole, l.ip ?? null]),
      [
        ['admin', '203.0.113.7'],
        ['agent', '203.0.113.8'],
        ['user', null],
      ],
    );
  } finally {
    await app.close();
  }
});
