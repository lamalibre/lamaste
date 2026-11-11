/**
 * `lamaste-server native-apps`: its arguments, the bodies it sends, the host
 * it names and what it prints of a client and a grant.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clientIdOf,
  findApplicationHost,
  grantEndWords,
  grantLine,
  nativeClientRows,
  nativeSettingsBody,
  parseNativeAppsArgs,
} from '../src/native-apps.js';

const PRINT = Array.from({ length: 32 }, () => 'ab').join(':');

test('a client is named by its id or its slug', () => {
  assert.equal(clientIdOf('lamaste-native-shop'), 'lamaste-native-shop');
  assert.equal(clientIdOf('shop'), 'lamaste-native-shop');
  assert.equal(clientIdOf('Shop!'), null);
  // A slug may look like anything a slug can be.
  assert.equal(clientIdOf('lamaste-server'), 'lamaste-native-lamaste-server');
});

test('arguments: one positional, known flags once, --android repeats', () => {
  const parsed = parseNativeAppsArgs([
    'create',
    'shop',
    '--host',
    'shop.example.com',
    '--android',
    `a.b=${PRINT}`,
    '--android',
    `c.d=${PRINT}`,
    '--disabled',
  ]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.target, 'shop');
  assert.equal(parsed.flags.get('--host'), 'shop.example.com');
  assert.equal(parsed.flags.get('--disabled'), true);
  assert.deepEqual(parsed.android, [`a.b=${PRINT}`, `c.d=${PRINT}`]);
  assert.equal(parseNativeAppsArgs(['list']).ok, true);
  assert.equal(parseNativeAppsArgs(['list', 'x']).ok, false);
  assert.match(parseNativeAppsArgs(['update', 'shop', '--host', 'x']).error, /takes no --host/);
  assert.match(parseNativeAppsArgs(['grants', 'shop', '--user']).error, /needs a value/);
  assert.match(
    parseNativeAppsArgs(['update', 'shop', '--name', 'a', '--name', 'b']).error,
    /given twice/,
  );
  assert.equal(parseNativeAppsArgs(['nope']).ok, false);
  assert.equal(parseNativeAppsArgs([]).ok, false);
});

test('settings become the body, only what was given', () => {
  const flags = new Map([
    ['--name', 'Shop'],
    ['--redirect', '/oauth/callback, /oauth/beta'],
    ['--idle-days', '7'],
    ['--ios-team', 'ABCDE12345'],
    ['--ios-bundle', 'com.example.shop'],
  ]);
  assert.deepEqual(nativeSettingsBody(flags, [`com.example.shop=${PRINT}`]), {
    ok: true,
    body: {
      name: 'Shop',
      redirectPaths: ['/oauth/callback', '/oauth/beta'],
      idleDays: 7,
      associations: {
        ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.shop'] },
        android: [
          { packageName: 'com.example.shop', sha256CertFingerprints: [PRINT.toUpperCase()] },
        ],
      },
    },
  });
  assert.deepEqual(nativeSettingsBody(new Map(), []), { ok: true, body: {} });
  // An update keeps the other platform's association.
  const current = { associations: { ios: { teamId: 'T', bundleIds: ['x.y'] } } };
  assert.deepEqual(nativeSettingsBody(new Map(), [`a.b=${PRINT}`], current).body.associations.ios, {
    teamId: 'T',
    bundleIds: ['x.y'],
  });
  assert.match(nativeSettingsBody(new Map([['--idle-days', 'x']]), []).error, /whole number/);
  assert.match(nativeSettingsBody(new Map([['--ios-team', 'T']]), []).error, /go together/);
  assert.match(nativeSettingsBody(new Map(), ['nofingerprint']).error, /--android is/);
});

test('an application host by id or FQDN: a plugin-owned site or a bound tunnel', () => {
  const state = {
    sites: [
      { id: 's1', fqdn: 'shop.example.com', owner: { plugin: 'shop' } },
      { id: 's2', fqdn: 'docs.example.com' },
    ],
    tunnels: [
      { id: 't1', fqdn: 'app.example.com', userSurface: { routes: ['a'] } },
      { id: 't2', fqdn: 'plain.example.com' },
    ],
  };
  assert.deepEqual(findApplicationHost(state, 'SHOP.example.com'), {
    hostKind: 'site',
    hostId: 's1',
    fqdn: 'shop.example.com',
  });
  assert.equal(findApplicationHost(state, 't1').hostKind, 'tunnel');
  assert.match(findApplicationHost(state, 'docs.example.com').error, /no application host/);
  assert.match(findApplicationHost(state, 'plain.example.com').error, /no application host/);
});

test('what a client and a grant print', () => {
  const rows = nativeClientRows({
    clientId: 'lamaste-native-shop',
    name: 'Shop\u001b[2J',
    hostKind: 'site',
    fqdn: 'shop.example.com',
    served: false,
    reason: 'disabled',
    audience: 'https://shop.example.com',
    redirectUris: ['https://shop.example.com/oauth/callback'],
    redirectPaths: ['/oauth/callback'],
    accessTokenMinutes: 15,
    idleDays: 30,
    absoluteDays: 90,
    servedRoutes: ['shop'],
    associations: { android: [{ packageName: 'a.b', sha256CertFingerprints: [PRINT] }] },
  });
  assert.deepEqual(rows[0], ['name', 'Shop[2J']);
  assert.match(Object.fromEntries(rows).state, /disabled/);
  assert.match(Object.fromEntries(rows).Android, /1 fingerprint/);
  const line = grantLine({
    grantId: 'g',
    clientId: 'lamaste-native-shop',
    username: 'alice',
    deviceName: null,
    createdAt: 'c',
    lastUsedAt: 'l',
    status: 'ended',
    endedAt: 'e',
    endedReason: 'reuse',
  });
  assert.match(line, /alice · unnamed device/);
  assert.match(line, /spent refresh token/);
  assert.equal(grantEndWords('standing:no_role').includes('no role'), true);
});
