/**
 * The http-level nginx file that keeps queries out of the access log and
 * Authelia (core `renderRequestPrivacyConf`, installed by create-lamaste as
 * /etc/nginx/conf.d/lamalibre-lamaste-request-privacy.conf): the map
 * `$lamaste_request_path` and the log format `lamaste_noquery`.
 *
 * When an nginx binary is on the PATH, nginx runs it: a server logging with
 * the relay's directive (to a file of the test's), a location sending a
 * stand-in backend `X-Original-URL` as the locations asking Authelia do,
 * and requests carrying a query, a referrer and a Basic username — none of
 * which the log line keeps.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  ACCESS_LOG_DIRECTIVE,
  ACCESS_LOG_FILE,
  ACCESS_LOG_FORMAT,
  REQUEST_PATH_VARIABLE,
  REQUEST_PRIVACY_FILE,
  renderRequestPrivacyConf,
} from '@lamalibre/lamaste';

const CONF = renderRequestPrivacyConf();

test('the file: the map and the format the vhosts name, nothing that could keep a query', () => {
  assert.equal(REQUEST_PRIVACY_FILE, '/etc/nginx/conf.d/lamalibre-lamaste-request-privacy.conf');
  assert.equal(
    ACCESS_LOG_DIRECTIVE,
    'access_log /var/log/nginx/access.log lamaste_noquery;',
    'exactly what lamaste-priv accepts at server level',
  );
  assert.equal(renderRequestPrivacyConf(), CONF, 'pure: a redeploy compares it byte for byte');
  assert.match(CONF, new RegExp(`^map \\$request_uri \\${REQUEST_PATH_VARIABLE} \\{$`, 'm'));
  const format = CONF.split('\n').find((line) => line.startsWith('log_format '));
  assert.ok(format, CONF);
  assert.ok(format.startsWith(`log_format ${ACCESS_LOG_FORMAT} '`), format);
  for (const leaking of ['$request ', '$request"', '$request_uri', '$args', '$query_string']) {
    assert.ok(!format.includes(leaking), `${leaking} in ${format}`);
  }
  for (const dropped of ['$remote_user', '$http_referer', '$uri']) {
    assert.ok(!format.includes(dropped), `${dropped} in ${format}`);
  }
  assert.ok(format.includes(REQUEST_PATH_VARIABLE));
  // The capture is positional: a named one would define a variable everywhere.
  assert.doesNotMatch(CONF, /\(\?P?</);
});

// ---------------------------------------------------------------------------
// In a real nginx (when one is installed)
// ---------------------------------------------------------------------------

const nginxBinary = spawnSync('nginx', ['-v']).status === 0 ? 'nginx' : null;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** One raw HTTP/1.1 request; the response body. */
function rawRequest(port, requestLine, headerLines = []) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        [
          requestLine,
          'Host: app.example.com',
          'Connection: close',
          'User-Agent: lamaste-test',
          ...headerLines,
          '',
          '',
        ].join('\r\n'),
      );
    });
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString('utf-8');
    });
    socket.on('end', () => resolve(data.slice(data.indexOf('\r\n\r\n') + 4)));
    socket.on('error', reject);
  });
}

