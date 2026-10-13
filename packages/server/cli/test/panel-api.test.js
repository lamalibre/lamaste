/**
 * The CLI's panel client: a JSON content type only together with a body
 * (a body-less DELETE with the header made Fastify answer 400 and
 * `registry-credential clear`, `tunnels delete`, `sites delete` never ran),
 * and a non-2xx answer surfaces as an error carrying the panel's message.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPanelCurlArgs, parsePanelResponse } from '../src/panel-api.js';

const base = { p12Path: '/pki/client.p12', configPath: '/tmp/curl-cfg' };

test('a request without a body carries no content type and no -d', () => {
  const args = buildPanelCurlArgs({ ...base, method: 'DELETE', path: '/api/registry-credential' });
  assert.ok(!args.includes('-d'));
  assert.ok(!args.some((a) => a.startsWith('Content-Type')));
  assert.deepEqual(args.slice(0, 4), ['-K', '/tmp/curl-cfg', '--cert-type', 'P12']);
  assert.deepEqual(args.slice(-3), [
    '-w',
    '\n%{http_code}',
    'https://127.0.0.1:9292/api/registry-credential',
  ]);
  assert.deepEqual(args.slice(args.indexOf('-X'), args.indexOf('-X') + 2), ['-X', 'DELETE']);
  assert.ok(args.includes('Accept: application/json'));
  assert.ok(!args.join(' ').includes('--pass'), 'the P12 password never enters argv');
});

test('a request with a body sends it as JSON with the content type', () => {
  const args = buildPanelCurlArgs({
    ...base,
    method: 'PUT',
    path: '/api/registry-credential',
    body: { registryUrl: 'https://feria.example.com', auth: { kind: 'oidc' } },
  });
  const ct = args.indexOf('Content-Type: application/json');
  assert.ok(ct > 0 && args[ct - 1] === '-H');
  const d = args.indexOf('-d');
  assert.equal(args[d + 1], '{"registryUrl":"https://feria.example.com","auth":{"kind":"oidc"}}');
  // Header and body sit together, before the URL.
  assert.ok(d > ct && d < args.length - 3);
});

test('a 2xx answer resolves to the JSON body; an empty 2xx body is {}', () => {
  assert.deepEqual(parsePanelResponse('{"configured":false,"removed":true}\n200', 'DELETE', '/x'), {
    configured: false,
    removed: true,
  });
  assert.deepEqual(parsePanelResponse('\n204', 'DELETE', '/x'), {});
});

test("a non-2xx answer throws with the panel's error and details", () => {
  assert.throws(
    () =>
      parsePanelResponse(
        '{"error":"Body cannot be empty when content-type is set to \'application/json\'"}\n400',
        'DELETE',
        '/api/registry-credential',
      ),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(
        err.message,
        /DELETE \/api\/registry-credential failed \(HTTP 400\): Body cannot be empty/,
      );
      return true;
    },
  );
  assert.throws(
    () => parsePanelResponse('{"error":"nope","details":"why"}\n409', 'POST', '/p'),
    /HTTP 409\): nope: why/,
  );
  // A non-JSON error body (nginx HTML, say) is still reported.
  assert.throws(
    () => parsePanelResponse('<html>502</html>\n502', 'GET', '/p'),
    /HTTP 502\): <html>502<\/html>/,
  );
  assert.throws(() => parsePanelResponse('\n000', 'GET', '/p'), /HTTP 0\)/);
});
