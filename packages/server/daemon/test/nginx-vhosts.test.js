/**
 * Every vhost the panel generates must pass lamaste-priv's allow-list — the
 * root helper refuses anything else, and a refused vhost is a feature that
 * does not work on a real server. Runs the generators against a stand-in
 * `sudo` that captures what they would hand to the helper.
 *
 * The allow-list's refusals are tested in
 * packages/provisioners/server/test/lamaste-priv.test.js.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { validateVhost, PANEL_SITE_RE } = require(
  fileURLToPath(new URL('../../../provisioners/server/scripts/lamaste-priv', import.meta.url)),
);

let work;
let captured;
let nginx;

before(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'lamaste-vhosts-'));
  captured = path.join(work, 'captured');
  const bin = path.join(work, 'bin');
  await mkdir(captured);
  await mkdir(bin);
  // Stand-in sudo: keep `lamaste-priv nginx-site write <name>` input, succeed otherwise.
  const fakeSudo = path.join(bin, 'sudo');
  await writeFile(
    fakeSudo,
    `#!/bin/sh\nif [ "$2" = nginx-site ] && [ "$3" = write ]; then cat > "${captured}/$4"; fi\nexit 0\n`,
  );
  await chmod(fakeSudo, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  nginx = await import('../src/lib/nginx.js');
});

after(async () => {
  await rm(work, { recursive: true, force: true });
});

test('every generated vhost passes the lamaste-priv allow-list', async () => {
  const d = 'example.com';
  await nginx.writePanelVhost(d);
  await nginx.writeAuthVhost(d);
  await nginx.writeTunnelVhost(d);
  await nginx.writePublicVhost('app1', d, 20010);
  await nginx.writePublicVhost('app2', d, 20011, '/etc/letsencrypt/live/example.com/', {
    pathPrefix: 'herd',
    maxBodySizeMb: 100,
  });
  await nginx.writeAuthenticatedVhost('app3', d, 20012, undefined, { maxBodySizeMb: 5 });
  await nginx.writeRestrictedVhost('app4', d, 20013, undefined, {
    pathPrefix: 'shell',
    enabled: false,
  });
  await nginx.writeAgentPanelVhost('agent-r730', d, 9393);
  await nginx.writeStaticSiteVhost(
    {
      id: '3f1d2c3a-1b2c-4d5e-8f90-123456789abc',
      fqdn: 'www.example.com',
      spaMode: true,
      autheliaProtected: false,
      rootPath: '/var/www/lamaste/3f1d2c3a-1b2c-4d5e-8f90-123456789abc/',
      aliases: ['example.com'],
    },
    '/etc/letsencrypt/live/www.example.com',
    d,
  );
  await nginx.writeStaticSiteVhost(
    {
      id: '4f1d2c3a-1b2c-4d5e-8f90-123456789abc',
      fqdn: 'docs.example.com',
      spaMode: false,
      autheliaProtected: true,
      rootPath: '/var/www/lamaste/4f1d2c3a-1b2c-4d5e-8f90-123456789abc',
    },
    '/etc/letsencrypt/live/docs.example.com/',
    d,
  );

  const names = await readdir(captured);
  assert.equal(names.length, 10);
  for (const name of names) {
    assert.match(name, PANEL_SITE_RE);
    const text = await readFile(path.join(captured, name), 'utf8');
    assert.doesNotThrow(() => validateVhost(text), name);
  }
});

test('the auth vhost serves the OIDC discovery, JWKS and token endpoints without forward auth', async () => {
  // Authelia is the relay's OpenID Connect provider: a CLI running the
  // device-code flow and Feria verifying JWTs reach these paths before any
  // session exists. They must fall through to the plain proxy location.
  const text = await readFile(path.join(captured, 'lamalibre-lamaste-auth'), 'utf8');
  const locations = [...text.matchAll(/location\s+(\S+)\s*\{/g)].map((m) => m[1]);
  for (const oidcPath of [
    '/.well-known/openid-configuration',
    '/jwks.json',
    '/api/oidc/token',
    '/api/oidc/device-authorization',
    '/api/oidc/userinfo',
  ]) {
    const guarded = locations.filter((l) => l !== '/' && oidcPath.startsWith(l));
    assert.deepEqual(guarded, [], `${oidcPath} must not be matched by a guarded location`);
  }
  const catchAll = /location \/ \{([^}]*)\}/.exec(text);
  assert.ok(catchAll, 'catch-all location');
  assert.match(catchAll[1], /proxy_pass http:\/\/127\.0\.0\.1:9091;/);
  assert.doesNotMatch(catchAll[1], /auth_request/);
  // Host and X-Forwarded-Proto reach Authelia so the issuer it derives is https://auth.<domain>.
  assert.match(text, /proxy_set_header Host \$host;/);
  assert.match(text, /proxy_set_header X-Forwarded-Proto \$scheme;/);
});

/** The body of `location <path> {...}` in a vhost (no nested blocks but `if`). */
function locationBody(text, matcher) {
  const start = text.indexOf(`location ${matcher} {`);
  assert.notEqual(start, -1, `location ${matcher}`);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(`unterminated location ${matcher}`);
}

