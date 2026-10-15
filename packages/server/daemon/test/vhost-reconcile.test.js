/**
 * At startup the panel rewrites installed vhosts that differ from what the
 * generators produce now: agent-panel vhosts (which must forward the panel's
 * relay assertion), app and plugin tunnel vhosts, static site vhosts and the
 * auth portal (whose authorization subrequests must name their own hostname,
 * not the client's Host header). It keeps the certificate the installed vhost
 * names (a wildcard certificate stays a wildcard certificate), never links a
 * vhost that is not linked, never adds or removes authentication, leaves
 * everything else alone, and keeps going when one rewrite fails.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderAgentPanelVhost,
  renderAuthVhost,
  renderStaticSiteVhost,
  renderTunnelVhost,
} from '../src/lib/nginx.js';
import {
  expectedTunnelVhost,
  reconcileSiteVhosts,
  reconcileTunnelVhosts,
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

function fakeDeps(installed, { failOn, tunnels, sites = [], linked = [] } = {}) {
  const writes = [];
  return {
    writes,
    deps: {
      readTunnels: async () => tunnels ?? [panel, plugin, current, app, open, internal, missing],
      readSites: async () => sites,
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
  const oldPlugin = renderTunnelVhost('restricted', 'herd', 'example.com', 9400, WILDCARD, {
    maxBodySizeMb: 50,
  }).config; // written without the plugin route: an older, different vhost
  const upToDate = renderTunnelVhost(
    'restricted',
    'shell',
    'example.com',
    9401,
    '/etc/letsencrypt/live/shell.example.com',
    { pathPrefix: 'shell', maxBodySizeMb: 50 },
  ).config;
  const appCert = '/etc/letsencrypt/live/app.example.com';
  const oldApp = namingClientHost(
    renderTunnelVhost('restricted', 'app', 'example.com', 9402, appCert).config,
    'app.example.com',
  );
  const publicApp = renderTunnelVhost('public', 'open', 'example.com', 9403, WILDCARD, {
    maxBodySizeMb: 10,
  }).config;
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-agent-panel-agent-r730': OLD_PANEL,
      'lamalibre-lamaste-app-herd': oldPlugin,
      'lamalibre-lamaste-app-shell': upToDate,
      'lamalibre-lamaste-app-app': oldApp,
      'lamalibre-lamaste-app-open': publicApp,
    },
    // `app` is enabled in state but someone unlinked its vhost; `herd` is
    // disabled in state but still linked.
    {
      linked: [
        'lamalibre-lamaste-agent-panel-agent-r730',
        'lamalibre-lamaste-app-herd',
        'lamalibre-lamaste-app-shell',
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
  assert.equal(panelWrite.name, 'lamalibre-lamaste-agent-panel-agent-r730');
  assert.equal(panelWrite.enabled, true);
  assert.equal(
    panelWrite.config,
    renderAgentPanelVhost('agent-r730', 'example.com', 9393, WILDCARD).config,
  );
  assert.match(panelWrite.config, /ssl_certificate \/etc\/letsencrypt\/live\/example\.com\//);
  assert.match(panelWrite.config, /auth_request \/internal\/lamaste\/agent-panel-authz;/);

  assert.equal(pluginWrite.name, 'lamalibre-lamaste-app-herd');
  assert.equal(pluginWrite.enabled, false, 'a disabled tunnel is unlinked');
  assert.match(
    pluginWrite.config,
    /proxy_set_header X-Lamalibre-Relay-Assertion \$relay_assertion;/,
  );
  assert.match(pluginWrite.config, /rewrite \^\/\?\(\.\*\)\$ \/herd\/\$1 break;/);
  assert.match(pluginWrite.config, /client_max_body_size 50m;/);

  // An app tunnel with neither access mode nor body limit stored: restricted,
  // as Gatekeeper reads it, and no limit, as it was written.
  assert.equal(appWrite.name, 'lamalibre-lamaste-app-app');
  assert.equal(appWrite.fqdn, 'app.example.com');
  assert.equal(appWrite.enabled, false, 'a rewrite never links a vhost that is not linked');
  assert.equal(
    appWrite.config,
    renderTunnelVhost('restricted', 'app', 'example.com', 9402, appCert).config,
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
  const publicVhost = renderTunnelVhost('public', 'app', 'example.com', 9402, WILDCARD).config;
  const gatedVhost = namingClientHost(
    renderTunnelVhost('authenticated', 'open', 'example.com', 9403, WILDCARD, {
      maxBodySizeMb: 10,
    }).config,
    'open.example.com',
  );
  const { deps, writes } = fakeDeps(
    { 'lamalibre-lamaste-app-app': publicVhost, 'lamalibre-lamaste-app-open': gatedVhost },
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
      'lamalibre-lamaste-agent-panel-agent-r730': OLD_PANEL,
      'lamalibre-lamaste-app-herd':
        'server {\n    ssl_certificate /x/fullchain.pem;\n    auth_request /x;\n}\n',
    },
    { failOn: 'lamalibre-lamaste-agent-panel-agent-r730' },
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
  assert.equal(expectedTunnelVhost(app, WILDCARD).name, 'lamalibre-lamaste-app-app');
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

test('the auth portal and static sites are rewritten to name their own hostname', async () => {
  const docsCert = '/etc/letsencrypt/live/docs.example.com';
  const { deps, writes } = fakeDeps(
    {
      'lamalibre-lamaste-auth': namingClientHost(
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
      linked: [`lamalibre-lamaste-site-${protectedSite.id}`],
    },
  );

  const result = await reconcileSiteVhosts(log, 'example.com', deps);
  assert.deepEqual(result.rewritten, ['auth.example.com', 'docs.example.com']);
  assert.equal(result.unchanged, 1);
  // A site still waiting for its certificate has no vhost to report.
  assert.deepEqual(result.skipped, [{ vhost: 'gone.example.com', reason: 'no vhost installed' }]);
  assert.deepEqual(result.failed, []);

  const [authWrite, siteWrite] = writes;
  assert.equal(authWrite.name, 'lamalibre-lamaste-auth');
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
      'lamalibre-lamaste-auth': renderAuthVhost('example.com').config,
      [`lamalibre-lamaste-site-${protectedSite.id}`]: renderStaticSiteVhost(
        { ...protectedSite, autheliaProtected: false },
        WILDCARD,
        'example.com',
      ).config,
    },
    { sites: [protectedSite] },
  );
  const result = await reconcileSiteVhosts(log, 'example.com', deps);
  assert.deepEqual(writes, []);
  assert.equal(result.unchanged, 1);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0].reason, /disagree on whether it authenticates/);
});
