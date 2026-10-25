/**
 * Plugin-declared OIDC clients: the manifest accepts only clients in the
 * plugin's own namespace, and the rendered Authelia section carries exactly
 * what each flow needs — a public device-code client with a claims policy
 * for the claims a resource server verifies offline, a confidential
 * client-credentials client with a pbkdf2 secret digest — plus the issuer
 * key as a template expression, never inline.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { validateManifest } from '@lamalibre/lamaste';
import {
  AUTHELIA_OIDC_KEY,
  OIDC_KEY_TEMPLATE_SENTINEL,
  LAMASTE_REGISTRY_OIDC_SCOPES,
  buildOidcProviderSection,
  lamasteServerOidcClient,
  oidcIssuerKeyTemplateLine,
  renderAutheliaConfigTemplate,
  renderOidcClaimsPolicies,
  renderOidcClient,
  sentinelizeAutheliaConfig,
} from '@lamalibre/lamaste/server';

/** Feria's lamaste-plugin.json, as shipped. */
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
      accessTokenClaims: ['groups', 'preferred_username'],
    },
  ],
};

const serviceClient = {
  id: 'feria-service',
  grantTypes: ['client_credentials'],
  scopes: ['registry_read'],
  audience: ['https://feria.{domain}'],
  confidential: true,
};

const DIGEST =
  '$pbkdf2-sha512$310000$c8p78n7pUMln0jzvd4aK4Q$JNRBzwAo0ek5qKn50cFzzvE9RXV88h1wJn5KGiHrD0YKtZaR/nCb2CJPOsKaPK0hjf.9yHxzQGZziziccp6Yng';

/** Dump the way the core writer does, then render the template line. */
const render = (config) =>
  renderAutheliaConfigTemplate(
    yaml.dump(config, { lineWidth: -1, quotingType: "'", forceQuotes: false }),
  );

test('manifest: oidcClients parse with defaults, and must stay in the plugin namespace', () => {
  const parsed = validateManifest(feriaManifest);
  assert.equal(parsed.oidcClients.length, 1);
  const client = parsed.oidcClients[0];
  assert.equal(client.accessTokenSignedResponseAlg, 'RS256');
  assert.equal(client.authorizationPolicy, 'two_factor');
  assert.equal(client.requirePkce, false);
  assert.equal(client.confidential, false);
  assert.deepEqual(client.redirectUris, []);
  assert.deepEqual(client.accessTokenClaims, ['groups', 'preferred_username']);

  assert.deepEqual(validateManifest({ name: 'x', version: '1' }).oidcClients, []);

  const withClient = (client) => ({ ...feriaManifest, oidcClients: [client] });
  assert.throws(
    () => validateManifest(withClient({ ...feriaManifest.oidcClients[0], id: 'shell-cli' })),
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
    validateManifest(withClient({ ...feriaManifest.oidcClients[0], grantTypes: ['implicit'] })),
  );
  assert.throws(() =>
    validateManifest(withClient({ ...feriaManifest.oidcClients[0], scopes: ['Bad Scope'] })),
  );
});

