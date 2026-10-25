/**
 * At startup the panel rewrites installed vhosts that differ from what the
 * generators produce now: agent-panel vhosts (which must forward the panel's
 * relay assertion), app and plugin tunnel vhosts (with the user surfaces a
 * bound app tunnel serves), static site vhosts, the auth portal (whose
 * authorization subrequests must name their own hostname, not the client's
 * Host header) and the panel's own vhost (which clears a client's relay
 * assertion). It keeps the certificate the installed vhost names (a wildcard
 * certificate stays a wildcard certificate), never links a vhost that is not
 * linked, never adds or removes authentication, leaves everything else
 * alone, and keeps going when one rewrite fails. The same reconcile, limited
 * to the tunnels a plugin route is bound to, follows a plugin's identity
 * (`reconcileUserSurfaceVhosts`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderAgentPanelVhost,
  renderAuthVhost,
  renderPanelVhost,
  renderStaticSiteVhost,
  renderTunnelVhost,
  renameVhosts,
} from '../src/lib/nginx.js';
import {
  expectedTunnelVhost,
  reconcileSiteVhosts,
  reconcileTunnelVhosts,
  reconcileUserSurfaceVhosts,
  renameLegacyVhosts,
} from '../src/lib/vhost-reconcile.js';

const WILDCARD = '/etc/letsencrypt/live/example.com';

const panel = {
  id: 'p',
  subdomain: 'agent-r730',
  fqdn: 'agent-r730.example.com',
  port: 9393,
  type: 'panel',
  enabled: true,
  agentLabel: 'r730',
};
const plugin = {
  id: 'g',
  subdomain: 'herd',
  fqdn: 'herd.example.com',
  port: 9400,
  type: 'plugin',
  accessMode: 'restricted',
  enabled: false,
  agentLabel: 'r730',
  pluginName: '@lamalibre/herd-server',
  pluginRoute: 'herd',
  maxBodySizeMb: 50,
};
const current = {
  ...plugin,
  id: 'c',
  subdomain: 'shell',
  fqdn: 'shell.example.com',
  port: 9401,
  enabled: true,
  pluginRoute: 'shell',
};
/** Persisted before access modes and body limits were stored. */
const app = {
  id: 'a',
  subdomain: 'app',
  fqdn: 'app.example.com',
  port: 9402,
  type: 'app',
  enabled: true,
  agentLabel: 'r730',
};
const open = {
  ...app,
  id: 'o',
  subdomain: 'open',
  fqdn: 'open.example.com',
  port: 9403,
  accessMode: 'public',
  maxBodySizeMb: 10,
};
const internal = {
  ...plugin,
  id: 'i',
  subdomain: null,
  fqdn: null,
  exposure: 'internal',
  port: 21000,
};
const missing = { ...panel, id: 'm', subdomain: 'agent-gone', fqdn: 'agent-gone.example.com' };

/** A pre-4.3 agent panel vhost: proxies with X-SSL-Client-* only. */
const OLD_PANEL = `server {
    listen 443 ssl;
    server_name agent-r730.example.com;

    ssl_certificate ${WILDCARD}/fullchain.pem;
    ssl_certificate_key ${WILDCARD}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9393;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
    }
}
`;

/**
 * What the generators wrote before the authorization subrequest named its own
 * hostname: Gatekeeper's `/authz/check`, and the client's Host header in
 * X-Original-URL, Host and the login redirect. (Nor did they clear the
 * client's X-Forwarded-* there — left in, so the fixture still differs.)
 */
function namingClientHost(config, fqdn) {
  const out = config
    .replaceAll(
      `proxy_pass http://127.0.0.1:9294/authz/tunnel/${fqdn};`,
      'proxy_pass http://127.0.0.1:9294/authz/check;',
    )
    .replaceAll(
      `X-Original-URL https://${fqdn}$request_uri;`,
      'X-Original-URL $scheme://$http_host$request_uri;',
    )
    .replaceAll(`proxy_set_header Host ${fqdn};`, 'proxy_set_header Host $http_host;')
    .replaceAll(`rd=https://${fqdn}$request_uri;`, 'rd=$scheme://$http_host$request_uri;');
  assert.notEqual(out, config, 'the fixture differs from the current vhost');
  return out;
}

