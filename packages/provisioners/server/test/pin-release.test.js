/**
 * create-lamaste@X installs release X's own libraries on the relay: the
 * vendored manifests pin every dependency on a workspace package exactly.
 * Unpinned, 4.6.0's serverd resolved core 4.7.0 (`^4.6.0`) and did not start.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pinWorkspaceDependencies, workspaceVersions } from '../scripts/pin-release.js';

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('workspace dependencies are pinned; third-party ranges stay', () => {
  const versions = new Map([
    ['@lamalibre/lamaste', '4.7.0'],
    ['@lamalibre/lamaste-tickets', '4.7.0'],
  ]);
  const pinned = pinWorkspaceDependencies(
    {
      name: '@lamalibre/lamaste-serverd',
      dependencies: { '@lamalibre/lamaste': '^4.7.0', fastify: '^5.2.0' },
      peerDependencies: { '@lamalibre/lamaste-tickets': '4.7.0' },
    },
    versions,
  );
  assert.deepEqual(pinned.dependencies, { '@lamalibre/lamaste': '4.7.0', fastify: '^5.2.0' });
  assert.deepEqual(pinned.peerDependencies, { '@lamalibre/lamaste-tickets': '4.7.0' });
});

test('a range the workspace version does not satisfy is refused', () => {
  const versions = new Map([['@lamalibre/lamaste', '4.7.0']]);
  for (const range of ['^5.0.0', '^4.8.0', '3.9.0', '~4.6.0']) {
    assert.throws(
      () =>
        pinWorkspaceDependencies(
          { name: 'x', dependencies: { '@lamalibre/lamaste': range } },
          versions,
        ),
      /the workspace has 4\.7\.0/,
      range,
    );
  }
  assert.equal(
    pinWorkspaceDependencies(
      { name: 'x', dependencies: { '@lamalibre/lamaste': '^4.6.0' } },
      versions,
    ).dependencies['@lamalibre/lamaste'],
    '4.7.0',
  );
});

test('the real workspaces: what create-lamaste vendors names this release exactly', async () => {
  const versions = await workspaceVersions(monorepoRoot);
  const core = versions.get('@lamalibre/lamaste');
  assert.ok(core, 'the core library is a workspace');
  for (const dir of ['packages/server/daemon', 'packages/server/cli', 'packages/sdks/gatekeeper']) {
    const { default: manifest } = await import(join(monorepoRoot, dir, 'package.json'), {
      with: { type: 'json' },
    });
    const pinned = pinWorkspaceDependencies(manifest, versions);
    for (const [name, version] of Object.entries(pinned.dependencies ?? {})) {
      if (versions.has(name)) assert.equal(version, versions.get(name), `${dir}: ${name}`);
    }
  }
});
