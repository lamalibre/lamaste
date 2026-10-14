/**
 * An agent-hosted plugin (`hosting: "agent"`) installed in an agent's plugin
 * registry is never loaded by it: the agent daemon serves no panel bundle
 * for it (the bundle is code the agent UI would evaluate), while a server
 * plugin's bundle next to it is served as before.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readPluginBundle } from '@lamalibre/lamaste/agent';

let dataDir;
let cfg;

async function writePackage(name) {
  const dir = path.join(dataDir, 'node_modules', ...name.split('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.1.0' }));
  await writeFile(path.join(dir, 'panel.js'), `/* bundle of ${name} */\n`);
}

function entry(name, packageName, hosting) {
  return {
    name,
    packageName,
    version: '0.1.0',
    description: '',
    capabilities: [],
    packages: { server: packageName },
    panel: {},
    modes: ['server', 'agent'],
    config: {},
    ...(hosting ? { hosting } : {}),
    status: 'enabled',
    installedAt: '2026-10-14T00:00:00.000Z',
  };
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'lamaste-agent-hosted-'));
  cfg = {
    dataDir,
    registryPath: path.join(dataDir, 'plugins.json'),
    pluginsDir: path.join(dataDir, 'plugins'),
    requiredMode: 'agent',
  };
  await writePackage('@lamalibre/e2e-agent-hosted-server');
  await writePackage('@lamalibre/e2e-server-hosted-server');
  await writeFile(
    cfg.registryPath,
    JSON.stringify({
      plugins: [
        entry('e2e-agent-hosted', '@lamalibre/e2e-agent-hosted-server', 'agent'),
        // Written before 4.2: no hosting, a server plugin.
        entry('e2e-server-hosted', '@lamalibre/e2e-server-hosted-server'),
      ],
    }),
  );
});

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test('readPluginBundle refuses an agent-hosted plugin', async () => {
  await assert.rejects(readPluginBundle(cfg, 'e2e-agent-hosted'), /agent-hosted/);
});

test('readPluginBundle still serves a server plugin without a hosting field', async () => {
  assert.equal(
    await readPluginBundle(cfg, 'e2e-server-hosted'),
    '/* bundle of @lamalibre/e2e-server-hosted-server */\n',
  );
});
