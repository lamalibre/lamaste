/**
 * `lamaste-server plugins web-surface`: its arguments (an action, its
 * flags, a subdomain and access mode a web surface may have), the body it
 * sends, and the words of its output — whether the site is served and why
 * not, the trees, what a refusal asks next — and how `sites list` marks a
 * site a plugin owns.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WEB_SURFACE_USAGE,
  bytesText,
  createBody,
  parseWebSurfaceArgs,
  shortDigest,
  siteOwnerTag,
  webSurfaceRefusalHint,
  webSurfaceServedText,
  webTreeRows,
} from '../src/plugin-web-surface.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('web-surface arguments: the status, and each action with its flags', () => {
  assert.deepEqual(parseWebSurfaceArgs(['piyasa']), {
    ok: true,
    name: 'piyasa',
    action: 'status',
  });
  assert.deepEqual(parseWebSurfaceArgs(['piyasa', 'create']), {
    ok: true,
    name: 'piyasa',
    action: 'create',
    subdomain: null,
    accessMode: null,
  });
  assert.deepEqual(
    parseWebSurfaceArgs([
      'piyasa',
      'create',
      '--subdomain',
      'market',
      '--access-mode',
      'restricted',
    ]),
    { ok: true, name: 'piyasa', action: 'create', subdomain: 'market', accessMode: 'restricted' },
  );
  // Flags may come before the action.
  assert.deepEqual(parseWebSurfaceArgs(['piyasa', '--tunnel', 'piyasa.example.com', 'move']), {
    ok: true,
    name: 'piyasa',
    action: 'move',
    tunnel: 'piyasa.example.com',
  });
  assert.deepEqual(parseWebSurfaceArgs(['piyasa', 'delete']), {
    ok: true,
    name: 'piyasa',
    action: 'delete',
    yes: false,
  });
  assert.deepEqual(parseWebSurfaceArgs(['piyasa', 'delete', '--yes']), {
    ok: true,
    name: 'piyasa',
    action: 'delete',
    yes: true,
  });
});

test('web-surface arguments: what is refused, and why', () => {
  assert.deepEqual(parseWebSurfaceArgs([]), { ok: false, error: WEB_SURFACE_USAGE });
  const refused = (args, re) => {
    const parsed = parseWebSurfaceArgs(args);
    assert.equal(parsed.ok, false, JSON.stringify(args));
    assert.match(parsed.error, re, JSON.stringify(args));
  };
  refused(['piyasa', 'rename'], /^Unknown action "rename"/);
  refused(['piyasa', 'status'], /^Unknown action "status"/);
  refused(['piyasa', 'create', 'extra'], /^Unexpected argument "extra"/);
  refused(['piyasa', '--yes'], /^Unknown option --yes/);
  refused(['piyasa', 'create', '--yes'], /^create takes no --yes/);
  refused(['piyasa', 'delete', '--tunnel', 't1'], /^delete takes no --tunnel/);
  refused(['piyasa', 'move', '--subdomain', 'x'], /^move takes no --subdomain/);
  refused(['piyasa', 'move'], /^Name the tunnel to move/);
  refused(['piyasa', 'move', '--tunnel'], /^--tunnel needs a value/);
  refused(['piyasa', 'move', '--tunnel', '--yes'], /^--tunnel needs a value/);
  refused(['piyasa', 'create', '--subdomain', 'a', '--subdomain', 'b'], /given twice/);
  refused(['piyasa', 'create', '--access-mode', 'public'], /never public/);
  // Reserved, an agent panel's, not a DNS label.
  for (const subdomain of ['panel', 'auth', 'agent-x', 'Market', '-a', 'a_b', 'a.b']) {
    refused(['piyasa', 'create', '--subdomain', subdomain], /cannot be a web surface's subdomain/);
  }
});

test('the create body carries only what was given', () => {
  assert.deepEqual(createBody({ subdomain: null, accessMode: null }), {});
  assert.deepEqual(createBody({ subdomain: 'market', accessMode: null }), { subdomain: 'market' });
  assert.deepEqual(createBody({ subdomain: null, accessMode: 'restricted' }), {
    accessMode: 'restricted',
  });
});

test('digests and sizes in words', () => {
  assert.equal(shortDigest(SHA_A), 'aaaaaaaaaaaa');
  assert.equal(shortDigest(null), '—');
  assert.equal(shortDigest(''), '—');
  assert.equal(shortDigest('ab\u001b[2Jcdefghijklmn'), 'ab[2Jcdefgh');
  assert.equal(bytesText(0), '0 B');
  assert.equal(bytesText(1023), '1023 B');
  assert.equal(bytesText(1536), '1.5 KiB');
  assert.equal(bytesText(20 * 1024), '20 KiB');
  assert.equal(bytesText(3 * 1024 * 1024 + 300 * 1024), '3.3 MiB');
  assert.equal(bytesText(undefined), 'an unknown size');
  assert.equal(bytesText(-1), 'an unknown size');
});

test('served: with a site, without one, and each reason it is not', () => {
  const site = { id: 's1', name: 'piyasa', fqdn: 'piyasa.example.com', accessMode: null };
  assert.deepEqual(webSurfaceServedText({ served: true, reason: null, site }, 'mi'), {
    served: true,
    text: 'served — its site serves the shell and the API',
  });
  // Servable, but nothing serves it until it owns a site.
  const noSite = webSurfaceServedText({ served: true, reason: null, site: null }, 'mi');
  assert.equal(noSite.served, false);
  assert.match(noSite.text, /owns no site yet/);

  const reasons = {
    not_installed: /not installed/,
    no_identity: /declares no identity/,
    no_web_surface: /declares no web surface/,
    not_approved: /waits for approval: lamaste-server plugins hooks mi/,
    not_hosted: /not hosted .* lamaste-server plugins hosting mi/,
    tree_not_current: /approved web tree yet/,
  };
  for (const [reason, re] of Object.entries(reasons)) {
    const withSite = webSurfaceServedText({ served: false, reason, site }, 'mi');
    assert.equal(withSite.served, false, reason);
    assert.match(withSite.text, re, reason);
    assert.match(withSite.text, /its site answers 503/, reason);
    assert.match(
      webSurfaceServedText({ served: false, reason, site: null }, 'mi').text,
      /it owns no site yet/,
      reason,
    );
  }
  // A reason this CLI does not know reaches the terminal printable.
  assert.equal(
    webSurfaceServedText({ served: false, reason: 'new\u0007_reason', site }, 'mi').text,
    'not served (new_reason; its site answers 503)',
  );
});

test('trees: short digests, and whether the one served is the approved one', () => {
  assert.deepEqual(webTreeRows({ approved: SHA_A, current: SHA_A, previous: SHA_B }), [
    ['approved tree', 'aaaaaaaaaaaa'],
    ['serving', 'aaaaaaaaaaaa (the approved tree)'],
    ['previous', 'bbbbbbbbbbbb (fallback for pages still open)'],
  ]);
  // An approved update the relay has not switched to yet.
  assert.deepEqual(webTreeRows({ approved: SHA_B, current: SHA_A, previous: null }), [
    ['approved tree', 'bbbbbbbbbbbb'],
    ['serving', 'aaaaaaaaaaaa (not the approved tree)'],
    ['previous', 'none'],
  ]);
  assert.deepEqual(webTreeRows(null), [
    ['approved tree', 'none'],
    ['serving', 'none'],
    ['previous', 'none'],
  ]);
});

test('a refusal points to the next step; one without a hint says all there is', () => {
  assert.equal(
    webSurfaceRefusalHint('hostname_taken', 'mi'),
    'Choose another subdomain: lamaste-server plugins web-surface mi create --subdomain <label>',
  );
  assert.match(webSurfaceRefusalHint('bound_to_tunnel', 'mi'), /web-surface mi move --tunnel/);
  assert.match(webSurfaceRefusalHint('not_approved', 'mi'), /plugins hooks mi$/);
  assert.match(webSurfaceRefusalHint('not_hosted', 'mi'), /plugins hosting mi$/);
  assert.match(webSurfaceRefusalHint('shared_tunnel', 'mi'), /unbind-user-surface/);
  assert.match(webSurfaceRefusalHint('tunnel_disabled', 'mi'), /toggle <id> --enable/);
  for (const code of [
    'no_web_surface',
    'no_identity',
    'exists',
    'not_bound',
    'web_tree',
    'gatekeeper',
  ]) {
    assert.equal(typeof webSurfaceRefusalHint(code, 'mi'), 'string', code);
  }
  assert.equal(webSurfaceRefusalHint('not_found', 'mi'), null);
  assert.equal(webSurfaceRefusalHint(undefined, 'mi'), null);
  assert.equal(webSurfaceRefusalHint('toString', 'mi'), null);
  // The plugin's name reaches the terminal printable.
  assert.equal(
    webSurfaceRefusalHint('not_approved', 'm\u001b[2Ji'),
    'Approve its installed version first: lamaste-server plugins hooks m[2Ji',
  );
});

test('sites list marks a site a plugin owns, with its access mode', () => {
  assert.equal(
    siteOwnerTag({
      name: 'piyasa',
      owner: { plugin: 'market-indicators' },
      accessMode: 'restricted',
    }),
    '[plugin market-indicators, restricted]',
  );
  assert.equal(
    siteOwnerTag({ name: 'piyasa', owner: { plugin: 'market-indicators' } }),
    '[plugin market-indicators]',
  );
  assert.equal(siteOwnerTag({ name: 'blog' }), null);
  assert.equal(siteOwnerTag({ name: 'blog', owner: null }), null);
  assert.equal(siteOwnerTag({ name: 'blog', owner: { plugin: 7 } }), null);
  assert.equal(siteOwnerTag({ owner: { plugin: 'm\u001b[2Ji' } }), '[plugin m[2Ji]');
});
