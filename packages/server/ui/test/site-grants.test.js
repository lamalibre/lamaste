/**
 * Grants on a web surface's site, in the panel's words: whether they decide
 * who reaches it, who a user or a group leaves out without one, what the
 * grant looks like, which sites a grant can name, and what lifts a refusal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  explainSiteGrantRefusal,
  grantableSites,
  missingSiteAccessText,
  principalKey,
  siteAccessOf,
  siteGrantBody,
  siteGrantsDecide,
  siteOfRoute,
} from '../src/admin/lib/site-grants.js';

const user = (principalId) => ({ principalType: 'user', principalId });
const group = (principalId) => ({ principalType: 'group', principalId });

test('siteGrantsDecide: restricted and a missing mode decide; authenticated and no site do not', () => {
  assert.equal(siteGrantsDecide({ accessMode: 'restricted' }), true);
  assert.equal(siteGrantsDecide({ accessMode: null }), true);
  assert.equal(siteGrantsDecide({}), true);
  assert.equal(siteGrantsDecide({ accessMode: 'authenticated' }), false);
  assert.equal(siteGrantsDecide(null), false);
});

test('siteGrantBody and principalKey', () => {
  assert.deepEqual(siteGrantBody(group('ops'), 'site-1'), {
    principalType: 'group',
    principalId: 'ops',
    resourceType: 'site',
    resourceId: 'site-1',
    context: {},
  });
  assert.equal(principalKey(user('ayse')), 'user:ayse');
});

test('siteAccessOf: a user through their grant or a granted group; a group through its own grant', () => {
  const groups = [
    { name: 'ops', members: ['ayse', 'mehmet'] },
    { name: 'sales', members: ['zeynep', 'ali', 'mehmet'] },
  ];
  const grants = [user('ali'), group('ops')];
  assert.deepEqual(siteAccessOf(user('ali'), grants, groups), { granted: true, without: [] });
  assert.deepEqual(siteAccessOf(user('mehmet'), grants, groups), { granted: true, without: [] });
  assert.deepEqual(siteAccessOf(user('zeynep'), grants, groups), {
    granted: false,
    without: ['zeynep'],
  });
  assert.deepEqual(siteAccessOf(group('ops'), grants, groups), { granted: true, without: [] });
  // sales holds no grant: its members other grants do not admit are left out.
  assert.deepEqual(siteAccessOf(group('sales'), grants, groups), {
    granted: false,
    without: ['zeynep'],
  });
  // A group no grant names whose members are all admitted otherwise.
  assert.deepEqual(siteAccessOf(group('sales'), [...grants, user('zeynep')], groups), {
    granted: false,
    without: [],
  });
  assert.deepEqual(siteAccessOf(group('gone'), grants, groups), { granted: false, without: [] });
});

test('missingSiteAccessText: nothing when admitted; a user, a group with members left out', () => {
  assert.equal(missingSiteAccessText(user('a'), { granted: true, without: [] }, 'c.test'), null);
  assert.equal(missingSiteAccessText(group('g'), { granted: false, without: [] }, 'c.test'), null);
  assert.match(
    missingSiteAccessText(user('a'), { granted: false, without: ['a'] }, 'c.test'),
    /^No site access — holds no grant on c\.test/,
  );
  assert.equal(
    missingSiteAccessText(group('g'), { granted: false, without: ['a', 'b'] }, 'c.test'),
    '2 members without site access (a, b) — the group holds no grant on c.test',
  );
});

test('grantableSites: only plugin-owned sites, labelled with the plugin, by hostname', () => {
  const sites = [
    { id: 's-z', fqdn: 'z.test', owner: { plugin: 'corral' }, accessMode: 'restricted' },
    { id: 's-docs', fqdn: 'docs.test', allowedUsers: [] },
    { id: 's-h', fqdn: 'h.test', owner: { plugin: 'herd' }, accessMode: 'authenticated' },
  ];
  const plugins = [{ name: '@lamalibre/corral-server', route: 'corral', displayName: 'Corral' }];
  assert.deepEqual(grantableSites(sites, plugins), [
    {
      id: 's-h',
      fqdn: 'h.test',
      route: 'herd',
      restricted: false,
      label: 'h.test — web surface of herd (authenticated: grants count for nothing)',
    },
    {
      id: 's-z',
      fqdn: 'z.test',
      route: 'corral',
      restricted: true,
      label: 'z.test — web surface of Corral',
    },
  ]);
  assert.deepEqual(grantableSites(undefined, []), []);
  assert.equal(siteOfRoute(sites, 'corral').id, 's-z');
  assert.equal(siteOfRoute(sites, 'none'), null);
});

test('explainSiteGrantRefusal: the message, and what lifts it by code', () => {
  const err = Object.assign(new Error('No site has this id'), { code: 'unknown_site' });
  assert.deepEqual(explainSiteGrantRefusal(err), {
    message: 'No site has this id',
    hint: 'The site is gone — refresh the page.',
  });
  assert.deepEqual(explainSiteGrantRefusal('Gatekeeper said no'), {
    message: 'Gatekeeper said no',
    hint: null,
  });
});
