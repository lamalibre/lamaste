/**
 * Agent-hosted plugins (`hosting: "agent"`, slice 1): the manifest accepts
 * the field and refuses a panel for it; the plugin host never imports such a
 * plugin's package, mounts nothing under its route and serves no bundle; the
 * panel's registry keeps the hosting; and its OIDC clients are planned for
 * Authelia exactly as a server plugin's are — served while enabled, the
 * confidential client's secret kept while installed.
 *
 * The fixture package's main module records that it was imported and then
 * throws, so an import would show up even though the plugin host swallows
 * mount failures.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { validateManifest, isAgentHostedPlugin } from '@lamalibre/lamaste';
import { buildOidcProviderSection } from '@lamalibre/lamaste/server';

const AGENT_PACKAGE = '@lamalibre/e2e-agent-hosted-server';
const SERVER_PACKAGE = '@lamalibre/e2e-server-hosted-server';

/** An agent-hosted manifest the way Feria 0.3.1 ships one. */
const agentManifest = {
  name: 'e2e-agent-hosted',
  version: '0.1.0',
  hosting: 'agent',
  capabilities: ['plugin:e2e-agent-hosted:publish'],
  oidcClients: [
    {
      id: 'e2e-agent-hosted-cli',
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
      scopes: ['openid', 'profile', 'groups'],
      audience: ['https://e2e-agent-hosted.{domain}'],
      accessTokenClaims: ['groups', 'preferred_username'],
    },
    {
      id: 'e2e-agent-hosted-service',
      confidential: true,
      grantTypes: ['client_credentials'],
      scopes: ['registry_read'],
      audience: ['https://e2e-agent-hosted.{domain}'],
    },
  ],
};

let stateDir;

/** Write a package into `<stateDir>/node_modules/<name>`. */
async function writePackage(name, { manifest, main }) {
  const dir = path.join(stateDir, 'node_modules', ...name.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name, version: '0.1.0', type: 'module', main: 'index.js' }),
  );
  await writeFile(path.join(dir, 'index.js'), main);
  await writeFile(path.join(dir, 'lamaste-plugin.json'), JSON.stringify(manifest));
}

/** A registry row the way `installPlugin` builds it from a validated manifest. */
function registryEntry(packageName, manifest, status) {
  const parsed = validateManifest(manifest);
  return {
    name: parsed.name,
    packageName,
    version: parsed.version,
    description: parsed.description,
    capabilities: parsed.capabilities,
    packages: parsed.packages,
    panel: parsed.panel,
    config: parsed.config,
    modes: parsed.modes,
    hosting: parsed.hosting,
    status,
    installedAt: '2026-10-14T00:00:00.000Z',
  };
}

before(async () => {
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-hosted-'));
  process.env.LAMALIBRE_LAMASTE_STATE_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_DATA_DIR = stateDir;
  process.env.LAMALIBRE_LAMASTE_PKI_DIR = path.join(stateDir, 'pki');

  await writePackage(AGENT_PACKAGE, {
    manifest: { ...agentManifest, packages: { server: AGENT_PACKAGE } },
    main: [
      'globalThis.__agentHostedImported = true;',
      "throw new Error('an agent-hosted plugin must never be imported');",
      '',
    ].join('\n'),
  });
  await writePackage(SERVER_PACKAGE, {
    manifest: {
      name: 'e2e-server-hosted',
      version: '0.1.0',
      packages: { server: SERVER_PACKAGE },
    },
    main: [
      'export default async function plugin(fastify) {',
      "  fastify.get('/ping', async () => ({ ok: true }));",
      '}',
      '',
    ].join('\n'),
  });
});

