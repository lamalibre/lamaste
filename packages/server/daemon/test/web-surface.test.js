/**
 * Slice 7, a plugin's web surface on the relay: the shell its server
 * package ships (`userSurface.web`) served on a site the plugin owns,
 * beside its user surface's API.
 *
 * - The tree store keeps verified copies only: staged from the installed
 *   package, checked against the approved digest before and after the
 *   copy, `current` and `previous` switched by a rename, the rest pruned.
 * - The tree's digest is part of the approval: read at install, staged from
 *   the tarball for an update (shown in its preview), served only once
 *   approved — and switched by the update that brings another, with the
 *   old tree kept as `previous`.
 * - The site: created on the declared subdomain (refused for a taken one,
 *   a plugin without a web surface, a bound tunnel, a second time),
 *   answering 503 until the surface is served, then the shell through
 *   Gatekeeper and the API; never managed through the sites API; deleted
 *   with its trees.
 * - Moving from the bound tunnel: one handover, the tunnel left disabled
 *   and unbound (and refused when enabled again), a restricted tunnel's
 *   grants copied, everything put back when nginx refuses.
 *
 * Every vhost written passes the lamaste-priv allow-list. nginx, certbot
 * and chisel are stand-ins (`fake-sudo.js`), npm too (`fake-npm.js`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { installFakeNpm } from './fake-npm.js';
import { installFakeSudo } from './fake-sudo.js';

const require = createRequire(import.meta.url);
const { validateVhost } = require(
  fileURLToPath(new URL('../../../provisioners/server/scripts/lamaste-priv', import.meta.url)),
);

const IP = '127.0.0.1';
const IDENTITY = { roles: [{ id: 'viewer', label: 'Viewer' }], attributes: ['displayName'] };

const logger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return logger;
  },
};
const actor = { actor: 'admin', certSerial: '0A1B', logger };

let dir;
let treesRoot;
let npm;
let sudo;
let lib;
let core;
let shared;
let app;

/** Gatekeeper's grants, as the stand-in Gatekeeper keeps them. */
const grants = [];

const T = {};

function tunnel(name, overrides = {}) {
  return {
    id: crypto.randomUUID(),
    subdomain: name,
    fqdn: `${name}.relay.test`,
    port: 20000 + Object.keys(T).length,
    description: null,
    type: 'app',
    accessMode: 'authenticated',
    enabled: true,
    createdAt: new Date().toISOString(),
    agentLabel: 'vm1',
    maxBodySizeMb: 10,
    ...overrides,
  };
}

/** A web tree's files, as a package holds them under `web/`. */
function webFiles(tree) {
  return Object.fromEntries(
    Object.entries(tree).map(([file, content]) => [`web/${file}`, content]),
  );
}

/** The digest of a web tree (core's rule), from its files. */
function treeSha(tree) {
  return shared.webTreeManifest(
    Object.entries(tree).map(([p, content]) => ({
      path: p,
      size: Buffer.byteLength(content),
      sha256: shared.webTreeFileSha256(Buffer.from(content)),
    })),
  ).sha256;
}

const TREE_1 = { 'index.html': '<p>one</p>', 'main-AAAA.js': 'one()', 'chunk-OLD.js': 'old()' };
const TREE_2 = { 'index.html': '<p>two</p>', 'main-BBBB.js': 'two()' };

function webManifest(name, version, extra = {}) {
  return {
    name,
    version,
    hosting: 'agent',
    agent: {},
    identity: IDENTITY,
    userSurface: { web: { defaultSubdomain: name } },
    ...extra,
  };
}

async function publish(name, version, manifest, files = {}) {
  await npm.publish(`@lamalibre/${name}-server`, version, {
    'lamaste-plugin.json': JSON.stringify(manifest),
    ...files,
  });
}

async function approve(name) {
  const plugin = await lib.findPlugin(name);
  await lib.approveHookSet(plugin, lib.installedApproval(plugin).digest, actor);
}

async function host(name, label) {
  await lib.hostPlugin(name, label, { actor: 'admin', logger, sourceIp: IP });
  const done = await lib.waitForPluginOperation(name);
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  await lib.identityIdle();
}