function fakeDeps(installed, { failOn, tunnels, sites = [], linked = [], served } = {}) {
  const writes = [];
  return {
    writes,
    deps: {
      readTunnels: async () => tunnels ?? [panel, plugin, current, app, open, internal, missing],
      readSites: async () => sites,
      servedUserSurface: async (routes) => (served ? served(routes) : []),
      readInstalledVhost: async (name) => installed[name] ?? null,
      isSiteEnabled: async (name) => linked.includes(name),
      installVhost: async (name, config, fqdn, opts) => {
        if (name === failOn) throw new Error('nginx -t failed');
        writes.push({ name, config, fqdn, enabled: opts.enabled });
      },
    },
  };
}

const log = { info() {}, warn() {}, error() {} };

test('outdated tunnel vhosts are rewritten on the certificate they name', async () => {
  const oldPlugin = renderTunnelVhost(
    'restricted',
    'herd.example.com',
    'example.com',
    9400,
    WILDCARD,
    {
      maxBodySizeMb: 50,
    },
  ).config; // written without the plugin route: an older, different vhost
  const upToDate = renderTunnelVhost(
    'restricted',
    'shell.example.com',
    'example.com',
    9401,
    '/etc/letsencrypt/live/shell.example.com',
    { pathPrefix: 'shell', maxBodySizeMb: 50 },
  ).config;
  const appCert = '/etc/letsencrypt/live/app.example.com';
  const oldApp = namingClientHost(
    renderTunnelVhost('restricted', 'app.example.com', 'example.com', 9402, appCert).config,
    'app.example.com',
  );
  const publicApp = renderTunnelVhost('public', 'open.example.com', 'example.com', 9403, WILDCARD, {
    maxBodySizeMb: 10,
  }).config;
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-agent-panel-agent-r730.example.com': OLD_PANEL,
      'lamalibre-lamaste-app-herd.example.com': oldPlugin,
      'lamalibre-lamaste-app-shell.example.com': upToDate,
      'lamalibre-lamaste-app-app.example.com': oldApp,
      'lamalibre-lamaste-app-open.example.com': publicApp,
    },
    // `app` is enabled in state but someone unlinked its vhost; `herd` is
    // disabled in state but still linked.
    {
      linked: [
        'lamalibre-lamaste-agent-panel-agent-r730.example.com',
        'lamalibre-lamaste-app-herd.example.com',
        'lamalibre-lamaste-app-shell.example.com',
      ],
    },
  );

  const result = await reconcileTunnelVhosts(log, deps);
  assert.deepEqual(result.rewritten, [
    'agent-r730.example.com',
    'herd.example.com',
    'app.example.com',
  ]);
  assert.equal(result.unchanged, 2);
  assert.deepEqual(result.skipped, [
    { vhost: 'agent-gone.example.com', reason: 'no vhost installed' },
  ]);
  assert.deepEqual(result.failed, []);

  const [panelWrite, pluginWrite, appWrite] = writes;
  assert.equal(panelWrite.name, 'lamalibre-lamaste-agent-panel-agent-r730.example.com');
  assert.equal(panelWrite.enabled, true);
  assert.equal(
    panelWrite.config,
    renderAgentPanelVhost('agent-r730.example.com', 'example.com', 9393, WILDCARD).config,
  );
  assert.match(panelWrite.config, /ssl_certificate \/etc\/letsencrypt\/live\/example\.com\//);
  assert.match(panelWrite.config, /auth_request \/internal\/lamaste\/agent-panel-authz;/);

  assert.equal(pluginWrite.name, 'lamalibre-lamaste-app-herd.example.com');
  assert.equal(pluginWrite.enabled, false, 'a disabled tunnel is unlinked');
  assert.match(
    pluginWrite.config,
    /proxy_set_header X-Lamalibre-Relay-Assertion \$relay_assertion;/,
  );
  assert.match(pluginWrite.config, /rewrite \^\/\?\(\.\*\)\$ \/herd\/\$1 break;/);
  assert.match(pluginWrite.config, /client_max_body_size 50m;/);

  // An app tunnel with neither access mode nor body limit stored: restricted,
  // as Gatekeeper reads it, and no limit, as it was written.
  assert.equal(appWrite.name, 'lamalibre-lamaste-app-app.example.com');
  assert.equal(appWrite.fqdn, 'app.example.com');
  assert.equal(appWrite.enabled, false, 'a rewrite never links a vhost that is not linked');
  assert.equal(
    appWrite.config,
    renderTunnelVhost('restricted', 'app.example.com', 'example.com', 9402, appCert).config,
  );
  assert.match(
    appWrite.config,
    /proxy_pass http:\/\/127\.0\.0\.1:9294\/authz\/tunnel\/app\.example\.com;/,
  );
  assert.match(
    appWrite.config,
    /proxy_set_header X-Original-URL https:\/\/app\.example\.com\$request_uri;/,
  );
  assert.match(appWrite.config, /proxy_set_header Host app\.example\.com;/);
  assert.doesNotMatch(appWrite.config, /\$http_host|client_max_body_size/);
});

