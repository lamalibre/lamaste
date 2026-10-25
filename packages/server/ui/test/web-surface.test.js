/**
 * Plugins' web surfaces, in the panel's words: why a site does not serve
 * the shell yet, what lifts a refused request, which subdomains the panel
 * would refuse, when Create and Move can be used, which sites a plugin
 * owns, and how an update changes a plugin's web tree.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  accessModeText,
  createBlock,
  explainWebSurfaceRefusal,
  formatTreeSize,
  moveBlock,
  notServedReasonText,
  ownedSiteRoutes,
  pluginAnchorId,
  servedText,
  shortDigest,
  showsWebSurface,
  siteOwner,
  siteOwnerRoute,
  subdomainProblem,
  treeSummary,
  webTreeChange,
} from '../src/admin/lib/web-surface.js';

const SHA_A = 'a'.repeat(56) + '01234567';
const SHA_B = 'b'.repeat(56) + '89abcdef';

const DECLARED = { defaultSubdomain: 'piyasa', accessMode: 'authenticated', root: 'web' };
const SITE = { id: 's1', name: 'piyasa', fqdn: 'piyasa.example.com', accessMode: 'restricted' };

/** A web surface view as `GET /api/plugins/:name/web-surface` answers. */
function view(overrides = {}) {
  return {
    declared: DECLARED,
    site: null,
    served: false,
    reason: 'not_approved',
    tree: { approved: SHA_A, current: null, previous: null },
    boundTunnel: null,
    offer: { subdomain: 'piyasa', accessMode: 'authenticated', available: true },
    ...overrides,
  };
}

test('a tree digest is shortened for the eye, kept whole elsewhere', () => {
  assert.equal(shortDigest(SHA_A), 'aaaaaaaa…234567');
  assert.equal(shortDigest('short'), 'short');
  assert.equal(shortDigest(null), '');
});

test('tree sizes read in bytes, kilobytes and megabytes', () => {
  assert.equal(formatTreeSize(0), '0 B');
  assert.equal(formatTreeSize(512), '512 B');
  assert.equal(formatTreeSize(1536), '1.5 KB');
  assert.equal(formatTreeSize(3 * 1024 * 1024), '3.0 MB');
  assert.equal(formatTreeSize(undefined), 'unknown size');
  assert.equal(treeSummary({ files: 12, totalBytes: 2048 }), '12 files, 2.0 KB');
  assert.equal(treeSummary({ files: 1, totalBytes: 10 }), '1 file, 10 B');
});

test('access modes in words', () => {
  assert.match(accessModeText('authenticated'), /any signed-in member/);
  assert.match(accessModeText('restricted'), /granted the site/);
  assert.equal(accessModeText(null), 'unknown');
});

test('served, or why the site answers 503', () => {
  assert.deepEqual(servedText(view({ site: SITE, served: true, reason: null })), {
    served: true,
    text: 'Served — its site serves the approved shell and its user-surface API',
  });
  assert.match(servedText(view({ served: true, reason: null })).text, /give it a site/);
  const waiting = servedText(view({ site: SITE }));
  assert.equal(waiting.served, false);
  assert.match(waiting.text, /^Its site answers 503: .*waits for approval/);
  assert.match(servedText(view()).text, /^Not served: /);
  assert.deepEqual(servedText(null), { served: false, text: 'Unknown' });
});

test('every reason a web surface is not served has a sentence', () => {
  for (const reason of [
    'not_installed',
    'no_identity',
    'no_web_surface',
    'not_approved',
    'not_hosted',
    'tree_not_current',
  ]) {
    const text = notServedReasonText(reason);
    assert.notEqual(text, reason, reason);
    assert.ok(text.length > 20, reason);
  }
  assert.match(notServedReasonText('tree_not_current'), /approved web tree/);
  assert.equal(notServedReasonText('something_new'), 'something_new');
});

test('a refusal keeps the panel’s message and says what lifts it', () => {
  const err = Object.assign(new Error("Cannot use 'piyasa': a tunnel holds 'piyasa'"), {
    status: 409,
    code: 'hostname_taken',
  });
  const explained = explainWebSurfaceRefusal(err);
  assert.equal(explained.message, "Cannot use 'piyasa': a tunnel holds 'piyasa'");
  assert.equal(explained.code, 'hostname_taken');
  assert.match(explained.hint, /another subdomain/);
  for (const code of [
    'no_web_surface',
    'no_identity',
    'exists',
    'bound_to_tunnel',
    'not_bound',
    'shared_tunnel',
    'tunnel_disabled',
    'not_hosted',
    'not_approved',
    'web_tree',
    'gatekeeper',
    'not_found',
  ]) {
    assert.ok(explainWebSurfaceRefusal(Object.assign(new Error('x'), { code })).hint, code);
  }
  // Without a code (or one the panel does not know) only the message.
  assert.deepEqual(explainWebSurfaceRefusal(new Error('boom')), {
    message: 'boom',
    code: null,
    hint: null,
  });
  assert.equal(explainWebSurfaceRefusal('a string').hint, null);
});

test('subdomains the panel would refuse', () => {
  assert.equal(subdomainProblem('piyasa'), null);
  assert.equal(subdomainProblem('my-app2'), null);
  assert.match(subdomainProblem(''), /Enter/);
  assert.match(subdomainProblem('-bad'), /DNS label/);
  assert.match(subdomainProblem('Upper'), /DNS label/);
  assert.match(subdomainProblem('a.b'), /DNS label/);
  assert.match(subdomainProblem('x'.repeat(64)), /DNS label/);
  assert.match(subdomainProblem('panel'), /reserved/);
  assert.match(subdomainProblem('www'), /reserved/);
  assert.match(subdomainProblem('agent-foo'), /agent panels/);
});

