/**
 * Enrollment calls the panel without a certificate, sending the one-time
 * enrollment token in a JSON body. The body reaches curl on stdin, never in
 * its arguments — which other local users can read — and the panel's answer
 * is read as before: the parsed body, or its `error` for a 4xx.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

const TOKEN = 'enroll-0123456789abcdef-SECRET';
const PIN = { panelServerPubkeySha256: 'A'.repeat(43) + '=', panelUrl: 'https://panel.test' };

let home;
let api;

before(async () => {
  // panel-api.js sweeps stale curl configs from the agent directory when it
  // loads; keep that away from the real one.
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-panel-api-'));
  process.env.HOME = home;
  api = await import('../src/lib/panel-api.js');
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

/**
 * A stand-in panel on loopback (plain HTTP; the pin only applies to TLS).
 * It records each request and, while curl still waits for the answer, the
 * command lines `ps` shows for the process requesting its port.
 *
 * @param {{ status: number, body: string }} answer
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
      seen.push({ method: req.method, headers: req.headers, body, commandLines });
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(answer.body);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { url: `http://127.0.0.1:${server.address().port}/api/enroll`, seen, server };
}

test('the POST arguments read the body on stdin and carry no body', () => {
  const args = api.unauthenticatedPostArgs('https://panel.test/api/enroll', PIN);
  const data = args.indexOf('--data-binary');
  assert.equal(args[data + 1], '@-');
  assert.ok(!args.includes('-d'));
  assert.ok(!args.includes('-f'), 'a 4xx body must stay readable');
  assert.equal(args.at(-1), 'https://panel.test/api/enroll');
  assert.deepEqual(args.slice(args.indexOf('--pinnedpubkey'), args.indexOf('--pinnedpubkey') + 2), [
    '--pinnedpubkey',
    `sha256//${PIN.panelServerPubkeySha256}`,
  ]);
});

test('the enrollment token reaches the panel on stdin and never shows on the command line', async () => {
  const panel = await standInPanel({
    status: 200,
    body: '{"ok":true,"label":"vm1","cert":"PEM"}',
  });
  try {
    const body = { token: TOKEN, csr: '-----BEGIN CERTIFICATE REQUEST-----' };
    const result = await api.curlPostUnauthenticated(panel.url, body, PIN);
    assert.deepEqual(result, { ok: true, label: 'vm1', cert: 'PEM' });

    const [request] = panel.seen;
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.body, JSON.stringify(body));
    // Where `ps` is available, the live curl process is in it — without the token.
    if (request.commandLines !== null) {
      assert.ok(request.commandLines.some((line) => line.startsWith('curl ')));
      for (const line of request.commandLines) {
        assert.ok(!line.includes(TOKEN), 'the token is not on the command line');
      }
    }
  } finally {
    panel.server.close();
  }
});

test("a refused enrollment rejects with the panel's error", async () => {
  const panel = await standInPanel({ status: 400, body: '{"error":"Invalid or expired token"}' });
  try {
    await assert.rejects(api.curlPostUnauthenticated(panel.url, { token: TOKEN }, PIN), (err) => {
      assert.equal(err.message, 'Invalid or expired token');
      assert.ok(!err.message.includes(TOKEN));
      return true;
    });
    assert.equal(panel.seen[0].body, JSON.stringify({ token: TOKEN }));
  } finally {
    panel.server.close();
  }
});