test('a rewrite never adds or removes authentication on a tunnel', async () => {
  // State says restricted, the installed vhost is public — and the reverse.
  const restrictedApp = { ...app, accessMode: 'restricted' };
  const publicVhost = renderTunnelVhost(
    'public',
    'app.example.com',
    'example.com',
    9402,
    WILDCARD,
  ).config;
  const gatedVhost = namingClientHost(
    renderTunnelVhost('authenticated', 'open.example.com', 'example.com', 9403, WILDCARD, {
      maxBodySizeMb: 10,
    }).config,
    'open.example.com',
  );
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-app-app.example.com': publicVhost,
      'lamalibre-lamaste-app-open.example.com': gatedVhost,
    },
    { tunnels: [restrictedApp, open] },
  );
  const result = await reconcileTunnelVhosts(log, deps);
  assert.deepEqual(writes, []);
  assert.deepEqual(
    result.skipped.map((s) => s.vhost),
    ['app.example.com', 'open.example.com'],
  );
  for (const s of result.skipped) assert.match(s.reason, /disagree on whether it authenticates/);
});

test('a failed rewrite is reported and the others still happen', async () => {
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-agent-panel-agent-r730.example.com': OLD_PANEL,
      'lamalibre-lamaste-app-herd.example.com':
        'server {\n    ssl_certificate /x/fullchain.pem;\n    auth_request /x;\n}\n',
    },
    { failOn: 'lamalibre-lamaste-agent-panel-agent-r730.example.com' },
  );
  const result = await reconcileTunnelVhosts(log, deps);
  assert.deepEqual(result.failed, [{ vhost: 'agent-r730.example.com', error: 'nginx -t failed' }]);
  assert.deepEqual(result.rewritten, ['herd.example.com']);
  assert.equal(writes.length, 1);
});

test('every tunnel with a hostname has an expected vhost', () => {
  assert.equal(expectedTunnelVhost(internal, WILDCARD), null);
  assert.equal(expectedTunnelVhost({ ...panel, fqdn: 'elsewhere.example.org' }, WILDCARD), null);
  assert.equal(expectedTunnelVhost({ ...app, type: 'unknown' }, WILDCARD), null);
  assert.equal(expectedTunnelVhost({ ...app, subdomain: '../x' }, WILDCARD), null);
  assert.ok(expectedTunnelVhost(panel, WILDCARD));
  assert.equal(expectedTunnelVhost(app, WILDCARD).name, 'lamalibre-lamaste-app-app.example.com');
  // Persisted before `type` existed: an app tunnel.
  assert.equal(
    expectedTunnelVhost({ ...app, type: undefined }, WILDCARD).config,
    expectedTunnelVhost(app, WILDCARD).config,
  );
  // A plugin tunnel without a route was written as an app tunnel is.
  assert.doesNotMatch(
    expectedTunnelVhost({ ...plugin, pluginRoute: undefined }, WILDCARD).config,
    /rewrite|relay_assertion/,
  );
});