after(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Manifest schema
// ---------------------------------------------------------------------------

test('manifest: hosting defaults to "server" and accepts "agent"', () => {
  const plain = validateManifest({ name: 'x', version: '1' });
  assert.equal(plain.hosting, 'server');
  assert.equal(isAgentHostedPlugin(plain), false);

  const agent = validateManifest(agentManifest);
  assert.equal(agent.hosting, 'agent');
  assert.equal(isAgentHostedPlugin(agent), true);
  assert.equal(agent.oidcClients.length, 2);
  assert.deepEqual(agent.capabilities, ['plugin:e2e-agent-hosted:publish']);

  assert.throws(() => validateManifest({ name: 'x', version: '1', hosting: 'local' }));
  // A registry entry from before 4.2 carries no hosting: a server plugin.
  assert.equal(isAgentHostedPlugin({}), false);
});

test('manifest: an agent-hosted plugin may not declare a panel', () => {
  const pages = { pages: [{ path: '/builds', title: 'Builds' }] };
  assert.throws(
    () => validateManifest({ ...agentManifest, panel: pages }),
    /An agent-hosted plugin .* cannot declare a panel/,
  );
  assert.throws(
    () => validateManifest({ ...agentManifest, panel: { label: 'Feria', icon: 'package' } }),
    /cannot declare a panel/,
  );
  assert.deepEqual(validateManifest({ ...agentManifest, panel: {} }).panel, {});

  // A server plugin keeps its pages (the multi-page shape used to be
  // stripped to {} by the panel union).
  const server = validateManifest({ name: 'x', version: '1', panel: pages });
  assert.deepEqual(server.panel, { pages: [{ path: '/builds', title: 'Builds' }] });
  assert.deepEqual(validateManifest({ name: 'x', version: '1', panel: { label: 'X' } }).panel, {
    label: 'X',
  });
});

// ---------------------------------------------------------------------------
// Plugin host
// ---------------------------------------------------------------------------

async function hostWith(entries) {
  const { default: Fastify } = await import('fastify');
  const { pluginHostPlugin } = await import('@lamalibre/lamaste');
  const app = Fastify({ logger: false });
  await app.register(pluginHostPlugin, {
    baseDir: stateDir,
    pluginsDataDir: path.join(stateDir, 'plugins'),
    readRegistry: async () => ({ plugins: entries }),
    auth: 'none',
  });
  await app.ready();
  return app;
}

test('plugin host: an enabled agent-hosted plugin is never imported and its route 404s', async () => {
  delete globalThis.__agentHostedImported;
  const app = await hostWith([
    registryEntry(
      AGENT_PACKAGE,
      { ...agentManifest, packages: { server: AGENT_PACKAGE } },
      'enabled',
    ),
    registryEntry(
      SERVER_PACKAGE,
      { name: 'e2e-server-hosted', version: '0.1.0', packages: { server: SERVER_PACKAGE } },
      'enabled',
    ),
  ]);
  try {
    assert.equal(globalThis.__agentHostedImported, undefined, 'the package was imported');

    // The host itself works: the server plugin next to it is mounted.
    const ping = await app.inject({ method: 'GET', url: '/e2e-server-hosted/ping' });
    assert.equal(ping.statusCode, 200);

    for (const url of [
      '/e2e-agent-hosted',
      '/e2e-agent-hosted/ping',
      '/e2e-agent-hosted/panel.js',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 404, url);
    }
  } finally {
    await app.close();
  }
});

test('plugin host: a disabled agent-hosted plugin is not imported either', async () => {
  const app = await hostWith([registryEntry(AGENT_PACKAGE, agentManifest, 'disabled')]);
  try {
    const res = await app.inject({ method: 'GET', url: '/e2e-agent-hosted/ping' });
    assert.equal(res.statusCode, 404);
    assert.equal(globalThis.__agentHostedImported, undefined);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Panel registry and OIDC clients
// ---------------------------------------------------------------------------

test('registry: hosting is stored, and a row without it reads as a server plugin', async () => {
  const { readPlugins, writePlugins } = await import('../src/lib/plugins.js');
  const legacy = registryEntry(
    SERVER_PACKAGE,
    { name: 'e2e-server-hosted', version: '0.1.0' },
    'enabled',
  );
  delete legacy.hosting;
  await writePlugins({ plugins: [registryEntry(AGENT_PACKAGE, agentManifest, 'enabled'), legacy] });

  const { plugins } = await readPlugins();
  const byName = Object.fromEntries(plugins.map((p) => [p.name, p]));
  assert.equal(byName['e2e-agent-hosted'].hosting, 'agent');
  assert.equal(byName['e2e-server-hosted'].hosting, 'server');
});

test('OIDC: an enabled agent-hosted plugin has its clients served, without being imported', async () => {
  const { writePlugins } = await import('../src/lib/plugins.js');
  const { planOidcClients, listPluginOidcClients } = await import('../src/lib/plugin-oidc.js');
  await writePlugins({ plugins: [registryEntry(AGENT_PACKAGE, agentManifest, 'enabled')] });

  const plan = await planOidcClients({ registryAuth: null });
  assert.deepEqual(
    plan.served.map((c) => [c.id, c.plugin]),
    [
      ['e2e-agent-hosted-cli', 'e2e-agent-hosted'],
      ['e2e-agent-hosted-service', 'e2e-agent-hosted'],
    ],
  );
  assert.deepEqual(plan.confidential, [
    { id: 'e2e-agent-hosted-service', plugin: 'e2e-agent-hosted' },
  ]);
  assert.deepEqual(plan.scopes, {});

  // What updateOidcProvider would write for it, on the plugin's domain
  // (the primary: no panel config is loaded here, so none is named).
  assert.deepEqual(
    plan.served.map((c) => c.domain),
    [null, null],
  );
  const served = plan.served.map((c) => ({ ...c, domain: 'relay.test' }));
  const section = buildOidcProviderSection([{ name: 'relay.test', members: [] }], 'hmac', served, {
    secretDigests: { 'e2e-agent-hosted-service': '$pbkdf2-sha512$310000$c2FsdA$a2V5' },
  });
  assert.deepEqual(
    section.clients.map((c) => c.client_id),
    ['e2e-agent-hosted-cli', 'e2e-agent-hosted-service'],
  );
  assert.deepEqual(section.claims_policies, {
    'e2e-agent-hosted-cli': { access_token: ['groups', 'preferred_username'] },
  });
  assert.ok(JSON.stringify(section).includes('https://e2e-agent-hosted.relay.test'));

  const listed = await listPluginOidcClients('e2e-agent-hosted');
  assert.deepEqual(
    listed.map((c) => [c.id, c.enabled]),
    [
      ['e2e-agent-hosted-cli', true],
      ['e2e-agent-hosted-service', true],
    ],
  );
  assert.equal(globalThis.__agentHostedImported, undefined);
});

test('OIDC: a plugin installed before refresh tokens were refused is served without them', async () => {
  const { writePlugins } = await import('../src/lib/plugins.js');
  const { planOidcClients } = await import('../src/lib/plugin-oidc.js');
  const manifestPath = path.join(
    stateDir,
    'node_modules',
    ...AGENT_PACKAGE.split('/'),
    'lamaste-plugin.json',
  );
  const current = await readFile(manifestPath, 'utf-8');
  const [cli, service] = agentManifest.oidcClients;
  const legacy = {
    ...JSON.parse(current),
    oidcClients: [
      {
        ...cli,
        grantTypes: [...cli.grantTypes, 'refresh_token'],
        scopes: [...cli.scopes, 'offline_access'],
      },
      service,
    ],
  };
  try {
    await writeFile(manifestPath, JSON.stringify(legacy));
    await writePlugins({ plugins: [registryEntry(AGENT_PACKAGE, agentManifest, 'enabled')] });
    const plan = await planOidcClients({ registryAuth: null });
    const served = plan.served.find((c) => c.id === 'e2e-agent-hosted-cli');
    assert.ok(served, 'the client is still served');
    assert.deepEqual(served.grantTypes, ['urn:ietf:params:oauth:grant-type:device_code']);
    assert.ok(!served.scopes.includes('offline_access'));
  } finally {
    await writeFile(manifestPath, current);
  }
});

test('OIDC: disabling serves none of its clients but keeps the confidential secret planned', async () => {
  const { writePlugins } = await import('../src/lib/plugins.js');
  const { planOidcClients } = await import('../src/lib/plugin-oidc.js');
  await writePlugins({ plugins: [registryEntry(AGENT_PACKAGE, agentManifest, 'disabled')] });

  const disabled = await planOidcClients({ registryAuth: null });
  assert.deepEqual(disabled.served, []);
  assert.deepEqual(disabled.confidential, [
    { id: 'e2e-agent-hosted-service', plugin: 'e2e-agent-hosted' },
  ]);

  // Uninstalled: nothing left to serve or to keep a secret for.
  await writePlugins({ plugins: [] });
  const gone = await planOidcClients({ registryAuth: null });
  assert.deepEqual(gone.served, []);
  assert.deepEqual(gone.confidential, []);
});

test('migration: plugins installed before 4.2 become server plugins', async () => {
  const { copyFile, readdir } = await import('node:fs/promises');
  const { DatabaseSync } = await import('node:sqlite');
  const { ensureMigrations } = await import('../src/lib/state-db.js');
  const migrations = new URL('../src/lib/migrations/state/', import.meta.url).pathname;
  const before42 = await mkdtemp(path.join(tmpdir(), 'lamaste-migrations-'));
  try {
    for (const file of await readdir(migrations)) {
      if (file < '0005') await copyFile(path.join(migrations, file), path.join(before42, file));
    }
    const db = new DatabaseSync(':memory:');
    await ensureMigrations(db, before42);
    db.prepare(
      `INSERT INTO plugins (name, package_name, version, status, installed_at)
       VALUES ('sync', '@lamalibre/sync-serverd', '2.0.0', 'enabled', '2026-01-01T00:00:00.000Z')`,
    ).run();

    await ensureMigrations(db, migrations);
    assert.equal(
      db.prepare('SELECT hosting FROM plugins WHERE name = ?').get('sync').hosting,
      'server',
    );
    db.close();
  } finally {
    await rm(before42, { recursive: true, force: true });
  }
});
