/**
 * The IP-based panel vhost (`https://<ip>:9292`, written by create-lamaste
 * at install and refreshed on every redeploy): every location that proxies
 * to the panel clears a relay assertion a client sent — the panel admits a
 * plugin's user surface on one, which only Gatekeeper may give it, through
 * a tunnel vhost — and the locations without a certificate check clear the
 * certificate headers too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SITE_UPLOAD_MAX_REQUEST_MIB } from '@lamalibre/lamaste';
import { IP_PANEL_SITE, generateIpPanelVhost } from '../src/lib/ip-panel-vhost.js';

const PKI = '/etc/lamalibre/lamaste/pki';

/** Every `location … { … }` of the vhost, its matcher and body (nested blocks are `if` only). */
function locations(text) {
  return [...text.matchAll(/^\s*location ([^{\n]+?) \{/gm)].map((m) => {
    const start = m.index;
    let depth = 0;
    for (let i = text.indexOf('{', start); i < text.length; i++) {
      if (text[i] === '{') depth++;
      if (text[i] === '}' && --depth === 0) {
        return { matcher: m[1], body: text.slice(start, i + 1) };
      }
    }
    throw new Error(`unterminated location ${m[1]}`);
  });
}

test('the IP panel vhost listens on 9292 with the self-signed certificate', () => {
  const text = generateIpPanelVhost(PKI);
  assert.equal(IP_PANEL_SITE, 'lamalibre-lamaste-panel-ip');
  assert.match(text, /^\s*listen 9292 ssl;$/m);
  assert.match(text, /ssl_certificate \/etc\/lamalibre\/lamaste\/pki\/self-signed\.pem;/);
  assert.match(text, /ssl_certificate_key \/etc\/lamalibre\/lamaste\/pki\/self-signed-key\.pem;/);
  assert.equal(generateIpPanelVhost(PKI), text, 'pure: a redeploy compares it byte for byte');
});

test('every location proxying to the panel clears a client’s relay assertion', () => {
  const proxied = locations(generateIpPanelVhost(PKI)).filter(({ body }) =>
    body.includes('proxy_pass http://127.0.0.1:3100;'),
  );
  assert.deepEqual(
    proxied.map((l) => l.matcher),
    ['/', '/api/enroll', '/api/invite', '~ ^/api/sites/[^/]+/files$', '/api'],
  );
  for (const { matcher, body } of proxied) {
    assert.ok(body.includes('proxy_set_header X-Lamalibre-Relay-Assertion "";'), matcher);
    for (const header of ['Remote-User', 'Remote-Groups', 'Remote-Name', 'Remote-Email']) {
      assert.ok(body.includes(`proxy_set_header ${header} "";`), `${matcher}: ${header}`);
    }
    const checksCertificate = body.includes('if ($ssl_client_verify != SUCCESS)');
    for (const header of ['X-SSL-Client-Verify', 'X-SSL-Client-DN', 'X-SSL-Client-Serial']) {
      // Set from nginx's TLS variables where a certificate is required,
      // cleared where none is.
      const line = checksCertificate
        ? new RegExp(`proxy_set_header ${header} \\$ssl_client_\\w+;`)
        : new RegExp(`proxy_set_header ${header} "";`);
      assert.match(body, line, `${matcher}: ${header}`);
    }
  }
});

test('only the site upload location admits a body over nginx’s 1 MiB default', () => {
  const text = generateIpPanelVhost(PKI);
  const sized = locations(text).filter(({ body }) => body.includes('client_max_body_size'));
  assert.deepEqual(
    sized.map((l) => l.matcher),
    ['~ ^/api/sites/[^/]+/files$'],
  );
  const [upload] = sized;
  assert.ok(upload.body.includes(`client_max_body_size ${SITE_UPLOAD_MAX_REQUEST_MIB}m;`));
  assert.ok(upload.body.includes('if ($ssl_client_verify != SUCCESS)'), 'mTLS required');
  assert.equal(text.match(/client_max_body_size/g).length, 1, 'none at server level');

  const re = new RegExp(upload.matcher.slice(2));
  assert.ok(re.test('/api/sites/3f1d2c3a-1b2c-4d5e-8f90-123456789abc/files'));
  assert.ok(!re.test('/api/sites/3f1d2c3a-1b2c-4d5e-8f90-123456789abc/files/x'));
  assert.ok(!re.test('/api/enroll'));
});