const protectedSite = {
  id: '4f1d2c3a-1b2c-4d5e-8f90-123456789abc',
  fqdn: 'docs.example.com',
  spaMode: false,
  autheliaProtected: true,
  allowedUsers: ['alice'],
  rootPath: '/var/www/lamaste/4f1d2c3a-1b2c-4d5e-8f90-123456789abc',
  certIssued: true,
};
const plainSite = {
  id: '3f1d2c3a-1b2c-4d5e-8f90-123456789abc',
  fqdn: 'www.example.com',
  spaMode: true,
  autheliaProtected: false,
  allowedUsers: [],
  rootPath: '/var/www/lamaste/3f1d2c3a-1b2c-4d5e-8f90-123456789abc/',
  aliases: ['example.com'],
  certIssued: true,
};
const pendingSite = { ...plainSite, id: '5f1d2c3a-1b2c-4d5e-8f90-123456789abc', certIssued: false };
const goneSite = {
  ...plainSite,
  id: '6f1d2c3a-1b2c-4d5e-8f90-123456789abc',
  fqdn: 'gone.example.com',
};

/** The panel vhost before it cleared a client's relay assertion. */
function panelVhostBefore45(certDir) {
  const config = renderPanelVhost('example.com', certDir).config;
  const out = config.replaceAll(
    '\n        # A relay assertion comes only from Gatekeeper, on a plugin\'s user surface\n        proxy_set_header X-Lamalibre-Relay-Assertion "";',
    '',
  );
  assert.notEqual(out, config, 'the fixture differs from the current vhost');
  return out;
}

test('the panel, the auth portal and static sites are rewritten', async () => {
  const docsCert = '/etc/letsencrypt/live/docs.example.com';
  const panelCert = '/etc/letsencrypt/live/panel.example.com';
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-panel-domain': panelVhostBefore45(panelCert),
      'lamalibre-lamaste-auth-example.com': namingClientHost(
        renderAuthVhost('example.com', WILDCARD).config,
        'auth.example.com',
      ),
      [`lamalibre-lamaste-site-${protectedSite.id}`]: namingClientHost(
        renderStaticSiteVhost(protectedSite, docsCert, 'example.com').config,
        'docs.example.com',
      ),
      [`lamalibre-lamaste-site-${plainSite.id}`]: renderStaticSiteVhost(
        plainSite,
        WILDCARD,
        'example.com',
      ).config,
    },
    {
      sites: [protectedSite, plainSite, pendingSite, goneSite],
      linked: ['lamalibre-lamaste-panel-domain', `lamalibre-lamaste-site-${protectedSite.id}`],
    },
  );

  const result = await reconcileSiteVhosts(log, [{ name: 'example.com', primary: true }], deps);
  assert.deepEqual(result.rewritten, ['panel.example.com', 'auth.example.com', 'docs.example.com']);
  assert.equal(result.unchanged, 1);
  // A site still waiting for its certificate has no vhost to report.
  assert.deepEqual(result.skipped, [{ vhost: 'gone.example.com', reason: 'no vhost installed' }]);
  assert.deepEqual(result.failed, []);

  const [panelWrite, authWrite, siteWrite] = writes;
  // The panel's own vhost: on its certificate, linked as it was, clearing a
  // client's relay assertion in every location.
  assert.equal(panelWrite.name, 'lamalibre-lamaste-panel-domain');
  assert.equal(panelWrite.enabled, true);
  assert.equal(panelWrite.config, renderPanelVhost('example.com', panelCert).config);
  assert.equal(panelWrite.config.match(/X-Lamalibre-Relay-Assertion "";/g).length, 8);
  // An older panel vhost gains the site upload location and its body limit.
  assert.match(panelWrite.config, /location ~ \^\/api\/sites\/\[\^\/\]\+\/files\$ \{/);
  assert.match(panelWrite.config, /client_max_body_size 64m;/);

  assert.equal(authWrite.name, 'lamalibre-lamaste-auth-example.com');
  assert.equal(authWrite.enabled, false, 'the link state is kept');
  assert.equal(authWrite.config, renderAuthVhost('example.com', WILDCARD).config);
  assert.match(authWrite.config, /ssl_certificate \/etc\/letsencrypt\/live\/example\.com\//);
  assert.match(authWrite.config, /X-Original-URL https:\/\/auth\.example\.com\$request_uri;/);

  assert.equal(siteWrite.name, `lamalibre-lamaste-site-${protectedSite.id}`);
  assert.equal(siteWrite.enabled, true);
  assert.equal(
    siteWrite.config,
    renderStaticSiteVhost(protectedSite, docsCert, 'example.com').config,
  );
  assert.match(siteWrite.config, /X-Original-URL https:\/\/docs\.example\.com\$request_uri;/);
  assert.doesNotMatch(siteWrite.config, /\$http_host/);
});