async function enroll(label) {
  const registry = await lib.loadAgentRegistry();
  registry.agents.push({
    label,
    serial: crypto.randomBytes(8).toString('hex'),
    capabilities: ['tunnels:read'],
    allowedSites: [],
    enrollmentMethod: 'p12',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    revoked: false,
  });
  await lib.saveAgentRegistry(registry);
}

function call(method, url, body) {
  return app.inject({
    method,
    url,
    headers: {
      'x-test-role': 'admin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

const status = async (name) => (await call('GET', `/api/plugins/${name}/web-surface`)).json();
const siteVhost = (site) => sudo.read(`lamalibre-lamaste-site-${site.id}`);

/** A stand-in Gatekeeper: grants in memory, everything else answered empty. */
async function gatekeeper(method, apiPath, body) {
  const url = new URL(apiPath, 'http://gk');
  if (url.pathname === '/api/grants' && method === 'GET') {
    const type = url.searchParams.get('resourceType');
    const id = url.searchParams.get('resourceId');
    return {
      ok: true,
      data: {
        grants: grants.filter(
          (g) => (!type || g.resourceType === type) && (!id || g.resourceId === id),
        ),
      },
    };
  }
  if (url.pathname === '/api/grants' && method === 'POST') {
    const grant = {
      grantId: crypto.randomUUID(),
      used: true,
      createdAt: new Date().toISOString(),
      context: {},
      ...body,
    };
    grants.push(grant);
    return { ok: true, data: { grant } };
  }
  if (url.pathname.startsWith('/api/grants/') && method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/grants/'.length));
    const at = grants.findIndex((g) => g.grantId === id);
    if (at !== -1) grants.splice(at, 1);
    return { ok: true, data: { ok: true } };
  }
  if (url.pathname === '/api/groups') return { ok: true, data: { groups: [] } };
  return { ok: true, data: {} };
}

before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'lamaste-s7-web-')));
  const stateDir = path.join(dir, 'state');
  treesRoot = path.join(dir, 'www', 'apps');
  await mkdir(stateDir);
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');
  process.env.LAMALIBRE_LAMASTE_CONFIG = path.join(stateDir, 'panel.json');
  process.env.LAMALIBRE_LAMASTE_WEB_TREES_ROOT = treesRoot;
  await writeFile(
    process.env.LAMALIBRE_LAMASTE_CONFIG,
    JSON.stringify({
      ip: '203.0.113.10',
      domain: 'relay.test',
      email: 'ops@relay.test',
      dataDir: stateDir,
      onboarding: { status: 'COMPLETED' },
    }),
  );
  npm = await installFakeNpm(path.join(dir, 'npm'));
  sudo = await installFakeSudo(path.join(dir, 'nginx'));

  lib = {
    ...(await import('../src/lib/config.js')),
    ...(await import('../src/lib/state.js')),
    ...(await import('../src/lib/mtls.js')),
    ...(await import('../src/lib/gatekeeper-client.js')),
    ...(await import('../src/lib/nginx.js')),
    ...(await import('../src/lib/audit.js')),
    ...(await import('../src/lib/plugins.js')),
    ...(await import('../src/lib/plugin-hooks.js')),
    ...(await import('../src/lib/plugin-hosting.js')),
    ...(await import('../src/lib/plugin-lifecycle.js')),
    ...(await import('../src/lib/plugin-operations.js')),
    ...(await import('../src/lib/hook-pipelines.js')),
    ...(await import('../src/lib/identity-sync.js')),
    ...(await import('../src/lib/user-surface.js')),
    ...(await import('../src/lib/web-surface.js')),
  };
  core = await import('@lamalibre/lamaste/server');
  shared = await import('@lamalibre/lamaste');
  await lib.loadConfig();
  lib.setOidcSyncForTests(async () => null);
  lib.setGatekeeperClientForTests(gatekeeper);
  lib.setUserSurfaceReconcileDepsForTests(sudo.reconcileDeps(lib));
  lib.setWebSurfaceDepsForTests({ readInstalledVhost: sudo.read });
  let internalPort = 21000;
  lib.setTunnelOpsForTests({
    async create(ctx) {
      const entry = {
        id: crypto.randomUUID(),
        subdomain: null,
        fqdn: null,
        port: internalPort++,
        description: `Internal tunnel of plugin ${ctx.plugin.name}`,
        type: 'plugin',
        exposure: 'internal',
        enabled: false,
        createdAt: new Date().toISOString(),
        pluginName: ctx.plugin.packageName,
        pluginRoute: ctx.route,
        agentLabel: ctx.agentLabel,
        maxBodySizeMb: 10,
      };
      await core.withTunnelLock(async () => {
        await lib.writeTunnels([...(await lib.readTunnels()), entry]);
      });
      return entry;
    },
    async enable(ctx) {
      await core.withTunnelLock(async () => {
        const tunnels = await lib.readTunnels();
        await lib.writeTunnels(
          tunnels.map((t) => (t.id === ctx.tunnelId ? { ...t, enabled: true } : t)),
        );
      });
    },
    async remove(ctx) {
      await core.withTunnelLock(async () => {
        await lib.writeTunnels((await lib.readTunnels()).filter((t) => t.id !== ctx.tunnelId));
      });
    },
    async waitForAgentHalf() {},
  });

  await enroll('vm1');

  T.taken = tunnel('taken');
  T.piyasa = tunnel('piyasa');
  T.vault = tunnel('vault', { accessMode: 'restricted' });
  await lib.writeTunnels(Object.values(T));
  for (const t of [T.taken, T.piyasa]) {
    await lib.writeAuthenticatedVhost(t.subdomain, 'relay.test', t.port, undefined, {
      maxBodySizeMb: 10,
    });
  }
  await lib.writeRestrictedVhost('vault', 'relay.test', T.vault.port, undefined, {
    maxBodySizeMb: 10,
  });

  const { default: Fastify } = await import('fastify');
  const { default: roleGuard } = await import('../src/middleware/role-guard.js');
  const { default: errorHandler } = await import('../src/middleware/errors.js');
  const { default: tunnelRoutes } = await import('../src/routes/management/tunnels.js');
  const { default: sitesRoutes } = await import('../src/routes/management/sites.js');
  const { default: webSurfaceRoutes } =
    await import('../src/routes/management/plugin-web-surface.js');
  app = Fastify({ logger: false });
  app.decorateRequest('certRole', null);
  app.decorateRequest('certLabel', null);
  app.decorateRequest('certCapabilities', null);
  app.addHook('onRequest', async (request) => {
    request.certRole = request.headers['x-test-role'] ?? 'unknown';
    request.certCapabilities = ['tunnels:read', 'tunnels:write', 'sites:read', 'sites:write'];
  });
  await app.register(roleGuard);
  await app.register(errorHandler);
  await app.register(tunnelRoutes, { prefix: '/api' });
  await app.register(sitesRoutes, { prefix: '/api' });
  await app.register(webSurfaceRoutes, { prefix: '/api' });
  await app.ready();
});

