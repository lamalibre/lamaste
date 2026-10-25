/**
 * A cache bust reads the panel's domain projection again before dropping the
 * cached sessions: the panel busts after every membership change, so a watch
 * event Gatekeeper missed never leaves a removed member admitted. Runs
 * against the build (`npm run build`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

test('POST /api/cache/bust reloads domains.json, then drops the cached sessions', async () => {
  const steps = [];
  const app = Fastify({ logger: false });
  const diagnostic = await import('../dist/server/routes/diagnostic.js');
  app.decorate('getSettings', () => ({}));
  app.decorate('updateSettings', () => {});
  app.decorate('reloadDomains', async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    steps.push('reload');
  });
  app.decorate('bustCache', () => steps.push('bust'));
  await app.register(diagnostic.diagnosticRoutes, { prefix: '/api' });
  await app.ready();
  const res = await app.inject({ method: 'POST', url: '/api/cache/bust' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(steps, ['reload', 'bust']);
  await app.close();
});
