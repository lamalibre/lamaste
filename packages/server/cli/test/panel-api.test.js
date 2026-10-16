/**
 * The CLI's panel client: a JSON content type only together with a body
 * (a body-less DELETE with the header made Fastify answer 400 and
 * `registry-credential clear`, `tunnels delete`, `sites delete` never ran),
 * and a non-2xx answer surfaces as an error carrying the panel's message.
 * Nothing secret is an argument of curl, which other local users can read:
 * the body reaches curl on stdin and the P12 password is in a 0600 config
 * file inside a private directory that is gone afterwards.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdir, stat } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

import {
  buildPanelCurlRequest,
  curlConfigLine,
  curlPanelRequest,
  parsePanelResponse,
  withCurlConfig,
} from '../src/panel-api.js';

const base = { p12Path: '/pki/client.p12', configPath: '/tmp/curl-cfg' };
const TOKEN = 'feria_tok_0123456789abcdefSECRET';
const P12_PASSWORD = 'p12-pa"ss\\word-SECRET';

test('a request without a body carries no content type and reads nothing on stdin', () => {
  const { args, input } = buildPanelCurlRequest({
    ...base,
    method: 'DELETE',
    path: '/api/registry-credential',
  });
  assert.equal(input, undefined);
  assert.ok(!args.includes('--data-binary') && !args.includes('@-'));
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

test('a body goes to curl on stdin with the content type, never as an argument', () => {
  const body = { registryUrl: 'https://feria.example.com', auth: { kind: 'token', token: TOKEN } };
  const { args, input } = buildPanelCurlRequest({
    ...base,
    method: 'PUT',
    path: '/api/registry-credential',
    body,
  });
  assert.equal(input, JSON.stringify(body));
  assert.ok(!args.some((a) => a.includes(TOKEN) || a.includes('feria.example.com')));
  assert.ok(!args.includes('-d'));
  const ct = args.indexOf('Content-Type: application/json');
  assert.ok(ct > 0 && args[ct - 1] === '-H');
  const data = args.indexOf('--data-binary');
  assert.equal(args[data + 1], '@-');
  // Header and body sit together, before the URL.
  assert.ok(data > ct && data < args.length - 3);
});

test('a curl config value is quoted and escaped; a line break or NUL is refused', () => {
  assert.equal(curlConfigLine('pass', 'plain'), 'pass = "plain"\n');
  assert.equal(curlConfigLine('pass', 'a"b\\c'), 'pass = "a\\"b\\\\c"\n');
  for (const bad of ['a\nheader = "X: y"', 'a\rb', 'a\0b']) {
    assert.throws(
      () => curlConfigLine('pass', bad),
      (err) => {
        assert.match(err.message, /"pass" contains a line break or NUL/);
        assert.ok(!err.message.includes(bad), 'the value is never repeated');
        return true;
      },
    );
  }
});

test('the config file is 0600 in a private 0700 directory, removed after success and failure', async () => {
  let seen;
  const result = await withCurlConfig('pass = "x"\n', async (configPath) => {
    const dir = path.dirname(configPath);
    seen = dir;
    assert.equal(path.dirname(dir), tmpdir());
    assert.match(path.basename(dir), /^lamalibre-lamaste-curl-/);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    return 'done';
  });
  assert.equal(result, 'done');
  await assert.rejects(stat(seen), { code: 'ENOENT' });

  await assert.rejects(
    withCurlConfig('pass = "x"\n', async (configPath) => {
      seen = path.dirname(configPath);
      throw new Error('curl failed');
    }),
    /curl failed/,
  );
  await assert.rejects(stat(seen), { code: 'ENOENT' });
});

/**
 * A stand-in panel on loopback (plain HTTP — curl uses the client
 * certificate only for TLS). It records each request and, while curl is
 * still waiting for the answer, the command lines `ps` shows for the
 * process requesting its port.
 *
 * @param {(req: { method: string, url: string, headers: http.IncomingHttpHeaders, body: string }) => { status: number, body: string }} answer
 */
async function standInPanel(answer) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      const { port } = server.address();
      const ps = await execa('ps', ['axww', '-o', 'args='], { reject: false });
      const commandLines =
        ps.exitCode === 0
          ? ps.stdout.split('\n').filter((line) => line.includes(`127.0.0.1:${port}`))
          : null;
      const request = { method: req.method, url: req.url, headers: req.headers, body };
      seen.push({ ...request, commandLines });
      const { status, body: reply } = answer(request);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(reply);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { panelUrl: `http://127.0.0.1:${server.address().port}`, seen, server };
}

/** The private config directories present in the temporary directory. */
async function curlConfigDirs() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('lamalibre-lamaste-curl-'));
}

test('the registry token reaches the panel on stdin; curl shows neither it nor the password', async () => {
  const before = await curlConfigDirs();
  const panel = await standInPanel(() => ({
    status: 200,
    body: '{"configured":true,"owner":"admin"}',
  }));
  try {
    const body = {
      registryUrl: 'https://feria.example.com',
      auth: { kind: 'token', token: TOKEN },
    };
    const result = await curlPanelRequest({
      panelUrl: panel.panelUrl,
      method: 'PUT',
      path: '/api/registry-credential',
      body,
      p12Path: '/nonexistent/client.p12',
      p12Password: P12_PASSWORD,
    });
    assert.deepEqual(result, { configured: true, owner: 'admin' });

    assert.equal(panel.seen.length, 1);
    const [request] = panel.seen;
    assert.equal(request.method, 'PUT');
    assert.equal(request.url, '/api/registry-credential');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.body, JSON.stringify(body));
    // Where `ps` is available, the live curl process is in it — without the
    // token or the password.
    if (request.commandLines !== null) {
      assert.ok(request.commandLines.some((line) => line.startsWith('curl ')));
      for (const line of request.commandLines) {
        assert.ok(!line.includes(TOKEN), 'the token is not on the command line');
        assert.ok(!line.includes('SECRET'), 'no secret is on the command line');
      }
    }
  } finally {
    panel.server.close();
  }
  assert.deepEqual(await curlConfigDirs(), before, 'the private config directory is removed');
});

test('a body-less request sends no body and no content type; a refusal keeps its message', async () => {
  const panel = await standInPanel((req) =>
    req.method === 'DELETE'
      ? { status: 200, body: '{"configured":false,"removed":true}' }
      : { status: 409, body: '{"error":"nope","details":"why"}' },
  );
  try {
    const options = {
      panelUrl: panel.panelUrl,
      p12Path: '/nonexistent/client.p12',
      p12Password: P12_PASSWORD,
    };
    assert.deepEqual(
      await curlPanelRequest({ ...options, method: 'DELETE', path: '/api/registry-credential' }),
      { configured: false, removed: true },
    );
    assert.equal(panel.seen[0].body, '');
    assert.equal(panel.seen[0].headers['content-type'], undefined);

    await assert.rejects(
      curlPanelRequest({ ...options, method: 'POST', path: '/api/tunnels', body: { port: 3000 } }),
      (err) => {
        assert.equal(err.statusCode, 409);
        assert.equal(err.message, 'POST /api/tunnels failed (HTTP 409): nope: why');
        return true;
      },
    );
    assert.equal(panel.seen[1].body, '{"port":3000}');
  } finally {
    panel.server.close();
  }
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