test('Create: blocked while it owns a site, declares none, is served by a tunnel, or the offer is taken', () => {
  assert.equal(createBlock(view()), null);
  assert.match(createBlock(view({ site: SITE, offer: null })), /owns a site/);
  assert.match(createBlock(view({ declared: null, offer: null })), /declares no web surface/);
  assert.match(
    createBlock(view({ boundTunnel: { id: 't1', fqdn: 'old.example.com', routes: ['mi'] } })),
    /old\.example\.com is bound .* move it instead/,
  );
  const taken = view({
    offer: { subdomain: 'piyasa', accessMode: 'authenticated', available: false },
  });
  assert.match(createBlock(taken), /'piyasa' is held/);
  // Another subdomain typed in: the panel says whether that one is free.
  assert.equal(createBlock(taken, { edited: true }), null);
  assert.equal(createBlock(null), 'Loading');
});

test('Move: only from a tunnel bound to this plugin alone, while it owns no site', () => {
  const bound = { id: 't1', fqdn: 'piyasa.example.com', routes: ['mi'] };
  assert.equal(moveBlock(view({ boundTunnel: bound }), 'mi'), null);
  assert.match(moveBlock(view(), 'mi'), /No tunnel is bound/);
  assert.match(moveBlock(view({ boundTunnel: bound, site: SITE }), 'mi'), /owns a site/);
  assert.match(moveBlock(view({ boundTunnel: bound, declared: null }), 'mi'), /declares no web/);
  assert.match(
    moveBlock(view({ boundTunnel: { ...bound, routes: ['mi', 'other'] } }), 'mi'),
    /other user surfaces too \(other\)/,
  );
});

test('sites a plugin owns, and who owns them', () => {
  const owned = { id: 's1', name: 'piyasa', owner: { plugin: 'mi' } };
  const own = { id: 's2', name: 'blog' };
  assert.equal(siteOwnerRoute(owned), 'mi');
  assert.equal(siteOwnerRoute(own), null);
  assert.equal(siteOwnerRoute({ owner: { plugin: 7 } }), null);
  assert.deepEqual([...ownedSiteRoutes([owned, own])], ['mi']);
  assert.equal(ownedSiteRoutes(undefined).size, 0);

  const plugins = [{ name: 'market-indicators', route: 'mi', displayName: 'Market Indicators' }];
  assert.deepEqual(siteOwner(owned, plugins), {
    route: 'mi',
    name: 'market-indicators',
    label: 'Market Indicators',
  });
  // The route no installed plugin holds any more: named by its route.
  assert.deepEqual(siteOwner(owned, []), { route: 'mi', name: null, label: 'mi' });
  assert.equal(siteOwner(own, plugins), null);
});

test('the Web surface panel shows for agent-hosted plugins that declare one or own a site', () => {
  const owned = new Set(['mi']);
  const none = new Set();
  const agent = { hosting: 'agent', route: 'mi' };
  assert.equal(showsWebSurface({ ...agent, userSurface: { web: DECLARED } }, none), true);
  // An older version's site, kept until deleted.
  assert.equal(showsWebSurface(agent, owned), true);
  assert.equal(showsWebSurface(agent, none), false);
  assert.equal(
    showsWebSurface({ ...agent, hosting: 'relay', userSurface: { web: DECLARED } }, owned),
    false,
  );
  assert.equal(pluginAnchorId('market-indicators'), 'plugin-market-indicators');
});

test('how an update changes a plugin’s web tree', () => {
  assert.equal(webTreeChange(null), null);
  assert.equal(webTreeChange({ before: null, after: null }), null);
  const after = { sha256: SHA_B, files: 3, totalBytes: 4096 };
  assert.deepEqual(webTreeChange({ before: null, after }), {
    kind: 'added',
    before: null,
    after,
    changes: null,
  });
  assert.deepEqual(webTreeChange({ before: SHA_A, after: null }), {
    kind: 'removed',
    before: SHA_A,
    after: null,
    changes: null,
  });
  assert.equal(webTreeChange({ before: SHA_A, after }).kind, 'changed');
  assert.equal(webTreeChange({ before: SHA_B, after }).kind, 'unchanged');
  // What changes by path passes through, for the approval to list.
  const changes = {
    added: { count: 1, paths: ['page-v2.html'] },
    removed: { count: 0, paths: [] },
    changed: { count: 1, paths: ['index.html'] },
    review: ['page-v2.html'],
  };
  assert.deepEqual(webTreeChange({ before: SHA_A, after, changes }).changes, changes);
});

test('create and move say why while a disabled tunnel is still bound', () => {
  const view = {
    site: null,
    declared: { defaultSubdomain: 'piyasa' },
    boundTunnel: { id: 't1', fqdn: 'piyasa.example.com', enabled: false, routes: ['mi'] },
    offer: null,
  };
  assert.match(createBlock(view), /disabled — unbind it, or enable it and move it/);
  assert.match(moveBlock(view, 'mi'), /disabled — enable it to move it, or unbind it/);
  assert.equal(notServedReasonText('not_owner').includes('another package'), true);
});