test('a site whose installed vhost disagrees with its protection is left alone', async () => {
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-panel-domain': renderPanelVhost('example.com').config,
      'lamalibre-lamaste-auth-example.com': renderAuthVhost('example.com').config,
      [`lamalibre-lamaste-site-${protectedSite.id}`]: renderStaticSiteVhost(
        { ...protectedSite, autheliaProtected: false },
        WILDCARD,
        'example.com',
      ).config,
    },
    { sites: [protectedSite] },
  );
  const result = await reconcileSiteVhosts(log, [{ name: 'example.com', primary: true }], deps);
  assert.deepEqual(writes, []);
  assert.equal(result.unchanged, 2);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /disagree on whether it authenticates/);
});

// ---------------------------------------------------------------------------
// Plugins' user surfaces (slice 6)
// ---------------------------------------------------------------------------

/** An app tunnel bound as the user surface of two plugins. */
const piyasa = {
  ...app,
  id: 'b',
  subdomain: 'piyasa',
  fqdn: 'piyasa.example.com',
  port: 9404,
  accessMode: 'restricted',
  maxBodySizeMb: 10,
  userSurface: { routes: ['market-indicators', 'fx'] },
};
const kamera = {
  ...piyasa,
  id: 'k',
  subdomain: 'kamera',
  fqdn: 'kamera.example.com',
  port: 9405,
  accessMode: 'authenticated',
  userSurface: { routes: ['camwatch'] },
};

/** Served: every bound route but `fx` (not approved yet), each with a 10 MiB limit. */
const servedButFx = (routes) =>
  routes.filter((r) => r !== 'fx').map((route) => ({ route, maxBodySizeMb: 10 }));

const piyasaVhost = (userSurface) =>
  renderTunnelVhost('restricted', 'piyasa.example.com', 'example.com', 9404, WILDCARD, {
    maxBodySizeMb: 10,
    ...(userSurface ? { userSurface } : {}),
  }).config;

