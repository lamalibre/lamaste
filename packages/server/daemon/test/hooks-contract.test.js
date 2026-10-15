/**
 * Lifecycle hooks (slice 2b), the contract: the manifest's `hooks` block,
 * hook sets and their digest, route patterns, the shared secret scanner,
 * decision validation, and reading a package tarball in memory.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  validateManifest,
  relayHookSetOf,
  agentHookSetOf,
  relayHookSetDigest,
  relayHookSetPreview,
  hookEntrySha256,
} from '@lamalibre/lamaste';
import {
  parseRoutePattern,
  routePattern,
  matchRoutePattern,
  requestPathSegments,
  findSecrets,
  redactSecrets,
  secretScanHook,
  unscannableReason,
} from '@lamalibre/lamaste/hooks';
import {
  validateHookDecision,
  isHookEditableHeader,
  readTarballFiles,
} from '@lamalibre/lamaste/server';

const base = {
  name: 'fx',
  version: '1.0.0',
  hosting: 'agent',
  agent: { requires: { os: ['linux'] } },
};

const fullHooks = {
  relay: {
    entry: 'hooks/relay.mjs',
    effects: ['audit', 'notify-admins'],
    install: { 'pre-tunnel': { timeoutMs: 60000 }, 'post-tunnel': {} },
    uninstall: { 'pre-teardown': {} },
    request: [
      {
        stage: 'pre-forward',
        routes: ['POST /admin/import/*'],
        body: { maxBytes: 1048576 },
        timeoutMs: 200,
        onError: 'reject',
      },
      {
        stage: 'post-forward',
        use: 'lamaste:secret-scan',
        routes: ['GET /admin/export/*', 'GET /app/*'],
        body: { maxBytes: 5242880 },
        with: { action: 'redact', packs: ['credentials', 'jwt'], onUnscannable: 'pass' },
      },
    ],
    tunnel: { down: { timeoutMs: 2000 }, up: {} },
  },
  agent: {
    install: { 'pre-tunnel': {}, 'post-tunnel': {} },
    uninstall: { 'pre-teardown': {}, 'post-teardown': {} },
    tunnel: { down: {}, up: {} },
  },
};

function manifestError(hooks, extra = {}) {
  try {
    validateManifest({ ...base, ...extra, hooks });
    return null;
  } catch (err) {
    return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('manifest: a complete hooks block validates', () => {
  const m = validateManifest({ ...base, hooks: fullHooks });
  assert.equal(m.hooks.relay.request.length, 2);
});

test('manifest: hooks need an agent-hosted plugin with an agent half', () => {
  assert.match(manifestError(fullHooks, { agent: undefined }), /agent half/);
  assert.match(manifestError(fullHooks, { hosting: 'server', agent: undefined }), /agent half/);
});

test('manifest: the hooks block is checked strictly', () => {
  const relay = (r) => ({ relay: { entry: 'h.mjs', ...r } });
  // An own hook without a module, a module without own hooks.
  assert.match(manifestError({ relay: { tunnel: { down: {} } } }), /need "entry"/);
  assert.match(manifestError({ relay: { entry: 'h.mjs' } }), /no relay hook/);
  // Entry inside the package only.
  assert.match(
    manifestError({ relay: { entry: '../h.mjs', tunnel: { down: {} } } }),
    /relative path/,
  );
  assert.match(
    manifestError({ relay: { entry: '/etc/h.mjs', tunnel: { down: {} } } }),
    /relative path/,
  );
  // Unknown stage, caps.
  assert.match(manifestError(relay({ install: { 'mid-tunnel': {} } })), /Unrecognized key/);
  assert.match(manifestError(relay({ tunnel: { down: { timeoutMs: 60000 } } })), /tunnel/);
  const req = (h) =>
    manifestError(relay({ request: [{ stage: 'pre-forward', routes: ['/admin/x'], ...h }] }));
  assert.match(req({ timeoutMs: 5000 }), /timeoutMs/);
  assert.match(req({ body: { maxBytes: 64 * 1024 * 1024 } }), /maxBytes/);
  assert.match(req({ onError: 'pass' }), /onError of a pre-forward hook/);
  assert.match(req({ routes: ['/tunnels/x'] }), /under \/admin or \/app/);
  assert.match(req({ routes: ['FETCH /admin/x'] }), /Unknown method/);
  assert.match(req({ with: {} }), /"with" configures a shared hook/);
  // The secret scanner: post-forward, with a body, Lamaste packs only.
  const scan = (h) =>
    manifestError({
      relay: {
        request: [
          { stage: 'post-forward', use: 'lamaste:secret-scan', routes: ['/admin/x'], ...h },
        ],
      },
    });
  assert.match(scan({}), /needs the response body/);
  assert.match(scan({ stage: 'pre-forward', body: { maxBytes: 10 } }), /stage is post-forward/);
  assert.match(scan({ body: { maxBytes: 10 }, with: { packs: ['mine'] } }), /with\.packs/);
  assert.match(scan({ body: { maxBytes: 10 }, with: { patterns: ['x'] } }), /Unrecognized key/);
  assert.equal(scan({ body: { maxBytes: 10 } }), null);
});

// ---------------------------------------------------------------------------
// Hook sets
// ---------------------------------------------------------------------------

test('hook set: defaults applied, digest binds the declarations and the module bytes', () => {
  const m = validateManifest({ ...base, hooks: fullHooks });
  const set = relayHookSetOf(m);
  assert.deepEqual(
    set.stages.map((s) => [s.stage, s.timeoutMs]),
    [
      ['install:pre-tunnel', 60000],
      ['install:post-tunnel', 30000],
      ['uninstall:pre-teardown', 30000],
      ['tunnel:down', 2000],
      ['tunnel:up', 2000],
    ],
  );
  assert.equal(set.request[0].onError, 'reject');
  assert.equal(set.request[0].onOversize, 'reject');
  assert.equal(set.request[1].onError, 'block');
  assert.deepEqual(set.request[1].settings, {
    action: 'redact',
    packs: ['credentials', 'jwt'],
    onUnscannable: 'pass',
  });
  assert.equal(agentHookSetOf(m).stages.length, 6);

  const sha = hookEntrySha256(Buffer.from('export default {}'));
  const d1 = relayHookSetDigest(set, sha);
  assert.match(d1, /^[a-f0-9]{64}$/);
  assert.equal(
    relayHookSetDigest(relayHookSetOf(validateManifest({ ...base, hooks: fullHooks })), sha),
    d1,
  );
  assert.notEqual(relayHookSetDigest(set, hookEntrySha256(Buffer.from('export default {} '))), d1);
  const changed = structuredClone(fullHooks);
  changed.relay.request[0].timeoutMs = 300;
  assert.notEqual(
    relayHookSetDigest(relayHookSetOf(validateManifest({ ...base, hooks: changed })), sha),
    d1,
  );
  assert.equal(
    relayHookSetOf(validateManifest({ ...base, hooks: { agent: fullHooks.agent } })),
    null,
  );
});

test('hook set: the preview shows fail-open hooks, effects, packs and inactive routes', () => {
  const set = relayHookSetOf(validateManifest({ ...base, hooks: fullHooks }));
  const preview = relayHookSetPreview(set, hookEntrySha256(Buffer.from('x')));
  assert.deepEqual(preview.request[0].failOpen, []);
  assert.deepEqual(preview.request[1].failOpen, ['onUnscannable']);
  assert.deepEqual(preview.request[1].inactiveRoutes, ['GET /app/*']);
  assert.equal(preview.failOpenCount, 1);
  assert.deepEqual(preview.effects, ['audit', 'notify-admins']);
  assert.deepEqual(preview.packs, ['credentials@1', 'jwt@1']);
});

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

test('routes: patterns parse and match conservatively', () => {
  assert.ok('error' in parseRoutePattern('/api/x'));
  assert.ok('error' in parseRoutePattern('POST  /admin/x'));
  assert.ok('error' in parseRoutePattern('/admin/a b'));
  const match = (pattern, method, url) =>
    matchRoutePattern(routePattern(pattern), method, requestPathSegments(url));
  assert.equal(match('POST /admin/import/*', 'POST', '/admin/import/a'), true);
  assert.equal(match('POST /admin/import/*', 'POST', '/admin/import/a/b/c?x=1'), true);
  assert.equal(match('POST /admin/import/*', 'POST', '/admin/import'), false);
  assert.equal(match('POST /admin/import/*', 'PUT', '/admin/import/a'), false);
  assert.equal(match('GET /admin/export', 'HEAD', '/admin/export'), true);
  assert.equal(match('/admin/*/run', 'DELETE', '/admin/jobs/run'), true);
  assert.equal(match('/admin/*/run', 'DELETE', '/admin/jobs/x/run'), false);
  // Bypass attempts the agent half would still route to the hooked path.
  assert.equal(match('POST /admin/import/*', 'POST', '/admin/IMPORT/a'), true);
  assert.equal(match('POST /admin/import/*', 'POST', '/admin/%69mport/a'), true);
  assert.equal(match('POST /admin/import/*', 'POST', '/admin//import/a/'), true);
});