test('manifest: access-token claims need their scope; client_credentials needs a confidential client', () => {
  const base = feriaManifest.oidcClients[0];
  const withClient = (client) => ({ ...feriaManifest, oidcClients: [client] });

  assert.throws(
    () => validateManifest(withClient({ ...base, scopes: ['openid', 'profile'] })),
    /groups.* needs the .*groups.* scope/,
  );
  assert.throws(
    () => validateManifest(withClient({ ...base, accessTokenClaims: ['email'] })),
    /email.* needs the .*email.* scope/,
  );
  assert.throws(
    () => validateManifest(withClient({ ...base, accessTokenClaims: ['groups', 'groups'] })),
    /must not repeat/,
  );
  assert.throws(() => validateManifest(withClient({ ...base, accessTokenClaims: ['sub'] })));
  assert.doesNotThrow(() =>
    validateManifest(
      withClient({
        ...base,
        scopes: ['openid', 'profile', 'groups', 'email'],
        accessTokenClaims: ['groups', 'preferred_username', 'name', 'email'],
      }),
    ),
  );

  assert.throws(
    () => validateManifest(withClient({ ...serviceClient, confidential: false })),
    /client_credentials grant requires a confidential client/,
  );
  assert.throws(
    () => validateManifest(withClient({ ...serviceClient, scopes: ['openid', 'registry_read'] })),
    /may not have the scopes openid/,
  );
  // Authelia requires one_factor whenever client_credentials is among the grants.
  assert.throws(
    () => validateManifest(withClient({ ...serviceClient, authorizationPolicy: 'two_factor' })),
    /authorizationPolicy must be one_factor/,
  );
  assert.equal(
    validateManifest(withClient({ ...serviceClient, authorizationPolicy: 'one_factor' }))
      .oidcClients[0].authorizationPolicy,
    'one_factor',
  );
  assert.throws(
    () =>
      validateManifest(
        withClient({ ...base, id: 'feria-web', grantTypes: ['authorization_code'] }),
      ),
    /authorization_code grant requires at least one redirect URI/,
  );
  // Both grants on one confidential client: Authelia's scope rule applies
  // whenever client_credentials is among the grants, so openid is refused.
  assert.throws(
    () =>
      validateManifest(
        withClient({
          ...serviceClient,
          grantTypes: ['client_credentials', 'urn:ietf:params:oauth:grant-type:device_code'],
          scopes: ['openid', 'registry_read'],
        }),
      ),
    /may not have the scopes openid/,
  );
  const parsed = validateManifest(withClient(serviceClient)).oidcClients[0];
  assert.equal(parsed.confidential, true);
  assert.equal(parsed.authorizationPolicy, 'one_factor');
  assert.deepEqual(parsed.accessTokenClaims, []);
});

test('renderOidcClient: public device-code client with the domain expanded and its claims policy', () => {
  const [client] = validateManifest(feriaManifest).oidcClients;
  const rendered = renderOidcClient({ ...client, plugin: 'feria', domain: 'samplepark.tr' });
  assert.deepEqual(rendered, {
    client_id: 'feria-cli',
    client_name: 'Feria CLI',
    public: true,
    // Members of the client's domain alone, with its factor.
    authorization_policy: 'lamaste_samplepark_tr_two_factor',
    consent_mode: 'explicit',
    scopes: ['openid', 'profile', 'groups'],
    grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
    token_endpoint_auth_method: 'none',
    access_token_signed_response_alg: 'RS256',
    requested_audience_mode: 'explicit',
    claims_policy: 'feria-cli',
    audience: ['https://feria.samplepark.tr'],
  });
  assert.ok(!('client_secret' in rendered));
  assert.throws(
    () => renderOidcClient({ ...client, plugin: 'feria', domain: 'd.test' }, DIGEST),
    /public and must not carry a secret/,
  );

  const withPkce = renderOidcClient({
    ...client,
    plugin: 'feria',
    domain: 'd.test',
    id: 'feria-web',
    name: undefined,
    requirePkce: true,
    accessTokenClaims: [],
    grantTypes: ['authorization_code', 'refresh_token'],
    redirectUris: ['https://feria.{domain}/callback'],
    audience: [],
  });
  assert.equal(withPkce.client_name, 'feria (feria-web)');
  assert.equal(withPkce.require_pkce, true);
  assert.deepEqual(withPkce.redirect_uris, ['https://feria.d.test/callback']);
  assert.ok(!('audience' in withPkce));
  assert.ok(!('claims_policy' in withPkce));

  assert.deepEqual(
    renderOidcClaimsPolicies([
      { ...client, plugin: 'feria' },
      { ...client, plugin: 'feria', id: 'feria-x', accessTokenClaims: [] },
    ]),
    {
      'feria-cli': { access_token: ['groups', 'preferred_username'] },
    },
  );
});