test('a bound tunnel’s vhost carries the user surfaces served now, and loses them when they stop', async () => {
  const before = piyasaVhost(null);
  const linked = ['lamalibre-lamaste-app-piyasa.example.com'];
  const first = fakeDeps(
    { 'lamalibre-lamaste-app-piyasa.example.com': before },
    { tunnels: [piyasa], linked, served: servedButFx },
  );
  const asked = [];
  const served = first.deps.servedUserSurface;
  first.deps.servedUserSurface = async (routes, tunnel) => {
    asked.push([routes, tunnel.id, tunnel.agentLabel]);
    return served(routes);
  };
  const result = await reconcileTunnelVhosts(log, first.deps);
  assert.deepEqual(result.rewritten, ['piyasa.example.com']);
  assert.deepEqual(
    asked,
    [[['market-indicators', 'fx'], piyasa.id, piyasa.agentLabel]],
    'asked about its bound routes — and which agent carries it',
  );
  const [write] = first.writes;
  assert.equal(write.enabled, true);
  assert.equal(write.config, piyasaVhost([{ route: 'market-indicators', maxBodySizeMb: 10 }]));
  assert.match(write.config, /location \^~ \/api\/market-indicators\/app\/ \{/);
  assert.doesNotMatch(write.config, /\/api\/fx\/app/, 'a route not served has no location');

  // Up to date: left alone.
  const again = fakeDeps(
    { 'lamalibre-lamaste-app-piyasa.example.com': write.config },
    { tunnels: [piyasa], linked, served: servedButFx },
  );
  assert.equal((await reconcileTunnelVhosts(log, again.deps)).unchanged, 1);

  // Its plugin no longer served (an update without identity): the location goes.
  const after = fakeDeps(
    { 'lamalibre-lamaste-app-piyasa.example.com': write.config },
    { tunnels: [piyasa], linked, served: () => [] },
  );
  await reconcileTunnelVhosts(log, after.deps);
  assert.equal(after.writes[0].config, before);
});

test('reconcileUserSurfaceVhosts rewrites only the tunnels the route is bound to, or was released from', async () => {
  const outdated = {
    'lamalibre-lamaste-app-piyasa.example.com': piyasaVhost(null),
    // Still serving camwatch, which was released from it.
    'lamalibre-lamaste-app-kamera.example.com': renderTunnelVhost(
      'authenticated',
      'kamera.example.com',
      'example.com',
      9405,
      WILDCARD,
      { maxBodySizeMb: 10, userSurface: [{ route: 'camwatch', maxBodySizeMb: 10 }] },
    ).config,
    'lamalibre-lamaste-app-app.example.com': namingClientHost(
      renderTunnelVhost('restricted', 'app.example.com', 'example.com', 9402, WILDCARD).config,
      'app.example.com',
    ),
  };
  const tunnels = [piyasa, kamera, app];

  const one = fakeDeps(outdated, { tunnels, served: servedButFx });
  const result = await reconcileUserSurfaceVhosts(log, 'market-indicators', {}, one.deps);
  assert.deepEqual(result.rewritten, ['piyasa.example.com']);
  assert.deepEqual(
    one.writes.map((w) => w.name),
    ['lamalibre-lamaste-app-piyasa.example.com'],
  );

  // A route released from `kamera` (its binding is gone from the state already).
  const released = fakeDeps(outdated, {
    tunnels: [piyasa, { ...kamera, userSurface: undefined }, app],
    served: servedButFx,
  });
  const releasedResult = await reconcileUserSurfaceVhosts(
    log,
    'camwatch',
    { ids: ['k'] },
    released.deps,
  );
  assert.deepEqual(releasedResult.rewritten, ['kamera.example.com']);
  assert.doesNotMatch(released.writes[0].config, /user-surface/);

  // No tunnel serves the route: nothing is touched.
  const none = fakeDeps(outdated, { tunnels, served: servedButFx });
  const noneResult = await reconcileUserSurfaceVhosts(log, 'other', {}, none.deps);
  assert.deepEqual(none.writes, []);
  assert.equal(noneResult.unchanged, 0);

  // Its agent revoked: the tunnel keeps its binding, no agent carries it,
  // and it serves nothing — reconciled by id, for no route in particular.
  const revoked = fakeDeps(
    {
      'lamalibre-lamaste-app-piyasa.example.com': piyasaVhost([
        { route: 'market-indicators', maxBodySizeMb: 10 },
      ]),
    },
    {
      tunnels: [{ ...piyasa, agentLabel: undefined }, kamera],
      served: () => [],
    },
  );
  const revokedResult = await reconcileUserSurfaceVhosts(
    log,
    null,
    { ids: [piyasa.id] },
    revoked.deps,
  );
  assert.deepEqual(revokedResult.rewritten, ['piyasa.example.com']);
  assert.equal(revoked.writes[0].config, piyasaVhost(null));
});

test('state a vhost cannot carry is reported, and a failed lookup does not stop the others', async () => {
  const served = [{ route: 'market-indicators', maxBodySizeMb: 10 }];
  assert.equal(expectedTunnelVhost({ ...piyasa, accessMode: 'public' }, WILDCARD, served), null);

  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-app-piyasa.example.com': piyasaVhost(null),
      'lamalibre-lamaste-app-kamera.example.com':
        'server {\n    ssl_certificate /x/fullchain.pem;\n}\n',
      'lamalibre-lamaste-app-app.example.com': renderTunnelVhost(
        'restricted',
        'app.example.com',
        'example.com',
        9402,
        WILDCARD,
      ).config,
    },
    {
      tunnels: [{ ...piyasa, accessMode: 'public' }, kamera, app],
      served: (routes) => {
        if (routes.includes('camwatch')) throw new Error('state.db is locked');
        return servedButFx(routes);
      },
    },
  );
  const result = await reconcileTunnelVhosts(log, deps);
  assert.deepEqual(result.skipped, [
    { vhost: 'piyasa.example.com', reason: 'state cannot be rendered' },
  ]);
  assert.deepEqual(result.failed, [{ vhost: 'kamera.example.com', error: 'state.db is locked' }]);
  assert.equal(result.unchanged, 1);
  assert.deepEqual(writes, []);
});

