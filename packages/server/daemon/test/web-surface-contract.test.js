/**
 * Slice 7, the web surface contract: the manifest's `userSurface.web`
 * (only with identity, never public, a safe root), the rules and digest of
 * a web tree, reading one from a staged tarball and from disk (regular
 * files only), the approval digest — byte for byte 4.4.1's without a web
 * surface — and the hosts that serve user surfaces, tunnels and
 * plugin-owned sites alike.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  ManifestValidationError,
  WEB_TREE_LIMITS,
  WebTreeError,
  approvalDigest,
  hookEntrySha256,
  isWebSurfaceSubdomain,
  relayHookSetOf,
  siteUserSurfaceRoute,
  userSurfaceHostByFqdn,
  userSurfaceHostServing,
  userSurfaceHosts,
  validateManifest,
  webTreeDigest,
  webTreeFileSha256,
  webTreeManifest,
  webTreePathProblem,
} from '@lamalibre/lamaste';
import {
  readTarballFiles,
  webTreeManifestOfDirectory,
  webTreeManifestOfTarball,
} from '@lamalibre/lamaste/server';

const agentBlock = {
  requires: { os: ['linux'], node: '>=22', systemPackages: ['sqlite3', 'curl'] },
  package: '@lamalibre/fx-agent',
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
};
const identity = { roles: [{ id: 'viewer', label: 'Görüntüleyici' }] };
const base = { name: 'fx', version: '1.0.0', hosting: 'agent', agent: agentBlock, identity };

const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
const spec = {
  package: '@lamalibre/fx-agent',
  version: '1.0.0',
  integrity: INTEGRITY,
  service: { entry: 'dist/agentd.js', memoryMax: '512M' },
  systemPackages: ['curl', 'sqlite3'],
};

function manifestError(manifest) {
  try {
    validateManifest(manifest);
  } catch (err) {
    assert.ok(err instanceof ManifestValidationError, String(err));
    return err.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
  }
  return null;
}

function file(p, content) {
  const bytes = Buffer.from(content);
  return { path: p, size: bytes.length, sha256: webTreeFileSha256(bytes) };
}

// ---------------------------------------------------------------------------
// Tarballs as npm writes them, plus the entries a hostile one might hold
// ---------------------------------------------------------------------------

function tarHeader(name, size, type = '0', linkname = '') {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(size.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(linkname, 157, 100, 'utf8');
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return h;
}

/** `entries`: [archivePath, content | { type, linkname }] */
function tgz(entries) {
  const parts = [];
  for (const [name, content] of entries) {
    if (typeof content === 'string' || Buffer.isBuffer(content)) {
      const data = Buffer.from(content);
      parts.push(tarHeader(name, data.length), data);
      parts.push(Buffer.alloc((512 - (data.length % 512)) % 512));
    } else {
      parts.push(tarHeader(name, 0, content.type, content.linkname ?? ''));
    }
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

test('manifest: userSurface.web parses with its defaults', () => {
  const m = validateManifest({ ...base, userSurface: { web: { defaultSubdomain: 'piyasa' } } });
  assert.deepEqual(m.userSurface, {
    web: { defaultSubdomain: 'piyasa', accessMode: 'authenticated', root: 'web' },
  });
  const r = validateManifest({
    ...base,
    userSurface: { web: { defaultSubdomain: 'fx-2', accessMode: 'restricted', root: 'dist/web' } },
  });
  assert.deepEqual(r.userSurface.web, {
    defaultSubdomain: 'fx-2',
    accessMode: 'restricted',
    root: 'dist/web',
  });
  // Without the block nothing changes.
  assert.equal(validateManifest(base).userSurface, undefined);
});

test('manifest: userSurface needs identity, so an agent half', () => {
  const web = { web: { defaultSubdomain: 'fx' } };
  const noIdentity = { ...base };
  delete noIdentity.identity;
  assert.match(manifestError({ ...noIdentity, userSurface: web }), /userSurface needs identity/);
  assert.match(
    manifestError({ name: 'fx', version: '1.0.0', userSurface: web }),
    /userSurface needs identity/,
  );
});

test('manifest: userSurface.web refuses what it must', () => {
  const bad = [
    [{ defaultSubdomain: 'panel' }, /defaultSubdomain/],
    [{ defaultSubdomain: 'www' }, /defaultSubdomain/],
    [{ defaultSubdomain: 'agent-x' }, /defaultSubdomain/],
    [{ defaultSubdomain: 'Piyasa' }, /defaultSubdomain/],
    [{ defaultSubdomain: 'a.b' }, /defaultSubdomain/],
    [{ defaultSubdomain: '-a' }, /defaultSubdomain/],
    [{ defaultSubdomain: 'fx', accessMode: 'public' }, /accessMode/],
    [{ defaultSubdomain: 'fx', root: '../web' }, /root/],
    [{ defaultSubdomain: 'fx', root: '/web' }, /root/],
    [{ defaultSubdomain: 'fx', root: 'web/' }, /root/],
    [{ defaultSubdomain: 'fx', root: '.web' }, /root/],
    [{ defaultSubdomain: 'fx', root: 'a//b' }, /root/],
    [{ defaultSubdomain: 'fx', maxBodySizeMb: 1 }, /Unrecognized key/],
    [{}, /defaultSubdomain/],
  ];
  for (const [web, expected] of bad) {
    assert.match(
      manifestError({ ...base, userSurface: { web } }) ?? '',
      expected,
      JSON.stringify(web),
    );
  }
  assert.match(manifestError({ ...base, userSurface: { desktop: {} } }) ?? '', /Unrecognized key/);
  assert.equal(isWebSurfaceSubdomain('piyasa'), true);
  assert.equal(isWebSurfaceSubdomain('api'), false);
});

// ---------------------------------------------------------------------------
// Web trees
// ---------------------------------------------------------------------------

test('web tree paths: segments, extensions, length and depth', () => {
  for (const ok of [
    'index.html',
    'main-TBGDC4WS.js',
    'assets/fonts/roboto_300.woff2',
    'media/logo.SVG',
    '_next/app.mjs',
  ]) {
    assert.equal(webTreePathProblem(ok), null, ok);
  }
  for (const bad of [
    '',
    '.env',
    'a/.hidden.js',
    '../x.js',
    'a/../x.js',
    './x.js',
    '/x.js',
    'a//x.js',
    'a b.js',
    'x%2e.js',
    'x.php',
    'x.map',
    'Makefile',
    'dir.d/',
    `${'a/'.repeat(16)}x.js`,
    `${'a'.repeat(254)}.js`,
  ]) {
    assert.notEqual(webTreePathProblem(bad), null, bad);
  }
});

test('web tree manifest: sorted, digest independent of order, every rule', () => {
  const files = [file('main.js', 'x'), file('index.html', '<p>'), file('a/b.css', 'b{}')];
  const m = webTreeManifest(files);
  assert.deepEqual(
    m.files.map((f) => f.path),
    ['a/b.css', 'index.html', 'main.js'],
  );
  assert.equal(m.totalBytes, 1 + 3 + 3);
  assert.equal(m.sha256, webTreeManifest([...files].reverse()).sha256);
  assert.equal(m.sha256, webTreeDigest(files));
  // Pinned (checked with shasum over the JSON by hand): the canonical form is
  // part of the approval digest.
  assert.equal(
    webTreeDigest([file('index.html', '<p>')]),
    '740e6845bf740b46d8c29c29cc7067cc7089c6339c8bf95fc2b346cafff8d9f9',
  );
  // Any change to a file changes it.
  assert.notEqual(m.sha256, webTreeManifest([...files.slice(0, 2), file('a/b.css', 'c{}')]).sha256);
  assert.notEqual(m.sha256, webTreeManifest([...files.slice(0, 2), file('a/c.css', 'b{}')]).sha256);

  const code = (fn) => {
    try {
      fn();
    } catch (err) {
      assert.ok(err instanceof WebTreeError, String(err));
      return err.code;
    }
    return null;
  };
  assert.equal(
    code(() => webTreeManifest([file('main.js', 'x')])),
    'NO_INDEX',
  );
  assert.equal(
    code(() => webTreeManifest([file('index.html', ''), file('.x.js', '')])),
    'INVALID_PATH',
  );
  assert.equal(
    code(() => webTreeManifest([file('index.html', ''), file('index.html', 'y')])),
    'DUPLICATE_PATH',
  );
  assert.equal(
    code(() => webTreeManifest([{ path: 'index.html', size: 1, sha256: 'nope' }])),
    'INVALID_FILE',
  );
  assert.equal(
    code(() =>
      webTreeManifest([
        { path: 'index.html', size: WEB_TREE_LIMITS.maxFileBytes + 1, sha256: 'a'.repeat(64) },
      ]),
    ),
    'FILE_TOO_LARGE',
  );
  const big = Array.from({ length: 5 }, (_, i) => ({
    path: `f${i}.js`,
    size: WEB_TREE_LIMITS.maxFileBytes,
    sha256: 'a'.repeat(64),
  }));
  assert.equal(
    code(() => webTreeManifest([file('index.html', ''), ...big])),
    'TREE_TOO_LARGE',
  );
  const many = Array.from({ length: WEB_TREE_LIMITS.maxFiles }, (_, i) => file(`f${i}.js`, ''));
  assert.equal(
    code(() => webTreeManifest([file('index.html', ''), ...many])),
    'TOO_MANY_FILES',
  );
});

test('web tree from a staged tarball: the files under root, regular files only', () => {
  const pkg = tgz([
    ['package/package.json', '{}'],
    ['package/lamaste-plugin.json', '{}'],
    ['package/web/', { type: '5' }],
    ['package/web/index.html', '<p>'],
    ['package/web/assets/app.js', 'x'],
    ['package/webby/other.js', 'not in the tree'],
  ]);
  const m = webTreeManifestOfTarball(pkg, 'web');
  assert.deepEqual(
    m.files.map((f) => f.path),
    ['assets/app.js', 'index.html'],
  );
  assert.equal(
    m.sha256,
    webTreeManifest([file('index.html', '<p>'), file('assets/app.js', 'x')]).sha256,
  );
  // The same reader serves the existing whole-file read unchanged.
  assert.deepEqual(
    [...readTarballFiles(pkg, new Set(['package/web/index.html', 'package/none']))].map(
      ([k, v]) => [k, v.toString()],
    ),
    [['package/web/index.html', '<p>']],
  );

  const reject = (entries, code) => {
    assert.throws(
      () => webTreeManifestOfTarball(tgz(entries), 'web'),
      (err) => err instanceof WebTreeError && err.code === code,
      code,
    );
  };
  reject([['package/index.html', '<p>']], 'NOT_FOUND');
  reject(
    [
      ['package/web/index.html', '<p>'],
      ['package/web/evil.js', { type: '2', linkname: '/etc/shadow' }],
    ],
    'NOT_REGULAR_FILE',
  );
  reject(
    [
      ['package/web/index.html', '<p>'],
      ['package/web/hard.js', { type: '1', linkname: 'package/package.json' }],
    ],
    'NOT_REGULAR_FILE',
  );
  reject(
    [
      ['package/web/index.html', '<p>'],
      ['package/web/index.html', '<script>'],
    ],
    'DUPLICATE_PATH',
  );
  reject(
    [
      ['package/web/index.html', '<p>'],
      ['package/web/big.js', Buffer.alloc(WEB_TREE_LIMITS.maxFileBytes + 1)],
    ],
    'FILE_TOO_LARGE',
  );
  reject(
    [
      ['package/web/index.html', '<p>'],
      ['package/web/x.php', ''],
    ],
    'INVALID_PATH',
  );
  reject([['package/web/app.js', 'x']], 'NO_INDEX');
});

test('web tree from a directory: the same manifest; links refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-tree-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>');
    fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'x');
    const m = await webTreeManifestOfDirectory(dir);
    assert.equal(
      m.sha256,
      webTreeManifest([file('index.html', '<p>'), file('assets/app.js', 'x')]).sha256,
    );

    fs.symlinkSync('/etc/hosts', path.join(dir, 'assets', 'hosts.js'));
    await assert.rejects(webTreeManifestOfDirectory(dir), (err) => err.code === 'NOT_REGULAR_FILE');
    fs.unlinkSync(path.join(dir, 'assets', 'hosts.js'));

    fs.symlinkSync(path.join(dir, 'assets'), path.join(dir, 'linked'));
    await assert.rejects(webTreeManifestOfDirectory(dir), (err) => err.code === 'NOT_REGULAR_FILE');
    fs.unlinkSync(path.join(dir, 'linked'));

    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    await assert.rejects(webTreeManifestOfDirectory(dir), (err) => err.code === 'INVALID_PATH');
    fs.unlinkSync(path.join(dir, '.env'));

    await assert.rejects(
      webTreeManifestOfDirectory(path.join(dir, 'missing')),
      (err) => err.code === 'NOT_FOUND',
    );
    await assert.rejects(
      webTreeManifestOfDirectory(path.join(dir, 'index.html')),
      (err) => err.code === 'NOT_FOUND',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Approval digest
// ---------------------------------------------------------------------------

test('approvalDigest: unchanged without a web surface (4.4.1 vectors); the tree enters it', () => {
  const m = validateManifest({
    ...base,
    hooks: { relay: { entry: 'hooks/relay.mjs', install: { 'pre-tunnel': {} } } },
  });
  const set = relayHookSetOf(m);
  const sha = hookEntrySha256(Buffer.from('export default {}'));
  // Computed with Lamaste 4.4.1, before identity and web surfaces existed.
  const v441 = {
    agentHalfOnly: '4f7e859edd8211fec497d263cd07bbbe5a758ff057c6a864514c1a70cf6e397e',
    relayOnly: '3877045ce0317eca28bc3d7f6638764b806251793fb9cc9f745a21fe4b5c3d04',
    both: '54bdb708a87d37d1a0eca4329a5be873abaeae0d72e01ce82960d677a82d46e9',
  };
  const subjects = {
    agentHalfOnly: { relay: null, agentHalf: spec },
    relayOnly: { relay: { set, entrySha256: sha }, agentHalf: null },
    both: { relay: { set, entrySha256: sha }, agentHalf: spec },
  };
  const tree = { treeSha256: webTreeDigest([file('index.html', '<p>')]) };
  for (const [name, subject] of Object.entries(subjects)) {
    assert.equal(approvalDigest({ ...subject, web: null }), v441[name], `${name}, null`);
    assert.equal(approvalDigest({ ...subject, web: undefined }), v441[name], `${name}, undefined`);
    const withWeb = approvalDigest({ ...subject, web: tree });
    assert.notEqual(withWeb, v441[name], `${name}: the tree enters the digest`);
    // Identity and the tree are independent parts.
    const withBoth = approvalDigest({ ...subject, identity, web: tree });
    assert.notEqual(withBoth, withWeb);
    assert.notEqual(withBoth, approvalDigest({ ...subject, identity }));
  }
  const other = { treeSha256: webTreeDigest([file('index.html', '<p>!')]) };
  assert.notEqual(
    approvalDigest({ relay: null, agentHalf: spec, web: tree }),
    approvalDigest({ relay: null, agentHalf: spec, web: other }),
  );
  assert.throws(
    () => approvalDigest({ relay: null, agentHalf: spec, web: { treeSha256: 'x' } }),
    /web.treeSha256 must be a SHA-256 hex digest/,
  );
});

// ---------------------------------------------------------------------------
// Hosts that serve user surfaces
// ---------------------------------------------------------------------------

const internal = (route, agentLabel = 'vm1') => ({
  id: `int-${route}`,
  type: 'plugin',
  exposure: 'internal',
  pluginRoute: route,
  agentLabel,
});
const boundTunnel = (routes, extra = {}) => ({
  id: 't1',
  type: 'app',
  fqdn: 'piyasa.example.com',
  agentLabel: 'vm1',
  accessMode: 'authenticated',
  userSurface: { routes },
  ...extra,
});
const ownedSite = (route, extra = {}) => ({
  id: 's1',
  name: 'fx',
  fqdn: 'fx.example.com',
  type: 'managed',
  owner: { plugin: route },
  accessMode: 'authenticated',
  ...extra,
});

test('siteUserSurfaceRoute: a plugin-owned site only, read defensively', () => {
  assert.equal(siteUserSurfaceRoute(ownedSite('fx')), 'fx');
  for (const bad of [
    null,
    'x',
    { name: 'plain' },
    ownedSite('Fx'),
    ownedSite('tunnels'),
    { ...ownedSite('fx'), owner: ['fx'] },
    { ...ownedSite('fx'), owner: { plugin: 7 } },
  ]) {
    assert.equal(siteUserSurfaceRoute(bad), null, JSON.stringify(bad));
  }
});

test('userSurfaceHosts: tunnels and sites, served when hosted, never twice', () => {
  const tunnels = [internal('mi'), internal('fx'), boundTunnel(['mi'])];
  const sites = [ownedSite('fx'), { id: 's2', name: 'blog', fqdn: 'blog.example.com' }];
  const hosts = userSurfaceHosts(tunnels, sites);
  assert.deepEqual(hosts, [
    {
      kind: 'tunnel',
      id: 't1',
      fqdn: 'piyasa.example.com',
      accessMode: 'authenticated',
      enabled: true,
      routes: ['mi'],
      served: ['mi'],
    },
    {
      kind: 'site',
      id: 's1',
      fqdn: 'fx.example.com',
      accessMode: 'authenticated',
      enabled: true,
      routes: ['fx'],
      served: ['fx'],
    },
  ]);
  assert.equal(userSurfaceHostByFqdn(hosts, 'FX.example.com')?.id, 's1');
  assert.equal(userSurfaceHostServing(hosts, 'fx')?.kind, 'site');
  assert.equal(userSurfaceHostServing(hosts, 'nope'), null);

  // A site's route is served while its plugin is hosted at all.
  assert.deepEqual(userSurfaceHosts([], [ownedSite('fx')])[0].served, []);
  assert.deepEqual(userSurfaceHosts([internal('fx', 'other')], [ownedSite('fx')])[0].served, [
    'fx',
  ]);

  // A route two hosts would serve is served on neither.
  const both = userSurfaceHosts([internal('fx'), boundTunnel(['fx'])], [ownedSite('fx')]);
  assert.deepEqual(
    both.map((h) => [h.kind, h.served]),
    [
      ['tunnel', []],
      ['site', []],
    ],
  );
  // A binding left on a tunnel whose agent does not host the plugin claims nothing.
  assert.deepEqual(
    userSurfaceHosts(
      [internal('fx'), boundTunnel(['fx'], { agentLabel: 'vm9' })],
      [ownedSite('fx')],
    ).map((h) => [h.kind, h.served]),
    [
      ['tunnel', []],
      ['site', ['fx']],
    ],
  );
  // Two hosts under one name: neither is a host.
  assert.deepEqual(
    userSurfaceHosts(
      [internal('fx'), internal('mi'), boundTunnel(['mi'], { fqdn: 'fx.example.com' })],
      [ownedSite('fx')],
    ),
    [],
  );

  // Access modes: missing or unknown reads as restricted, public serves none.
  assert.equal(
    userSurfaceHosts([internal('fx')], [ownedSite('fx', { accessMode: undefined })])[0].accessMode,
    'restricted',
  );
  assert.equal(
    userSurfaceHosts([internal('fx')], [ownedSite('fx', { accessMode: 'open' })])[0].accessMode,
    'restricted',
  );
  assert.deepEqual(
    userSurfaceHosts([internal('fx')], [ownedSite('fx', { accessMode: 'public' })]),
    [],
  );
  assert.deepEqual(
    userSurfaceHosts([internal('mi'), boundTunnel(['mi'], { accessMode: 'public' })], []),
    [],
  );

  // A disabled tunnel is a host, but serves nothing anyone resolves.
  const disabled = userSurfaceHosts([internal('mi'), boundTunnel(['mi'], { enabled: false })], []);
  assert.equal(disabled[0].enabled, false);
  assert.equal(userSurfaceHostServing(disabled, 'mi'), null);

  // Malformed entries are no hosts.
  assert.deepEqual(
    userSurfaceHosts(
      [internal('fx')],
      [
        ownedSite('fx', { fqdn: 'not a host' }),
        ownedSite('fx', { id: '' }),
        ownedSite('fx', { fqdn: 'fx' }),
      ],
    ),
    [],
  );
  assert.deepEqual(userSurfaceHosts('x', {}), []);
});
