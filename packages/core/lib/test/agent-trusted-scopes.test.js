/**
 * Trusted publisher scopes on agents and the local plugin host: an agent
 * follows the list its relay sent (recorded by converge, reset to the
 * built-in scope when the relay sends none), installs a package of an
 * additional scope only through the relay's registry, and the local host
 * follows its user's list. Every refusal here happens before npm runs.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let home;
let agent;
const LABEL = 'vm1';

before(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-scopes-'));
  // Paths are derived from the home directory when the modules load.
  process.env.HOME = home;
  agent = await import('../dist/agent/index.js');
  const dir = path.join(home, '.lamalibre', 'lamaste', 'agents', LABEL);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(dir, 'config.json'),
    JSON.stringify({ panelUrl: 'https://203.0.113.10:9292', authMethod: 'p12' }),
  );
});

after(async () => {
  await rm(home, { recursive: true, force: true });
});

const configPath = () => path.join(home, '.lamalibre', 'lamaste', 'agents', LABEL, 'config.json');

test('an agent never synced trusts @lamalibre alone', async () => {
  assert.deepEqual(await agent.agentTrustedScopes(LABEL), ['@lamalibre']);
});

test("converge records the relay's list and resets it when the relay sends none", async () => {
  assert.deepEqual(
    await agent.recordTrustedScopes(LABEL, { trustedScopes: ['@lamalibre', '@example', '@Bad'] }),
    [],
  );
  assert.deepEqual(JSON.parse(await readFile(configPath(), 'utf8')).trustedScopes, [
    '@lamalibre',
    '@example',
  ]);
  assert.deepEqual(await agent.agentTrustedScopes(LABEL), ['@lamalibre', '@example']);

  // An older (or rolled back) relay: no list — fail closed.
  await agent.recordTrustedScopes(LABEL, {});
  assert.deepEqual(await agent.agentTrustedScopes(LABEL), ['@lamalibre']);

  await agent.recordTrustedScopes(LABEL, { trustedScopes: ['@lamalibre', '@example'] });
});

test('an agent refuses an untrusted scope, and an additional one without the relay registry', async () => {
  const cfg = agent.agentPluginConfig(LABEL);
  await assert.rejects(
    agent.installPlugin(cfg, '@other/x-server'),
    /not a trusted publisher scope/,
  );
  await assert.rejects(
    agent.installPlugin(cfg, '@lamalibre-evil/x-server'),
    /not a trusted publisher scope/,
  );
  await assert.rejects(agent.installPlugin(cfg, '@LamaLibre/x-server'), /Invalid package name/);
  // Trusted, but npm would resolve it through this machine's configuration.
  await assert.rejects(agent.installPlugin(cfg, '@example/x-server'), /relay's registry/);
  await assert.rejects(
    agent.installPlugin(cfg, '@example/x-server', {
      npmrc: { registryUrl: 'https://registry.example.test/', token: 't', scope: '@lamalibre' },
    }),
    /relay's registry/,
  );
});

test('the local host follows its own list, changed only through its functions', async () => {
  assert.deepEqual(await agent.localTrustedScopes(), ['@lamalibre']);
  await assert.rejects(agent.addLocalTrustedScope('@lamalibre'), { code: 'builtin_scope' });
  await assert.rejects(agent.addLocalTrustedScope('@Example'), { code: 'invalid_scope' });
  assert.deepEqual(await agent.addLocalTrustedScope('@example'), ['@lamalibre', '@example']);
  await assert.rejects(agent.addLocalTrustedScope('@example'), { code: 'scope_already_trusted' });
  const file = agent.localTrustedScopesFile();
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { additional: ['@example'] });

  // A file not written by Lamaste never widens trust.
  await writeFile(file, JSON.stringify({ additional: ['@example', '@example'] }));
  assert.deepEqual(await agent.localTrustedScopes(), ['@lamalibre']);
  await writeFile(file, JSON.stringify({ additional: ['@example'] }));

  // A local plugin from the scope keeps it trusted.
  await writeFile(
    path.join(path.dirname(file), 'plugins.json'),
    JSON.stringify({ plugins: [{ name: 'x', packageName: '@example/x-server' }] }),
  );
  await assert.rejects(agent.removeLocalTrustedScope('@example'), { code: 'scope_in_use' });
  await writeFile(path.join(path.dirname(file), 'plugins.json'), JSON.stringify({ plugins: [] }));
  assert.deepEqual(await agent.removeLocalTrustedScope('@example'), ['@lamalibre']);
  await assert.rejects(agent.removeLocalTrustedScope('@example'), { code: 'scope_not_trusted' });

  const cfg = agent.localPluginConfig();
  await assert.rejects(agent.installPlugin(cfg, '@example/x-server'), /not a trusted/);
});