// ---------------------------------------------------------------------------
// The secret scanner
// ---------------------------------------------------------------------------

const PEM_JSON =
  '{"key":"-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEAuK7w2bcdeABCDEF\\nqwerty0123456789+/=\\n-----END RSA PRIVATE KEY-----","id":12345678901234567890}';

test('secret scan: finds credentials in raw and JSON-escaped text', () => {
  const tokens = [
    'ghp_' + 'A1b2'.repeat(9),
    'AKIAIOSFODNN7EXAMPLE',
    'xoxb-1234567890-abcdefghij',
    'feria_' + 'a'.repeat(43),
    'npm_' + 'B'.repeat(36),
    'glpat-' + 'x'.repeat(20),
  ];
  for (const token of tokens) {
    const found = findSecrets(`before ${token} after`, ['credentials']);
    assert.equal(found.length, 1, token);
  }
  const pem = findSecrets(PEM_JSON, ['credentials']);
  assert.deepEqual(
    pem.map((m) => m.ruleId),
    ['private-key'],
  );
  // Not secrets: a sha256, a short ghp_, a word.
  assert.deepEqual(findSecrets('a'.repeat(64) + ' ghp_short token=abc', ['credentials']), []);
});

test('secret scan: redaction keeps JSON valid and every other byte as it was', () => {
  const out = redactSecrets(PEM_JSON, findSecrets(PEM_JSON, ['credentials']));
  assert.equal(out, '{"key":"[REDACTED:private-key]","id":12345678901234567890}');
  assert.equal(JSON.parse(out).key, '[REDACTED:private-key]');
  // assignments: only the value goes.
  const body = '{"username":"ali","password":"hunter2-long","note":"ok"} token=abcd1234&x=1';
  const redacted = redactSecrets(body, findSecrets(body, ['assignments']));
  assert.equal(
    redacted,
    '{"username":"ali","password":"[REDACTED:json-secret-field]","note":"ok"} token=[REDACTED:secret-assignment]&x=1',
  );
  const jwt =
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
  assert.equal(findSecrets(jwt, ['credentials']).length, 0);
  assert.equal(findSecrets(jwt, ['jwt']).length, 1);
});

