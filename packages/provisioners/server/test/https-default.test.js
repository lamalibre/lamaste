/**
 * The HTTPS catch-all create-lamaste installs
 * (`/etc/nginx/sites-available/lamalibre-lamaste-https-default`): a
 * hostname no site of the relay serves is refused at the TLS handshake,
 * never answered with another site's certificate and sign-in redirect.
 *
 * When an nginx binary is on the PATH, it runs: the catch-all beside a site
 * with a certificate, and real handshakes — the site's name, an unknown
 * name, no SNI.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  ACCESS_LOG_DIRECTIVE,
  ACCESS_LOG_FILE,
  RELAY_TLS_DIRECTIVES,
  renderRequestPrivacyConf,
} from '@lamalibre/lamaste';
import { isDuplicateDefaultServer } from '../src/lib/http-redirect.js';
import {
  HTTPS_DEFAULT_SITE,
  HTTP_REDIRECT_SITE,
  generateHttpsDefaultVhost,
  generateHttpRedirectVhost,
} from '../src/lib/service-config.js';

const LISTEN = 'listen 443 ssl default_server;';

test('the catch-all: the default 443 server, as the relay listens, without a certificate', () => {
  const vhost = generateHttpsDefaultVhost();
  const directives = vhost
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(directives, [
    'server {',
    LISTEN,
    'server_name _;',
    // Logged as every server of the relay: the path, never the query.
    ACCESS_LOG_DIRECTIVE,
    // The socket's default server sets every name's protocol floor.
    ...RELAY_TLS_DIRECTIVES,
    'ssl_reject_handshake on;',
    'return 444;',
    '}',
  ]);
  assert.equal(HTTPS_DEFAULT_SITE, 'lamalibre-lamaste-https-default');
  assert.notEqual(HTTPS_DEFAULT_SITE, HTTP_REDIRECT_SITE);
  // Port 80 keeps its own default server: the redirect certbot clones.
  assert.match(generateHttpRedirectVhost(), /listen 80 default_server;/);
});

test("a step is skipped only when another site owns that port's default server", () => {
  const failure = (stderr) => Object.assign(new Error('nginx rejected'), { nginxStderr: stderr });
  const duplicate443 =
    'nginx: [emerg] a duplicate default server for 0.0.0.0:443 in /etc/nginx/sites-enabled/other:3';
  assert.equal(isDuplicateDefaultServer(failure(duplicate443), 443), true);
  assert.equal(isDuplicateDefaultServer(failure(duplicate443), 80), false);
  assert.equal(
    isDuplicateDefaultServer(
      failure('nginx: [emerg] a duplicate default server for 0.0.0.0:80 in /x:1'),
      80,
    ),
    true,
  );
  assert.equal(
    isDuplicateDefaultServer(failure('nginx: [emerg] unknown directive "foo" in /x:1'), 443),
    false,
    'any other failure is raised, not skipped',
  );
  assert.equal(isDuplicateDefaultServer(new Error('EEXIST'), 443), false);
  assert.equal(isDuplicateDefaultServer(undefined, 443), false);
});

const nginxBinary = spawnSync('nginx', ['-v']).status === 0 ? 'nginx' : null;
const opensslBinary = spawnSync('openssl', ['version']).status === 0 ? 'openssl' : null;

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

/** A TLS handshake to nginx: the certificate's subject and what an HTTP request answered, or the failure. */
function handshake(port, servername, tlsVersion) {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: '127.0.0.1',
      port,
      ...(servername ? { servername } : {}),
      ...(tlsVersion ? { minVersion: tlsVersion, maxVersion: tlsVersion } : {}),
      rejectUnauthorized: false,
    });
    socket.once('secureConnect', () => {
      const subject = socket.getPeerCertificate().subject?.CN ?? null;
      socket.write(`GET / HTTP/1.1\r\nHost: ${servername ?? 'x'}\r\nConnection: close\r\n\r\n`);
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString('utf-8');
      });
      socket.on('end', () => resolve({ ok: true, subject, body: data.split('\r\n\r\n')[1] ?? '' }));
    });
    socket.once('error', (err) => resolve({ ok: false, code: err.code ?? err.message }));
  });
}