test('renderOidcClient: confidential client-credentials client carries the digest, no consent, basic auth', () => {
  const [client] = validateManifest({ ...feriaManifest, oidcClients: [serviceClient] }).oidcClients;
  const rendered = renderOidcClient(
    { ...client, plugin: 'feria', domain: 'samplepark.tr' },
    DIGEST,
  );
  assert.deepEqual(rendered, {
    client_id: 'feria-service',
    client_name: 'feria (feria-service)',
    client_secret: DIGEST,
    authorization_policy: 'one_factor',
    scopes: ['registry_read'],
    grant_types: ['client_credentials'],
    token_endpoint_auth_method: 'client_secret_basic',
    access_token_signed_response_alg: 'RS256',
    requested_audience_mode: 'explicit',
    audience: ['https://feria.samplepark.tr'],
  });
  assert.ok(!('public' in rendered));
  assert.throws(
    () => renderOidcClient({ ...client, plugin: 'feria', domain: 'samplepark.tr' }),
    /confidential but has no secret digest/,
  );

  const lamaste = renderOidcClient(
    lamasteServerOidcClient('https://feria.samplepark.tr/', 'samplepark.tr'),
    DIGEST,
  );
  assert.equal(lamaste.client_id, 'lamaste-server');
  assert.equal(lamaste.client_secret, DIGEST);
  assert.equal(lamaste.authorization_policy, 'one_factor');
  assert.ok(!('consent_mode' in lamaste));
  // Even a declaration that says two_factor is rendered one_factor.
  assert.equal(
    renderOidcClient(
      { ...client, plugin: 'feria', domain: 'd.test', authorizationPolicy: 'two_factor' },
      DIGEST,
    ).authorization_policy,
    'one_factor',
  );
  assert.deepEqual(lamaste.grant_types, ['client_credentials']);
  assert.deepEqual(lamaste.scopes, ['lamaste.registry']);
  assert.deepEqual(lamaste.audience, ['https://feria.samplepark.tr']);
  assert.equal(lamaste.token_endpoint_auth_method, 'client_secret_basic');
});

test('a client of a domain the relay does not serve is refused, not rendered', () => {
  const [cli] = validateManifest(feriaManifest).oidcClients;
  assert.throws(
    () =>
      buildOidcProviderSection([{ name: 'samplepark.tr', members: [] }], 'h', [
        { ...cli, plugin: 'feria', domain: 'codelama.com.tr' },
      ]),
    /belongs to 'codelama.com.tr', no domain of this relay/,
  );
});

test('buildOidcProviderSection: hmac secret, the key as a sentinel, claims policies, scopes, clients', () => {
  const [cli] = validateManifest(feriaManifest).oidcClients;
  const section = buildOidcProviderSection(
    [{ name: 'samplepark.tr', members: ['onur'] }],
    'hmac-secret',
    [
      { ...cli, plugin: 'feria', domain: 'samplepark.tr' },
      lamasteServerOidcClient('https://feria.samplepark.tr', 'samplepark.tr'),
    ],
    { secretDigests: { 'lamaste-server': DIGEST }, scopes: LAMASTE_REGISTRY_OIDC_SCOPES },
  );
  assert.equal(section.hmac_secret, 'hmac-secret');
  assert.deepEqual(section.jwks, [
    { key_id: 'lamaste-oidc', algorithm: 'RS256', use: 'sig', key: OIDC_KEY_TEMPLATE_SENTINEL },
  ]);
  assert.deepEqual(section.lifespans, { device_code: '10 minutes' });
  assert.deepEqual(section.claims_policies, {
    'feria-cli': { access_token: ['groups', 'preferred_username'] },
  });
  assert.deepEqual(section.scopes, { 'lamaste.registry': { claims: [] } });
  assert.deepEqual(
    section.clients.map((c) => c.client_id),
    ['feria-cli', 'lamaste-server'],
  );
  assert.ok(!JSON.stringify(section).includes('PRIVATE KEY'));

  // Without claims or custom scopes the keys are absent, not empty.
  const bare = buildOidcProviderSection([{ name: 'd.test', members: [] }], 'h', [
    { ...cli, plugin: 'feria', domain: 'd.test', accessTokenClaims: [] },
  ]);
  assert.ok(!('claims_policies' in bare));
  assert.ok(!('scopes' in bare));
});

