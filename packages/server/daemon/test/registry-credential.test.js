/**
 * The panel's registry (Feria) credential: stored at 0600 without ever
 * being echoed back, verified against the registry before storage, used to
 * broker one-hour agent tokens, and used to revoke a user's tokens when a
 * feria-* group is lost. The registry is a stand-in HTTP server speaking
 * Feria's auth contract.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  brokerAgentRegistryToken,
  clearRegistryCredentialConfig,
  lostFeriaGroups,
  readRegistryCredentialConfig,
  registryCredentialPath,
  revokeRegistryTokensForOwner,
  summariseRegistryCredential,
  verifyRegistryCredential,
  writeRegistryCredentialConfig,
  RegistryCredentialError,
} from '@lamalibre/lamaste/server';
import { renderInstallNpmrc, withInstallNpmrc, npmNerfDart } from '@lamalibre/lamaste/agent';

const ADMIN_TOKEN = 'feria_adminadminadminadminadminadmin';
const READ_TOKEN = 'feria_readreadreadreadreadreadreadread';

let server;
let registryUrl;
let requests;
let stateDir;

before(async () => {
  requests = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const auth = req.headers.authorization ?? '';
      const token = auth.replace(/^Bearer\s+/i, '');
      requests.push({ method: req.method, url: req.url, token, body });
      const json = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (token !== ADMIN_TOKEN && token !== READ_TOKEN)
        return json(401, { error: 'authentication required' });
      const scopes = token === ADMIN_TOKEN ? ['read', 'publish', 'admin'] : ['read'];
      if (req.method === 'GET' && req.url === '/-/whoami') {
        return json(200, { username: 'machine:lamaste', owner: 'machine:lamaste', scopes });
      }
      if (req.method === 'POST' && req.url === '/-/feria/broker/agent-token') {
        if (!scopes.includes('admin'))
          return json(403, { error: 'brokering requires the admin scope' });
        const { agentLabel, expiresIn } = JSON.parse(body);
        return json(201, {
          id: 'tok-1',
          owner: `agent:${agentLabel}`,
          kind: 'agent',
          scopes: ['read'],
          label: `agent ${agentLabel}`,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          createdBy: 'machine:lamaste',
          token: `feria_agent_${agentLabel}_${expiresIn}`,
        });
      }
      if (req.method === 'DELETE' && req.url.startsWith('/-/feria/tokens?owner=')) {
        const owner = decodeURIComponent(req.url.split('owner=')[1]);
        return json(200, { revoked: owner === 'user:alice' ? [{ id: 'a' }, { id: 'b' }] : [] });
      }
      json(404, { error: 'not found' });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  registryUrl = `http://127.0.0.1:${server.address().port}`;
  stateDir = await mkdtemp(path.join(tmpdir(), 'lamaste-regcred-'));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(stateDir, { recursive: true, force: true });
});

test('config file round-trips at 0600 and the summary never carries the token', async () => {
  assert.equal(await readRegistryCredentialConfig(stateDir), null);
  const config = {
    provider: 'feria',
    registryUrl: `${registryUrl}/`,
    token: ADMIN_TOKEN,
    scope: '@lamalibre',
    owner: 'machine:lamaste',
    configuredAt: '2026-10-13T00:00:00.000Z',
  };
  await writeRegistryCredentialConfig(stateDir, config);
  assert.equal((await stat(registryCredentialPath(stateDir))).mode & 0o777, 0o600);
  assert.deepEqual(await readRegistryCredentialConfig(stateDir), config);
  const summary = summariseRegistryCredential(config);
  assert.ok(!JSON.stringify(summary).includes(ADMIN_TOKEN));
  assert.equal(summary.owner, 'machine:lamaste');
  assert.equal(await clearRegistryCredentialConfig(stateDir), true);
  assert.equal(await clearRegistryCredentialConfig(stateDir), false);
  await assert.rejects(
    writeRegistryCredentialConfig(stateDir, { ...config, token: 'npm_notours' }),
  );
});

test('verifyRegistryCredential requires a valid token with the admin scope', async () => {
  const ok = await verifyRegistryCredential({ registryUrl, token: ADMIN_TOKEN });
  assert.deepEqual(ok, { owner: 'machine:lamaste', scopes: ['read', 'publish', 'admin'] });
  await assert.rejects(verifyRegistryCredential({ registryUrl, token: READ_TOKEN }), (err) => {
    assert.ok(err instanceof RegistryCredentialError);
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /admin scope/);
    return true;
  });
  await assert.rejects(
    verifyRegistryCredential({ registryUrl, token: 'feria_unknownunknownunknown' }),
    (err) => {
      assert.equal(err.statusCode, 502);
      return true;
    },
  );
  await assert.rejects(
    verifyRegistryCredential({ registryUrl: 'http://127.0.0.1:1', token: ADMIN_TOKEN }),
    /unreachable/,
  );
});

test('brokerAgentRegistryToken returns a one-hour read token owned by the agent', async () => {
  const config = {
    provider: 'feria',
    registryUrl,
    token: ADMIN_TOKEN,
    scope: '@lamalibre',
    configuredAt: new Date().toISOString(),
  };
  const cred = await brokerAgentRegistryToken(config, 'r730-app-1');
  assert.equal(cred.registryUrl, `${registryUrl}/`);
  assert.equal(cred.scope, '@lamalibre');
  assert.equal(cred.token, 'feria_agent_r730-app-1_1h');
  assert.equal(cred.tokenId, 'tok-1');
  const sent = requests.at(-1);
  assert.equal(sent.token, ADMIN_TOKEN);
  assert.deepEqual(JSON.parse(sent.body), { agentLabel: 'r730-app-1', expiresIn: '1h' });

  await assert.rejects(
    brokerAgentRegistryToken(config, 'plugin-agent:x:y'),
    /cannot hold a registry token/,
  );
  await assert.rejects(
    brokerAgentRegistryToken({ ...config, token: READ_TOKEN }, 'r730-app-1'),
    (err) => {
      assert.equal(err.statusCode, 502); // our credential is the problem, not the caller
      return true;
    },
  );
});

test('revokeRegistryTokensForOwner and lostFeriaGroups', async () => {
  const config = {
    provider: 'feria',
    registryUrl,
    token: ADMIN_TOKEN,
    scope: '@lamalibre',
    configuredAt: new Date().toISOString(),
  };
  assert.equal(await revokeRegistryTokensForOwner(config, 'user:alice'), 2);
  assert.equal(await revokeRegistryTokensForOwner(config, 'user:bob'), 0);
  assert.equal(decodeURIComponent(requests.at(-1).url), '/-/feria/tokens?owner=user:bob');

  assert.deepEqual(
    lostFeriaGroups(['admins', 'feria-publishers', 'feria-readers'], ['admins', 'feria-readers']),
    ['feria-publishers'],
  );
  assert.deepEqual(lostFeriaGroups(['feria-readers'], ['feria-readers', 'feria-admins']), []);
  assert.deepEqual(lostFeriaGroups(['admins'], []), []);
  assert.deepEqual(lostFeriaGroups(['feria-admins'], []), ['feria-admins']);
});

test('withInstallNpmrc writes an isolated 0600 userconfig for npm and removes it afterwards', async () => {
  const npmrc = { registryUrl: 'https://feria.samplepark.tr', token: 'feria_agenttoken' };
  assert.equal(npmNerfDart('https://feria.samplepark.tr'), '//feria.samplepark.tr/');
  assert.equal(
    renderInstallNpmrc(npmrc),
    '@lamalibre:registry=https://feria.samplepark.tr/\n//feria.samplepark.tr/:_authToken=feria_agenttoken\n',
  );

  let seenFile;
  await withInstallNpmrc(stateDir, npmrc, async (env) => {
    seenFile = env.npm_config_userconfig;
    assert.ok(seenFile.startsWith(path.join(stateDir, '.npmrc-install-')));
    assert.equal((await stat(seenFile)).mode & 0o777, 0o600);
    assert.equal(await readFile(seenFile, 'utf-8'), renderInstallNpmrc(npmrc));
  });
  await assert.rejects(stat(seenFile), /ENOENT/);

  // Removed on failure too, and absent entirely without a credential.
  await assert.rejects(
    withInstallNpmrc(stateDir, npmrc, async (env) => {
      seenFile = env.npm_config_userconfig;
      throw new Error('boom');
    }),
    /boom/,
  );
  await assert.rejects(stat(seenFile), /ENOENT/);
  await withInstallNpmrc(stateDir, undefined, async (env) => assert.deepEqual(env, {}));
  assert.throws(() => renderInstallNpmrc({ ...npmrc, scope: 'bad scope' }), /Invalid npm scope/);
});
