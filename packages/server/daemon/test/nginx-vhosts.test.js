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
  // App tunnels bound as plugins' user surfaces (slice 6).
  await nginx.writeRestrictedVhost('piyasa', d, 20014, undefined, {
    maxBodySizeMb: 10,
    userSurface: [
      { route: 'market-indicators', maxBodySizeMb: 10 },
      { route: 'fx', maxBodySizeMb: 25 },
    ],
  });
  await nginx.writeAuthenticatedVhost('kamera', d, 20015, '/etc/letsencrypt/live/example.com/', {
    userSurface: [{ route: 'camwatch', maxBodySizeMb: 50 }],
  });
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
  assert.equal(names.length, 12);
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

test('plugin tunnel vhosts carry Gatekeeper’s assertion; every other tunnel vhost clears a client’s', async () => {
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

  // An app tunnel's backend never sees a relay assertion, public or not.
  for (const app of ['app1', 'app3']) {
    const main = locationBody(
      await readFile(path.join(captured, `lamalibre-lamaste-app-${app}`), 'utf8'),
      '/',
    );
    assert.match(main, /proxy_set_header X-Lamalibre-Relay-Assertion "";/, app);
    assert.doesNotMatch(main, /relay_assertion/, app);
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

// ---------------------------------------------------------------------------
// Plugins' user surfaces (slice 6)
// ---------------------------------------------------------------------------

/** Every `location … { … }` of a vhost: its matcher and body (nested blocks are `if` only). */
function locations(text) {
  return [...text.matchAll(/^\s*location ([^{\n]+?) \{/gm)].map((m) => ({
    matcher: m[1],
    body: locationBody(text, m[1]),
  }));
}

test('a bound tunnel vhost serves each user surface through Gatekeeper to the panel, request target untouched', async () => {
  const text = await readFile(path.join(captured, 'lamalibre-lamaste-app-piyasa'), 'utf8');
  const fqdn = 'piyasa.example.com';

  const authz = locationBody(text, '= /internal/lamaste/user-surface-authz');
  assert.match(authz, /^\s*internal;$/m);
  assert.ok(authz.includes(`proxy_pass http://127.0.0.1:9294/authz/user-surface/${fqdn};`));
  for (const line of [
    'proxy_pass_request_body off;',
    'proxy_set_header Content-Length "";',
    'proxy_set_header Connection "";',
    'proxy_set_header X-Original-Method $request_method;',
    `proxy_set_header X-Original-URL https://${fqdn}$request_uri;`,
    'proxy_set_header X-Forwarded-For $remote_addr;',
    'proxy_set_header X-Forwarded-Host "";',
    'proxy_set_header X-Forwarded-Proto "";',
    'proxy_set_header X-Forwarded-Uri "";',
    'proxy_set_header X-Forwarded-Method "";',
    `proxy_set_header Host ${fqdn};`,
    'proxy_set_header Cookie $http_cookie;',
    'proxy_http_version 1.1;',
  ]) {
    assert.ok(authz.includes(line), `authz: ${line}`);
  }
  // Assertions are single use: nothing here is cached.
  assert.doesNotMatch(text, /proxy_cache/);

  const unauthenticated = locationBody(text, '= /internal/lamaste/user-surface-401');
  assert.match(unauthenticated, /^\s*internal;$/m);
  assert.ok(
    unauthenticated.includes(
      'proxy_pass http://127.0.0.1:9294/authz/user-surface-unauthenticated;',
    ),
  );
  // Gatekeeper's rate limit keys on the address nginx saw, never one a client sent.
  assert.ok(unauthenticated.includes('proxy_set_header X-Forwarded-For $remote_addr;'));

  for (const [route, limit] of [
    ['market-indicators', 10],
    ['fx', 25],
  ]) {
    for (const matcher of [`= /api/${route}/app`, `/api/${route}/app/`]) {
      const body = locationBody(text, matcher);
      for (const line of [
        'auth_request /internal/lamaste/user-surface-authz;',
        'auth_request_set $relay_assertion $upstream_http_x_lamalibre_relay_assertion;',
        'proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;',
        // Nothing any part of the panel trusts comes from the browser
        'proxy_set_header Cookie "";',
        'proxy_set_header Authorization "";',
        'proxy_set_header Remote-User "";',
        'proxy_set_header Remote-Groups "";',
        'proxy_set_header Remote-Name "";',
        'proxy_set_header Remote-Email "";',
        'proxy_set_header X-SSL-Client-Verify "";',
        'proxy_set_header X-SSL-Client-DN "";',
        'proxy_set_header X-SSL-Client-Serial "";',
        'proxy_set_header X-Forwarded-Host "";',
        'proxy_set_header Host $host;',
        'proxy_set_header X-Real-IP $remote_addr;',
        'proxy_set_header X-Forwarded-For $remote_addr;',
        'proxy_set_header X-Forwarded-Proto $scheme;',
        'proxy_set_header Connection "";',
        // No URI: the panel gets the request target the assertion is bound to
        'proxy_pass http://127.0.0.1:3100;',
        'proxy_http_version 1.1;',
        `client_max_body_size ${limit}m;`,
        // No user-surface response lives longer than the panel lets it
        'proxy_read_timeout 3600s;',
        'proxy_send_timeout 3600s;',
        'error_page 401 = /internal/lamaste/user-surface-401;',
      ]) {
        assert.ok(body.includes(line), `${matcher}: ${line}`);
      }
      assert.doesNotMatch(body, /rewrite|\$http_|X-SSL-Client-\w+ \$/, matcher);
    }
  }

  // The rest of the host goes down the tunnel as before.
  const main = locationBody(text, '/');
  assert.match(main, /auth_request \/internal\/lamaste\/authz;/);
  assert.match(main, /proxy_pass http:\/\/127\.0\.0\.1:20014;/);

  // Only what lamaste-priv lets through: no header hiding, no named
  // location, no default type, no variable in a proxy_pass.
  for (const name of ['lamalibre-lamaste-app-piyasa', 'lamalibre-lamaste-app-kamera']) {
    const vhost = await readFile(path.join(captured, name), 'utf8');
    assert.doesNotMatch(vhost, /proxy_hide_header|default_type|location @|proxy_pass [^;]*\$/);
    assert.doesNotThrow(() => validateVhost(vhost), name);
  }
  const kamera = await readFile(path.join(captured, 'lamalibre-lamaste-app-kamera'), 'utf8');
  assert.ok(locationBody(kamera, '/api/camwatch/app/').includes('client_max_body_size 50m;'));
  assert.ok(kamera.includes('ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;'));
});

test('a tunnel vhost without a bound user surface has no user-surface location', async () => {
  for (const app of ['app1', 'app2', 'app3', 'app4']) {
    const text = await readFile(path.join(captured, `lamalibre-lamaste-app-${app}`), 'utf8');
    assert.doesNotMatch(text, /user-surface|\/app\b/, app);
  }
});

test('a user surface is never rendered on a public vhost, for an invalid route or limit', () => {
  const surface = [{ route: 'fx', maxBodySizeMb: 10 }];
  assert.throws(
    () =>
      nginx.renderTunnelVhost('public', 'open', 'example.com', 20020, undefined, {
        userSurface: surface,
      }),
    /public tunnel vhost cannot serve/,
  );
  for (const route of ['Fx', 'fx/../x', 'fx$host', '-fx', 'tunnels', 'a'.repeat(65)]) {
    assert.throws(
      () =>
        nginx.renderTunnelVhost('restricted', 'x', 'example.com', 20020, undefined, {
          userSurface: [{ route, maxBodySizeMb: 10 }],
        }),
      /Invalid user-surface route/,
      route,
    );
  }
  for (const maxBodySizeMb of [0, 10241, 1.5, '10']) {
    assert.throws(
      () =>
        nginx.renderTunnelVhost('authenticated', 'x', 'example.com', 20020, undefined, {
          userSurface: [{ route: 'fx', maxBodySizeMb }],
        }),
      /Invalid maxBodySizeMb/,
      String(maxBodySizeMb),
    );
  }
});

test('every location that proxies a browser to the panel clears a client’s relay assertion', async () => {
  // Only a user-surface location sets one — from Gatekeeper's answer.
  let checked = 0;
  for (const name of await readdir(captured)) {
    const text = await readFile(path.join(captured, name), 'utf8');
    for (const { matcher, body } of locations(text)) {
      if (!/proxy_pass http:\/\/127\.0\.0\.1:3100[/;]/.test(body)) continue;
      checked += 1;
      const userSurface = /^(= )?\/api\/[a-z0-9-]+\/app\/?$/.test(matcher);
      assert.ok(
        body.includes(
          userSurface
            ? 'proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;'
            : 'proxy_set_header X-Lamalibre-Relay-Assertion "";',
        ),
        `${name} ${matcher}`,
      );
      if (!userSurface) assert.doesNotMatch(body, /relay_assertion/, `${name} ${matcher}`);
    }
  }
  // panel (7) + auth (2) + agent-panel authz (1) + user surfaces (2 × 3)
  assert.equal(checked, 16);
});

test('no location proxying to a tunnel or agent backend passes Authelia’s session cookie on', async () => {
  // Every location whose proxy_pass is not a Lamaste service on the relay
  // (panel 3100, chisel 9090, Authelia 9091, Gatekeeper 9294) reaches a
  // backend: an app on an agent, an agent's lamaste-agentd, or whatever
  // holds the tunnel port. Each sets Cookie from the map that strips
  // authelia_session — the browser's other cookies still reach the app.
  const RELAY_SERVICES = new Set(['3100', '9090', '9091', '9294']);
  const backends = [];
  for (const name of await readdir(captured)) {
    const text = await readFile(path.join(captured, name), 'utf8');
    for (const { matcher, body } of locations(text)) {
      const pass = /proxy_pass http:\/\/127\.0\.0\.1:(\d+)/.exec(body);
      if (!pass || RELAY_SERVICES.has(pass[1])) continue;
      backends.push(`${name} ${matcher}`);
      assert.ok(
        body.includes('proxy_set_header Cookie $lamaste_backend_cookie;'),
        `${name} ${matcher}: Cookie from $lamaste_backend_cookie`,
      );
      assert.equal(
        (body.match(/proxy_set_header Cookie /g) ?? []).length,
        1,
        `${name} ${matcher}: one Cookie header`,
      );
    }
  }
  // app1–app4, piyasa and kamera (location /), and the agent panel
  assert.equal(backends.length, 7, backends.join('\n'));
  // Gatekeeper alone is handed the browser's session, to check it.
  for (const name of await readdir(captured)) {
    const text = await readFile(path.join(captured, name), 'utf8');
    for (const { matcher, body } of locations(text)) {
      if (body.includes('proxy_set_header Cookie $http_cookie;')) {
        assert.match(body, /proxy_pass http:\/\/127\.0\.0\.1:9294\/authz\//, `${name} ${matcher}`);
      }
    }
  }
});

test('the panel vhost renders on the certificate it names, as the reconcile rewrites it', () => {
  const { name, fqdn, config } = nginx.renderPanelVhost(
    'example.com',
    '/etc/letsencrypt/live/example.com/',
  );
  assert.equal(name, 'lamalibre-lamaste-panel-domain');
  assert.equal(fqdn, 'panel.example.com');
  assert.match(config, /ssl_certificate \/etc\/letsencrypt\/live\/example\.com\/fullchain\.pem;/);
  assert.equal(
    nginx.renderPanelVhost('example.com').config.match(/live\/panel\.example\.com\//g).length,
    2,
  );
  assert.throws(() => nginx.renderPanelVhost('example.com $host'), /Invalid hostname/);
});
