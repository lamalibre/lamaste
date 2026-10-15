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

test('a refusal keeps its code, reasons and operation id for the caller to act on', () => {
  assert.throws(
    () =>
      parsePanelResponse(
        JSON.stringify({
          error: 'Agent "vm1" cannot host plugin "fx": The app host helper is not enabled',
          code: 'agent_not_eligible',
          reasons: ['The app host helper is not enabled on the agent', 42],
        }) + '\n409',
        'POST',
        '/api/plugins/fx/hosting',
      ),
    (err) => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'agent_not_eligible');
      assert.deepEqual(err.reasons, ['The app host helper is not enabled on the agent']);
      assert.equal(err.operationId, undefined);
      return true;
    },
  );
  assert.throws(
    () =>
      parsePanelResponse(
        '{"error":"Plugin \\"fx\\" has an operation in progress","operationId":"op-1"}\n409',
        'DELETE',
        '/api/plugins/fx',
      ),
    (err) => {
      assert.equal(err.operationId, 'op-1');
      assert.equal(err.code, undefined);
      assert.equal(err.reasons, undefined);
      return true;
    },
  );
});

test('a failed validation names what to correct, not just that it failed', () => {
  assert.throws(
    () =>
      parsePanelResponse(
        JSON.stringify({
          error: 'Validation failed',
          details: {
            issues: [
              {
                path: ['durationMinutes'],
                message: 'A push-install window is open 5 to 480 minutes',
              },
            ],
          },
        }) + '\n400',
        'POST',
        '/api/plugins/push-install/enable/vm1',
      ),
    /HTTP 400\): Validation failed: durationMinutes: A push-install window is open 5 to 480 minutes$/,
  );
  // Details that are neither a string nor issues are left out, never "[object Object]".
  assert.throws(
    () =>
      parsePanelResponse('{"error":"Internal server error","details":{"x":1}}\n500', 'GET', '/p'),
    /HTTP 500\): Internal server error$/,
  );
});
