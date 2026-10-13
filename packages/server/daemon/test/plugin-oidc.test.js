/**
 * Plugin-declared OIDC clients: the manifest accepts only clients in the
 * plugin's own namespace, and the rendered Authelia section carries exactly
 * what the device-code flow needs — public client, no secret, JWT access
 * tokens, explicit audience and consent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateManifest } from '@lamalibre/lamaste';
import { buildOidcProviderSection, renderOidcClient } from '@lamalibre/lamaste/server';

const feriaManifest = {
  name: 'feria',
  version: '0.2.0',
  modes: ['server'],
  packages: { server: '@lamalibre/feria-serverd' },
  oidcClients: [
    {
      id: 'feria-cli',
      name: 'Feria CLI',
      grantTypes: ['urn:ietf:params:oauth:grant-type:device_code'],
      scopes: ['openid', 'profile', 'groups'],
      audience: ['https://feria.{domain}'],
    },
  ],
};

test('manifest: oidcClients parse with defaults, and must stay in the plugin namespace', () => {
  const parsed = validateManifest(feriaManifest);
  assert.equal(parsed.oidcClients.length, 1);
  const client = parsed.oidcClients[0];
  assert.equal(client.accessTokenSignedResponseAlg, 'RS256');
  assert.equal(client.authorizationPolicy, 'two_factor');
  assert.equal(client.requirePkce, false);
  assert.deepEqual(client.redirectUris, []);

  assert.deepEqual(validateManifest({ name: 'x', version: '1' }).oidcClients, []);

  assert.throws(
    () =>
      validateManifest({
        ...feriaManifest,
        oidcClients: [{ ...feriaManifest.oidcClients[0], id: 'shell-cli' }],
      }),
    /shell-cli.* must be .*feria.* or start with/,
  );
  assert.throws(
    () =>
      validateManifest({
        ...feriaManifest,
        oidcClients: [feriaManifest.oidcClients[0], feriaManifest.oidcClients[0]],
      }),
    /declared twice/,
  );
  assert.throws(() =>
    validateManifest({
      ...feriaManifest,
      oidcClients: [{ ...feriaManifest.oidcClients[0], grantTypes: ['implicit'] }],
    }),
  );
  assert.throws(() =>
    validateManifest({
      ...feriaManifest,
      oidcClients: [{ ...feriaManifest.oidcClients[0], scopes: ['Bad Scope'] }],
    }),
  );
});

test('renderOidcClient produces a public device-code client with the domain expanded', () => {
  const [client] = validateManifest(feriaManifest).oidcClients;
  const rendered = renderOidcClient('samplepark.tr', { ...client, plugin: 'feria' });
  assert.deepEqual(rendered, {
    client_id: 'feria-cli',
    client_name: 'Feria CLI',
    public: true,
    authorization_policy: 'two_factor',
    consent_mode: 'explicit',
    scopes: ['openid', 'profile', 'groups'],
    grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
    token_endpoint_auth_method: 'none',
    access_token_signed_response_alg: 'RS256',
    requested_audience_mode: 'explicit',
    audience: ['https://feria.samplepark.tr'],
  });
  assert.ok(!('client_secret' in rendered));

  const withPkce = renderOidcClient('d.test', {
    ...client,
    plugin: 'feria',
    id: 'feria-web',
    name: undefined,
    requirePkce: true,
    grantTypes: ['authorization_code', 'refresh_token'],
    redirectUris: ['https://feria.{domain}/callback'],
    audience: [],
  });
  assert.equal(withPkce.client_name, 'feria (feria-web)');
  assert.equal(withPkce.require_pkce, true);
  assert.deepEqual(withPkce.redirect_uris, ['https://feria.d.test/callback']);
  assert.ok(!('audience' in withPkce));
});

test('buildOidcProviderSection wires the hmac secret, the RS256 issuer key and the clients', () => {
  const [client] = validateManifest(feriaManifest).oidcClients;
  const section = buildOidcProviderSection(
    'samplepark.tr',
    'hmac-secret',
    '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    [{ ...client, plugin: 'feria' }],
  );
  assert.equal(section.hmac_secret, 'hmac-secret');
  assert.deepEqual(section.jwks, [
    {
      key_id: 'lamaste-oidc',
      algorithm: 'RS256',
      use: 'sig',
      key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    },
  ]);
  assert.deepEqual(section.lifespans, { device_code: '10 minutes' });
  assert.equal(section.clients.length, 1);
  assert.equal(section.clients[0].client_id, 'feria-cli');
});
