/**
 * The panel's registry (Feria) credential: stored at 0600 without ever
 * being echoed back, verified against the registry before storage, used to
 * broker one-hour agent tokens, and used to revoke a user's tokens when a
 * feria-* group is lost. Both authentication kinds are exercised: a pasted
 * token, and the panel's own `lamaste-server` OIDC client (client
 * credentials at a stand-in Authelia → Feria login). The registry is a
 * stand-in HTTP server speaking Feria's auth contract.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AgentTokenBroker,
  RegistryServiceTokenCache,
  TOKEN_REFRESH_MARGIN_MS,
  brokerAgentRegistryToken,
  clearRegistryCredentialConfig,
  lamasteServerOidcClient,
  lostFeriaGroups,
  migrateRegistryCredentialConfig,
  obtainRegistryServiceToken,
  readRegistryCredentialConfig,
  registryAudience,
  registryCredentialPath,
  requestClientCredentialsToken,
  revokeRegistryTokensForOwner,
  summariseRegistryCredential,
  verifyRegistryCredential,
  writeRegistryCredentialConfig,
  RegistryCredentialError,
} from '@lamalibre/lamaste/server';
import { renderInstallNpmrc, withInstallNpmrc, npmNerfDart } from '@lamalibre/lamaste/agent';

const ADMIN_TOKEN = 'feria_adminadminadminadminadminadmin';
const READ_TOKEN = 'feria_readreadreadreadreadreadreadread';
const CLIENT_SECRET = 'c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2U';

let server;
let registryUrl;
let requests;
let stateDir;
/** What the stand-in Feria does with a login: `admin` grants the admin scope, `readonly` only read. */
let loginPolicy = 'admin';
/** What the stand-in Authelia answers; set by tests. */
let autheliaMode = 'ok';

const tokenConfig = () => ({
  provider: 'feria',
  registryUrl,
  scope: '@lamalibre',
  auth: { kind: 'token', token: ADMIN_TOKEN },
  configuredAt: new Date().toISOString(),
});

const oidcConfig = () => ({
  provider: 'feria',
  registryUrl,
  scope: '@lamalibre',
  auth: { kind: 'oidc', clientId: 'lamaste-server' },
  configuredAt: new Date().toISOString(),
});