test('vhosts an older version named by subdomain are renamed to their hostnames, in one call; a failure keeps the old names', async () => {
  let asked = null;
  const logged = [];
  const renamed = await renameLegacyVhosts(
    { info: (o) => logged.push(o), warn() {}, error: (o) => logged.push(o) },
    'example.com',
    {
      // A same-subdomain tunnel of another domain never takes an old file:
      // names by subdomain existed on the primary domain alone.
      readTunnels: async () => [
        panel,
        plugin,
        app,
        internal,
        { ...app, id: 'other', fqdn: 'app.codelama.com.tr' },
      ],
      renameVhosts: async (renames) => {
        asked = renames;
        return renames.map((r) => r.to);
      },
    },
  );
  assert.deepEqual(asked, [
    {
      from: 'lamalibre-lamaste-auth',
      to: 'lamalibre-lamaste-auth-example.com',
      serverName: 'auth.example.com',
    },
    {
      from: 'lamalibre-lamaste-agent-panel-agent-r730',
      to: 'lamalibre-lamaste-agent-panel-agent-r730.example.com',
      serverName: 'agent-r730.example.com',
    },
    {
      from: 'lamalibre-lamaste-app-herd',
      to: 'lamalibre-lamaste-app-herd.example.com',
      serverName: 'herd.example.com',
    },
    {
      from: 'lamalibre-lamaste-app-app',
      to: 'lamalibre-lamaste-app-app.example.com',
      serverName: 'app.example.com',
    },
  ]);
  assert.equal(renamed.length, 4);

  const failed = await renameLegacyVhosts(log, 'example.com', {
    readTunnels: async () => [app],
    renameVhosts: async () => {
      throw new Error('nginx -t failed after renaming vhosts');
    },
  });
  assert.deepEqual(failed, [], 'nothing renamed; the old names keep serving');
});

/** In-memory sites-available / sites-enabled for renameVhosts. */
function fakeSites(available, enabled, { valid = true } = {}) {
  const files = new Map(Object.entries(available));
  const links = new Set(enabled);
  const steps = [];
  return {
    files,
    links,
    steps,
    ops: {
      readInstalledVhost: async (n) => files.get(n) ?? null,
      siteExists: async (n) => files.has(n),
      isSiteEnabled: async (n) => links.has(n),
      writeVhostFile: async (n, t) => {
        steps.push(['write', n]);
        files.set(n, t);
      },
      enableSite: async (n) => {
        steps.push(['enable', n]);
        links.add(n);
      },
      disableSite: async (n) => {
        steps.push(['disable', n]);
        links.delete(n);
      },
      removeSite: async (n) => {
        steps.push(['remove', n]);
        files.delete(n);
        links.delete(n);
      },
      testConfig: async () => ({ valid, error: valid ? null : 'duplicate server_name' }),
      reload: async () => steps.push(['reload']),
    },
  };
}

const OLD_APP = 'server {\n    listen 443 ssl;\n    server_name app.example.com;\n}\n';

