/**
 * Where @lamalibre packages install from: the shared case table (also read
 * by the desktop's branding.rs and lamaste-priv's tests), the npm forms,
 * and npm's own configuration read through `npm config get`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  LAMALIBRE_REGISTRY_URL,
  LAMALIBRE_REGISTRY_CONFIG_KEY,
  LAMALIBRE_REGISTRY_ENV,
  LamalibreRegistryError,
  chooseLamalibreRegistry,
  isPublicNpmRegistry,
  lamalibreRegistryArg,
  lamalibreRegistryEnv,
} from '../dist/index.js';
import {
  lamalibreRegistryNpmArg,
  lamalibreRegistryNpmEnv,
  resolveLamalibreRegistry,
} from '../dist/agent/index.js';
import { resolveLamalibreRegistry as resolveFromServer } from '../dist/server/index.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/lamalibre-registry-cases.json', import.meta.url), 'utf8'),
);

test('the default is the hosted Feria, and the fixture agrees', () => {
  assert.equal(LAMALIBRE_REGISTRY_URL, 'https://feria.codelama.com.tr/');
  assert.equal(fixture.default, LAMALIBRE_REGISTRY_URL);
});

test('every case of the shared table', () => {
  for (const c of fixture.cases) {
    if (c.refused) {
      assert.throws(
        () => chooseLamalibreRegistry(c.configured),
        LamalibreRegistryError,
        JSON.stringify(c.configured),
      );
    } else {
      assert.equal(chooseLamalibreRegistry(c.configured), c.registry, JSON.stringify(c.configured));
    }
  }
  assert.equal(chooseLamalibreRegistry(undefined), LAMALIBRE_REGISTRY_URL);
  assert.equal(chooseLamalibreRegistry(null), LAMALIBRE_REGISTRY_URL);
});

test('a refusal names the public registry and the way out, never a credential', () => {
  try {
    chooseLamalibreRegistry('https://registry.npmjs.org/');
    assert.fail('expected a refusal');
  } catch (err) {
    assert.ok(err instanceof LamalibreRegistryError);
    assert.equal(err.code, 'lamalibre_registry_refused');
    assert.match(err.message, /registry\.npmjs\.org/);
    assert.match(err.message, /feria\.codelama\.com\.tr/);
  }
  assert.throws(
    () => chooseLamalibreRegistry('https://user:secret@feria.example.org/'),
    (err) => !err.message.includes('secret'),
  );
});

test('the npm forms', () => {
  assert.equal(LAMALIBRE_REGISTRY_CONFIG_KEY, '@lamalibre:registry');
  assert.equal(LAMALIBRE_REGISTRY_ENV, 'npm_config_@lamalibre:registry');
  assert.equal(
    lamalibreRegistryArg('https://feria.codelama.com.tr/'),
    '--@lamalibre:registry=https://feria.codelama.com.tr/',
  );
  assert.deepEqual(lamalibreRegistryEnv('http://localhost:4873/'), {
    'npm_config_@lamalibre:registry': 'http://localhost:4873/',
  });
  assert.equal(isPublicNpmRegistry('https://registry.npmjs.org/x'), true);
  assert.equal(isPublicNpmRegistry('https://feria.codelama.com.tr/'), false);
  assert.equal(isPublicNpmRegistry('not a url'), false);
});

/**
 * npm as a configuration reader, isolated from this machine's npmrc files:
 * a userconfig of our own and a global config that does not exist.
 */
function isolated(userconfigText) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lamalibre-registry-test-'));
  const userconfig = path.join(dir, 'npmrc');
  writeFileSync(userconfig, userconfigText);
  return {
    dir,
    env: {
      npm_config_userconfig: userconfig,
      npm_config_globalconfig: path.join(dir, 'no-global-npmrc'),
    },
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('nothing configured: the hosted Feria', async () => {
  const t = isolated('');
  try {
    assert.equal(
      await resolveLamalibreRegistry({ cwd: t.dir, env: t.env }),
      LAMALIBRE_REGISTRY_URL,
    );
    assert.equal(await resolveFromServer({ cwd: t.dir, env: t.env }), LAMALIBRE_REGISTRY_URL);
    assert.equal(
      await lamalibreRegistryNpmArg({ cwd: t.dir, env: t.env }),
      `--@lamalibre:registry=${LAMALIBRE_REGISTRY_URL}`,
    );
  } finally {
    t.done();
  }
});

test('a development Feria in npm configuration wins', async () => {
  const t = isolated('@lamalibre:registry=http://localhost:4873\n');
  try {
    assert.deepEqual(await lamalibreRegistryNpmEnv({ cwd: t.dir, env: t.env }), {
      'npm_config_@lamalibre:registry': 'http://localhost:4873/',
    });
  } finally {
    t.done();
  }
});

test("a project .npmrc in the install's directory counts", async () => {
  const t = isolated('');
  try {
    writeFileSync(path.join(t.dir, '.npmrc'), '@lamalibre:registry=http://127.0.0.1:4873/\n');
    writeFileSync(path.join(t.dir, 'package.json'), '{"private":true}\n');
    assert.equal(
      await resolveLamalibreRegistry({ cwd: t.dir, env: t.env }),
      'http://127.0.0.1:4873/',
    );
  } finally {
    t.done();
  }
});

test('npmjs in npm configuration is refused', async () => {
  const t = isolated('@lamalibre:registry=https://registry.npmjs.org/\n');
  try {
    await assert.rejects(
      resolveLamalibreRegistry({ cwd: t.dir, env: t.env }),
      LamalibreRegistryError,
    );
  } finally {
    t.done();
  }
});

test('an npm that cannot run fails the call', async () => {
  await assert.rejects(
    resolveLamalibreRegistry({ npm: '/nonexistent/npm' }),
    /npm config get @lamalibre:registry failed/,
  );
});

test('agent and local plugin installs without a credential route @lamalibre (withInstallNpmrc)', async () => {
  const { withInstallNpmrc } = await import('../dist/agent/index.js');
  const saved = {
    userconfig: process.env.npm_config_userconfig,
    globalconfig: process.env.npm_config_globalconfig,
    scope: process.env['npm_config_@lamalibre:registry'],
  };
  const t = isolated('');
  try {
    Object.assign(process.env, t.env);
    delete process.env['npm_config_@lamalibre:registry'];
    await withInstallNpmrc(t.dir, undefined, async (env) => {
      assert.deepEqual(env, { 'npm_config_@lamalibre:registry': LAMALIBRE_REGISTRY_URL });
    });
    writeFileSync(t.env.npm_config_userconfig, '@lamalibre:registry=http://localhost:4873\n');
    await withInstallNpmrc(t.dir, undefined, async (env) => {
      assert.deepEqual(env, { 'npm_config_@lamalibre:registry': 'http://localhost:4873/' });
    });
    // With a credential the isolated userconfig routes the scope instead.
    await withInstallNpmrc(
      t.dir,
      { registryUrl: 'https://feria.example.org/', token: 't' },
      async (env) => assert.deepEqual(Object.keys(env), ['npm_config_userconfig']),
    );
  } finally {
    for (const [key, name] of [
      ['userconfig', 'npm_config_userconfig'],
      ['globalconfig', 'npm_config_globalconfig'],
      ['scope', 'npm_config_@lamalibre:registry'],
    ]) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
    t.done();
  }
});