/** A JWT-shaped assertion the stand-in Authelia mints and the stand-in Feria "verifies". */
function fakeJwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'lamaste-oidc' })}.${b64(claims)}.sig`;
}

before(async () => {
  requests = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const auth = req.headers.authorization ?? '';
      const token = auth.replace(/^Bearer\s+/i, '');
      requests.push({ method: req.method, url: req.url, token, body, headers: req.headers });
      const json = (status, payload) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      // --- stand-in Authelia token endpoint ---
      if (req.method === 'POST' && req.url === '/api/oidc/token') {
        if (autheliaMode === 'down') return json(500, { error: 'server_error' });
        const [id, secret] = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64')
          .toString()
          .split(':')
          .map(decodeURIComponent);
        if (id !== 'lamaste-server' || secret !== CLIENT_SECRET) {
          return json(401, {
            error: 'invalid_client',
            error_description: 'Client authentication failed',
          });
        }
        const form = new URLSearchParams(body);
        if (form.get('grant_type') !== 'client_credentials')
          return json(400, { error: 'unsupported_grant_type' });
        const issuer = `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`;
        const now = Math.floor(Date.now() / 1000);
        return json(200, {
          access_token: fakeJwt({
            iss: issuer,
            sub: 'lamaste-server',
            client_id: 'lamaste-server',
            aud: [form.get('audience')],
            scope: form.get('scope'),
            iat: now,
            exp: now + 3600,
          }),
          token_type: 'bearer',
          expires_in: 3600,
          scope: form.get('scope'),
        });
      }

      // --- stand-in Feria ---
      if (req.method === 'POST' && req.url === '/-/feria/login') {
        const { assertion } = JSON.parse(body);
        const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
        if (claims.iss !== 'https://auth.samplepark.tr')
          return json(401, { error: 'assertion issuer is not trusted' });
        if (claims.client_id !== 'lamaste-server') return json(403, { error: 'login refused' });
        const scopes = loginPolicy === 'admin' ? ['read', 'publish', 'admin'] : ['read'];
        return json(201, {
          id: 'ci-1',
          owner: 'ci:auth.samplepark.tr/lamaste-server',
          kind: 'ci',
          scopes,
          label: 'lamaste-server',
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          createdBy: 'login',
          token: `feria_ci_${scopes.length}`,
        });
      }
      const ciToken = /^feria_ci_(\d)$/.exec(token);
      const known = token === ADMIN_TOKEN || token === READ_TOKEN || ciToken;
      if (!known) return json(401, { error: 'authentication required' });
      const scopes =
        token === ADMIN_TOKEN || (ciToken && ciToken[1] === '3')
          ? ['read', 'publish', 'admin']
          : ['read'];
      const owner = ciToken
        ? 'ci:auth.samplepark.tr/lamaste-server'
        : token === ADMIN_TOKEN
          ? 'machine:lamaste'
          : 'machine:reader';
      if (req.method === 'GET' && req.url === '/-/whoami') {
        return json(200, { username: owner, owner, scopes });
      }
      if (req.method === 'POST' && req.url === '/-/feria/broker/agent-token') {
        if (!scopes.includes('admin'))
          return json(403, { error: 'brokering requires the admin scope' });
        const { agentLabel, expiresIn } = JSON.parse(body);
        return json(201, {
          id: `tok-${requests.length}`,
          owner: `agent:${agentLabel}`,
          kind: 'agent',
          scopes: ['read'],
          label: `agent ${agentLabel}`,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          createdBy: owner,
          token: `feria_agent_${agentLabel}_${expiresIn}`,
        });
      }
      if (req.method === 'DELETE' && req.url.startsWith('/-/feria/tokens?owner=')) {
        const who = decodeURIComponent(req.url.split('owner=')[1]);
        return json(200, { revoked: who === 'user:alice' ? [{ id: 'a' }, { id: 'b' }] : [] });
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

/** Deps for the oidc chain: Authelia is the same stand-in server. */
const oidcDeps = () => ({
  oidc: {
    domain: 'samplepark.tr',
    clientSecret: CLIENT_SECRET,
    tokenEndpoint: `${registryUrl}/api/oidc/token`,
  },
});

test('config file round-trips at 0600 and the summary never carries a token', async () => {
  assert.equal(await readRegistryCredentialConfig(stateDir), null);
  const config = { ...tokenConfig(), registryUrl: `${registryUrl}/`, owner: 'machine:lamaste' };
  await writeRegistryCredentialConfig(stateDir, config);
  assert.equal((await stat(registryCredentialPath(stateDir))).mode & 0o777, 0o600);
  assert.deepEqual(await readRegistryCredentialConfig(stateDir), config);
  const summary = summariseRegistryCredential(config);
  assert.ok(!JSON.stringify(summary).includes(ADMIN_TOKEN));
  assert.equal(summary.owner, 'machine:lamaste');
  assert.equal(summary.auth, 'token');
  assert.equal(summary.clientId, null);

  const oidc = { ...oidcConfig(), owner: 'ci:auth.samplepark.tr/lamaste-server' };
  await writeRegistryCredentialConfig(stateDir, oidc);
  assert.deepEqual(await readRegistryCredentialConfig(stateDir), oidc);
  assert.deepEqual(summariseRegistryCredential(oidc), {
    provider: 'feria',
    registryUrl,
    scope: '@lamalibre',
    auth: 'oidc',
    clientId: 'lamaste-server',
    owner: 'ci:auth.samplepark.tr/lamaste-server',
    configuredAt: oidc.configuredAt,
  });

  assert.equal(await clearRegistryCredentialConfig(stateDir), true);
  assert.equal(await clearRegistryCredentialConfig(stateDir), false);
  await assert.rejects(
    writeRegistryCredentialConfig(stateDir, {
      ...tokenConfig(),
      auth: { kind: 'token', token: 'npm_notours' },
    }),
  );
  await assert.rejects(
    writeRegistryCredentialConfig(stateDir, {
      ...oidcConfig(),
      auth: { kind: 'oidc', clientId: 'someone-else' },
    }),
  );
});

test("the first release's on-disk shape (top-level token) is read as auth.kind token", async () => {
  const legacy = {
    provider: 'feria',
    registryUrl: `${registryUrl}/`,
    token: ADMIN_TOKEN,
    scope: '@lamalibre',
    owner: 'machine:lamaste',
    configuredAt: '2026-10-13T00:00:00.000Z',
  };
  assert.deepEqual(migrateRegistryCredentialConfig(legacy), {
    provider: 'feria',
    registryUrl: `${registryUrl}/`,
    scope: '@lamalibre',
    owner: 'machine:lamaste',
    configuredAt: '2026-10-13T00:00:00.000Z',
    auth: { kind: 'token', token: ADMIN_TOKEN },
  });
  // Written by 4.0.x, read by this version — transparently.
  await writeFile(registryCredentialPath(stateDir), JSON.stringify(legacy), { mode: 0o600 });
  const read = await readRegistryCredentialConfig(stateDir);
  assert.equal(read.auth.kind, 'token');
  assert.equal(read.auth.token, ADMIN_TOKEN);
  assert.ok(!('token' in read));
  await clearRegistryCredentialConfig(stateDir);

  assert.throws(
    () => migrateRegistryCredentialConfig({ provider: 'feria', registryUrl: 'x' }),
    (err) => err instanceof RegistryCredentialError && err.statusCode === 500,
  );
  await writeFile(registryCredentialPath(stateDir), '{"provider":"feria"}', { mode: 0o600 });
  await assert.rejects(readRegistryCredentialConfig(stateDir), /registry-credential\.json/);
  await clearRegistryCredentialConfig(stateDir);
});

test('verifyRegistryCredential (token) requires a valid token with the admin scope', async () => {
  const ok = await verifyRegistryCredential({
    registryUrl,
    auth: { kind: 'token', token: ADMIN_TOKEN },
  });
  assert.deepEqual(ok, { owner: 'machine:lamaste', scopes: ['read', 'publish', 'admin'] });
  await assert.rejects(
    verifyRegistryCredential({ registryUrl, auth: { kind: 'token', token: READ_TOKEN } }),
    (err) => {
      assert.ok(err instanceof RegistryCredentialError);
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /admin scope/);
      return true;
    },
  );
  await assert.rejects(
    verifyRegistryCredential({
      registryUrl,
      auth: { kind: 'token', token: 'feria_unknownunknownunknown' },
    }),
    (err) => {
      assert.equal(err.statusCode, 502);
      return true;
    },
  );
  await assert.rejects(
    verifyRegistryCredential({
      registryUrl: 'http://127.0.0.1:1',
      auth: { kind: 'token', token: ADMIN_TOKEN },
    }),
    /unreachable/,
  );
});

test('the lamaste-server client is confidential, client-credentials only, with the registry as audience', () => {
  const client = lamasteServerOidcClient('https://feria.samplepark.tr/');
  assert.equal(client.id, 'lamaste-server');
  assert.equal(client.plugin, 'lamaste');
  assert.equal(client.confidential, true);
  assert.deepEqual(client.grantTypes, ['client_credentials']);
  assert.deepEqual(client.scopes, ['lamaste.registry']);
  assert.deepEqual(client.audience, ['https://feria.samplepark.tr']);
  assert.equal(client.accessTokenSignedResponseAlg, 'RS256');
  assert.equal(client.authorizationPolicy, 'one_factor');
  assert.equal(registryAudience('https://feria.samplepark.tr'), 'https://feria.samplepark.tr');
  assert.equal(registryAudience('https://panel.x.tr/api/feria/'), 'https://panel.x.tr/api/feria');
});

test('requestClientCredentialsToken: client_secret_basic, forwarded headers make the issuer https://auth.<domain>', async () => {
  const result = await requestClientCredentialsToken({
    tokenEndpoint: `${registryUrl}/api/oidc/token`,
    issuer: 'https://auth.samplepark.tr',
    clientId: 'lamaste-server',
    clientSecret: CLIENT_SECRET,
    scope: 'lamaste.registry',
    audience: 'https://feria.samplepark.tr',
  });
  const sent = requests.at(-1);
  assert.equal(sent.headers['x-forwarded-proto'], 'https');
  assert.equal(sent.headers['x-forwarded-host'], 'auth.samplepark.tr');
  assert.match(sent.headers.authorization, /^Basic /);
  assert.equal(
    sent.body,
    'grant_type=client_credentials&scope=lamaste.registry&audience=https%3A%2F%2Fferia.samplepark.tr',
  );
  const claims = JSON.parse(Buffer.from(result.accessToken.split('.')[1], 'base64url').toString());
  assert.equal(claims.iss, 'https://auth.samplepark.tr');
  assert.equal(claims.client_id, 'lamaste-server');
  assert.deepEqual(claims.aud, ['https://feria.samplepark.tr']);
  assert.ok(result.expiresAt > Date.now() + 3_500_000);

  await assert.rejects(
    requestClientCredentialsToken({
      tokenEndpoint: `${registryUrl}/api/oidc/token`,
      issuer: 'https://auth.samplepark.tr',
      clientId: 'lamaste-server',
      clientSecret: 'wrong',
      scope: 'lamaste.registry',
      audience: 'https://feria.samplepark.tr',
    }),
    (err) => {
      assert.ok(err instanceof RegistryCredentialError);
      assert.match(err.message, /invalid_client: Client authentication failed/);
      assert.match(err.message, /registers this client in Authelia/);
      return true;
    },
  );
});

test('verifyRegistryCredential (oidc) runs the whole chain and explains what Feria must trust', async () => {
  loginPolicy = 'admin';
  const ok = await verifyRegistryCredential(oidcConfig(), oidcDeps());
  assert.deepEqual(ok, {
    owner: 'ci:auth.samplepark.tr/lamaste-server',
    scopes: ['read', 'publish', 'admin'],
  });
  const login = requests.find((r) => r.url === '/-/feria/login');
  assert.deepEqual(Object.keys(JSON.parse(login.body)).sort(), ['assertion', 'label']);
  assert.equal(JSON.parse(login.body).label, 'lamaste-server');

  // No secret available → a server-side problem, not Feria's.
  await assert.rejects(verifyRegistryCredential(oidcConfig(), {}), (err) => {
    assert.equal(err.statusCode, 500);
    assert.match(err.message, /secret is not available/);
    return true;
  });

  // Feria grants no admin → the rules hint names issuer, audience and claim.
  loginPolicy = 'readonly';
  await assert.rejects(verifyRegistryCredential(oidcConfig(), oidcDeps()), (err) => {
    assert.equal(err.statusCode, 400);
    assert.match(err.message, /admin scope/);
    assert.match(err.message, /"workloads" rule/);
    assert.match(err.message, /https:\/\/auth\.<domain>/);
    assert.match(err.message, new RegExp(`audience ${registryUrl}`));
    assert.match(err.message, /client_id — or sub/);
    return true;
  });
  loginPolicy = 'admin';

  // Feria refuses the login (issuer unknown) → same hint.
  await assert.rejects(
    verifyRegistryCredential(oidcConfig(), {
      oidc: { ...oidcDeps().oidc, domain: 'other.example' },
    }),
    (err) => {
      assert.equal(err.statusCode, 502);
      assert.match(err.message, /issuer is not trusted/);
      assert.match(err.message, /"workloads" rule/);
      return true;
    },
  );

  // Authelia down → 502 naming Authelia.
  autheliaMode = 'down';
  await assert.rejects(verifyRegistryCredential(oidcConfig(), oidcDeps()), /Authelia refused/);
  autheliaMode = 'ok';
});

test('RegistryServiceTokenCache reuses an oidc token until five minutes before expiry, per credential', async () => {
  let now = Date.now();
  const cache = new RegistryServiceTokenCache(() => now);
  const before = requests.length;
  const first = await cache.resolve(oidcConfig(), oidcDeps());
  assert.equal(first.token, 'feria_ci_3');
  const chainCalls = requests.length - before;
  assert.equal(chainCalls, 2); // token endpoint + login

  await cache.resolve(oidcConfig(), oidcDeps());
  assert.equal(requests.length - before, chainCalls, 'second resolve served from cache');

  now += 3_600_000 - TOKEN_REFRESH_MARGIN_MS + 1_000; // inside the refresh margin
  await cache.resolve(oidcConfig(), oidcDeps());
  assert.equal(requests.length - before, chainCalls * 2, 'refreshed before expiry');

  // Another registry URL is another credential: not served from cache.
  await cache.resolve({ ...oidcConfig(), registryUrl: `${registryUrl}/` }, oidcDeps());
  assert.equal(requests.length - before, chainCalls * 3);

  // A pasted token is never exchanged.
  const pasted = await cache.resolve(tokenConfig());
  assert.equal(pasted.token, ADMIN_TOKEN);
  assert.equal(pasted.expiresAt, Number.POSITIVE_INFINITY);
  assert.equal(requests.length - before, chainCalls * 3);

  cache.invalidate();
  await cache.resolve(oidcConfig(), oidcDeps());
  assert.equal(requests.length - before, chainCalls * 4);

  const direct = await obtainRegistryServiceToken(oidcConfig(), oidcDeps());
  assert.equal(direct.owner, 'ci:auth.samplepark.tr/lamaste-server');
});

test('brokerAgentRegistryToken returns a one-hour read token owned by the agent', async () => {
  const config = tokenConfig();
  const cred = await brokerAgentRegistryToken(config, 'r730-app-1', { serviceToken: ADMIN_TOKEN });
  assert.equal(cred.registryUrl, `${registryUrl}/`);
  assert.equal(cred.scope, '@lamalibre');
  assert.equal(cred.token, 'feria_agent_r730-app-1_1h');
  assert.match(cred.tokenId, /^tok-\d+$/);
  const sent = requests.at(-1);
  assert.equal(sent.token, ADMIN_TOKEN);
  assert.deepEqual(JSON.parse(sent.body), { agentLabel: 'r730-app-1', expiresIn: '1h' });

  // With the panel's oidc identity (a Feria ci token carrying admin).
  const viaOidc = await brokerAgentRegistryToken(oidcConfig(), 'r730-app-2', {
    serviceToken: 'feria_ci_3',
  });
  assert.equal(viaOidc.token, 'feria_agent_r730-app-2_1h');

  await assert.rejects(
    brokerAgentRegistryToken(config, 'plugin-agent:x:y', { serviceToken: ADMIN_TOKEN }),
    /cannot hold a registry token/,
  );
  await assert.rejects(
    brokerAgentRegistryToken(config, 'r730-app-1', { serviceToken: READ_TOKEN }),
    (err) => {
      assert.equal(err.statusCode, 502); // our credential is the problem, not the caller
      return true;
    },
  );
});

test('AgentTokenBroker: one token per agent per hour of installs, ten new ones at most', async () => {
  let now = Date.parse('2026-10-13T10:00:00Z');
  const broker = new AgentTokenBroker({ now: () => now });
  let minted = 0;
  const mint =
    (label, lifetimeMs = 3_600_000) =>
    async () => {
      minted += 1;
      return {
        registryUrl: `${registryUrl}/`,
        scope: '@lamalibre',
        token: `feria_agent_${label}_${minted}`,
        expiresAt: new Date(now + lifetimeMs).toISOString(),
        tokenId: `tok-${minted}`,
      };
    };

  const first = await broker.acquire('a', mint('a'));
  assert.equal(first.ok, true);
  assert.equal(first.cached, false);
  const again = await broker.acquire('a', mint('a'));
  assert.equal(again.ok && again.cached, true);
  assert.equal(again.credential.tokenId, first.credential.tokenId);
  assert.equal(minted, 1, 'the second install reused the token');

  // Another agent has its own token and its own budget.
  const other = await broker.acquire('b', mint('b'));
  assert.equal(other.ok && other.credential.tokenId, 'tok-2');

  // Five minutes before expiry the token is spent: a new one is brokered.
  now += 3_600_000 - TOKEN_REFRESH_MARGIN_MS;
  const refreshed = await broker.acquire('a', mint('a'));
  assert.equal(refreshed.ok && refreshed.cached, false);
  assert.equal(refreshed.credential.tokenId, 'tok-3');

  // Short-lived tokens (never good for an install) exhaust the budget.
  const fresh = new AgentTokenBroker({ now: () => now });
  for (let i = 0; i < 10; i += 1) {
    const r = await fresh.acquire('c', mint('c', 60_000));
    assert.equal(r.ok, true);
    now += 61_000;
  }
  const limited = await fresh.acquire('c', mint('c', 60_000));
  assert.equal(limited.ok, false);
  assert.ok(limited.retryAfterSeconds > 0 && limited.retryAfterSeconds <= 3600);
  // ...but not another agent's.
  assert.equal((await fresh.acquire('d', mint('d'))).ok, true);
  // The window slides: an hour after the first issuance one slot is free.
  now += 3_600_000;
  assert.equal((await fresh.acquire('c', mint('c', 60_000))).ok, true);

  // A failed broker call counts against the budget and caches nothing.
  const failing = new AgentTokenBroker({ now: () => now, maxPerWindow: 1 });
  await assert.rejects(
    failing.acquire('e', async () => {
      throw new Error('registry down');
    }),
    /registry down/,
  );
  assert.equal((await failing.acquire('e', mint('e'))).ok, false);
  failing.reset();
  assert.equal((await failing.acquire('e', mint('e'))).ok, true);
});

test('revokeRegistryTokensForOwner and lostFeriaGroups', async () => {
  const config = tokenConfig();
  assert.equal(
    await revokeRegistryTokensForOwner(config, 'user:alice', { serviceToken: ADMIN_TOKEN }),
    2,
  );
  assert.equal(
    await revokeRegistryTokensForOwner(config, 'user:bob', { serviceToken: ADMIN_TOKEN }),
    0,
  );
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
