/**
 * The CLI's panel client: a JSON content type only together with a body
 * (a body-less DELETE with the header made Fastify answer 400 and
 * `registry-credential clear`, `tunnels delete`, `sites delete` never ran),
 * and a non-2xx answer surfaces as an error carrying the panel's message.
 * Nothing secret is an argument of curl, which other local users can read:
 * the body reaches curl on stdin and the P12 password is in a 0600 config
 * file inside a private directory that is gone afterwards — also when the
 * CLI is interrupted. The panel is verified against its own certificate:
 * a listener on its port that cannot present it receives no request and
 * not even the client certificate, and curl is never run with `-k`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdir, stat } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

import {
  buildPanelCurlRequest,
  curlConfigLine,
  curlFailure,
  curlPanelRequest,
  parsePanelResponse,
  withCurlConfig,
} from '../src/panel-api.js';
import { standInPanel } from './stand-in-panel.js';
import { PANEL_ADDRESS, makeTlsFixtures } from './tls-fixtures.js';

const identity = { certPath: '/pki/self-signed.pem', address: PANEL_ADDRESS, port: 9292 };
const base = { identity, p12Path: '/pki/client.p12', configPath: '/tmp/curl-cfg' };
const TOKEN = 'feria_tok_0123456789abcdefSECRET';
const P12_PASSWORD = 'p12-pa"ss\\word-SECRET';

/** @type {Awaited<ReturnType<typeof makeTlsFixtures>>} */
let tls;
before(async () => {
  tls = await makeTlsFixtures(P12_PASSWORD);
});
after(async () => {
  await tls?.cleanup();
});

test('a request without a body carries no content type and reads nothing on stdin', () => {
  const { args, input } = buildPanelCurlRequest({
    ...base,
    method: 'DELETE',
    path: '/api/registry-credential',
  });
  assert.equal(input, undefined);
  assert.ok(!args.includes('--data-binary') && !args.includes('@-'));
  assert.ok(!args.some((a) => a.startsWith('Content-Type')));
  assert.deepEqual(args.slice(0, 5), ['-q', '-K', '/tmp/curl-cfg', '--cert-type', 'P12']);
  assert.deepEqual(args.slice(-3), [
    '-w',
    '\n%{http_code}',
    `https://${PANEL_ADDRESS}:9292/api/registry-credential`,
  ]);
  assert.deepEqual(args.slice(args.indexOf('-X'), args.indexOf('-X') + 2), ['-X', 'DELETE']);
  assert.ok(args.includes('Accept: application/json'));
  assert.ok(!args.join(' ').includes('--pass'), 'the P12 password never enters argv');
});

test('a path with a dot segment is refused before curl could resolve it to another route', () => {
  for (const path of ['/api/domains/../activate', '/api/domains/./x', '/api/users/..']) {
    assert.throws(
      () => buildPanelCurlRequest({ ...base, method: 'DELETE', path }),
      /may not have a "\." or "\.\." segment/,
      path,
    );
  }
  // A query value is no path segment.
  buildPanelCurlRequest({ ...base, method: 'GET', path: '/api/sites/x/files?path=../etc' });
});

test('the panel is verified against its own certificate on loopback, never with -k', () => {
  const { args } = buildPanelCurlRequest({ ...base, method: 'GET', path: '/api/tunnels' });
  // A .curlrc could switch verification off; -q only works as the first argument.
  assert.equal(args[0], '-q');
  for (const insecure of ['-k', '--insecure']) {
    assert.ok(!args.includes(insecure), `${insecure} is never passed`);
  }
  assert.ok(!args.some((a) => /^-[a-zA-Z]*k/.test(a) && !a.startsWith('--')), 'no bundled -k');
  const at = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(at('--cacert'), '/pki/self-signed.pem');
  assert.equal(at('--connect-to'), `${PANEL_ADDRESS}:9292:127.0.0.1:9292`);
  assert.equal(at('--proto'), '=https');
  assert.equal(at('--noproxy'), '*');
  // Forward-secret TLS 1.2 suites only: the server proves its key before
  // the client presents its certificate.
  assert.ok(
    at('--ciphers')
      .split(':')
      .every((suite) => suite.startsWith('ECDHE+')),
  );
  assert.equal(args.at(-1), `https://${PANEL_ADDRESS}:9292/api/tunnels`);
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
  const listeners = () => [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const before = listeners();
  let seen;
  const result = await withCurlConfig('pass = "x"\n', async (configPath) => {
    const dir = path.dirname(configPath);
    seen = dir;
    assert.equal(path.dirname(dir), tmpdir());
    assert.match(path.basename(dir), /^lamalibre-lamaste-curl-/);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    // Signal handlers guard the directory while the request runs ...
    assert.deepEqual(listeners(), [before[0] + 1, before[1] + 1]);
    return 'done';
  });
  assert.equal(result, 'done');
  await assert.rejects(stat(seen), { code: 'ENOENT' });
  // ... and are gone with it.
  assert.deepEqual(listeners(), before);

  await assert.rejects(
    withCurlConfig('pass = "x"\n', async (configPath) => {
      seen = path.dirname(configPath);
      throw new Error('curl failed');
    }),
    /curl failed/,
  );
  await assert.rejects(stat(seen), { code: 'ENOENT' });
  assert.deepEqual(listeners(), before);
});

const panelApiUrl = new URL('../src/panel-api.js', import.meta.url).href;

for (const signal of ['SIGINT', 'SIGTERM']) {
  test(`${signal} during a request removes the config directory and still ends the CLI by ${signal}`, async () => {
    // A CLI process in the middle of a request: the config file exists and
    // curl has not answered yet.
    const script = `
      import { withCurlConfig } from ${JSON.stringify(panelApiUrl)};
      await withCurlConfig('pass = "SECRET"\\n', async (configPath) => {
        process.stdout.write(configPath + '\\n');
        await new Promise((resolve) => setTimeout(resolve, 60_000));
      });
    `;
    const child = execa(process.execPath, ['--input-type=module', '-e', script], {
      reject: false,
      cwd: path.dirname(fileURLToPath(import.meta.url)),
    });
    const configPath = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (chunk) => {
        out += chunk;
        if (out.includes('\n')) resolve(out.trim());
      });
      child.once('exit', () => reject(new Error('the CLI process ended before its request')));
    });
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    child.kill(signal);
    const result = await child;
    assert.equal(result.signal, signal, 'the process ends by the signal, as without the handlers');
    await assert.rejects(stat(path.dirname(configPath)), { code: 'ENOENT' });
  });
}

