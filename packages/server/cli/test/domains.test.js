/**
 * `lamaste-server domains` in words: one row per domain and what uses it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  autheliaVersionText,
  domainRows,
  languageRequest,
  languageText,
  memberRequest,
  membershipsText,
  renderingText,
  usageText,
} from '../src/domains.js';

test('a row per domain: its state, members and what uses it', () => {
  assert.deepEqual(
    domainRows([
      { name: 'samplepark.tr', primary: true, status: 'active', members: 3, usedBy: {} },
      {
        name: 'codelama.com.tr',
        primary: false,
        status: 'active',
        members: 2,
        externalMembers: 4,
        usedBy: { tunnels: ['a', 'b'], sites: [], plugins: ['feria'], registry: true },
      },
      { name: 'new.example', primary: false, status: 'pending' },
    ]),
    [
      {
        name: 'samplepark.tr',
        state: 'primary',
        members: 3,
        externalMembers: 0,
        usedBy: '',
        language: null,
      },
      {
        name: 'codelama.com.tr',
        state: 'active',
        members: 2,
        externalMembers: 4,
        usedBy: '2 tunnel(s), 1 plugin(s), the registry credential',
        language: null,
      },
      {
        name: 'new.example',
        state: 'pending',
        members: 0,
        externalMembers: 0,
        usedBy: '',
        language: null,
      },
    ],
  );
  assert.equal(usageText(undefined), '');
});

test('a domain name a panel answer carries is terminal text', () => {
  const [row] = domainRows([{ name: 'evil\u001b[31m.example', status: 'active', members: 0 }]);
  assert.ok(!row.name.includes('\u001b'));
});

test('a membership command line: add (external with the flag), kind, remove', () => {
  const path = '/api/domains/codelama.com.tr/members/ali';
  assert.deepEqual(memberRequest('codelama.com.tr', ['add', 'ali']), {
    method: 'PUT',
    path,
    body: { kind: 'member' },
    user: 'ali',
    kind: 'member',
  });
  assert.deepEqual(memberRequest('codelama.com.tr', ['add', 'ali', '--external']).body, {
    kind: 'external',
  });
  assert.deepEqual(memberRequest('codelama.com.tr', ['kind', 'ali', 'external']).body, {
    kind: 'external',
  });
  assert.equal(memberRequest('codelama.com.tr', ['remove', 'ali']).method, 'DELETE');
  // Nothing the panel would be asked to guess at.
  assert.equal(memberRequest('codelama.com.tr', ['add']), null);
  assert.equal(memberRequest('codelama.com.tr', ['add', 'ali', '--admin']), null);
  assert.equal(memberRequest('codelama.com.tr', ['kind', 'ali']), null);
  assert.equal(memberRequest('codelama.com.tr', ['kind', 'ali', 'owner']), null);
  assert.equal(memberRequest('codelama.com.tr', ['remove', 'ali', '--external']), null);
  assert.equal(
    memberRequest('codelama.com.tr', ['add', '../x']).path,
    '/api/domains/codelama.com.tr/members/..%2Fx',
  );
});

test('memberships in one line, external ones marked, as terminal text', () => {
  assert.equal(
    membershipsText([{ name: 'a.example', kind: 'external' }, 'b.example']),
    'a.example (external), b.example',
  );
  assert.equal(membershipsText(undefined), '—');
  assert.ok(!membershipsText([{ name: 'x\u001b[31m.example', kind: 'member' }]).includes('\u001b'));
});

test('a row carries the domain’s page language, only one of the page languages', () => {
  const rows = domainRows([
    { name: 'alpha.test', status: 'active', members: 1, language: 'tr' },
    { name: 'beta.test', status: 'active', members: 1, language: 'tr-TR' },
  ]);
  assert.deepEqual(
    rows.map((r) => r.language),
    ['tr', null],
  );
});

test('the language command line: show, set, clear; anything else is a usage error', () => {
  assert.deepEqual(languageRequest('alpha.test', []), { action: 'show' });
  assert.deepEqual(languageRequest('alpha.test', ['tr']), {
    action: 'set',
    language: 'tr',
    path: '/api/domains/alpha.test/language',
    body: { language: 'tr' },
  });
  assert.deepEqual(languageRequest('alpha.test', ['--unset']).body, { language: null });
  // The panel decides which languages exist: an unknown one is sent and refused there.
  assert.deepEqual(languageRequest('alpha.test', ['de']).body, { language: 'de' });
  assert.equal(languageRequest('alpha.test', ['tr', 'en']), null);
  assert.equal(languageRequest('alpha.test', ['--force']), null);
});

test('a language, a rendering and the relay’s Authelia in words', () => {
  assert.equal(languageText('tr'), 'tr (Türkçe)');
  assert.equal(languageText(null), 'not set — English pages, sign-in following the browser');
  const rendering = {
    rendered: { v: 1 },
    current: true,
    renderFailing: false,
    vhostPending: false,
  };
  assert.equal(renderingText({ status: 'active', rendering: null }), null);
  assert.equal(renderingText({ status: 'active', rendering }), 'rendered and served');
  assert.equal(renderingText({ status: 'pending', rendering }), 'rendered; served once active');
  assert.equal(
    renderingText({ status: 'active', rendering: { ...rendering, current: false } }),
    'rendering (within a minute)',
  );
  assert.equal(
    renderingText({ status: 'active', rendering: { ...rendering, vhostPending: true } }),
    'rendered; the vhost waits for a retry',
  );
  assert.match(
    renderingText({ status: 'active', rendering: { ...rendering, renderFailing: true } }),
    /failed/,
  );
  assert.equal(autheliaVersionText({ running: '4.39.28', pinned: '4.39.28' }), null);
  assert.equal(autheliaVersionText({ running: null, pinned: '4.39.28' }), null);
  assert.match(
    autheliaVersionText({ running: '4.40.1', pinned: '4.39.28' }),
    /^Authelia 4\.40\.1 runs/,
  );
});