test('renameVhosts: a migration a crash cut short is finished — the old file goes, the new one takes its link', async () => {
  const sites = fakeSites(
    {
      'lamalibre-lamaste-app-app': OLD_APP,
      'lamalibre-lamaste-app-app.example.com': OLD_APP,
    },
    ['lamalibre-lamaste-app-app'],
  );
  const renamed = await renameVhosts(
    [
      {
        from: 'lamalibre-lamaste-app-app',
        to: 'lamalibre-lamaste-app-app.example.com',
        serverName: 'app.example.com',
      },
    ],
    sites.ops,
  );
  assert.deepEqual(renamed, ['lamalibre-lamaste-app-app.example.com']);
  assert.equal(sites.files.has('lamalibre-lamaste-app-app'), false, 'the old file is gone');
  assert.deepEqual([...sites.links], ['lamalibre-lamaste-app-app.example.com']);
  assert.ok(sites.steps.some(([s]) => s === 'reload'));
});

test('renameVhosts: an old file serving another host is left alone; nginx refusing restores every link', async () => {
  const foreign = fakeSites(
    { 'lamalibre-lamaste-app-app': OLD_APP.replace('app.example.com', 'app.other.example') },
    ['lamalibre-lamaste-app-app'],
  );
  const none = await renameVhosts(
    [
      {
        from: 'lamalibre-lamaste-app-app',
        to: 'lamalibre-lamaste-app-app.example.com',
        serverName: 'app.example.com',
      },
    ],
    foreign.ops,
  );
  assert.deepEqual(none, []);
  assert.deepEqual(foreign.steps, [], 'nothing written, linked or reloaded');

  const refused = fakeSites(
    {
      'lamalibre-lamaste-app-app': OLD_APP,
      'lamalibre-lamaste-app-app.example.com': OLD_APP,
      'lamalibre-lamaste-auth': 'server {\n    server_name auth.example.com;\n}\n',
    },
    ['lamalibre-lamaste-app-app', 'lamalibre-lamaste-auth'],
    { valid: false },
  );
  await assert.rejects(
    renameVhosts(
      [
        {
          from: 'lamalibre-lamaste-app-app',
          to: 'lamalibre-lamaste-app-app.example.com',
          serverName: 'app.example.com',
        },
        {
          from: 'lamalibre-lamaste-auth',
          to: 'lamalibre-lamaste-auth-example.com',
          serverName: 'auth.example.com',
        },
      ],
      refused.ops,
    ),
    /nginx -t failed/,
  );
  assert.deepEqual(
    [...refused.links].sort(),
    ['lamalibre-lamaste-app-app', 'lamalibre-lamaste-auth'],
    'the old links are back',
  );
  assert.ok(
    refused.files.has('lamalibre-lamaste-app-app.example.com'),
    'a file that was there stays',
  );
  assert.equal(refused.files.has('lamalibre-lamaste-auth-example.com'), false, 'a new file goes');
});

test('a protected static site under none of the relay domains renders closed, and the start says so', async () => {
  const site = {
    id: '11111111-2222-4333-8444-555555555555',
    name: 'legacy',
    fqdn: 'docs.customer.example',
    type: 'custom',
    spaMode: false,
    autheliaProtected: true,
    allowedUsers: [],
    certIssued: true,
    rootPath: '/var/www/lamaste/11111111-2222-4333-8444-555555555555/',
  };
  const { config } = renderStaticSiteVhost(
    site,
    '/etc/letsencrypt/live/docs.customer.example',
    null,
  );
  assert.match(config, /location \/ \{\s*return 403;\s*\}/, 'nothing served without a sign-in');
  assert.doesNotMatch(config, /try_files/);
  assert.doesNotMatch(config, /auth_request/);

  const notices = [];
  const result = await reconcileSiteVhosts(log, [{ name: 'example.com', primary: true }], {
    readSites: async () => [site],
    // As 4.6 left it: asking Authelia, which no cookie of the relay reaches.
    readInstalledVhost: async () =>
      'server {\n    ssl_certificate /etc/letsencrypt/live/docs.customer.example/fullchain.pem;\n    auth_request /internal/authelia/authz;\n}\n',
    installVhost: async () => assert.fail('a vhost that authenticates is never rewritten open'),
    isSiteEnabled: async () => true,
    notify: async (n) => notices.push(n),
  });
  assert.deepEqual(result.closed, ['docs.customer.example']);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].level, 'warning');
  assert.match(notices[0].message, /docs\.customer\.example/);
});