/** The private config directories present in the temporary directory. */
async function curlConfigDirs() {
  return (await readdir(tmpdir())).filter((name) => name.startsWith('lamalibre-lamaste-curl-'));
}

test('the registry token reaches the verified panel on stdin; curl shows neither it nor the password', async () => {
  const before = await curlConfigDirs();
  const panel = await standInPanel(tls.panel, () => ({
    status: 200,
    body: '{"configured":true,"owner":"admin"}',
  }));
  try {
    const body = {
      registryUrl: 'https://feria.example.com',
      auth: { kind: 'token', token: TOKEN },
    };
    const result = await curlPanelRequest({
      identity: panel.identity,
      method: 'PUT',
      path: '/api/registry-credential',
      body,
      p12Path: tls.p12Path,
      p12Password: P12_PASSWORD,
    });
    assert.deepEqual(result, { configured: true, owner: 'admin' });

    assert.equal(panel.seen.length, 1);
    const [request] = panel.seen;
    assert.equal(request.method, 'PUT');
    assert.equal(request.url, '/api/registry-credential');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.body, JSON.stringify(body));
    // The admin client certificate authenticated the request.
    assert.deepEqual(panel.handshakes, [{ clientCertificate: 'admin' }]);
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
  const panel = await standInPanel(tls.panel, (req) =>
    req.method === 'DELETE'
      ? { status: 200, body: '{"configured":false,"removed":true}' }
      : { status: 409, body: '{"error":"nope","details":"why"}' },
  );
  try {
    const options = {
      identity: panel.identity,
      p12Path: tls.p12Path,
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

/**
 * Make one request with the registry token to `listener` and expect it to be
 * refused before anything reached it: no request and no completed
 * handshake, so no client certificate either.
 */
async function expectRefusedBefore(listener) {
  await assert.rejects(
    curlPanelRequest({
      identity: listener.identity,
      method: 'PUT',
      path: '/api/registry-credential',
      body: { auth: { kind: 'token', token: TOKEN } },
      p12Path: tls.p12Path,
      p12Password: P12_PASSWORD,
    }),
    (err) => {
      assert.ok(
        err.message.startsWith(
          `The listener on 127.0.0.1:${listener.identity.port} did not prove it is the panel: ` +
            `it must present ${tls.panel.certPath}. Nothing was sent to it.`,
        ),
        err.message,
      );
      assert.ok(!err.message.includes(TOKEN));
      return true;
    },
  );
  assert.deepEqual(listener.seen, [], 'no request reached it');
  assert.deepEqual(listener.handshakes, [], 'no handshake completed: no client certificate');
}

test("a listener on the panel's port without the panel's key gets no request and no client certificate", async () => {
  // Someone else's listener on the port nginx does not hold, with a
  // certificate for the same address.
  const squatter = await standInPanel(
    tls.impostor,
    () => ({ status: 200, body: '{"configured":true}' }),
    {},
    tls.panel.certPath,
  );
  try {
    await expectRefusedBefore(squatter);
  } finally {
    squatter.server.close();
  }
});

test('a listener offering only RSA key exchange never gets the client certificate', async () => {
  // The panel's certificate is public. Over TLS 1.2 with RSA key exchange a
  // client presents its certificate before the server has proved it holds
  // the key, so a listener presenting the panel's certificate could collect
  // the admin certificate from the handshake. The CLI offers forward-secret
  // suites only — here even the real key gets no handshake that way.
  const rsaOnly = await standInPanel(tls.panel, undefined, {
    maxVersion: 'TLSv1.2',
    ciphers: 'AES128-GCM-SHA256:AES256-GCM-SHA384',
  });
  try {
    await expectRefusedBefore(rsaOnly);
  } finally {
    rsaOnly.server.close();
  }
});

test('the panel certificate for another address is refused too', async () => {
  // The right key alone is not enough: the certificate must name the
  // address the CLI asked for, as create-lamaste issues it.
  const panel = await standInPanel(tls.panel);
  try {
    await assert.rejects(
      curlPanelRequest({
        identity: { ...panel.identity, address: '198.51.100.9' },
        method: 'GET',
        path: '/api/tunnels',
        p12Path: tls.p12Path,
        p12Password: P12_PASSWORD,
      }),
      /did not prove it is the panel/,
    );
    assert.deepEqual(panel.seen, []);
  } finally {
    panel.server.close();
  }
});

test('nothing listening is reported as such', async () => {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  await assert.rejects(
    curlPanelRequest({
      identity: { certPath: tls.panel.certPath, address: PANEL_ADDRESS, port },
      method: 'GET',
      path: '/api/tunnels',
      p12Path: tls.p12Path,
      p12Password: P12_PASSWORD,
    }),
    (err) => {
      assert.ok(
        err.message.startsWith(`Nothing listens on 127.0.0.1:${port} — is nginx running?`),
        err.message,
      );
      return true;
    },
  );
});

test("a failed curl run says what failed in the panel's terms, never curl's command line", () => {
  const request = { p12Path: '/pki/client.p12', timeoutMs: 30000 };
  const id = { certPath: '/pki/self-signed.pem', port: 9292 };
  const untrusted = curlFailure(
    {
      exitCode: 60,
      stderr: 'curl: (60) SSL certificate problem: self signed certificate\nMore details here: …',
    },
    id,
    request,
  );
  assert.match(
    untrusted.message,
    /^The listener on 127\.0\.0\.1:9292 did not prove it is the panel/,
  );
  assert.equal(untrusted.curlExitCode, 60);
  assert.match(curlFailure({ exitCode: 7, stderr: '' }, id, request).message, /^Nothing listens/);
  assert.match(
    curlFailure(
      { exitCode: 58, stderr: 'curl: (58) could not load PEM client certificate' },
      id,
      request,
    ).message,
    /^curl could not use the admin client certificate \/pki\/client\.p12 \(curl: \(58\)/,
  );
  assert.equal(
    curlFailure({ timedOut: true }, id, request).message,
    'The panel did not answer within 30 s',
  );
  assert.equal(curlFailure({ code: 'ENOENT' }, id, request).message, 'curl is not installed');
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

test("a refused settings change keeps each field's message, the revision and the hosting", () => {
  assert.throws(
    () =>
      parsePanelResponse(
        JSON.stringify({
          error: 'Invalid settings',
          errors: {
            retries: 'Must be at most 10',
            _: 'The body carries only revision, values and secrets',
            'not a key': 'dropped: not a key a setting can have',
            __proto__x: 'dropped too',
            region: { message: 'dropped: not a string' },
          },
        }) + '\n400',
        'PUT',
        '/api/plugins/fx/settings',
      ),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, 'PUT /api/plugins/fx/settings failed (HTTP 400): Invalid settings');
      assert.deepEqual(err.errors, {
        retries: 'Must be at most 10',
        _: 'The body carries only revision, values and secrets',
      });
      assert.equal(err.revision, undefined);
      assert.equal(err.hosting, undefined);
      return true;
    },
  );
  assert.throws(
    () =>
      parsePanelResponse(
        '{"error":"The settings changed","code":"revision_mismatch","revision":7}\n409',
        'PUT',
        '/api/plugins/fx/settings',
      ),
    (err) => {
      assert.equal(err.code, 'revision_mismatch');
      assert.equal(err.revision, 7);
      assert.equal(err.errors, undefined);
      return true;
    },
  );
  const hosting = { agentLabel: 'vm1', phase: 'active', state: 'down', reason: 'tunnel' };
  assert.throws(
    () =>
      parsePanelResponse(
        JSON.stringify({ error: 'offline', code: 'hosting_offline', hosting }) + '\n503',
        'PUT',
        '/api/plugins/fx/settings',
      ),
    (err) => {
      assert.equal(err.code, 'hosting_offline');
      assert.deepEqual(err.hosting, hosting);
      return true;
    },
  );
  // Not hosted at all: the hosting is null, and still carried.
  assert.throws(
    () =>
      parsePanelResponse(
        '{"error":"not hosted","code":"hosting_offline","hosting":null}\n503',
        'PUT',
        '/p',
      ),
    (err) => err.hosting === null,
  );
  // Errors with nothing usable, a negative revision and a non-object hosting are left out.
  assert.throws(
    () =>
      parsePanelResponse(
        '{"error":"x","errors":{"bad key":"m"},"revision":-1,"hosting":"vm1"}\n409',
        'PUT',
        '/p',
      ),
    (err) =>
      err.errors === undefined && err.revision === undefined && !Object.hasOwn(err, 'hosting'),
  );
});