test(
  'nginx itself: the log line and the URL for Authelia keep the path, never the query',
  { skip: nginxBinary ? false : 'no nginx binary on the PATH' },
  async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), 'lamaste-request-privacy-'));
    const backend = http.createServer((req, res) => {
      const body = Buffer.from(req.headers['x-original-url'] ?? '');
      res.writeHead(200, { 'content-length': String(body.length) });
      res.end(body);
    });
    await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve));
    const port = await freePort();
    const accessLog = path.join(prefix, 'logs', 'access.log');
    await mkdir(path.join(prefix, 'logs'));
    await writeFile(path.join(prefix, 'request-privacy.conf'), CONF);
    const conf = path.join(prefix, 'nginx.conf');
    await writeFile(
      conf,
      [
        'worker_processes 1;',
        `pid ${path.join(prefix, 'nginx.pid')};`,
        `error_log ${path.join(prefix, 'logs', 'error.log')};`,
        'events { worker_connections 64; }',
        'http {',
        // What Ubuntu's nginx.conf does: the server's directive replaces it.
        `  access_log ${path.join(prefix, 'logs', 'combined.log')};`,
        `  client_body_temp_path ${path.join(prefix, 'tmp-body')};`,
        `  proxy_temp_path ${path.join(prefix, 'tmp-proxy')};`,
        `  fastcgi_temp_path ${path.join(prefix, 'tmp-fcgi')};`,
        `  uwsgi_temp_path ${path.join(prefix, 'tmp-uwsgi')};`,
        `  scgi_temp_path ${path.join(prefix, 'tmp-scgi')};`,
        `  include ${path.join(prefix, 'request-privacy.conf')};`,
        '  server {',
        `    listen 127.0.0.1:${port};`,
        `    ${ACCESS_LOG_DIRECTIVE.replace(ACCESS_LOG_FILE, accessLog)}`,
        '    location = /old { rewrite ^ /authz last; }',
        '    location / {',
        `      proxy_set_header X-Original-URL https://app.example.com${REQUEST_PATH_VARIABLE};`,
        `      proxy_pass http://127.0.0.1:${backend.address().port};`,
        '      proxy_http_version 1.1;',
        '    }',
        '    location = /quiet { access_log off; return 204; }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    const check = spawnSync(nginxBinary, ['-t', '-p', prefix, '-c', conf], { encoding: 'utf-8' });
    assert.equal(check.status, 0, check.stderr);
    const server = spawn(nginxBinary, ['-p', prefix, '-c', conf, '-g', 'daemon off;'], {
      stdio: 'ignore',
    });
    try {
      for (let i = 0; i < 100; i += 1) {
        const up = await new Promise((resolve) => {
          const s = net.connect(port, '127.0.0.1', () => {
            s.end();
            resolve(true);
          });
          s.on('error', () => resolve(false));
        });
        if (up) break;
        await sleep(50);
      }

      // The URL Authelia would be told: raw (still encoded), no query.
      assert.equal(
        await rawRequest(port, 'GET /p/%7Euser?email=someone%40example.test&x=1 HTTP/1.1', [
          'Referer: https://app.example.com/search?q=private',
          `Authorization: Basic ${Buffer.from('chosen-name:pw').toString('base64')}`,
        ]),
        'https://app.example.com/p/%7Euser',
      );
      assert.equal(await rawRequest(port, 'GET /a#frag?x=1 HTTP/1.1'), 'https://app.example.com/a');
      assert.equal(await rawRequest(port, 'GET /?only=query HTTP/1.1'), 'https://app.example.com/');
      // An internal redirect: the path the client asked for is logged.
      assert.equal(
        await rawRequest(port, 'GET /old?token=secret HTTP/1.1'),
        'https://app.example.com/old',
      );
      await rawRequest(port, 'GET /quiet?code=single-use HTTP/1.1');

      const lines = (await readFile(accessLog, 'utf-8')).trim().split('\n');
      assert.equal(lines.length, 4, lines.join('\n'));
      const shape =
        /^127\.0\.0\.1 - - \[[^\]]+\] "GET (\S*) HTTP\/1\.1" (\d{3}) \d+ "-" "lamaste-test"$/;
      assert.deepEqual(
        lines.map((line) => {
          const m = shape.exec(line);
          assert.ok(m, `combined's shape: ${line}`);
          return [m[1], m[2]];
        }),
        [
          ['/p/%7Euser', '200'],
          ['/a', '200'],
          ['/', '200'],
          ['/old', '200'],
        ],
      );
      const text = lines.join('\n');
      for (const kept of ['email', 'someone', 'search', 'private', 'chosen-name', 'secret']) {
        assert.ok(!text.includes(kept), `${kept} in the log:\n${text}`);
      }
      const combined = await readFile(path.join(prefix, 'logs', 'combined.log'), 'utf-8').catch(
        () => '',
      );
      assert.equal(combined, '', 'the http-level log is replaced, not added to');
    } finally {
      server.kill('SIGTERM');
      await new Promise((resolve) => server.once('exit', resolve));
      backend.close();
      const errors = await readFile(path.join(prefix, 'logs', 'error.log'), 'utf-8').catch(
        () => '',
      );
      await rm(prefix, { recursive: true, force: true });
      assert.doesNotMatch(errors, /\[(?:emerg|alert|crit)\]/, errors);
    }
  },
);

// ---------------------------------------------------------------------------
// When create-lamaste installs it
// ---------------------------------------------------------------------------

/** The titles of the subtasks a task function hands Listr. */
async function subtaskTitles(tasks) {
  const ctx = {
    installDir: '/opt/lamalibre/lamaste',
    configDir: '/etc/lamalibre/lamaste',
    pkiDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'pki'),
  };
  let list = null;
  tasks(ctx, {
    newListr(items) {
      list = items;
      return items;
    },
  });
  return list.map((t) => t.title);
}

test('installed before any vhost names it — fresh install and redeploy', async () => {
  const STEP = 'Keeping queries out of the access log and Authelia';
  const { nginxTasks } = await import('../src/tasks/nginx.js');
  const install = await subtaskTitles(nginxTasks);
  assert.ok(install.includes(STEP), install.join(' | '));
  for (const later of [
    'Writing IP-based panel vhost',
    'Redirecting plain HTTP to HTTPS',
    'Refusing unknown hostnames over HTTPS',
    'Validating and starting nginx',
  ]) {
    assert.ok(install.indexOf(later) > install.indexOf(STEP), later);
  }

  // Before the running panel stops (a relay whose nginx refuses it keeps the
  // version it runs), so before the installer's own sites are refreshed and
  // the new panel re-renders every vhost at its start.
  const { redeployTasks } = await import('../src/tasks/redeploy.js');
  const redeploy = await subtaskTitles(redeployTasks);
  assert.ok(redeploy.includes(STEP), redeploy.join(' | '));
  for (const later of [
    'Stopping panel services',
    'Redirecting plain HTTP to HTTPS',
    'Refusing unknown hostnames over HTTPS',
    'Refreshing the IP panel vhost',
    'Reloading systemd and restarting panel',
  ]) {
    assert.ok(redeploy.indexOf(later) > redeploy.indexOf(STEP), later);
  }
});