test('secret scan: unscannable bodies are named', () => {
  const text = Buffer.from('{"a":1}');
  assert.equal(unscannableReason({ 'content-type': 'application/json' }, text), null);
  assert.equal(unscannableReason({ 'content-type': 'text/plain; charset=utf-8' }, text), null);
  assert.match(unscannableReason({ 'content-encoding': 'gzip' }, text), /content-encoding/);
  assert.match(unscannableReason({ 'content-type': 'image/png' }, text), /content-type/);
  assert.match(
    unscannableReason({ 'content-type': 'text/plain; charset=latin1' }, text),
    /charset/,
  );
  assert.match(unscannableReason({}, Buffer.from([0xff, 0xfe, 0x00])), /UTF-8/);
});

test('secret scan: the hook decides pass, replace, block, and audits without values', () => {
  const body = (s) => {
    const bytes = Buffer.from(s);
    return { contentType: 'application/json', bytes, text: () => s, json: () => JSON.parse(s) };
  };
  const input = (s, headers = { 'content-type': 'application/json' }) => ({
    status: 200,
    headers,
    request: { method: 'GET', path: '/admin/export/x', query: '', caller: { type: 'admin' } },
    route: 'GET /admin/export/*',
    body: body(s),
  });
  const redact = { action: 'redact', packs: ['credentials'], onUnscannable: 'block' };
  assert.deepEqual(secretScanHook(input('{"ok":true}'), redact), { action: 'pass' });
  const replaced = secretScanHook(input(PEM_JSON), redact);
  assert.equal(replaced.action, 'replace');
  assert.equal(replaced.effects[0].event, 'secret-scan.redacted');
  assert.equal(replaced.effects[0].data.rules, 'private-key');
  assert.ok(!JSON.stringify(replaced.effects).includes('MIIE'));
  const blocked = secretScanHook(input(PEM_JSON), { ...redact, action: 'block' });
  assert.equal(blocked.action, 'block');
  const binary = secretScanHook(input('xx', { 'content-type': 'image/png' }), redact);
  assert.equal(binary.reasonId, 'secret-scan.unscannable');
  assert.deepEqual(
    secretScanHook(input('xx', { 'content-type': 'image/png' }), {
      ...redact,
      onUnscannable: 'pass',
    }),
    { action: 'pass' },
  );
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

test('decisions: only the contract shapes, bounded, with safe header edits', () => {
  const ok = (stage, d) => validateHookDecision(stage, d).ok;
  assert.equal(ok('request:pre-forward', { action: 'continue' }), true);
  assert.equal(ok('request:pre-forward', { action: 'reject', status: 422, body: { e: 1 } }), true);
  assert.equal(ok('request:pre-forward', { action: 'reject', status: 500 }), false);
  assert.equal(
    ok('request:pre-forward', { action: 'continue', setHeaders: { 'x-app': 'v' } }),
    true,
  );
  for (const name of [
    'authorization',
    'Cookie',
    'x-lamalibre-caller',
    'host',
    'content-length',
    'x-ssl-client-dn',
    'remote-user',
  ]) {
    assert.equal(
      ok('request:pre-forward', { action: 'continue', setHeaders: { [name]: 'x' } }),
      false,
      name,
    );
    assert.equal(isHookEditableHeader(name.toLowerCase()), false, name);
  }
  assert.equal(
    ok('request:pre-forward', { action: 'continue', setHeaders: { 'x-a': 'a\r\nb' } }),
    false,
  );
  assert.equal(ok('request:pre-forward', { action: 'continue', extra: 1 }), false);
  assert.equal(ok('request:post-forward', { action: 'block', reasonId: 'leak' }), true);
  assert.equal(ok('request:post-forward', { action: 'block', reasonId: 'Leak!' }), false);
  assert.equal(
    ok('request:post-forward', { action: 'replace', setHeaders: { 'set-cookie': 'x' } }),
    false,
  );
  assert.equal(ok('install:pre-tunnel', { ok: false, reason: 'no disk' }), true);
  assert.equal(ok('install:pre-tunnel', { ok: true, output: { a: 'x'.repeat(20000) } }), false);
  assert.equal(
    ok('tunnel:down', { fallback: { status: 503, retryAfter: 60, body: { error: 'm' } } }),
    true,
  );
  assert.equal(ok('tunnel:down', { fallback: { status: 200 } }), false);
  assert.equal(
    ok('tunnel:up', {
      effects: [
        { type: 'notify-admins', message: 'back' },
        { type: 'audit', event: 'up' },
      ],
    }),
    true,
  );
  assert.equal(ok('tunnel:up', { effects: [{ type: 'webhook', url: 'https://x' }] }), false);
  assert.equal(
    ok('tunnel:up', { effects: Array.from({ length: 11 }, () => ({ type: 'log', message: 'x' })) }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Tarballs
// ---------------------------------------------------------------------------

test('tarball: regular files are read in memory, links are not followed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'lamaste-tgz-'));
  try {
    await mkdir(path.join(dir, 'package', 'hooks'), { recursive: true });
    await writeFile(path.join(dir, 'package', 'lamaste-plugin.json'), '{"name":"fx"}');
    await writeFile(path.join(dir, 'package', 'hooks', 'relay.mjs'), 'export default {}');
    execFileSync('ln', ['-s', '/etc/hosts', path.join(dir, 'package', 'link.mjs')]);
    const tgz = path.join(dir, 'p.tgz');
    execFileSync('tar', ['-czf', tgz, '-C', dir, 'package']);
    const files = readTarballFiles(
      await readFile(tgz),
      new Set(['package/lamaste-plugin.json', 'package/hooks/relay.mjs', 'package/link.mjs']),
    );
    assert.equal(files.get('package/lamaste-plugin.json').toString(), '{"name":"fx"}');
    assert.equal(files.get('package/hooks/relay.mjs').toString(), 'export default {}');
    assert.equal(files.has('package/link.mjs'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