after(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The tree store
// ---------------------------------------------------------------------------

async function writeTree(root, tree) {
  for (const [file, content] of Object.entries(tree)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
}

test('tree store: verified copies, current and previous switched by rename, the rest pruned', async () => {
  const store = path.join(dir, 'store-unit', 'fx');
  const src1 = path.join(dir, 'src1');
  const src2 = path.join(dir, 'src2');
  const src3 = path.join(dir, 'src3');
  await writeTree(src1, TREE_1);
  await writeTree(src2, TREE_2);
  await writeTree(src3, { 'index.html': '<p>three</p>' });
  const [d1, d2, d3] = [TREE_1, TREE_2, { 'index.html': '<p>three</p>' }].map(treeSha);

  assert.equal(await core.stageWebTree(store, src1, d1), true);
  assert.equal(await core.stageWebTree(store, src1, d1), false, 'a stored tree is kept');
  assert.equal(await core.switchWebTree(store, d1), true);
  assert.deepEqual(await core.readWebTreeStore(store), {
    current: d1,
    previous: null,
    trees: [d1],
  });
  assert.equal(await readFile(path.join(store, 'current', 'main-AAAA.js'), 'utf8'), 'one()');
  assert.equal(((await lstat(path.join(store, d1, 'index.html'))).mode & 0o777).toString(8), '640');

  await core.stageWebTree(store, src2, d2);
  assert.equal(await core.switchWebTree(store, d2), true);
  assert.equal(await core.switchWebTree(store, d2), false);
  assert.deepEqual(await core.readWebTreeStore(store), {
    current: d2,
    previous: d1,
    trees: [d1, d2].sort(),
  });
  // An old page's lazy file is still there, under previous.
  assert.equal(await readFile(path.join(store, 'previous', 'chunk-OLD.js'), 'utf8'), 'old()');

  // A third tree: the first goes.
  await core.stageWebTree(store, src3, d3);
  await core.switchWebTree(store, d3);
  assert.deepEqual(await core.readWebTreeStore(store), {
    current: d3,
    previous: d2,
    trees: [d2, d3].sort(),
  });
  // A revert switches back to what previous holds.
  await core.switchWebTree(store, d2);
  assert.deepEqual(await core.readWebTreeStore(store), {
    current: d2,
    previous: d3,
    trees: [d2, d3].sort(),
  });
  assert.equal(await readlink(path.join(store, 'current')), d2, 'links are relative');
});

test('tree store: a source that is not the approved tree, or holds a link, is refused', async () => {
  const store = path.join(dir, 'store-refused', 'fx');
  const src = path.join(dir, 'src-refused');
  await writeTree(src, TREE_1);
  await assert.rejects(
    core.stageWebTree(store, src, treeSha(TREE_2)),
    (err) => err instanceof shared.WebTreeError && err.code === 'DIGEST_MISMATCH',
  );
  await symlink('/etc/hosts', path.join(src, 'hosts.js'));
  await assert.rejects(
    core.stageWebTree(store, src, treeSha(TREE_1)),
    (err) => err instanceof shared.WebTreeError && err.code === 'NOT_REGULAR_FILE',
  );
  assert.deepEqual((await core.readWebTreeStore(store)).trees, []);
  await assert.rejects(core.switchWebTree(store, treeSha(TREE_1)), /not a directory/);
});

// ---------------------------------------------------------------------------
// Approval and staging
// ---------------------------------------------------------------------------

test('install: the tree is read and approved with the rest; served only once approved', async () => {
  await publish('wf', '1.0.0', webManifest('wf', '1.0.0'), webFiles(TREE_1));
  await lib.installPlugin('@lamalibre/wf-server', logger);
  const plugin = await lib.findPlugin('wf');
  assert.equal(plugin.webTreeSha256, treeSha(TREE_1));
  assert.deepEqual(plugin.userSurface, {
    web: { defaultSubdomain: 'wf', accessMode: 'authenticated', root: 'web' },
  });
  const approval = lib.installedApproval(plugin);
  assert.deepEqual(approval.web, { treeSha256: treeSha(TREE_1) });
  assert.notEqual(
    approval.digest,
    lib.installedApproval({ ...plugin, userSurface: undefined }).digest,
  );

  // Not approved yet: nothing in the store.
  let ws = (await status('wf')).webSurface;
  assert.equal(ws.served, false);
  assert.equal(ws.reason, 'not_approved');
  assert.deepEqual(ws.tree, { approved: treeSha(TREE_1), current: null, previous: null });
  assert.deepEqual(ws.offer, { subdomain: 'wf', accessMode: 'authenticated', available: true });

  await approve('wf');
  ws = (await status('wf')).webSurface;
  assert.equal(ws.tree.current, treeSha(TREE_1), 'the approval serves the tree');
  assert.equal(ws.reason, 'not_hosted');
  assert.equal(
    await readFile(path.join(treesRoot, 'wf', 'current', 'index.html'), 'utf8'),
    '<p>one</p>',
  );
  const [switched] = await lib.listAudit({ plugin: 'wf', action: 'plugin.web-tree.switched' });
  assert.equal(switched.details.treeSha256, treeSha(TREE_1));
});

test('install: a tree that breaks a rule, or is missing, is refused', async () => {
  await publish(
    'wbad',
    '1.0.0',
    webManifest('wbad', '1.0.0'),
    webFiles({ 'index.html': '', '.env': 'x' }),
  );
  await assert.rejects(
    lib.installPlugin('@lamalibre/wbad-server', logger),
    (err) => err.statusCode === 400 && /web surface .* cannot be served/.test(err.message),
  );
  await publish('wnone', '1.0.0', webManifest('wnone', '1.0.0'));
  await assert.rejects(lib.installPlugin('@lamalibre/wnone-server', logger), /cannot be served/);
  assert.equal(await lib.findPlugin('wbad'), null);
  assert.equal(await lib.findPlugin('wnone'), null);
});

test('update: another tree waits for approval, shown in the preview; applied, it is switched to', async () => {
  await publish('wu', '1.0.0', webManifest('wu', '1.0.0'), webFiles(TREE_1));
  await lib.installPlugin('@lamalibre/wu-server', logger);
  await approve('wu');
  await publish('wu', '1.1.0', webManifest('wu', '1.1.0'), webFiles(TREE_2));
  const staged = await lib.updatePlugin('wu', '1.1.0', actor);
  assert.ok(staged.pendingUpdate);
  assert.deepEqual(staged.pendingUpdate.web, {
    before: treeSha(TREE_1),
    after: {
      sha256: treeSha(TREE_2),
      files: 2,
      totalBytes: Object.values(TREE_2).reduce((n, c) => n + Buffer.byteLength(c), 0),
    },
  });
  assert.deepEqual(staged.pendingUpdate.approvalRequired, [
    { code: 'digest.unapproved', reason: 'its identity and web surface are not what was approved' },
  ]);
  // Waiting: the approved tree stays served.
  assert.equal((await status('wu')).webSurface.tree.current, treeSha(TREE_1));

  const approved = await lib.approveHookSet(
    await lib.findPlugin('wu'),
    staged.pendingUpdate.digest,
    actor,
  );
  await lib.updatePlugin('wu', '1.1.0', { ...actor, approvedUpdate: approved });
  const done = await lib.waitForPluginOperation('wu');
  assert.equal(done.status, 'succeeded', JSON.stringify(done));
  const ws = (await status('wu')).webSurface;
  assert.deepEqual(ws.tree, {
    approved: treeSha(TREE_2),
    current: treeSha(TREE_2),
    previous: treeSha(TREE_1),
  });
});

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

test('create: refused for a taken name, a plugin without a web surface, twice', async () => {
  await publish('nw', '1.0.0', {
    name: 'nw',
    version: '1.0.0',
    hosting: 'agent',
    agent: {},
    identity: IDENTITY,
  });
  await lib.installPlugin('@lamalibre/nw-server', logger);
  for (const [name, body, code, expected] of [
    ['nw', {}, 400, 'no_web_surface'],
    ['wf', { subdomain: 'taken' }, 409, 'hostname_taken'],
    ['wf', { subdomain: 'panel' }, 409, 'hostname_taken'],
    ['nothing', {}, 404, undefined],
  ]) {
    const res = await call('POST', `/api/plugins/${name}/web-surface`, body);
    assert.equal(res.statusCode, code, `${name} ${JSON.stringify(body)}: ${res.body}`);
    assert.equal(res.json().code, expected);
  }
  assert.equal(
    (await call('POST', '/api/plugins/wf/web-surface', { accessMode: 'public' })).statusCode,
    400,
  );
});

test('create: the site on the declared subdomain, 503 until served, then the shell and the API', async () => {
  const res = await call('POST', '/api/plugins/wf/web-surface', {});
  assert.equal(res.statusCode, 201, res.body);
  const ws = res.json().webSurface;
  assert.equal(ws.site.fqdn, 'wf.relay.test');
  assert.equal(ws.site.accessMode, 'authenticated');
  const site = (await lib.readSites()).find((s) => s.id === ws.site.id);
  assert.deepEqual(site.owner, { plugin: 'wf' });
  assert.equal(site.rootPath, `${treesRoot}/wf/current`);

  // Not hosted: every request 503.
  let vhost = await siteVhost(site);
  assert.match(vhost, /return 503;/);
  assert.doesNotMatch(vhost, /location \/api\/wf\/app\//);
  assert.doesNotThrow(() => validateVhost(vhost));
  assert.equal((await call('POST', '/api/plugins/wf/web-surface', {})).json().code, 'exists');

  await host('wf', 'vm1');
  vhost = await siteVhost(site);
  assert.equal((await status('wf')).webSurface.served, true);
  assert.match(vhost, /auth_request \/internal\/lamaste\/shell-authz;/);
  assert.match(
    vhost,
    /proxy_pass http:\/\/127\.0\.0\.1:9294\/authz\/user-surface-shell\/wf\.relay\.test;/,
  );
  assert.match(vhost, /location \/api\/wf\/app\/ \{/);
  assert.match(vhost, /try_files \$uri @previous;/);
  assert.ok(vhost.includes(`root ${treesRoot}/wf/current;`));
  assert.ok(vhost.includes(`root ${treesRoot}/wf/previous;`));
  assert.match(vhost, /Content-Security-Policy "default-src 'self'; script-src 'self';/);
  // The API's answers are the panel's to head: the shell's headers stay in its locations.
  const api = vhost.slice(vhost.indexOf('location /api/wf/app/'), vhost.indexOf('location / {'));
  assert.doesNotMatch(api, /Content-Security-Policy/);
  // The tree directory is under /var/www/lamaste on a relay; here the test's.
  assert.doesNotThrow(() => validateVhost(vhost.replaceAll(treesRoot, '/var/www/lamaste/apps')));

  // Gatekeeper's reading of the state: the site serves the route.
  const hosts = shared.userSurfaceHosts(await lib.readTunnels(), await lib.readSites());
  const served = shared.userSurfaceHostServing(hosts, 'wf');
  assert.equal(served.kind, 'site');
  assert.equal(served.fqdn, 'wf.relay.test');
  assert.equal(await lib.userSurfaceOrigin('wf'), 'https://wf.relay.test');

  const [created] = await lib.listAudit({ plugin: 'wf', action: 'plugin.web-surface.created' });
  assert.equal(created.details.fqdn, 'wf.relay.test');
});

test('the sites API manages no plugin-owned site; no tunnel takes its route or its name', async () => {
  const site = (await lib.readSites()).find((s) => s.owner?.plugin === 'wf');
  for (const [method, url, body] of [
    ['GET', `/api/sites/${site.id}/files`],
    ['DELETE', `/api/sites/${site.id}/files`, { path: 'index.html' }],
    ['PATCH', `/api/sites/${site.id}`, { spaMode: false }],
    ['DELETE', `/api/sites/${site.id}`],
  ]) {
    const res = await call(method, url, body);
    assert.equal(res.statusCode, 409, `${method} ${url}: ${res.body}`);
    assert.equal(res.json().details.code, 'plugin_owned_site');
  }
  const bind = await call('PUT', `/api/tunnels/${T.taken.id}/user-surface`, { route: 'wf' });
  assert.equal(bind.statusCode, 400, bind.body);
  assert.match(bind.json().details ?? bind.json().error, /web surface/);
  const create = await call('POST', '/api/tunnels', {
    subdomain: 'wf',
    port: 20555,
    agentLabel: 'vm1',
    accessMode: 'authenticated',
  });
  assert.equal(create.statusCode, 400, create.body);
  assert.match(create.json().details, /already served: by the static site 'wf'/);
});

test('delete: the vhost, the entry, the trees and the site’s grants go', async () => {
  await publish('wd', '1.0.0', webManifest('wd', '1.0.0'), webFiles(TREE_1));
  await lib.installPlugin('@lamalibre/wd-server', logger);
  await approve('wd');
  const created = await call('POST', '/api/plugins/wd/web-surface', { accessMode: 'restricted' });
  assert.equal(created.statusCode, 201, created.body);
  const siteId = created.json().webSurface.site.id;
  grants.push({
    grantId: 'g-site',
    principalType: 'user',
    principalId: 'ayse',
    resourceType: 'site',
    resourceId: siteId,
    context: {},
  });
  const res = await call('DELETE', '/api/plugins/wd/web-surface');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(
    (await lib.readSites()).some((s) => s.id === siteId),
    false,
  );
  assert.equal(await sudo.read(`lamalibre-lamaste-site-${siteId}`), null);
  assert.deepEqual(await core.readWebTreeStore(path.join(treesRoot, 'wd')), {
    current: null,
    previous: null,
    trees: [],
  });
  assert.equal(
    grants.some((g) => g.resourceId === siteId),
    false,
  );
  assert.equal((await call('DELETE', '/api/plugins/wd/web-surface')).statusCode, 404);
});

// ---------------------------------------------------------------------------
// Moving from the bound tunnel
// ---------------------------------------------------------------------------

async function bound(name, t) {
  await publish(name, '1.0.0', webManifest(name, '1.0.0'), webFiles(TREE_1));
  await lib.installPlugin(`@lamalibre/${name}-server`, logger);
  await approve(name);
  await host(name, 'vm1');
  const res = await call('PUT', `/api/tunnels/${t.id}/user-surface`, { route: name });
  assert.equal(res.statusCode, 200, res.body);
}

test('move: refused while nginx refuses — everything as it was', async () => {
  await bound('mi', T.piyasa);
  // A bound tunnel: creating a second host is refused.
  assert.equal(
    (await call('POST', '/api/plugins/mi/web-surface', {})).json().code,
    'bound_to_tunnel',
  );
  const before = { tunnels: await lib.readTunnels(), sites: await lib.readSites() };
  lib.setWebSurfaceDepsForTests({
    readInstalledVhost: sudo.read,
    async moveAppVhostToWebSurface() {
      throw new Error('nginx -t failed');
    },
  });
  try {
    const res = await call('POST', '/api/plugins/mi/web-surface/move', { tunnelId: T.piyasa.id });
    assert.equal(res.statusCode, 500, res.body);
  } finally {
    lib.setWebSurfaceDepsForTests({ readInstalledVhost: sudo.read });
  }
  assert.deepEqual(await lib.readTunnels(), before.tunnels);
  assert.deepEqual(await lib.readSites(), before.sites);
  assert.match(await sudo.read('lamalibre-lamaste-app-piyasa'), /location \/api\/mi\/app\//);
});

test('move: the host handed to the web surface in one reload; the tunnel kept, off and unbound', async () => {
  const res = await call('POST', '/api/plugins/mi/web-surface/move', { tunnelId: T.piyasa.id });
  assert.equal(res.statusCode, 200, res.body);
  const ws = res.json().webSurface;
  assert.equal(ws.site.fqdn, 'piyasa.relay.test');
  assert.equal(ws.served, true);
  const stored = (await lib.readTunnels()).find((t) => t.id === T.piyasa.id);
  assert.equal(stored.enabled, false);
  assert.equal(stored.userSurface, undefined);
  assert.equal(await sudo.read('lamalibre-lamaste-app-piyasa'), null, 'the tunnel vhost is gone');
  const vhost = await sudo.read(`lamalibre-lamaste-site-${ws.site.id}`);
  assert.match(vhost, /server_name piyasa\.relay\.test;/);
  assert.match(vhost, /location \/api\/mi\/app\//);
  assert.equal(sudo.isEnabled(`lamalibre-lamaste-site-${ws.site.id}`), true);

  const hosts = shared.userSurfaceHosts(await lib.readTunnels(), await lib.readSites());
  assert.equal(shared.userSurfaceHostServing(hosts, 'mi').kind, 'site');

  // The tunnel cannot come back on while the site holds its name.
  const enable = await call('PATCH', `/api/tunnels/${T.piyasa.id}`, { enabled: true });
  assert.equal(enable.statusCode, 400, enable.body);
  assert.match(enable.json().details, /already served/);
  const [moved] = await lib.listAudit({ plugin: 'mi', action: 'plugin.web-surface.moved' });
  assert.equal(moved.details.tunnelId, T.piyasa.id);
});

test('move: a restricted tunnel’s grants follow it to the site', async () => {
  await bound('kw', T.vault);
  grants.push({
    grantId: 'g-vault',
    principalType: 'group',
    principalId: 'ops',
    resourceType: 'tunnel',
    resourceId: T.vault.id,
    context: {},
  });
  const res = await call('POST', '/api/plugins/kw/web-surface/move', { tunnelId: T.vault.id });
  assert.equal(res.statusCode, 200, res.body);
  const ws = res.json().webSurface;
  assert.equal(ws.site.accessMode, 'restricted');
  assert.ok(
    grants.some(
      (g) =>
        g.resourceType === 'site' &&
        g.resourceId === ws.site.id &&
        g.principalType === 'group' &&
        g.principalId === 'ops',
    ),
  );
});

test('move: refused for a tunnel not bound to the plugin, or for a plugin with a site', async () => {
  for (const [name, tunnelId, code] of [
    ['wf', T.taken.id, 'exists'],
    ['wu', T.taken.id, 'not_bound'],
    ['wu', 'nope', 'not_found'],
  ]) {
    const res = await call('POST', `/api/plugins/${name}/web-surface/move`, { tunnelId });
    assert.equal(res.json().code, code, `${name} ${tunnelId}: ${res.body}`);
  }
});