test('the rendered YAML reads the issuer key with a template expression at the right indent', () => {
  const [cli] = validateManifest(feriaManifest).oidcClients;
  const section = buildOidcProviderSection(
    [{ name: 'samplepark.tr', members: ['onur'] }],
    'hmac-secret',
    [{ ...cli, plugin: 'feria', domain: 'samplepark.tr' }],
  );
  const text = render({ identity_providers: { oidc: section } });
  const expectedLine = oidcIssuerKeyTemplateLine(8);
  assert.equal(
    expectedLine,
    `        key: {{ secret "${AUTHELIA_OIDC_KEY}" | mindent 10 "|" | msquote }}`,
  );
  assert.equal(AUTHELIA_OIDC_KEY, '/etc/authelia/oidc-issuer.pem');
  const lines = text.split('\n');
  assert.equal(lines.filter((l) => l.includes('{{')).length, 1, 'exactly one template line');
  assert.ok(lines.includes(expectedLine), `expected line in:\n${text}`);
  assert.ok(!text.includes(OIDC_KEY_TEMPLATE_SENTINEL));

  // Exactly what Authelia receives for Feria's manifest.
  assert.equal(
    text,
    `identity_providers:
  oidc:
    hmac_secret: hmac-secret
    jwks:
      - key_id: lamaste-oidc
        algorithm: RS256
        use: sig
${expectedLine}
    lifespans:
      device_code: 10 minutes
    claims_policies:
      feria-cli:
        access_token:
          - groups
          - preferred_username
    authorization_policies:
      lamaste_samplepark_tr_one_factor:
        default_policy: deny
        rules:
          - policy: one_factor
            subject:
              - user:onur
      lamaste_samplepark_tr_two_factor:
        default_policy: deny
        rules:
          - policy: two_factor
            subject:
              - user:onur
    clients:
      - client_id: feria-cli
        client_name: Feria CLI
        public: true
        authorization_policy: lamaste_samplepark_tr_two_factor
        consent_mode: explicit
        scopes:
          - openid
          - profile
          - groups
        grant_types:
          - urn:ietf:params:oauth:grant-type:device_code
        token_endpoint_auth_method: none
        access_token_signed_response_alg: RS256
        requested_audience_mode: explicit
        claims_policy: feria-cli
        audience:
          - https://feria.samplepark.tr
`,
  );

  // Reading the file back: the template line becomes the sentinel, and
  // re-rendering reproduces the file byte for byte.
  const parsed = yaml.load(sentinelizeAutheliaConfig(text));
  assert.equal(parsed.identity_providers.oidc.jwks[0].key, OIDC_KEY_TEMPLATE_SENTINEL);
  assert.equal(render(parsed), text);
});

test('the writer refuses "{{" or "}}" anywhere else — the file is a Go template', () => {
  const [cli] = validateManifest(feriaManifest).oidcClients;
  const evil = buildOidcProviderSection([{ name: 'samplepark.tr', members: [] }], 'hmac', [
    {
      ...cli,
      plugin: 'feria',
      domain: 'samplepark.tr',
      name: '{{ env "AUTHELIA_SESSION_SECRET" }}',
    },
  ]);
  assert.throws(
    () => render({ identity_providers: { oidc: evil } }),
    /must not contain "\{\{" or "\}\}"/,
  );
  assert.throws(() => renderAutheliaConfigTemplate('a: b }}\n'), /must not contain/);
  assert.throws(
    () => render({ access_control: { rules: [{ domain: 'x.{{ .Env }}.tld' }] } }),
    /must not contain/,
  );
  // A document without the sentinel passes through untouched.
  assert.equal(
    render({ server: { address: 'tcp://127.0.0.1:9091/' } }),
    'server:\n  address: tcp://127.0.0.1:9091/\n',
  );
  // The sentinel is replaced wherever js-yaml quotes it or not.
  assert.equal(
    renderAutheliaConfigTemplate(`    key: '${OIDC_KEY_TEMPLATE_SENTINEL}'\n`),
    `${oidcIssuerKeyTemplateLine(4)}\n`,
  );
  // Only a well-formed template line is sentinelized on read.
  assert.equal(sentinelizeAutheliaConfig('key: {{ nope }}\n'), 'key: {{ nope }}\n');
});
