/**
 * The native apps page's helpers: the association form round trip, the
 * served file URLs, the words of a client's state and a grant's end, the
 * hosts a client can be registered for, and the person filter.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_GRANT_END_REASONS } from '@lamalibre/lamaste/native-apps';

import {
  associationFileUrls,
  associationsFromForm,
  associationsToForm,
  filterGrantsByPerson,
  grantEndText,
  nativeClientIdOf,
  nativeClientStatusText,
  nativeHostChoices,
  splitList,
} from '../src/admin/lib/native-apps.js';

const PRINT = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(':');

test('lists split on commas, spaces and line breaks', () => {
  assert.deepEqual(splitList(' a, b\nc  d,,'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(splitList(undefined), []);
});

test('the association form round-trips, blank parts left out', () => {
  const form = {
    teamId: ' ABCDE12345 ',
    bundleIds: 'com.example.app, com.example.beta',
    android: `com.example.app ${PRINT.toLowerCase()}\n\ncom.example.beta ${PRINT}`,
  };
  const value = associationsFromForm(form);
  assert.deepEqual(value, {
    ios: { teamId: 'ABCDE12345', bundleIds: ['com.example.app', 'com.example.beta'] },
    android: [
      { packageName: 'com.example.app', sha256CertFingerprints: [PRINT] },
      { packageName: 'com.example.beta', sha256CertFingerprints: [PRINT] },
    ],
  });
  assert.deepEqual(associationsFromForm(associationsToForm(value)), value);
  assert.deepEqual(associationsFromForm({}), {});
  assert.deepEqual(associationsToForm(undefined), { teamId: '', bundleIds: '', android: '' });
});

test('the file URLs are those the host serves for what is set', () => {
  assert.deepEqual(associationFileUrls({ fqdn: null, associations: { ios: {} } }), []);
  assert.deepEqual(
    associationFileUrls({
      fqdn: 'app.example.com',
      associations: { ios: { teamId: 'X', bundleIds: [] }, android: [{}] },
    }),
    [
      'https://app.example.com/.well-known/apple-app-site-association',
      'https://app.example.com/.well-known/assetlinks.json',
    ],
  );
  assert.deepEqual(associationFileUrls({ fqdn: 'a.example.com', associations: {} }), []);
});

test('every grant end reason has words', () => {
  for (const reason of NATIVE_GRANT_END_REASONS) {
    assert.notEqual(grantEndText(reason), reason, reason);
  }
  assert.equal(grantEndText(null), '');
});

test('a client is served or says why not', () => {
  assert.equal(nativeClientStatusText({ served: true }), 'Signs people in');
  assert.match(nativeClientStatusText({ served: false, reason: 'disabled' }), /Disabled/);
  assert.match(nativeClientStatusText({ served: false, reason: 'domain_inactive' }), /domain/);
  assert.equal(nativeClientStatusText({ served: false }), 'Not served');
});

test('only application hosts without a client are offered', () => {
  const hosts = nativeHostChoices({
    sites: [
      { id: 's1', fqdn: 'shop.example.com', owner: { plugin: 'shop' } },
      { id: 's2', fqdn: 'docs.example.com' },
    ],
    tunnels: [
      { id: 't1', fqdn: 'app.example.com', userSurface: { routes: ['a', 'b'] } },
      { id: 't2', fqdn: 'plain.example.com' },
      { id: 't3', fqdn: 'taken.example.com', userSurface: { routes: ['c'] } },
    ],
    clients: [{ hostKind: 'tunnel', hostId: 't3' }],
  });
  assert.deepEqual(
    hosts.map((h) => [h.kind, h.id]),
    [
      ['site', 's1'],
      ['tunnel', 't1'],
    ],
  );
  assert.match(hosts[1].label, /a, b/);
});

test('a slug makes a lamaste-native id', () => {
  assert.equal(nativeClientIdOf('shop'), 'lamaste-native-shop');
});

test('grants filter by person', () => {
  const grants = [
    { username: 'alice', userId: '1' },
    { username: null, userId: 'bob-id' },
  ];
  assert.equal(filterGrantsByPerson(grants, '').length, 2);
  assert.deepEqual(filterGrantsByPerson(grants, 'ALI'), [grants[0]]);
  assert.deepEqual(filterGrantsByPerson(grants, 'bob'), [grants[1]]);
});
