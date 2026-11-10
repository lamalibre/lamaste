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
import {
  AUTHELIA_NOSCRIPT_TEXT,
  SITE_UPLOAD_MAX_REQUEST_MIB,
  autheliaIndexLanguageFilters,
} from '@lamalibre/lamaste';
import {
  INVITATIONS_PAGE_HEADERS,
  INVITE_PAGE_HEADERS,
  UNAVAILABLE_PAGE_STYLE_HASH,
} from '@lamalibre/lamaste/server';

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
  await nginx.writeAuthVhost(d, { primary: true });
  // A second domain's portal: Authelia and the invitation page, nothing of the panel's.
  await nginx.writeAuthVhost('codelama.com.tr', { primary: false });
  // A branded domain's portal: its theme, stylesheet and logo in the index HTML.
  await nginx.writeAuthVhost('samplepark.tr', {
    primary: false,
    branding: { theme: 'dark', logo: true },
  });
  await nginx.writeTunnelVhost(d);
  await nginx.writePublicVhost('app1.example.com', d, 20010);
  await nginx.writePublicVhost('app2.example.com', d, 20011, '/etc/letsencrypt/live/example.com/', {
    pathPrefix: 'herd',
    maxBodySizeMb: 100,
  });
  await nginx.writeGatekeeperVhost('app3.example.com', d, 20012, undefined, {
    maxBodySizeMb: 5,
  });
  await nginx.writeGatekeeperVhost('app4.example.com', d, 20013, undefined, {
    pathPrefix: 'shell',
    enabled: false,
  });
  await nginx.writeAgentPanelVhost('agent-r730.example.com', d, 9393);
  // App tunnels bound as plugins' user surfaces (slice 6).
  await nginx.writeGatekeeperVhost('piyasa.example.com', d, 20014, undefined, {
    maxBodySizeMb: 10,
    userSurface: [
      { route: 'market-indicators', maxBodySizeMb: 10 },
      { route: 'fx', maxBodySizeMb: 25 },
    ],
  });
  await nginx.writeGatekeeperVhost(
    'kamera.example.com',
    d,
    20015,
    '/etc/letsencrypt/live/example.com/',
    {
      userSurface: [{ route: 'camwatch', maxBodySizeMb: 50 }],
    },
  );
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
  assert.equal(names.length, 14);
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
  const text = await readFile(path.join(captured, 'lamalibre-lamaste-auth-example.com'), 'utf8');
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
    path.join(captured, 'lamalibre-lamaste-agent-panel-agent-r730.example.com'),
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
    await readFile(path.join(captured, 'lamalibre-lamaste-app-app4.example.com'), 'utf8'),
    '/',
  );
  assert.match(
    restrictedPlugin,
    /auth_request_set \$relay_assertion \$upstream_http_x_lamalibre_relay_assertion;/,
  );
  assert.match(restrictedPlugin, /proxy_set_header X-Lamalibre-Relay-Assertion \$relay_assertion;/);

  // A public plugin tunnel has no user to vouch for — and passes on no client's assertion.
  const publicPlugin = await readFile(
    path.join(captured, 'lamalibre-lamaste-app-app2.example.com'),
    'utf8',
  );
  assert.match(publicPlugin, /proxy_set_header X-Lamalibre-Relay-Assertion "";/);

  // An app tunnel's backend never sees a relay assertion, public or not.
  for (const app of ['app1', 'app3']) {
    const main = locationBody(
      await readFile(path.join(captured, `lamalibre-lamaste-app-${app}.example.com`), 'utf8'),
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
    const text = await readFile(
      path.join(captured, `lamalibre-lamaste-app-${app}.example.com`),
      'utf8',
    );
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

  const auth = await readFile(path.join(captured, 'lamalibre-lamaste-auth-example.com'), 'utf8');
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
      () => nginx.renderTunnelVhost('restricted', `${subdomain}.${domain}`, domain, 20013),
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
  const text = await readFile(
    path.join(captured, 'lamalibre-lamaste-app-piyasa.example.com'),
    'utf8',
  );
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

  // A refusal answered as JSON from Gatekeeper's X-Lamalibre-Refusal (auth_request
  // keeps the subrequest's status and headers, never its body), only ever one of
  // two fixed bodies; Gatekeeper is never asked twice.
  const refused = locationBody(text, '= /internal/lamaste/user-surface-403');
  assert.match(refused, /^\s*internal;$/m);
  for (const line of [
    'default_type application/json;',
    'add_header Cache-Control "no-store" always;',
    'add_header X-Content-Type-Options "nosniff" always;',
    'if ($lamaste_refusal = not_a_member) {',
    `return 403 '{"error":"not_a_member"}';`,
    `return 403 '{"error":"forbidden"}';`,
  ]) {
    assert.ok(refused.includes(line), `403: ${line}`);
  }
  assert.doesNotMatch(refused, /proxy_pass/);

  for (const [route, limit] of [
    ['market-indicators', 10],
    ['fx', 25],
  ]) {
    for (const matcher of [`= /api/${route}/app`, `^~ /api/${route}/app/`]) {
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
        'error_page 403 = /internal/lamaste/user-surface-403;',
        'auth_request_set $lamaste_refusal $upstream_http_x_lamalibre_refusal;',
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
  // location, no variable in a proxy_pass (a default type only in the JSON
  // refusal's location — lamaste-priv allows it in locations alone).
  for (const name of [
    'lamalibre-lamaste-app-piyasa.example.com',
    'lamalibre-lamaste-app-kamera.example.com',
  ]) {
    const vhost = await readFile(path.join(captured, name), 'utf8');
    assert.doesNotMatch(vhost, /proxy_hide_header|location @|proxy_pass [^;]*\$/);
    assert.doesNotThrow(() => validateVhost(vhost), name);
  }
  const kamera = await readFile(
    path.join(captured, 'lamalibre-lamaste-app-kamera.example.com'),
    'utf8',
  );
  assert.ok(locationBody(kamera, '^~ /api/camwatch/app/').includes('client_max_body_size 50m;'));
  assert.ok(kamera.includes('ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;'));
});

test('a tunnel vhost without a bound user surface has no user-surface location', async () => {
  for (const app of ['app1', 'app2', 'app3', 'app4']) {
    const text = await readFile(
      path.join(captured, `lamalibre-lamaste-app-${app}.example.com`),
      'utf8',
    );
    assert.doesNotMatch(text, /user-surface|\/app\b/, app);
  }
});

test('a user surface is never rendered on a public vhost, for an invalid route or limit', () => {
  const surface = [{ route: 'fx', maxBodySizeMb: 10 }];
  assert.throws(
    () =>
      nginx.renderTunnelVhost('public', 'open.example.com', 'example.com', 20020, undefined, {
        userSurface: surface,
      }),
    /public tunnel vhost cannot serve/,
  );
  for (const route of ['Fx', 'fx/../x', 'fx$host', '-fx', 'tunnels', 'a'.repeat(65)]) {
    assert.throws(
      () =>
        nginx.renderTunnelVhost('restricted', 'x.example.com', 'example.com', 20020, undefined, {
          userSurface: [{ route, maxBodySizeMb: 10 }],
        }),
      /Invalid user-surface route/,
      route,
    );
  }
  for (const maxBodySizeMb of [0, 10241, 1.5, '10']) {
    assert.throws(
      () =>
        nginx.renderTunnelVhost('authenticated', 'x.example.com', 'example.com', 20020, undefined, {
          userSurface: [{ route: 'fx', maxBodySizeMb }],
        }),
      /Invalid maxBodySizeMb/,
      String(maxBodySizeMb),
    );
  }
});

test('every location that proxies a browser to the panel clears a client’s relay assertion', async () => {
  // Only a user-surface location, an auth portal's inviter API and its
  // password change set one — from Gatekeeper's answer.
  let checked = 0;
  for (const name of await readdir(captured)) {
    const text = await readFile(path.join(captured, name), 'utf8');
    for (const { matcher, body } of locations(text)) {
      if (!/proxy_pass http:\/\/127\.0\.0\.1:3100[/;]/.test(body)) continue;
      checked += 1;
      const userSurface =
        /^(= |\^~ )?\/api\/[a-z0-9-]+\/app\/?$/.test(matcher) ||
        matcher === '^~ /api/delegated-invitations/' ||
        matcher === '= /api/account/password';
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
  // panel (8: the site upload location too) + primary auth (6: the
  // mail consent callback too) + second and branded domains' auth (4 each:
  // the invitation API, the inviter's API, the forgot-password API, the
  // change-password API) + agent-panel authz (1) + user surfaces (2 × 3)
  assert.equal(checked, 29);
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

// ---------------------------------------------------------------------------
// The multi-domain relay
// ---------------------------------------------------------------------------

test('a second domain’s auth portal serves Authelia and invitations — never the desktop’s user-access sign-in', async () => {
  const text = await readFile(
    path.join(captured, 'lamalibre-lamaste-auth-codelama.com.tr'),
    'utf8',
  );
  assert.match(text, /server_name auth\.codelama\.com\.tr;/);
  assert.match(text, /live\/auth\.codelama\.com\.tr\/fullchain\.pem/);
  assert.match(text, /location \/invite\/ \{/);
  assert.match(text, /location \/api\/invite\/ \{/);
  assert.match(text, /location \/ \{\s*proxy_pass http:\/\/127\.0\.0\.1:9091;/);
  // Authelia derives the issuer and cookie domain from the forwarded host:
  // the portal's own name, never the client's.
  const portal = locationBody(text, '/');
  for (const line of [
    'proxy_set_header Host auth.codelama.com.tr;',
    'proxy_set_header X-Forwarded-Host auth.codelama.com.tr;',
    'proxy_set_header X-Forwarded-Proto https;',
  ]) {
    assert.ok(portal.includes(line), line);
  }
  assert.doesNotMatch(portal, /\$http_x_forwarded_host|\$host\b/);
  // The rate-limit zone is an http-level name: declared once, by the primary's portal.
  assert.doesNotMatch(text, /limit_req_zone/);
  assert.doesNotMatch(text, /user-access/);
  // The desktop's sign-in is the primary's alone; the auth requests here are
  // the inviter API's, to Gatekeeper, the change-password page's, to
  // Authelia, and its API's, to Gatekeeper (mail-design.md §6.3).
  assert.doesNotMatch(text, /\/internal\/authelia\/authz/);
  assert.deepEqual(text.match(/auth_request \S+;/g), [
    'auth_request off;',
    'auth_request /internal/lamaste/delegated-invitations-authz;',
    'auth_request /internal/lamaste/account-authz;',
    'auth_request /internal/lamaste/account-authz;',
    'auth_request off;',
    'auth_request /internal/lamaste/account-api-authz;',
  ]);
  // Google returns the mail consent to the primary's portal alone.
  assert.doesNotMatch(text, /mail\/google\/callback/);
  const primary = await readFile(path.join(captured, 'lamalibre-lamaste-auth-example.com'), 'utf8');
  assert.match(primary, /limit_req_zone \$binary_remote_addr zone=user_access_auth/);
  assert.match(primary, /location \/api\/user-access\/authorize \{/);
});

test('every auth portal serves the inviter API through Gatekeeper, and the invitation API under its own Host', async () => {
  for (const domain of ['example.com', 'codelama.com.tr', 'samplepark.tr']) {
    const text = await readFile(path.join(captured, `lamalibre-lamaste-auth-${domain}`), 'utf8');
    const fqdn = `auth.${domain}`;
    const api = locationBody(text, '^~ /api/delegated-invitations/');
    for (const line of [
      'auth_request /internal/lamaste/delegated-invitations-authz;',
      'proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;',
      'proxy_set_header Cookie "";',
      'proxy_set_header Authorization "";',
      'proxy_set_header Remote-User "";',
      'proxy_set_header X-SSL-Client-Verify "";',
      'proxy_set_header X-Forwarded-Host "";',
      `proxy_set_header Host ${fqdn};`,
      'proxy_pass http://127.0.0.1:3100;',
      'client_max_body_size 16k;',
      'error_page 401 = /internal/lamaste/delegated-invitations-401;',
      'error_page 403 = /internal/lamaste/delegated-invitations-403;',
    ]) {
      assert.ok(api.includes(line), `${domain}: ${line}`);
    }
    assert.doesNotMatch(api, /\$host\b|\$http_host/, domain);
    const authz = locationBody(text, '= /internal/lamaste/delegated-invitations-authz');
    for (const line of [
      'internal;',
      `proxy_pass http://127.0.0.1:9294/authz/delegated-invitations/${domain};`,
      `proxy_set_header X-Original-URL https://${fqdn}$request_uri;`,
      `proxy_set_header Host ${fqdn};`,
      'proxy_set_header Cookie $http_cookie;',
      'proxy_pass_request_body off;',
    ]) {
      assert.ok(authz.includes(line), `${domain}: ${line}`);
    }
    // The invitation API: the panel tells a delegated token's domain by
    // this literal Host, never one a client named.
    const invite = locationBody(text, '/api/invite/');
    assert.ok(invite.includes(`proxy_set_header Host ${fqdn};`), domain);
    assert.ok(invite.includes('proxy_set_header X-Forwarded-Host "";'), domain);
    assert.ok(invite.includes('client_max_body_size 16k;'), domain);
    assert.doesNotMatch(invite, /proxy_set_header Host \$host/, domain);
  }
});

test('the panel vhost’s public invitation API writes a Host no invitation names', async () => {
  const text = await readFile(path.join(captured, 'lamalibre-lamaste-panel-domain'), 'utf8');
  const location = text.slice(text.indexOf('location /api/invite/ {'));
  const body = location.slice(0, location.indexOf('\n    }'));
  // A delegated token is answered only with `Host: auth.<its domain>`: a
  // client's own Host here would serve it off the portal.
  assert.match(body, /proxy_set_header Host 127\.0\.0\.1;/);
  assert.doesNotMatch(body, /proxy_set_header Host \$host/);
});

test('every auth portal serves the domain’s brand overrides and rewrites Authelia’s index for it; an unbranded domain gets the stock page', async () => {
  const unbranded = await readFile(
    path.join(captured, 'lamalibre-lamaste-auth-codelama.com.tr'),
    'utf8',
  );
  const branded = await readFile(
    path.join(captured, 'lamalibre-lamaste-auth-samplepark.tr'),
    'utf8',
  );
  const autheliaHeaders = (fqdn) => [
    `proxy_set_header Host ${fqdn};`,
    'proxy_set_header X-Real-IP $remote_addr;',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    `proxy_set_header X-Forwarded-Host ${fqdn};`,
    'proxy_set_header X-Forwarded-Proto https;',
  ];

  for (const [text, domain] of [
    [unbranded, 'codelama.com.tr'],
    [branded, 'samplepark.tr'],
  ]) {
    // The three routes Authelia lets a file override fall back to it; the
    // stylesheet does not. Each static answer: nosniff, revalidated.
    for (const [matcher, fallback] of [
      ['= /favicon.ico', '@authelia'],
      ['= /static/media/logo.png', '@authelia'],
      ['/locales/', '@authelia'],
      ['= /brand.css', '@stock_css'],
    ]) {
      const body = locationBody(text, matcher);
      assert.ok(body.includes(`root /var/www/lamaste/auth/${domain};`), `${domain} ${matcher}`);
      assert.ok(body.includes(`try_files $uri ${fallback};`), `${domain} ${matcher}`);
      assert.ok(body.includes('add_header X-Content-Type-Options nosniff;'), matcher);
      assert.ok(
        body.includes('add_header Cache-Control "public, max-age=0, must-revalidate";'),
        matcher,
      );
      assert.doesNotMatch(body, /proxy_pass|sub_filter/, matcher);
    }
    // The stock stylesheet (the change-password link's rules) for a domain without a rendering.
    const stockCss = locationBody(text, '@stock_css');
    assert.ok(stockCss.includes('root /var/www/lamaste/auth-stock;'), domain);
    assert.ok(stockCss.includes('try_files /brand.css =404;'), domain);
    // Authelia's own answer: every header the portal's catch-all sends, no rewrite.
    const fallback = locationBody(text, '@authelia');
    assert.match(fallback, /proxy_pass http:\/\/127\.0\.0\.1:9091;/);
    for (const line of autheliaHeaders(`auth.${domain}`)) assert.ok(fallback.includes(line), line);
    assert.doesNotMatch(fallback, /sub_filter|add_header/);
    // The index rewrite: uncompressed from Authelia, every occurrence, text/html only (the default).
    const portal = locationBody(text, '/');
    for (const line of autheliaHeaders(`auth.${domain}`)) assert.ok(portal.includes(line), line);
    assert.match(portal, /proxy_set_header Accept-Encoding "";/);
    assert.match(portal, /sub_filter_once off;/);
    assert.doesNotMatch(portal, /sub_filter_types/);
    // The per-domain root is a link switched by rename: never disabled (the comment names it).
    assert.doesNotMatch(text, /^\s*disable_symlinks/m);
    // The invitation page: the domain's own from its rendering when it has
    // one, else the stock page — the token left in the URL for the script.
    // A link's token in its fragment (`/invite`) or, from 4.8, its path (`/invite/`).
    for (const matcher of ['= /invite', '/invite/']) {
      const invite = locationBody(text, matcher);
      assert.ok(invite.includes(`root /var/www/lamaste/auth/${domain};`), domain);
      assert.ok(invite.includes('try_files /invite/index.html @invite;'), domain);
      assert.ok(invite.includes('add_header X-Content-Type-Options "nosniff" always;'), domain);
      assert.ok(
        invite.includes(
          `add_header Content-Security-Policy "${INVITE_PAGE_HEADERS['Content-Security-Policy']}" always;`,
        ),
        domain,
      );
      assert.doesNotMatch(invite, /alias|\$uri|proxy_pass/);
    }
    const stockInvite = locationBody(text, '@invite');
    assert.ok(stockInvite.includes('root /var/www/lamaste/invite;'));
    assert.ok(stockInvite.includes('try_files /index.html =404;'));
    assert.ok(stockInvite.includes('add_header X-Frame-Options "DENY" always;'));
    const invitations = locationBody(text, '/invitations/');
    assert.ok(invitations.includes('try_files /invitations/index.html @invitations;'), domain);
    assert.ok(
      invitations.includes(
        `add_header Content-Security-Policy "${INVITATIONS_PAGE_HEADERS['Content-Security-Policy']}" always;`,
      ),
      domain,
    );
    assert.ok(locationBody(text, '@invitations').includes('root /var/www/lamaste/invitations;'));
    assert.doesNotMatch(text, /alias \/var\/www\/lamaste\/invite/);
  }

  // Unbranded: the light theme, no logo (the placeholder never shown) — the
  // stock page but for the change-password link and its stylesheet, the
  // stock one (mail-design.md §6.3).
  const stock = locationBody(unbranded, '/');
  assert.ok(stock.includes(`sub_filter 'data-theme="light"' 'data-theme="light"';`));
  assert.ok(stock.includes(`sub_filter 'data-logooverride="true"' 'data-logooverride="false"';`));
  assert.ok(
    stock.includes(`sub_filter '</head>' '<link rel="stylesheet" href="/brand.css"></head>';`),
  );
  assert.ok(
    stock.includes(
      `sub_filter '</body>' '<a id="lamaste-account-password" href="/account/password">Change password</a></body>';`,
    ),
  );
  // Without mail anywhere, nothing touches the reset link (Authelia's is disabled).
  assert.doesNotMatch(stock, /data-resetpassword/);
  // Branded with a logo: its theme, its logo, its stylesheet.
  const dark = locationBody(branded, '/');
  assert.ok(dark.includes(`sub_filter 'data-theme="light"' 'data-theme="dark"';`));
  assert.ok(dark.includes(`sub_filter 'data-logooverride="true"' 'data-logooverride="true"';`));
  assert.ok(
    dark.includes(`sub_filter '</head>' '<link rel="stylesheet" href="/brand.css"></head>';`),
  );
  // Branded without a logo: Authelia's generic icon, never Lamaste's placeholder.
  const noLogo = locationBody(
    nginx.renderAuthVhost('samplepark.tr', undefined, {
      primary: false,
      branding: { theme: 'oled', logo: false },
    }).config,
    '/',
  );
  assert.ok(noLogo.includes(`sub_filter 'data-theme="light"' 'data-theme="oled"';`));
  assert.ok(noLogo.includes(`sub_filter 'data-logooverride="true"' 'data-logooverride="false"';`));
  assert.match(noLogo, /brand\.css/);
  // The primary's portal carries the same, beside its user-access locations.
  const primary = await readFile(path.join(captured, 'lamalibre-lamaste-auth-example.com'), 'utf8');
  assert.match(locationBody(primary, '/'), /sub_filter_once off;/);
  assert.match(primary, /location @authelia \{/);

  // Only Authelia's themes reach a root-validated file; the logo switch is a boolean.
  for (const branding of [
    { theme: 'solarized', logo: true },
    { theme: 'dark"', logo: true },
    { theme: 'dark', logo: 'yes' },
    { theme: 'dark' },
    'dark',
  ]) {
    assert.throws(
      () => nginx.renderAuthVhost('samplepark.tr', undefined, { branding }),
      /Invalid auth vhost branding/,
      JSON.stringify(branding),
    );
  }
});

test('tunnel vhosts are named by their hostname; a hostname not one label under its domain is refused', () => {
  const { name, fqdn } = nginx.renderTunnelVhost(
    'restricted',
    'feria.codelama.com.tr',
    'codelama.com.tr',
    20060,
  );
  assert.equal(name, 'lamalibre-lamaste-app-feria.codelama.com.tr');
  assert.equal(fqdn, 'feria.codelama.com.tr');
  assert.match(name, PANEL_SITE_RE);
  assert.equal(
    nginx.renderAgentPanelVhost('agent-r730.example.com', 'example.com', 9393).name,
    'lamalibre-lamaste-agent-panel-agent-r730.example.com',
  );
  for (const [host, domain] of [
    ['feria.samplepark.tr', 'codelama.com.tr'],
    ['a.b.codelama.com.tr', 'codelama.com.tr'],
    ['codelama.com.tr', 'codelama.com.tr'],
  ]) {
    assert.throws(() => nginx.renderTunnelVhost('public', host, domain, 20060), /not a subdomain/);
  }
  assert.throws(
    () => nginx.renderAgentPanelVhost('panel.example.com', 'example.com', 9393),
    /Invalid agent panel subdomain/,
  );
});

test('a Gatekeeper tunnel — authenticated too — and a protected site answer Gatekeeper’s refusal page on 403, redirecting to their own domain’s sign-in', async () => {
  for (const accessMode of ['authenticated', 'restricted']) {
    const { config } = nginx.renderTunnelVhost(
      accessMode,
      'workspace.codelama.com.tr',
      'codelama.com.tr',
      20080,
    );
    assert.match(config, /error_page 403 = \/internal\/lamaste\/authz;/, accessMode);
    assert.match(
      config,
      /error_page 401 =302 https:\/\/auth\.codelama\.com\.tr\/\?rd=https:\/\/workspace\.codelama\.com\.tr\$request_uri;/,
      accessMode,
    );
  }
  const site = await readFile(
    path.join(captured, 'lamalibre-lamaste-site-4f1d2c3a-1b2c-4d5e-8f90-123456789abc'),
    'utf8',
  );
  assert.match(site, /error_page 403 = \/internal\/lamaste\/refusal;/);
  const refusal = locationBody(site, '= /internal/lamaste/refusal');
  assert.match(refusal, /internal;/);
  assert.match(
    refusal,
    /proxy_pass http:\/\/127\.0\.0\.1:9294\/authz\/refusal\/docs\.example\.com;/,
  );
  assert.match(refusal, /proxy_set_header Cookie "";/);
});

test('the panel vhost admits a large body at the site upload location alone', () => {
  const { config } = nginx.renderPanelVhost('example.com', '/etc/letsencrypt/live/example.com/');
  const all = locations(config);
  const sized = all.filter(({ body }) => body.includes('client_max_body_size'));
  assert.deepEqual(
    sized.map((l) => l.matcher),
    ['~ ^/api/sites/[^/]+/files$'],
  );
  const [upload] = sized;
  assert.ok(upload.body.includes(`client_max_body_size ${SITE_UPLOAD_MAX_REQUEST_MIB}m;`));
  // The size is all that differs from /api: the certificate check and the
  // headers are the same, the WebSocket upgrade is not needed.
  assert.ok(upload.body.includes('if ($ssl_client_verify != SUCCESS) {\n            return 496;'));
  const api = all.find((l) => l.matcher === '/api').body;
  const directives = (body) =>
    body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('location'));
  assert.deepEqual(
    directives(upload.body).filter((d) => !d.startsWith('client_max_body_size')),
    directives(api).filter((d) => !/^proxy_set_header (Upgrade|Connection) /.test(d)),
  );
  // None at server level either: every other location keeps nginx's 1 MiB.
  assert.equal(config.match(/client_max_body_size/g).length, 1);

  // The regex takes the upload route and nothing else under /api.
  const re = new RegExp(upload.matcher.slice(2));
  const id = '3f1d2c3a-1b2c-4d5e-8f90-123456789abc';
  assert.ok(re.test(`/api/sites/${id}/files`));
  for (const other of [
    '/api/sites',
    `/api/sites/${id}`,
    `/api/sites/${id}/files/x`,
    `/api/sites/${id}/verify-dns`,
    `/api/sites/a/b/files`,
    `/api/plugins/x/settings`,
  ]) {
    assert.ok(!re.test(other), other);
  }
});

// ---------------------------------------------------------------------------
// Page languages (packages/core/docs/page-language-design.md)
// ---------------------------------------------------------------------------

const FIXTURES_49 = new URL('./fixtures/lamaste-4.9.0/', import.meta.url);
const fixture49 = (name) => readFile(new URL(name, FIXTURES_49), 'utf8');
/** Every line of `text` but its comments is printable ASCII (lamaste-priv's tokenizer refuses anything else). */
function assertAsciiDirectives(text, label) {
  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    assert.match(line, /^[\x20-\x7e]*$/, label);
  }
}

/** A vhost with every CSP hash replaced by one placeholder: what may differ between releases. */
const withoutHashes = (text) => text.replace(/'sha256-[A-Za-z0-9+/=]{44}'/g, "'sha256-…'");

/**
 * An auth vhost without what 4.13's mail added (mail-design.md §5, §6): the
 * account locations, the consent callback (primary), the stock stylesheet
 * fallback, the index's mail filters and — on a domain with neither brand
 * nor language — the stylesheet link every portal now has.
 */
function withoutMail(text, domain, { primary, styled }) {
  const fqdn = `auth.${domain}`;
  let out = text.replace(nginx.accountLocations(domain, fqdn), '');
  if (primary) out = out.replace(nginx.mailCallbackLocation(fqdn), '');
  out = out
    .replace('try_files $uri @stock_css;', 'try_files $uri =404;')
    .replace(
      /\n\n {4}# The stylesheet of a domain with neither brand nor language:[\s\S]*?\n {4}\}/,
      '',
    )
    .replace(/\n {8}# The domain's mail \(mail-design[\s\S]*?(?=\n {8}sub_filter '<\/head>')/, '');
  if (!styled) out = out.replace(/\n {8}sub_filter '<\/head>' [^\n]*/, '');
  return out;
}

test('a domain without a page language keeps its 4.9.0 auth vhost but for the pages’ CSP hashes (regression pin)', async () => {
  for (const [name, domain, opts] of [
    ['auth-primary-unbranded.conf', 'alpha.example', { primary: true, branding: null }],
    [
      'auth-branded.conf',
      'beta.example',
      { primary: false, branding: { theme: 'dark', logo: true } },
    ],
  ]) {
    const before = await fixture49(name);
    const now = nginx.renderAuthVhost(domain, `/etc/letsencrypt/live/auth.${domain}`, {
      ...opts,
      language: null,
    }).config;
    assert.notEqual(now, before, `${name}: the pages' hashes changed with their scripts`);
    const pinned = withoutMail(now, domain, {
      primary: opts.primary,
      styled: opts.branding !== null,
    });
    assert.notEqual(pinned, now, `${name}: 4.13's mail is what was taken out`);
    assert.equal(withoutHashes(pinned), withoutHashes(before), name);
    // `language` absent is `language: null`.
    assert.equal(
      nginx.renderAuthVhost(domain, `/etc/letsencrypt/live/auth.${domain}`, opts).config,
      now,
    );
  }
});

test('a body above the server block’s limit passes the Gatekeeper checks it meets: only the serving location limits it', () => {
  /** Every `client_max_body_size` of location `matcher` in `text`. */
  const limits = (text, matcher) =>
    locationBody(text, matcher).match(/client_max_body_size \S+;/g) ?? [];
  const internal = [
    '/internal/lamaste/authz',
    '= /internal/lamaste/user-surface-authz',
    '= /internal/lamaste/user-surface-401',
    '= /internal/lamaste/user-surface-403',
  ];
  // A tunnel of 20 MiB serving a plugin of 50 MiB: the plugin's upload
  // passes the tunnel's own limit only where it is served.
  for (const mode of ['restricted', 'authenticated']) {
    const { config } = nginx.renderTunnelVhost(
      mode,
      'kamera.example.com',
      'example.com',
      20020,
      undefined,
      { maxBodySizeMb: 20, userSurface: [{ route: 'camwatch', maxBodySizeMb: 50 }] },
    );
    assert.match(config, /^ {4}client_max_body_size 20m;$/m, mode);
    for (const matcher of internal) {
      assert.deepEqual(limits(config, matcher), ['client_max_body_size 0;'], `${mode} ${matcher}`);
      assert.match(locationBody(config, matcher), /^\s*internal;$/m, `${mode} ${matcher}`);
    }
    for (const matcher of ['= /api/camwatch/app', '^~ /api/camwatch/app/']) {
      assert.deepEqual(limits(config, matcher), ['client_max_body_size 50m;'], matcher);
    }
    assert.deepEqual(limits(config, '/'), [], 'the tunnel’s own locations keep its 20 MiB');
    assert.doesNotThrow(() => validateVhost(config), mode);
  }

  // A plugin's site sets no limit of its own (nginx's 1 MiB): a 26 MiB
  // upload to its API meets four internal locations, none of which limits it.
  const { config } = nginx.renderWebSurfaceVhost(
    { id: 'corral-site', fqdn: 'portal.beta.example' },
    '/etc/letsencrypt/live/portal.beta.example',
    'beta.example',
    { route: 'corral', maxBodySizeMb: 26, treesDir: '/var/www/lamaste/apps/corral', served: true },
  );
  assert.doesNotMatch(config, /^ {4}client_max_body_size/m);
  for (const matcher of [
    '= /internal/lamaste/shell-authz',
    '= /internal/lamaste/user-surface-authz',
    '= /internal/lamaste/user-surface-401',
    '= /internal/lamaste/user-surface-403',
  ]) {
    assert.deepEqual(limits(config, matcher), ['client_max_body_size 0;'], matcher);
  }
  for (const matcher of ['= /api/corral/app', '^~ /api/corral/app/']) {
    assert.deepEqual(limits(config, matcher), ['client_max_body_size 26m;'], matcher);
  }
  // The shell takes no body: nginx's 1 MiB, and 405 for anything but GET and HEAD.
  assert.deepEqual(limits(config, '/'), []);
  assert.doesNotThrow(() => validateVhost(config));
});

/** The lines 4.12 adds to the internal locations that never read the body. */
const BODY_NOT_READ_LINES =
  /\n {8}# Never reads the body: the location serving the request owns the limit\n {8}client_max_body_size 0;/g;

test('a served web surface keeps its 4.9.0 vhost but for its internal locations’ body limit (regression pin)', async () => {
  const now = nginx.renderWebSurfaceVhost(
    { id: 'demo-site', fqdn: 'app.beta.example' },
    '/etc/letsencrypt/live/app.beta.example',
    'beta.example',
    { route: 'demo', maxBodySizeMb: 10, treesDir: '/var/www/lamaste/apps/demo', served: true },
  ).config;
  const before = await fixture49('web-surface-served.conf');
  // The shell's and the API's Gatekeeper checks, the API's 401 and 403.
  assert.equal(now.match(BODY_NOT_READ_LINES)?.length, 4);
  assert.notEqual(now, before, 'the start’s reconcile rewrites it');
  assert.equal(now.replace(BODY_NOT_READ_LINES, ''), before);
});

test('a domain with a page language: every locale file forced, the index in its language, the menu hidden — all through lamaste-priv', () => {
  for (const branding of [null, { theme: 'dark', logo: true }]) {
    const { config } = nginx.renderAuthVhost('alpha.example', undefined, {
      primary: false,
      branding,
      language: 'tr',
    });
    assert.doesNotThrow(() => validateVhost(config), JSON.stringify(branding));
    assertAsciiDirectives(config, JSON.stringify(branding));
    // Its braces are the regex's: read up to the location's own end.
    const opening = 'location ~ "^/locales/[^/]{1,64}/(consent|portal|settings)[.]json$" {';
    assert.ok(config.includes(opening));
    const forced = config.slice(
      config.indexOf(opening),
      config.indexOf('\n    }', config.indexOf(opening)),
    );
    assert.ok(forced.includes('root /var/www/lamaste/auth/alpha.example;'));
    assert.ok(forced.includes('try_files /locales/forced/$1.json $uri @authelia;'));
    assert.doesNotMatch(forced, /\\/);
    const index = locationBody(config, '/');
    for (const [from, to] of autheliaIndexLanguageFilters('tr')) {
      assert.ok(index.includes(`sub_filter '${from}' '${to}';`), from);
    }
    assert.ok(
      index.includes(
        `sub_filter '${AUTHELIA_NOSCRIPT_TEXT}' 'Bu uygulama i&#231;in taray&#305;c&#305;n&#305;zda JavaScript etkin olmal&#305;d&#305;r.';`,
      ),
    );
    assert.ok(index.includes(`sub_filter '<html lang="' '<html lang="tr" data-authelia-lang="';`));
    // The stylesheet (the menu rule), branded or not.
    assert.ok(
      index.includes(`sub_filter '</head>' '<link rel="stylesheet" href="/brand.css"></head>';`),
    );
    // The theme and logo switch as the brand says.
    assert.ok(
      index.includes(
        `sub_filter 'data-theme="light"' 'data-theme="${branding?.theme ?? 'light'}"';`,
      ),
    );
  }
  // English forced too: its lang, no noscript rewrite (Authelia's own sentence).
  const en = nginx.renderAuthVhost('alpha.example', undefined, { language: 'en' }).config;
  assert.doesNotThrow(() => validateVhost(en));
  assert.ok(en.includes(`sub_filter '<html lang="' '<html lang="en" data-authelia-lang="';`));
  assert.ok(!en.includes(`sub_filter '${AUTHELIA_NOSCRIPT_TEXT}'`));
  assert.match(en, /location ~ "\^\/locales\//);
  // Without a language: no forced location, no lang rewrite.
  const none = nginx.renderAuthVhost('alpha.example', undefined, {}).config;
  assert.doesNotMatch(none, /locales\/forced|data-authelia-lang/);
  // Only a page language reaches a root-validated file.
  for (const language of ['de', 'TR', 'tr"', '', 1, {}]) {
    assert.throws(
      () => nginx.renderAuthVhost('alpha.example', undefined, { language }),
      /Invalid auth vhost language/,
      JSON.stringify(language),
    );
  }
});

test('a web surface not served answers 503 with Lamaste’s "not available" page, in the domain’s rendering or the stock one', async () => {
  const site = { id: 'demo-site', fqdn: 'app.beta.example' };
  const opts = { route: 'demo', maxBodySizeMb: 10, treesDir: '/var/www/lamaste/apps/demo' };
  for (const clearSiteData of [false, true]) {
    const { config } = nginx.renderWebSurfaceVhost(
      site,
      '/etc/letsencrypt/live/app.beta.example',
      'beta.example',
      { ...opts, served: false, clearSiteData },
    );
    assert.doesNotThrow(() => validateVhost(config), String(clearSiteData));
    assertAsciiDirectives(config, String(clearSiteData));
    // Every request still 503 (the status kept: error_page without `=`).
    assert.match(config, /\n {4}error_page 503 \/internal\/lamaste\/unavailable;\n/);
    assert.match(locationBody(config, '/'), /return 503;/);
    const page = locationBody(config, '= /internal/lamaste/unavailable');
    assert.match(page, /\n {8}internal;\n/);
    assert.ok(page.includes('root /var/www/lamaste/auth/beta.example;'));
    assert.ok(page.includes('try_files /unavailable/index.html @unavailable;'));
    const stock = locationBody(config, '@unavailable');
    assert.ok(stock.includes('root /var/www/lamaste/unavailable;'));
    assert.ok(stock.includes('try_files /index.html =503;'));
    // Both carry the page's headers: its style by hash, the domain's logo host, no caching.
    for (const body of [page, stock]) {
      assert.ok(body.includes(`style-src ${UNAVAILABLE_PAGE_STYLE_HASH}`));
      assert.ok(body.includes('img-src https://auth.beta.example;'));
      assert.ok(body.includes('add_header Cache-Control "no-store" always;'));
      assert.equal(body.includes(`Clear-Site-Data '"storage"'`), clearSiteData);
    }
  }
  // 4.9.0's not-served vhost, the page added: nothing else changed.
  const before = await fixture49('web-surface-not-served.conf');
  const now = nginx.renderWebSurfaceVhost(
    site,
    '/etc/letsencrypt/live/app.beta.example',
    'beta.example',
    { ...opts, served: false, clearSiteData: true },
  ).config;
  const added = now
    .replace(/\n {4}error_page 503 \/internal\/lamaste\/unavailable;/, '')
    .replace(
      /\n\n {4}# Lamaste's "not available" page[\s\S]*?\n {4}location @unavailable \{[\s\S]*?\n {4}\}/,
      '',
    );
  assert.equal(added, before);
});

// ---------------------------------------------------------------------------
// Mail (packages/core/docs/mail-design.md §5, §6)
// ---------------------------------------------------------------------------

test('each portal links its own reset page, none where its domain cannot send — what lamaste-priv admits', () => {
  const primaryUrl = 'https://auth.alpha.example/reset';
  const render = (domain, mail, opts = {}) =>
    nginx.renderAuthVhost(domain, undefined, { primary: false, mail, ...opts }).config;
  const portal = (text) => locationBody(text, '/');

  // The primary: Authelia's own URL is already its own — nothing to rewrite.
  const primary = render(
    'alpha.example',
    { primaryResetUrl: primaryUrl, domainResetUrl: primaryUrl },
    { primary: true },
  );
  assert.doesNotMatch(portal(primary), /data-resetpassword/);
  // Another domain that can send: Authelia's URL replaced by its own.
  const sending = render('beta.example', {
    primaryResetUrl: primaryUrl,
    domainResetUrl: 'https://auth.beta.example/reset',
  });
  assert.ok(
    portal(sending).includes(
      `sub_filter 'data-resetpasswordcustomurl="${primaryUrl}"' 'data-resetpasswordcustomurl="https://auth.beta.example/reset"';`,
    ),
  );
  // One that cannot: the link switched off and emptied — never Authelia's own reset.
  const silent = render('beta.example', { primaryResetUrl: primaryUrl, domainResetUrl: null });
  assert.ok(
    portal(silent).includes(`sub_filter 'data-resetpassword="true"' 'data-resetpassword="false"';`),
  );
  assert.ok(
    portal(silent).includes(
      `sub_filter 'data-resetpasswordcustomurl="${primaryUrl}"' 'data-resetpasswordcustomurl=""';`,
    ),
  );
  // In Turkish, the change-password link as ASCII character references.
  const turkish = render(
    'beta.example',
    { primaryResetUrl: primaryUrl, domainResetUrl: 'https://auth.beta.example/reset' },
    { language: 'tr' },
  );
  assert.match(portal(turkish), /href="\/account\/password">&#350;ifre de&#287;i&#351;tir<\/a>/);
  for (const text of [primary, sending, silent, turkish]) {
    assert.doesNotThrow(() => validateVhost(text));
    assertAsciiDirectives(text, 'mail');
  }
  // Only an auth host's own /reset reaches a root-validated file.
  for (const mail of [
    { primaryResetUrl: 'https://evil.example/reset', domainResetUrl: null },
    { primaryResetUrl: primaryUrl, domainResetUrl: 'https://auth.gamma.example/reset' },
    { primaryResetUrl: "https://auth.alpha.example/reset' ; x", domainResetUrl: null },
    { primaryResetUrl: primaryUrl },
    null,
  ]) {
    assert.throws(
      () => render('beta.example', mail),
      /Invalid auth vhost mail/,
      JSON.stringify(mail),
    );
  }
});

test('the account locations: the reset API public, the change-password page and API behind two-factor Authelia; the consent callback on the primary alone', () => {
  const second = nginx.renderAuthVhost('beta.example', undefined, { primary: false }).config;
  const primary = nginx.renderAuthVhost('alpha.example', undefined, { primary: true }).config;
  for (const [text, fqdn] of [
    [second, 'auth.beta.example'],
    [primary, 'auth.alpha.example'],
  ]) {
    // The forgot-password page: the rendering's, else the stock one; core's CSP.
    const page = locationBody(text, '= /reset');
    assert.match(page, /try_files \/reset\/index\.html @reset;/);
    assert.match(locationBody(text, '@reset'), /root \/var\/www\/lamaste\/reset;/);
    assert.match(
      page,
      /add_header Content-Security-Policy "default-src 'none'; script-src 'sha256-/,
    );
    // Its API: public, to the panel under the portal's literal name, nothing of the client's identity.
    const resetApi = locationBody(text, '^~ /api/account/reset/');
    assert.doesNotMatch(resetApi, /auth_request/);
    for (const line of [
      `proxy_set_header Host ${fqdn};`,
      'proxy_set_header X-Forwarded-Host "";',
      'proxy_set_header Remote-User "";',
      'proxy_set_header Cookie "";',
      'proxy_set_header X-Lamalibre-Relay-Assertion "";',
      'proxy_pass http://127.0.0.1:3100;',
      'client_max_body_size 16k;',
    ]) {
      assert.ok(resetApi.includes(line), `${fqdn} reset API: ${line}`);
    }
    // The change-password page: Authelia's forward auth, a redirect to the sign-in.
    for (const matcher of ['= /account/password', '@account_password']) {
      const body = locationBody(text, matcher);
      assert.match(body, /auth_request \/internal\/lamaste\/account-authz;/, matcher);
      assert.match(body, /error_page 401 =302 \$redirection_url;/, matcher);
    }
    // Its API: the user as Gatekeeper vouched for them — never a Remote-User.
    const api = locationBody(text, '= /api/account/password');
    assert.match(api, /auth_request \/internal\/lamaste\/account-api-authz;/);
    assert.match(
      api,
      /auth_request_set \$relay_assertion \$upstream_http_x_lamalibre_relay_assertion;/,
    );
    assert.ok(api.includes('proxy_set_header X-Lamalibre-Relay-Assertion $relay_assertion;'));
    assert.ok(api.includes('proxy_set_header Remote-User "";'));
    assert.doesNotMatch(api, /Remote-User \$/);
    assert.doesNotMatch(api, /X-Lamalibre-Relay-Assertion "";/);
    assert.match(api, /error_page 401 = \/internal\/lamaste\/account-401;/);
    assert.match(api, /error_page 403 = \/internal\/lamaste\/account-403;/);
    const apiAuthz = locationBody(text, '= /internal/lamaste/account-api-authz');
    assert.match(apiAuthz, /internal;/);
    const domain = fqdn.slice('auth.'.length);
    assert.ok(apiAuthz.includes(`proxy_pass http://127.0.0.1:9294/authz/account/${domain};`));
    assert.ok(apiAuthz.includes(`proxy_set_header X-Original-URL https://${fqdn}$request_uri;`));
    assert.ok(apiAuthz.includes(`proxy_set_header Host ${fqdn};`));
    // The subrequest names this portal, never the client's Host.
    const authz = locationBody(text, '= /internal/lamaste/account-authz');
    assert.match(authz, /internal;/);
    assert.ok(authz.includes(`proxy_set_header X-Original-URL https://${fqdn}$request_uri;`));
    assert.match(authz, /proxy_pass http:\/\/127\.0\.0\.1:9091\/api\/authz\/auth-request;/);
    assert.doesNotThrow(() => validateVhost(text), fqdn);
  }
  assert.doesNotMatch(second, /mail\/google\/callback/);
  const callback = locationBody(primary, '= /mail/google/callback');
  for (const line of [
    'access_log off;',
    'proxy_set_header Host auth.alpha.example;',
    'proxy_set_header X-Forwarded-Host "";',
    'proxy_set_header Cookie "";',
    'proxy_pass http://127.0.0.1:3100;',
  ]) {
    assert.ok(callback.includes(line), line);
  }
});
