/**
 * lamaste-priv's vhost allow-list and site-name rules. nginx opens the files
 * a vhost names as root, so every vhost the helper accepts must be unable to
 * name a file outside the paths Lamaste serves. The generators' side (every
 * vhost the panel writes is accepted) is tested in
 * packages/server/daemon/test/nginx-vhosts.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { validateVhost, assertSiteName } = require(
  fileURLToPath(new URL('../scripts/lamaste-priv', import.meta.url)),
);

const server = (inner) => `server {\n listen 443 ssl;\n server_name a.example.com;\n${inner}\n}\n`;
const location = (inner) => server(` location / {\n${inner}\n }`);

const refused = {
  'access_log to a file': server(' access_log /etc/cron.d/x;'),
  'log_format at http level': "log_format x '$request';\n" + server(''),
  error_log: server(' error_log /etc/cron.d/x;'),
  'include of an arbitrary file': server(' include /etc/shadow;'),
  'include traversing out of snippets': server(
    ' include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf/../../../shadow;',
  ),
  'quoted directive name': server(' "access_log" /tmp/x;'),
  'single-quoted include': server(" 'include' /etc/shadow;"),
  'include inside map': 'map $a $b {\n include /etc/shadow;\n}\n',
  'block inside map': 'map $a $b {\n default { }\n}\n',
  'ssl key outside letsencrypt': server(' ssl_certificate_key /etc/shadow;'),
  'ssl key traversal': server(
    ' ssl_certificate_key /etc/letsencrypt/live/../../shadow/privkey.pem;',
  ),
  'root outside the web root': server(' root /etc;'),
  'root traversal': server(' root /var/www/lamaste/../../../etc;'),
  'alias with a variable': location('  alias /var/www/lamaste/$1;'),
  'proxy_pass to a unix socket': location('  proxy_pass http://unix:/run/docker.sock:;'),
  'proxy_pass off-host': location('  proxy_pass http://10.0.0.1:80;'),
  client_body_temp_path: server(' client_body_temp_path /etc/sudoers.d;'),
  proxy_cache_path: 'proxy_cache_path /etc/x keys_zone=z:1m;\n' + server(''),
  'listen on port 80': 'server {\n listen 80;\n server_name a.example.com;\n}\n',
  'listen on a unix socket': 'server {\n listen unix:/etc/x;\n}\n',
  backslash: server(String.raw` add_header X a\;access_log;`),
  'dollar-brace variable': server(' add_header X ${x};'),
  load_module: 'load_module /tmp/x.so;\n',
  'http block': 'http {\n}\n',
  'if at server level': server(' if ($a) { return 403; }'),
  'proxy_pass inside if': location('  if ($a) { proxy_pass http://127.0.0.1:1; }'),
  'include inside location': location('  include /etc/shadow;'),
  'unknown module directive': location('  perl Foo::handler;'),
  'unterminated string': server(' add_header X "abc'),
  'missing closing brace': 'server {\n listen 443 ssl;\n',
  'extra closing brace': server('') + '}\n',
  'non-ASCII token': server(' add_header X é;'),
  'quote inside a word': server(' add_header X a"b;'),
  ssl_stapling_file: server(' ssl_stapling_file /etc/shadow;'),
  'no directives': '# only a comment\n',
};

for (const [name, text] of Object.entries(refused)) {
  test(`refuses a vhost with ${name}`, () => {
    assert.throws(() => validateVhost(text));
  });
}

test('accepts a minimal TLS proxy vhost, comments with any text included', () => {
  validateVhost(
    `# Managed by Lamaste — généré\nserver {\n listen 443 ssl;\n server_name a.example.com;\n` +
      ` ssl_certificate /etc/letsencrypt/live/a.example.com/fullchain.pem;\n` +
      ` ssl_certificate_key /etc/letsencrypt/live/a.example.com/privkey.pem;\n` +
      ` location / {\n  proxy_set_header Host $host;\n  proxy_pass http://127.0.0.1:20010;\n }\n}\n`,
  );
});

test('site names: only the vhosts the panel writes', () => {
  for (const name of [
    'lamalibre-lamaste-panel-domain',
    'lamalibre-lamaste-auth',
    'lamalibre-lamaste-tunnel',
    'lamalibre-lamaste-app-gitlab',
    'lamalibre-lamaste-agent-panel-agent-r730',
    'lamalibre-lamaste-site-3f1d2c3a-1b2c-4d5e-8f90-123456789abc',
  ]) {
    assert.doesNotThrow(() => assertSiteName(name, 'write'), name);
  }
  for (const name of [
    '../x',
    'default',
    'lamalibre-lamaste-http-redirect',
    'lamalibre-lamaste-panel-ip',
    'lamalibre-lamaste-app-a/../../x',
    'lamalibre-lamaste-app-',
    'lamalibre-lamaste-site-not-a-uuid',
  ]) {
    assert.throws(() => assertSiteName(name, 'write'), name);
  }
});

test('the IP vhost may only be switched on and off', () => {
  assert.doesNotThrow(() => assertSiteName('lamalibre-lamaste-panel-ip', 'enable'));
  assert.doesNotThrow(() => assertSiteName('lamalibre-lamaste-panel-ip', 'disable'));
  assert.throws(() => assertSiteName('lamalibre-lamaste-panel-ip', 'remove'));
});