test('the agent panel vhost lets the panel authorize every request and forwards its assertion', async () => {
  const text = await readFile(
    path.join(captured, 'lamalibre-lamaste-agent-panel-agent-r730'),
    'utf8',
  );

  const authz = locationBody(text, '= /internal/lamaste/agent-panel-authz');
  assert.match(authz, /^\s*internal;$/m);
  assert.match(authz, /proxy_pass http:\/\/127\.0\.0\.1:3100\/api\/agent-panel\/authz\/r730;/);
  assert.match(authz, /proxy_pass_request_body off;/);
  // Verified by nginx, never the client's: the certificate and the request.
  assert.match(authz, /proxy_set_header X-SSL-Client-Verify \$ssl_client_verify;/);
  assert.match(authz, /proxy_set_header X-SSL-Client-DN \$ssl_client_s_dn;/);
  assert.match(authz, /proxy_set_header X-SSL-Client-Serial \$ssl_client_serial;/);
  assert.match(authz, /proxy_set_header X-Original-Method \$request_method;/);
  assert.match(authz, /proxy_set_header X-Original-URI \$request_uri;/);
  assert.match(authz, /proxy_set_header X-Forwarded-For \$remote_addr;/);

  const main = locationBody(text, '/');
  assert.match(main, /return 496;/);
  assert.match(main, /auth_request \/internal\/lamaste\/agent-panel-authz;/);
  assert.match(
    main,
    /auth_request_set \$relay_assertion \$upstream_http_x_lamalibre_relay_assertion;/,
  );
  assert.match(main, /proxy_set_header X-Lamalibre-Relay-Assertion \$relay_assertion;/);
  assert.match(main, /proxy_pass http:\/\/127\.0\.0\.1:9393;/);
  // No rewrite: the daemon must receive $request_uri unchanged, as asserted.
  assert.doesNotMatch(main, /rewrite/);
});

test('plugin tunnel vhosts carry Gatekeeper’s assertion; app tunnel vhosts are unchanged', async () => {
  const restrictedPlugin = locationBody(
    await readFile(path.join(captured, 'lamalibre-lamaste-app-app4'), 'utf8'),
    '/',
  );
  assert.match(
    restrictedPlugin,
    /auth_request_set \$relay_assertion \$upstream_http_x_lamalibre_relay_assertion;/,
  );
  assert.match(restrictedPlugin, /proxy_set_header X-Lamalibre-Relay-Assertion \$relay_assertion;/);

  // A public plugin tunnel has no user to vouch for — and passes on no client's assertion.
  const publicPlugin = await readFile(path.join(captured, 'lamalibre-lamaste-app-app2'), 'utf8');
  assert.match(publicPlugin, /proxy_set_header X-Lamalibre-Relay-Assertion "";/);

  for (const app of ['app1', 'app3']) {
    const text = await readFile(path.join(captured, `lamalibre-lamaste-app-${app}`), 'utf8');
    assert.doesNotMatch(text, /Relay-Assertion|relay_assertion/i, app);
  }
});

test('authorization subrequests name the vhost’s own hostname, never the client’s Host', async () => {
  // nginx selects the vhost from an absolute-form request line
  // (`GET https://a.example.com/ HTTP/1.1`) but `$http_host` is the client's
  // Host header, which may name another tunnel or site: built from it, the
  // subrequest authorized that other one while nginx served this one.
  for (const name of await readdir(captured)) {
    const text = await readFile(path.join(captured, name), 'utf8');
    assert.doesNotMatch(text, /\$http_host/, name);
  }

  for (const app of ['app3', 'app4']) {
    const fqdn = `${app}.example.com`;
    const text = await readFile(path.join(captured, `lamalibre-lamaste-app-${app}`), 'utf8');
    const authz = locationBody(text, '/internal/lamaste/authz');
    // The tunnel is named in the path, as the agent panel names its agent.
    assert.ok(
      authz.includes(`proxy_pass http://127.0.0.1:9294/authz/tunnel/${fqdn};`),
      `${app}: the subrequest path names the tunnel`,
    );
    // Nothing of the client's names another host, scheme or path to Gatekeeper.
    for (const header of ['X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Forwarded-Uri']) {
      assert.ok(authz.includes(`proxy_set_header ${header} "";`), `${app}: ${header} cleared`);
    }
    assert.ok(
      authz.includes(`proxy_set_header X-Original-URL https://${fqdn}$request_uri;`),
      `${app}: X-Original-URL names the tunnel`,
    );
    assert.ok(authz.includes(`proxy_set_header Host ${fqdn};`), `${app}: Host names the tunnel`);
    assert.ok(
      locationBody(text, '/').includes(
        `error_page 401 =302 https://auth.example.com/?rd=https://${fqdn}$request_uri;`,
      ),
      `${app}: the login redirect returns to the tunnel`,
    );
  }

  const site = await readFile(
    path.join(captured, 'lamalibre-lamaste-site-4f1d2c3a-1b2c-4d5e-8f90-123456789abc'),
    'utf8',
  );
  const siteAuthz = locationBody(site, '/internal/authelia/authz');
  assert.ok(
    siteAuthz.includes('proxy_set_header X-Original-URL https://docs.example.com$request_uri;'),
  );
  assert.ok(siteAuthz.includes('proxy_set_header X-Forwarded-Host "";'));

  const auth = await readFile(path.join(captured, 'lamalibre-lamaste-auth'), 'utf8');
  assert.ok(
    locationBody(auth, '/internal/authelia/authz').includes(
      'proxy_set_header X-Original-URL https://auth.example.com$request_uri;',
    ),
  );
});

test('a hostname that is not a plain literal is refused, not written into a vhost', () => {
  for (const [subdomain, domain] of [
    ['app$http_host', 'example.com'],
    ['app', 'example.com;'],
    ['app', 'example.com $request_uri'],
  ]) {
    assert.throws(
      () => nginx.renderTunnelVhost('restricted', subdomain, domain, 20013),
      /Invalid hostname/,
    );
  }
  assert.throws(
    () =>
      nginx.renderStaticSiteVhost(
        { id: 'x', fqdn: 'docs.example.com$http_host', autheliaProtected: true, rootPath: '/x' },
        '/etc/letsencrypt/live/x',
        'example.com',
      ),
    /Invalid hostname/,
  );
});
