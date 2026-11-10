/**
 * Native apps on the user surface (docs/native-apps-design.md), wave 1:
 * the native client's rules and the association files, the reserved OIDC
 * client ids, the Authelia rendering, the access-token verifier and the
 * broker's grace window, the bearer credential of a relay assertion, the
 * served rules of application hosts (joined site routes, cross-agent tunnel
 * bindings), `identity.signInEvents`, and the sign-in events — sealed, and
 * received by an agent half's handler end to end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  APPLE_APP_SITE_ASSOCIATION_PATH,
  ASSET_LINKS_PATH,
  AGENT_HALF_SIGN_IN_EVENTS_PATH,
  ManifestValidationError,
  NATIVE_REDIRECT_PAGE_KEYS,
  NativeAssociationsSchema,
  NativeClientCreateSchema,
  NativeClientUpdateSchema,
  NonceStore,
  PAGE_MESSAGES_EN,
  PAGE_MESSAGES_TR,
  RELAY_PANEL_AUDIENCE,
  RELAY_PANEL_PORT,
  RESERVED_API_PREFIXES,
  approvalDigest,
  bearerTokenOf,
  bodySha256Hex,
  callAgentHalf,
  generateCallerAssertionNonce,
  generateHostingSecret,
  identityChangeNeedsApproval,
  identityDiff,
  isNativeClientId,
  isNativeGrantEndReason,
  isNativeRedirectPath,
  isReservedOidcClientId,
  nativeAudience,
  nativeClientId,
  nativeClientLifetimesValid,
  nativeDeviceName,
  nativeRedirectUris,
  nativeTokenSha256,
  nativeUserAgentSummary,
  normalizeIdentityBlock,
  openGraceAnswer,
  openSignInEvents,
  parseNativeIssuerKeys,
  parseSignInEvents,
  parseSignInEventsWire,
  renderAppleAppSiteAssociation,
  renderAssetLinks,
  sealGraceAnswer,
  sealSignInEvents,
  signCallerAssertion,
  signRelayAssertion,
  siteUserSurfaceRoutes,
  tunnelOriginAgent,
  tunnelServedUserSurfaceRoutes,
  tunnelUserSurfaceRouteState,
  userSurfaceHosts,
  validateManifest,
  verifyNativeAccessToken,
  verifyRelayAssertion,
} from '../dist/index.js';
import { createCallerAssertionVerifier, createSignInEventsHandler } from '../dist/agent/index.js';
import {
  HOST_ACCESS_FACTOR,
  UNAVAILABLE_PAGE_STYLE_HASH,
  buildOidcProviderSection,
  nativeRedirectPageHeaders,
  renderNativeClient,
  renderNativeClientLifespans,
  renderNativeClientPolicies,
  renderNativeRedirectPage,
} from '../dist/server/index.js';

// ---------------------------------------------------------------------------
// The client's rules
// ---------------------------------------------------------------------------

test('client ids: lamaste-native-<slug>; lamaste and lamaste-* are reserved', () => {
  assert.equal(nativeClientId('field-app'), 'lamaste-native-field-app');
  for (const bad of ['', '-a', 'a-', 'A', 'a_b', 'a'.repeat(41)]) {
    assert.throws(() => nativeClientId(bad), /slug/, bad);
  }
  assert.equal(isNativeClientId('lamaste-native-x1'), true);
  assert.equal(isNativeClientId('lamaste-native-'), false);
  assert.equal(isNativeClientId('lamaste-server'), false);
  assert.equal(isReservedOidcClientId('lamaste'), true);
  assert.equal(isReservedOidcClientId('lamaste-server'), true);
  assert.equal(isReservedOidcClientId('lamaste-native-x'), true);
  assert.equal(isReservedOidcClientId('lamastex'), false);
  assert.equal(isReservedOidcClientId('feria-cli'), false);
  assert.ok(RESERVED_API_PREFIXES.includes('native-apps'));
});

test('manifest: a plugin may not declare a client id under lamaste-', () => {
  const attempt = (name, id) => {
    try {
      validateManifest({
        name,
        version: '1.0.0',
        oidcClients: [
          { id, grantTypes: ['authorization_code'], redirectUris: ['https://x.example/cb'] },
        ],
      });
      return null;
    } catch (err) {
      assert.ok(err instanceof ManifestValidationError, String(err));
      return err.issues.map((e) => `${e.path}: ${e.message}`).join('\n');
    }
  };
  assert.match(attempt('lamaste', 'lamaste-native-x'), /reserved for Lamaste/);
  assert.match(attempt('lamaste', 'lamaste'), /reserved for Lamaste/);
  assert.equal(attempt('feria', 'feria-cli'), null);
});

test('redirect paths: segments of [A-Za-z0-9._~-], nothing under /api or /.well-known', () => {
  for (const ok of ['/oauth/callback', '/cb', '/a.b/c~d_e-f', `/${'a'.repeat(127)}`]) {
    assert.equal(isNativeRedirectPath(ok), true, ok);
  }
  for (const bad of [
    '',
    '/',
    'oauth',
    '/oauth/',
    '//x',
    '/./x',
    '/x/..',
    '/x?y',
    '/x#y',
    '/x y',
    '/api',
    '/API/x',
    '/api/fx/app',
    '/.well-known/assetlinks.json',
    '/.Well-Known',
    `/${'a'.repeat(128)}`,
  ]) {
    assert.equal(isNativeRedirectPath(bad), false, bad);
  }
  assert.equal(nativeAudience('App.Example.COM'), 'https://app.example.com');
  assert.deepEqual(nativeRedirectUris('app.example.com', ['/cb', '/x/y']), [
    'https://app.example.com/cb',
    'https://app.example.com/x/y',
  ]);
  assert.throws(() => nativeRedirectUris('app.example.com', ['/api/x']), /redirect path/);
});

test('client schema: defaults 15 min, 30 / 90 days; idle never longer than absolute', () => {
  const created = NativeClientCreateSchema.parse({
    slug: 'field',
    hostKind: 'site',
    hostId: 'abc',
    name: '  Field app ',
    redirectPaths: ['/oauth/callback'],
  });
  assert.deepEqual(created, {
    slug: 'field',
    hostKind: 'site',
    hostId: 'abc',
    name: 'Field app',
    redirectPaths: ['/oauth/callback'],
    accessTokenMinutes: 15,
    idleDays: 30,
    absoluteDays: 90,
    associations: {},
    enabled: true,
  });
  const refuse = (patch) =>
    NativeClientCreateSchema.safeParse({
      slug: 'field',
      hostKind: 'tunnel',
      hostId: 'abc',
      name: 'Field',
      redirectPaths: ['/cb'],
      ...patch,
    }).success;
  assert.equal(refuse({ idleDays: 91 }), false);
  assert.equal(refuse({ idleDays: 90, absoluteDays: 90 }), true);
  assert.equal(refuse({ accessTokenMinutes: 16 }), false);
  assert.equal(refuse({ accessTokenMinutes: 4 }), false);
  assert.equal(refuse({ absoluteDays: 366 }), false);
  assert.equal(refuse({ redirectPaths: [] }), false);
  assert.equal(refuse({ redirectPaths: ['/a', '/a'] }), false);
  assert.equal(refuse({ redirectPaths: ['/a', '/b', '/c', '/d', '/e'] }), false);
  assert.equal(refuse({ hostKind: 'domain' }), false);
  assert.equal(refuse({ name: 'a\u202eb' }), false);
  assert.equal(refuse({ extra: 1 }), false);
  assert.equal(NativeClientUpdateSchema.safeParse({}).success, false);
  assert.equal(NativeClientUpdateSchema.safeParse({ enabled: false }).success, true);
  assert.equal(nativeClientLifetimesValid({ idleDays: 31, absoluteDays: 30 }), false);
});

test('grant words: end reasons, device names and user-agent summaries', () => {
  assert.equal(isNativeGrantEndReason('reuse'), true);
  assert.equal(isNativeGrantEndReason('standing:no_role'), true);
  assert.equal(isNativeGrantEndReason('whatever'), false);
  assert.equal(nativeDeviceName('  Ayşe’s\u0000 phone\u202e  '), 'Ayşe’s phone');
  assert.equal(nativeDeviceName('x'.repeat(100)).length, 64);
  assert.equal(nativeDeviceName('\u0001'), null);
  assert.equal(nativeDeviceName(42), null);
  assert.equal(nativeUserAgentSummary('okhttp/4.12.0').length, 13);
  assert.equal(nativeUserAgentSummary('a'.repeat(300)).length, 128);
});

// ---------------------------------------------------------------------------
// Association files
// ---------------------------------------------------------------------------

const FP = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(
  ':',
);

test('associations: the setting is checked strictly', () => {
  const ok = {
    ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.app'] },
    android: [{ packageName: 'com.example.app', sha256CertFingerprints: [FP] }],
  };
  assert.deepEqual(NativeAssociationsSchema.parse(ok), ok);
  assert.deepEqual(NativeAssociationsSchema.parse({}), {});
  const bad = [
    { ios: { teamId: 'abcde12345', bundleIds: ['com.example.app'] } },
    { ios: { teamId: 'ABCDE12345', bundleIds: [] } },
    { ios: { teamId: 'ABCDE12345', bundleIds: ['app'] } },
    { ios: { teamId: 'ABCDE12345', bundleIds: ['com.x', 'com.x'] } },
    { android: [{ packageName: 'com.x', sha256CertFingerprints: [FP.toLowerCase()] }] },
    { android: [{ packageName: 'com.x', sha256CertFingerprints: ['AA:BB'] }] },
    {
      android: [
        { packageName: 'com.x', sha256CertFingerprints: [FP] },
        { packageName: 'com.x', sha256CertFingerprints: [FP] },
      ],
    },
    { windows: {} },
  ];
  for (const b of bad) assert.equal(NativeAssociationsSchema.safeParse(b).success, false);
});

test('associations: AASA claims only the redirect paths; assetlinks per package', () => {
  assert.equal(APPLE_APP_SITE_ASSOCIATION_PATH, '/.well-known/apple-app-site-association');
  assert.equal(ASSET_LINKS_PATH, '/.well-known/assetlinks.json');
  const setting = {
    ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.app', 'com.example.beta'] },
    android: [{ packageName: 'com.example.app', sha256CertFingerprints: [FP] }],
  };
  assert.deepEqual(renderAppleAppSiteAssociation(setting, ['/oauth/callback']), {
    applinks: {
      details: [
        {
          appIDs: ['ABCDE12345.com.example.app', 'ABCDE12345.com.example.beta'],
          components: [{ '/': '/oauth/callback' }],
        },
      ],
    },
    webcredentials: { apps: ['ABCDE12345.com.example.app', 'ABCDE12345.com.example.beta'] },
  });
  assert.deepEqual(renderAssetLinks(setting), [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.example.app',
        sha256_cert_fingerprints: [FP],
      },
    },
  ]);
  assert.equal(renderAppleAppSiteAssociation({}, ['/cb']), null);
  assert.equal(renderAssetLinks({ ios: setting.ios }), null);
  assert.throws(() => renderAppleAppSiteAssociation(setting, ['/api/x']), /redirect path/);
});

test('the redirect page: no script, the shared style hash, no referrer, both languages', () => {
  assert.deepEqual(NATIVE_REDIRECT_PAGE_KEYS, ['nativeRedirect.title', 'nativeRedirect.text']);
  for (const key of NATIVE_REDIRECT_PAGE_KEYS) {
    assert.ok(PAGE_MESSAGES_EN[key] && PAGE_MESSAGES_TR[key], key);
  }
  const page = renderNativeRedirectPage({ brand: null, language: 'tr', domain: null });
  assert.match(page, /<html lang="tr">/);
  assert.ok(page.includes(PAGE_MESSAGES_TR['nativeRedirect.title']));
  assert.doesNotMatch(page, /<script/i);
  const branded = renderNativeRedirectPage({
    brand: { name: 'Acme <b>', tagline: null, logo: true },
    language: 'en',
    domain: 'example.com',
  });
  assert.ok(branded.includes('Acme &lt;b&gt;'));
  assert.ok(branded.includes('https://auth.example.com/'));
  const headers = nativeRedirectPageHeaders('example.com');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.ok(headers['Content-Security-Policy'].includes(UNAVAILABLE_PAGE_STYLE_HASH));
  assert.equal(headers['Cache-Control'], 'no-store');
});

// ---------------------------------------------------------------------------
// Authelia rendering
// ---------------------------------------------------------------------------

const DOMAINS = [
  { name: 'example.com', groupKey: '0123456789abcdef' },
  { name: 'other.org', groupKey: 'fedcba9876543210' },
];

const NATIVE = {
  clientId: 'lamaste-native-field',
  name: 'Field app',
  fqdn: 'App.Example.com',
  domain: 'example.com',
  redirectPaths: ['/oauth/callback'],
  accessTokenMinutes: 15,
  idleDays: 30,
};

test('renderNativeClient: the client the design verified against Authelia 4.39.28', () => {
  assert.deepEqual(renderNativeClient(NATIVE), {
    client_id: 'lamaste-native-field',
    client_name: 'Field app',
    public: true,
    authorization_policy: 'lamaste_client_lamaste-native-field',
    consent_mode: 'explicit',
    lifespan: 'lamaste_client_lamaste-native-field',
    require_pkce: true,
    pkce_challenge_method: 'S256',
    redirect_uris: ['https://app.example.com/oauth/callback'],
    scopes: ['openid', 'offline_access', 'profile'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    access_token_signed_response_alg: 'RS256',
    requested_audience_mode: 'implicit',
    audience: ['https://app.example.com'],
    claims_policy: 'lamaste-native-field',
  });
  for (const bad of [
    { clientId: 'feria-cli' },
    { fqdn: 'app.other.org' },
    { fqdn: 'example.com' },
    { redirectPaths: [] },
    { redirectPaths: ['/api/x'] },
    { accessTokenMinutes: 16 },
    { idleDays: 0 },
    { name: '' },
  ]) {
    assert.throws(() => renderNativeClient({ ...NATIVE, ...bad }), JSON.stringify(bad));
  }
});

test('native lifespans and policies: idle as the refresh lifetime; the host factor, members and granted externals', () => {
  assert.deepEqual(
    renderNativeClientLifespans([{ ...NATIVE, accessTokenMinutes: 5, idleDays: 7 }]),
    {
      'lamaste_client_lamaste-native-field': {
        access_token: '5 minutes',
        id_token: '5 minutes',
        refresh_token: '7 days',
      },
    },
  );
  assert.equal(HOST_ACCESS_FACTOR, 'two_factor');
  assert.deepEqual(renderNativeClientPolicies([NATIVE], DOMAINS), {
    'lamaste_client_lamaste-native-field': {
      default_policy: 'deny',
      rules: [
        { policy: 'two_factor', subject: ['group:lamaste:m:0123456789abcdef'] },
        {
          policy: 'two_factor',
          subject: [['group:lamaste:x:0123456789abcdef', 'group:app.example.com']],
        },
      ],
    },
  });
  assert.throws(
    () =>
      renderNativeClientPolicies(
        [{ ...NATIVE, domain: 'nowhere.net', fqdn: 'a.nowhere.net' }],
        DOMAINS,
      ),
    /no domain/,
  );
});

test('buildOidcProviderSection: native clients beside plugin clients, one section', () => {
  const section = buildOidcProviderSection(DOMAINS, 'h'.repeat(64), [], {
    nativeClients: [NATIVE],
  });
  assert.equal(section.clients.length, 1);
  assert.equal(section.clients[0].client_id, 'lamaste-native-field');
  assert.deepEqual(section.claims_policies, {
    'lamaste-native-field': { access_token: ['preferred_username'] },
  });
  assert.deepEqual(Object.keys(section.lifespans.custom), ['lamaste_client_lamaste-native-field']);
  assert.ok(section.authorization_policies['lamaste_client_lamaste-native-field']);
  assert.throws(
    () => buildOidcProviderSection([DOMAINS[1]], 'h'.repeat(64), [], { nativeClients: [NATIVE] }),
    /no domain of this relay/,
  );
  assert.throws(
    () =>
      buildOidcProviderSection(DOMAINS, 'h'.repeat(64), [], { nativeClients: [NATIVE, NATIVE] }),
    /rendered twice/,
  );
  // Without native clients, the section a 4.12 relay rendered.
  const plain = buildOidcProviderSection(DOMAINS, 'h'.repeat(64), []);
  assert.equal('custom' in plain.lifespans, false);
  assert.equal('claims_policies' in plain, false);
});

// ---------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------

const ISSUER = 'https://auth.example.com';
const AUDIENCE = 'https://app.example.com';
const CLIENT = 'lamaste-native-field';
const NOW = 1_800_000_000;

const { privateKey: ISSUER_KEY, publicKey: ISSUER_PUB } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

function jwks(pub = ISSUER_PUB, kid = 'lamaste-oidc', extra = {}) {
  return { keys: [{ ...pub.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256', ...extra }] };
}

function sign(claims, header = {}, key = ISSUER_KEY) {
  const h = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'lamaste-oidc', typ: 'at+jwt', ...header }),
  ).toString('base64url');
  const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const s = crypto.sign('sha256', Buffer.from(`${h}.${c}`), key).toString('base64url');
  return `${h}.${c}.${s}`;
}

function claims(patch = {}) {
  return {
    aud: [AUDIENCE],
    client_id: CLIENT,
    exp: NOW + 600,
    iat: NOW - 300,
    nbf: NOW - 300,
    iss: ISSUER,
    jti: '939d3186-c569-4641-9afa-9456240c154c',
    preferred_username: 'alice',
    scp: ['openid', 'offline_access', 'profile'],
    sub: '462c1ee3-0dcb-45e2-bbc5-0a53c2414f5c',
    ...patch,
  };
}

const KEYS = parseNativeIssuerKeys(jwks());
const verify = (token, opts = {}) =>
  verifyNativeAccessToken(token, {
    keys: KEYS,
    issuer: ISSUER,
    audience: AUDIENCE,
    clientId: CLIENT,
    now: NOW,
    ...opts,
  });

test('issuer keys: RSA signing keys of 2048 bits and more, with a kid; others skipped', () => {
  assert.equal(KEYS.length, 1);
  assert.equal(KEYS[0].kid, 'lamaste-oidc');
  assert.match(KEYS[0].thumbprint, /^[A-Za-z0-9_-]{43}$/);
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey;
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
  assert.equal(parseNativeIssuerKeys(jwks(weak)).length, 0);
  assert.equal(
    parseNativeIssuerKeys({ keys: [{ ...ec.export({ format: 'jwk' }), kid: 'e' }] }).length,
    0,
  );
  assert.equal(parseNativeIssuerKeys(jwks(ISSUER_PUB, 'k', { use: 'enc' })).length, 0);
  assert.equal(parseNativeIssuerKeys(jwks(ISSUER_PUB, 'k', { alg: 'RS512' })).length, 0);
  assert.throws(() => parseNativeIssuerKeys({}), /JWKS/);
  assert.throws(() => parseNativeIssuerKeys({ keys: Array(17).fill({}) }), /too many/);
});

test('verifyNativeAccessToken: a token Authelia issues for the host is admitted', () => {
  const token = sign(claims());
  const result = verify(token);
  assert.equal(result.ok, true);
  assert.deepEqual(result.claims, {
    username: 'alice',
    clientId: CLIENT,
    jti: '939d3186-c569-4641-9afa-9456240c154c',
    exp: NOW + 600,
    iat: NOW - 300,
    tokenSha256: nativeTokenSha256(token),
  });
  assert.equal(result.claims.tokenSha256, crypto.createHash('sha256').update(token).digest('hex'));
  // `aud` as a string too.
  assert.equal(verify(sign(claims({ aud: AUDIENCE }))).ok, true);
});

test('verifyNativeAccessToken: every refusal names its reason', () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const cases = {
    malformed: [
      'a.b',
      '',
      'x'.repeat(9000),
      `${sign(claims())}.x`,
      sign(claims({ jti: 'nope' })),
      sign(claims({ exp: 'soon' })),
      sign(claims(), { crit: ['x'] }),
      sign(claims(), { kid: 7 }),
    ],
    unsupported_algorithm: [sign(claims(), { alg: 'none' }), sign(claims(), { alg: 'HS256' })],
    wrong_type: [sign(claims(), { typ: 'JWT' }), sign(claims(), { typ: undefined })],
    unknown_key: [sign(claims(), { kid: 'other' })],
    bad_signature: [
      sign(claims(), {}, other),
      sign(claims()).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
    ],
    wrong_issuer: [sign(claims({ iss: 'https://auth.other.org' }))],
    wrong_audience: [sign(claims({ aud: ['https://x.example.com'] })), sign(claims({ aud: 7 }))],
    wrong_client: [
      sign(claims({ client_id: 'lamaste-native-other' })),
      sign(claims({ client_id: 'fx' })),
    ],
    expired: [sign(claims({ exp: NOW }))],
    not_yet_valid: [
      sign(claims({ iat: NOW + 31, exp: NOW + 600 })),
      sign(claims({ nbf: NOW + 31 })),
    ],
    lifetime_too_long: [sign(claims({ iat: NOW - 1000, exp: NOW + 10 }))],
    invalid_username: [
      sign(claims({ preferred_username: 'a b' })),
      sign(claims({ preferred_username: undefined })),
    ],
  };
  for (const [reason, tokens] of Object.entries(cases)) {
    for (const token of tokens) {
      assert.deepEqual(verify(token), { ok: false, reason }, `${reason}: ${token.slice(0, 40)}`);
    }
  }
  assert.deepEqual(verify(42), { ok: false, reason: 'malformed' });
  // Skew: 30 s in the future still passes.
  assert.equal(verify(sign(claims({ iat: NOW + 30, nbf: NOW + 30, exp: NOW + 600 }))).ok, true);
});

test('bearerTokenOf: Bearer <token>, one value, nothing else', () => {
  assert.equal(bearerTokenOf('Bearer abc.def.ghi'), 'abc.def.ghi');
  assert.equal(bearerTokenOf('bearer abc'), 'abc');
  for (const bad of [
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic abc',
    'Bearer a b',
    'Bearer  a',
    ['Bearer a'],
  ]) {
    assert.equal(bearerTokenOf(bad), null, String(bad));
  }
});

test('grace window: the answer opens only with the spent token and its grant', () => {
  const sealed = sealGraceAnswer({ spentRefreshToken: 'rt-1', grantId: 'g1', answer: '{"a":1}' });
  assert.equal(openGraceAnswer({ spentRefreshToken: 'rt-1', grantId: 'g1', sealed }), '{"a":1}');
  assert.equal(openGraceAnswer({ spentRefreshToken: 'rt-2', grantId: 'g1', sealed }), null);
  assert.equal(openGraceAnswer({ spentRefreshToken: 'rt-1', grantId: 'g2', sealed }), null);
  assert.equal(
    openGraceAnswer({
      spentRefreshToken: 'rt-1',
      grantId: 'g1',
      sealed: { ...sealed, ct: sealed.ct.slice(0, -2) + 'AA' },
    }),
    null,
  );
  assert.equal(
    openGraceAnswer({ spentRefreshToken: 'rt-1', grantId: 'g1', sealed: { v: 2 } }),
    null,
  );
  assert.ok(!JSON.stringify(sealed).includes('"a"'));
});

// ---------------------------------------------------------------------------
// The relay assertion's bearer credential
// ---------------------------------------------------------------------------

function relayKey() {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const spki = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const kid = crypto.createHash('sha256').update(spki).digest('hex').slice(0, 32);
  return { kid, privateKey, publicKey: spki.toString('base64'), createdAt: '' };
}

test('relay assertion: a user-surface caller may carry a bearer credential, verified as signed', () => {
  const key = relayKey();
  const keys = new Map([[key.kid, crypto.createPublicKey(key.privateKey)]]);
  const credential = { kind: 'bearer', clientId: CLIENT, tokenSha256: 'a'.repeat(64), exp: NOW };
  const target = { route: 'fx', path: '/api/fx/app/x' };
  const header = signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: RELAY_PANEL_PORT,
      caller: { type: 'user', username: 'alice', credential },
      method: 'POST',
      target,
    },
    key,
  );
  const verified = verifyRelayAssertion(header, {
    keys,
    aud: RELAY_PANEL_AUDIENCE,
    port: RELAY_PANEL_PORT,
    method: 'POST',
    url: '/api/fx/app/x',
    nonces: new NonceStore(),
  });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload.caller, { type: 'user', username: 'alice', credential });

  // A session caller carries none.
  const session = signRelayAssertion(
    {
      aud: RELAY_PANEL_AUDIENCE,
      port: RELAY_PANEL_PORT,
      caller: { type: 'user', username: 'alice' },
      method: 'GET',
      target,
    },
    key,
  );
  const s = verifyRelayAssertion(session, {
    keys,
    aud: RELAY_PANEL_AUDIENCE,
    port: RELAY_PANEL_PORT,
    method: 'GET',
    url: '/api/fx/app/x',
    nonces: new NonceStore(),
  });
  assert.deepEqual(s.payload.caller, { type: 'user', username: 'alice' });

  const bad = [
    { ...credential, kind: 'session' },
    { ...credential, clientId: 'fx' },
    { ...credential, tokenSha256: 'A'.repeat(64) },
    { ...credential, exp: 1.5 },
    { ...credential, extra: 1 },
  ];
  for (const c of bad) {
    assert.throws(
      () =>
        signRelayAssertion(
          {
            aud: RELAY_PANEL_AUDIENCE,
            port: RELAY_PANEL_PORT,
            caller: { type: 'user', username: 'alice', credential: c },
            method: 'GET',
            target,
          },
          key,
        ),
      /credential/,
    );
  }
  // Never on an inviter's request.
  assert.throws(
    () =>
      signRelayAssertion(
        {
          aud: RELAY_PANEL_AUDIENCE,
          port: RELAY_PANEL_PORT,
          caller: { type: 'user', username: 'alice', credential },
          method: 'GET',
          target: {
            invitations: 'fx',
            domain: 'example.com',
            path: '/api/delegated-invitations/fx',
          },
        },
        key,
      ),
    /bearer/,
  );

  // A forged payload with a malformed credential or an extra caller field is malformed.
  const forge = (caller) => {
    const payload = {
      v: 1,
      kid: key.kid,
      aud: RELAY_PANEL_AUDIENCE,
      port: RELAY_PANEL_PORT,
      caller,
      method: 'GET',
      target,
      iat: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign(null, Buffer.from(encoded), key.privateKey).toString('base64url');
    return verifyRelayAssertion(`${encoded}.${sig}`, {
      keys,
      aud: RELAY_PANEL_AUDIENCE,
      port: RELAY_PANEL_PORT,
      method: 'GET',
      url: '/api/fx/app/x',
      nonces: new NonceStore(),
    });
  };
  assert.deepEqual(forge({ type: 'user', username: 'alice', credential: { kind: 'bearer' } }), {
    ok: false,
    reason: 'malformed',
  });
  assert.deepEqual(forge({ type: 'user', username: 'alice', roles: ['admin'] }), {
    ok: false,
    reason: 'malformed',
  });
});

// ---------------------------------------------------------------------------
// Application hosts
// ---------------------------------------------------------------------------

const internal = (route, agentLabel) => ({
  id: `i-${route}`,
  exposure: 'internal',
  pluginRoute: route,
  agentLabel,
  port: 21000,
});

test('sites: the owner route first, then joined routes; served whichever agent hosts them', () => {
  const site = {
    id: 's1',
    fqdn: 'app.example.com',
    accessMode: 'restricted',
    owner: { plugin: 'shell' },
    userSurface: { routes: ['dir', 'shell', 'BAD', 'notify', 'dir'] },
  };
  assert.deepEqual(siteUserSurfaceRoutes(site), ['shell', 'dir', 'notify']);
  assert.deepEqual(siteUserSurfaceRoutes({ userSurface: { routes: ['dir'] } }), []);
  const many = { ...site, userSurface: { routes: Array.from({ length: 30 }, (_, i) => `r${i}`) } };
  assert.equal(siteUserSurfaceRoutes(many).length, 16);

  const tunnels = [internal('shell', 'a1'), internal('dir', 'a2')];
  const [host] = userSurfaceHosts(tunnels, [site]);
  assert.deepEqual(host.routes, ['shell', 'dir', 'notify']);
  assert.deepEqual(host.served, ['shell', 'dir']);

  // A joined route a tunnel also binds is served on neither.
  const bound = {
    id: 't1',
    type: 'app',
    fqdn: 'dir.example.com',
    agentLabel: 'a2',
    accessMode: 'restricted',
    userSurface: { routes: ['dir'] },
  };
  const hosts = userSurfaceHosts(tunnels, [site]).concat();
  const both = userSurfaceHosts([...tunnels, bound], [site]);
  assert.deepEqual(both.find((h) => h.kind === 'site').served, ['shell']);
  assert.deepEqual(both.find((h) => h.kind === 'tunnel').served, []);
  assert.equal(hosts.length, 1);
});

test('tunnels: a route another agent hosts is served only while the binding names the tunnel’s agent', () => {
  const tunnels = [internal('own', 'a1'), internal('far', 'a2'), internal('gone', undefined)];
  const tunnel = {
    id: 't1',
    type: 'app',
    fqdn: 'app.example.com',
    agentLabel: 'a1',
    accessMode: 'authenticated',
    userSurface: { routes: ['own', 'far', 'gone', 'unbound-x'] },
  };
  const all = [...tunnels, tunnel];
  assert.equal(tunnelOriginAgent(tunnel), null);
  assert.equal(tunnelUserSurfaceRouteState(all, tunnel, 'own'), 'served');
  assert.equal(tunnelUserSurfaceRouteState(all, tunnel, 'far'), 'cross_agent_unconfirmed');
  assert.equal(tunnelUserSurfaceRouteState(all, tunnel, 'gone'), 'not_hosted');
  assert.equal(tunnelUserSurfaceRouteState(all, tunnel, 'nope'), 'not_bound');
  assert.deepEqual(tunnelServedUserSurfaceRoutes(all, tunnel), ['own']);

  const confirmed = { ...tunnel, userSurface: { ...tunnel.userSurface, originAgent: 'a1' } };
  assert.equal(tunnelOriginAgent(confirmed), 'a1');
  assert.deepEqual(tunnelServedUserSurfaceRoutes([...tunnels, confirmed], confirmed), [
    'own',
    'far',
  ]);
  // Carried by another agent now: the confirmation lapses.
  const moved = { ...confirmed, agentLabel: 'a3' };
  assert.equal(
    tunnelUserSurfaceRouteState([...tunnels, moved], moved, 'far'),
    'cross_agent_unconfirmed',
  );
  assert.deepEqual(tunnelServedUserSurfaceRoutes([...tunnels, moved], moved), []);
  // A malformed origin is none.
  assert.equal(tunnelOriginAgent({ userSurface: { routes: [], originAgent: 'A B' } }), null);
});

// ---------------------------------------------------------------------------
// identity.signInEvents
// ---------------------------------------------------------------------------

const ROLES = { roles: [{ id: 'viewer', label: 'V' }] };

test('identity.signInEvents: normalized only when true; the digest of a block without it is unchanged', () => {
  assert.deepEqual(normalizeIdentityBlock({ ...ROLES, signInEvents: true }).signInEvents, true);
  assert.equal('signInEvents' in normalizeIdentityBlock({ ...ROLES, signInEvents: false }), false);
  assert.equal('signInEvents' in normalizeIdentityBlock(ROLES), false);
  const subject = { relay: null, agentHalf: null };
  const plain = approvalDigest({ ...subject, identity: ROLES });
  assert.equal(approvalDigest({ ...subject, identity: { ...ROLES, signInEvents: false } }), plain);
  assert.notEqual(
    approvalDigest({ ...subject, identity: { ...ROLES, signInEvents: true } }),
    plain,
  );
});

test('identity.signInEvents: turning it on waits for approval; turning it off does not', () => {
  const on = identityDiff(ROLES, { ...ROLES, signInEvents: true });
  assert.equal(on.signInEventsAdded, true);
  assert.equal(on.signInEventsRemoved, false);
  assert.equal(identityChangeNeedsApproval(on), true);
  const off = identityDiff({ ...ROLES, signInEvents: true }, ROLES);
  assert.equal(off.signInEventsRemoved, true);
  assert.equal(identityChangeNeedsApproval(off), false);
  assert.equal(identityDiff(null, null).signInEventsAdded, false);
  assert.equal(
    validateManifest({
      name: 'fx',
      version: '1.0.0',
      hosting: 'agent',
      agent: { package: '@lamalibre/fx-agent', service: { entry: 'dist/a.js' } },
      identity: { ...ROLES, signInEvents: true },
    }).identity.signInEvents,
    true,
  );
});

// ---------------------------------------------------------------------------
// Sign-in events
// ---------------------------------------------------------------------------

const U1 = '11111111-1111-4111-8111-111111111111';
const event = (seq, patch = {}) => ({
  seq,
  userId: U1,
  at: '2026-11-10T12:00:00.000Z',
  client: { kind: 'native', clientId: CLIENT },
  ...patch,
});

test('sign-in events: sealed to the plugin, the request and the envelope', () => {
  const secret = generateHostingSecret();
  const nonce = generateCallerAssertionNonce();
  const envelope = { from: 3, to: 9 };
  const events = [event(3), event(9)];
  const sealed = sealSignInEvents({ secret, plugin: 'fx', nonce, envelope, events });
  assert.ok(!JSON.stringify(sealed).includes(U1));
  const opened = openSignInEvents({ secret, plugin: 'fx', nonce, envelope, sealed });
  assert.deepEqual(parseSignInEvents(opened, envelope), events);
  for (const ctx of [
    { plugin: 'fy' },
    { nonce: generateCallerAssertionNonce() },
    { envelope: { from: 3, to: 10 } },
    { secret: generateHostingSecret() },
  ]) {
    assert.throws(
      () => openSignInEvents({ secret, plugin: 'fx', nonce, envelope, sealed, ...ctx }),
      /could not be opened/,
    );
  }
  assert.throws(
    () => sealSignInEvents({ secret, plugin: 'fx', nonce, envelope, events: [event(4), event(9)] }),
    /envelope/,
  );
  assert.throws(
    () => sealSignInEvents({ secret, plugin: 'fx', nonce, envelope, events: [event(9), event(3)] }),
    /envelope/,
  );
  assert.equal(
    parseSignInEvents([event(3, { client: { kind: 'web' } }), event(9)], envelope),
    null,
  );
  assert.equal(parseSignInEvents([event(3, { userId: 'x' }), event(9)], envelope), null);
  assert.equal(parseSignInEventsWire({ protocol: 1, from: 2, to: 1, events: sealed }), null);
  assert.equal(parseSignInEventsWire({ protocol: 2, from: 3, to: 9, events: sealed }), null);
  assert.deepEqual(parseSignInEventsWire({ protocol: 1, from: 3, to: 9, events: sealed }), {
    protocol: 1,
    from: 3,
    to: 9,
    events: sealed,
  });
});

test('sign-in events handler: end to end through callAgentHalf; only Lamaste, the body as signed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-native-signin-'));
  const secret = generateHostingSecret();
  const configPath = path.join(dir, 'half.json');
  await writeFile(
    configPath,
    JSON.stringify({
      plugin: 'fx',
      port: 0,
      secret,
      issuedAt: '2026-11-10T00:00:00.000Z',
      fetchedAt: '2026-11-10T00:00:01.000Z',
      acknowledged: true,
    }),
    { mode: 0o600 },
  );
  const received = [];
  const lines = [];
  let fail = false;
  const handler = createSignInEventsHandler({
    verifier: createCallerAssertionVerifier({ configPath, plugin: 'fx' }),
    onEvents: async (events) => {
      if (fail) throw new Error(`refused ${U1}`);
      received.push(...events);
    },
    logger: {
      info: (o, m) => lines.push(JSON.stringify([o, m])),
      warn: (o, m) => lines.push(JSON.stringify([o, m])),
    },
  });
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const out = await handler.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      res.writeHead(out.status, out.headers);
      res.end(out.bodyText);
    });
  });
  const port = await new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
  try {
    const envelope = { from: 1, to: 2 };
    const events = [event(1), event(2)];
    const call = () =>
      callAgentHalf({
        plugin: 'fx',
        port,
        secret,
        method: 'POST',
        path: AGENT_HALF_SIGN_IN_EVENTS_PATH,
        body: (nonce) => ({
          protocol: 1,
          ...envelope,
          events: sealSignInEvents({ secret, plugin: 'fx', nonce, envelope, events }),
        }),
        timeoutMs: 5_000,
        maxResponseBytes: 4096,
      });
    const ok = await call();
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { protocol: 1, acknowledged: 2 });
    assert.deepEqual(received, events);

    fail = true;
    const failed = await call();
    assert.equal(failed.status, 500);
    fail = false;

    // An admin caller is refused; an unsigned body is 401.
    const nonce = generateCallerAssertionNonce();
    const body = Buffer.from(
      JSON.stringify({
        protocol: 1,
        ...envelope,
        events: sealSignInEvents({ secret, plugin: 'fx', nonce, envelope, events }),
      }),
    );
    const asAdmin = await handler.handle({
      method: 'POST',
      url: AGENT_HALF_SIGN_IN_EVENTS_PATH,
      headers: {
        'x-lamalibre-caller': signCallerAssertion(
          {
            plugin: 'fx',
            caller: { type: 'admin' },
            method: 'POST',
            path: AGENT_HALF_SIGN_IN_EVENTS_PATH,
            nonce,
            bodySha256: bodySha256Hex(body),
          },
          secret,
        ),
      },
      body,
    });
    assert.equal(asAdmin.status, 403);
    const unsigned = await handler.handle({
      method: 'POST',
      url: AGENT_HALF_SIGN_IN_EVENTS_PATH,
      headers: {
        'x-lamalibre-caller': signCallerAssertion(
          {
            plugin: 'fx',
            caller: { type: 'lamaste' },
            method: 'POST',
            path: AGENT_HALF_SIGN_IN_EVENTS_PATH,
            nonce: generateCallerAssertionNonce(),
          },
          secret,
        ),
      },
      body,
    });
    assert.equal(unsigned.status, 401);
    assert.equal(
      (
        await handler.handle({
          method: 'GET',
          url: AGENT_HALF_SIGN_IN_EVENTS_PATH,
          headers: {},
          body,
        })
      ).status,
      405,
    );
    assert.equal(
      (await handler.handle({ method: 'POST', url: '/admin/identity/x', headers: {}, body }))
        .status,
      404,
    );
    assert.equal(
      (
        await handler.handle({
          method: 'POST',
          url: AGENT_HALF_SIGN_IN_EVENTS_PATH,
          headers: {},
          body: {},
        })
      ).status,
      400,
    );

    // Nothing about a user in a log line.
    assert.ok(lines.length > 0);
    for (const line of lines) assert.ok(!line.includes(U1), line);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