test(
  'nginx itself: the known name is served; an unknown name and no SNI fail the handshake',
  { skip: nginxBinary && opensslBinary ? false : 'no nginx or openssl binary on the PATH' },
  async () => {
    const prefix = await mkdtemp(path.join(tmpdir(), 'lamaste-https-default-'));
    const port = await freePort();
    try {
      await mkdir(path.join(prefix, 'logs'));
      const cert = path.join(prefix, 'known.pem');
      const key = path.join(prefix, 'known.key');
      const made = spawnSync(
        opensslBinary,
        [
          'req',
          '-x509',
          '-newkey',
          'ec',
          '-pkeyopt',
          'ec_paramgen_curve:prime256v1',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=known.example.test',
          '-keyout',
          key,
          '-out',
          cert,
        ],
        { encoding: 'utf-8' },
      );
      assert.equal(made.status, 0, made.stderr);

      const catchAll = generateHttpsDefaultVhost();
      assert.ok(catchAll.includes(LISTEN));
      await writeFile(
        path.join(prefix, 'catch-all.conf'),
        catchAll
          .replace(LISTEN, `listen 127.0.0.1:${port} ssl default_server;`)
          .replace(ACCESS_LOG_FILE, path.join(prefix, 'logs', 'access.log')),
      );
      // A relay site, listed before the catch-all as nginx would read the
      // sites alphabetically: without default_server it would be the default.
      await writeFile(
        path.join(prefix, 'known.conf'),
        [
          'server {',
          `    listen 127.0.0.1:${port} ssl;`,
          '    server_name known.example.test;',
          `    ssl_certificate ${cert};`,
          `    ssl_certificate_key ${key};`,
          ...RELAY_TLS_DIRECTIVES.map((line) => `    ${line}`),
          '    location / { return 200 "known"; }',
          '}',
          '',
        ].join('\n'),
      );
      await writeFile(path.join(prefix, 'request-privacy.conf'), renderRequestPrivacyConf());
      const conf = path.join(prefix, 'nginx.conf');
      await writeFile(
        conf,
        [
          'worker_processes 1;',
          `pid ${path.join(prefix, 'nginx.pid')};`,
          `error_log ${path.join(prefix, 'logs', 'error.log')};`,
          'events { worker_connections 64; }',
          'http {',
          '  access_log off;',
          // A distribution default the catch-all must not leak to every name.
          '  ssl_protocols TLSv1.3;',
          `  client_body_temp_path ${path.join(prefix, 'tmp-body')};`,
          `  proxy_temp_path ${path.join(prefix, 'tmp-proxy')};`,
          `  fastcgi_temp_path ${path.join(prefix, 'tmp-fcgi')};`,
          `  uwsgi_temp_path ${path.join(prefix, 'tmp-uwsgi')};`,
          `  scgi_temp_path ${path.join(prefix, 'tmp-scgi')};`,
          `  include ${path.join(prefix, 'request-privacy.conf')};`,
          `  include ${path.join(prefix, 'known.conf')};`,
          `  include ${path.join(prefix, 'catch-all.conf')};`,
          '}',
          '',
        ].join('\n'),
      );
      const check = spawnSync(nginxBinary, ['-t', '-p', prefix, '-c', conf], {
        encoding: 'utf-8',
      });
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
        const known = await handshake(port, 'known.example.test');
        assert.equal(known.ok, true, JSON.stringify(known));
        assert.equal(known.subject, 'known.example.test');
        assert.equal(known.body, 'known');
        // TLS 1.2 to the known name: the catch-all (the socket's default)
        // carries the relay's protocols, not nginx's http-level ones.
        const tls12 = await handshake(port, 'known.example.test', 'TLSv1.2');
        assert.equal(tls12.ok, true, `TLS 1.2: ${JSON.stringify(tls12)}`);

        const unknown = await handshake(port, 'vinyard.example.test');
        assert.equal(unknown.ok, false, 'an unknown name never gets a certificate');
        const noSni = await handshake(port, null);
        assert.equal(noSni.ok, false, 'no SNI: no certificate either');
      } finally {
        server.kill('SIGTERM');
        await new Promise((resolve) => server.once('exit', resolve));
      }
    } finally {
      await rm(prefix, { recursive: true, force: true });
    }
  },
);
