/**
 * lamaste-apphost, the agent's root helper (slice 3). It runs as root and
 * takes a stranger's tarball, so every input is checked before anything is
 * written: arguments, the service spec, the tarball's integrity, every
 * archive entry (only regular files and directories inside package/), the
 * bundled rule (no dependencies, no install scripts), the entry file — and
 * whose route it is: an owner record per route (package and agent label)
 * and the route on its account, so neither another plugin nor another agent
 * on the machine inherits an agent half's account or kept data. And it acts
 * only on what the relay signed: `install`, `activate` and `remove` take the
 * relay's signature over the job as the first line of stdin and verify it
 * with the key pinned for the agent — any other key, any field that does
 * not match the command, an expired or reused job is refused (exit 5).
 *
 * The tests run the helper in a sandbox root with the system commands
 * replaced (useradd, systemctl, apt-get, …), so they need no root and run
 * on macOS. The tarball is unpacked by the helper itself — no tar runs.
 * Its names, paths and patterns must equal @lamalibre/lamaste's; the last
 * tests compare them.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const helper = require(fileURLToPath(new URL('../scripts/lamaste-apphost', import.meta.url)));

let core;
let agentLib;
let scratch;
/** The relay's signing key, and another relay's. */
let relayKey;
let otherKey;

before(async () => {
  core = await import('@lamalibre/lamaste');
  agentLib = await import('@lamalibre/lamaste/agent');
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lamaste-apphost-'));
  relayKey = await core
    .createRelaySigner(path.join(scratch, 'relay-a.json'), { create: true })
    .current();
  otherKey = await core
    .createRelaySigner(path.join(scratch, 'relay-b.json'), { create: true })
    .current();
});

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures: a sandbox root, the system commands, tarballs
// ---------------------------------------------------------------------------

const UID = process.getuid();
const GID = process.getgid();
const LABEL = 'vm1';
const ROUTE = 'fx';
const PKG = '@lamalibre/fx-agent';

function sandbox({ osRelease = 'ID=ubuntu\nID_LIKE=debian\nVERSION_ID="24.04"\n' } = {}) {
  const root = fs.mkdtempSync(path.join(scratch, 'root-'));
  for (const dir of ['opt', 'var/lib', 'etc/systemd/system', 'run/systemd/system']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true, mode: 0o755 });
  }
  if (osRelease !== null) fs.writeFileSync(path.join(root, 'etc/os-release'), osRelease);
  return root;
}

/** The commands the helper runs, as a small in-memory system. */
function fakeSystem({ packages = [], users = [], groups = [], failSystemctl = () => false } = {}) {
  const passwd = new Map(users.map((u) => [u.name, u]));
  const group = new Map(groups.map((g) => [g.name, g]));
  const installed = new Set(packages);
  const active = new Set();
  const calls = [];
  let nextId = 990;
  const done = (stdout = '', status = 0) => ({ status, stdout, stderr: '' });
  const run = (file, args) => {
    const cmd = path.basename(file);
    calls.push([cmd, ...args]);
    switch (cmd) {
      case 'getent': {
        const [db, name] = args;
        const entry = (db === 'passwd' ? passwd : group).get(name);
        if (!entry) return done('', 2);
        return db === 'passwd'
          ? done(
              `${name}:x:${entry.uid}:${entry.gid}:${entry.comment ?? ''}:/nonexistent:/usr/sbin/nologin\n`,
            )
          : done(`${name}:x:${entry.gid}:\n`);
      }
      case 'useradd': {
        const name = args[args.length - 1];
        const comment = args[args.indexOf('--comment') + 1];
        assert.ok(args.includes('--user-group'), 'a new account gets its own group');
        const gid = nextId;
        group.set(name, { name, gid });
        passwd.set(name, { name, uid: nextId++, gid, comment });
        return done();
      }
      case 'userdel':
        passwd.delete(args[0]);
        group.delete(args[0]);
        return done();
      case 'groupdel':
        group.delete(args[0]);
        return done();
      case 'systemctl': {
        const [verb, ...rest] = args;
        if (failSystemctl(args)) return { status: 1, stdout: '', stderr: `${verb} failed` };
        if (verb === 'is-active') {
          return active.has(rest[0]) ? done('active\n') : done('inactive\n', 3);
        }
        if (verb === 'start' || verb === 'restart') active.add(rest[0]);
        if (verb === 'disable' && rest[0] === '--now') active.delete(rest[1]);
        return done();
      }
      case 'dpkg-query':
        return installed.has(args[args.length - 1]) ? done('install ok installed') : done('', 1);
      case 'apt-get':
        if (args[0] === 'install') for (const p of args.slice(5)) installed.add(p);
        return done();
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  };
  return { run, calls, users: passwd, groups: group, installed, active };
}

/** One ustar entry as npm writes them (POSIX ustar, checksummed). */
function tarEntry({ name, type = '0', data = Buffer.alloc(0), mode = 0o644, linkname = '' }) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write(linkname, 157, 100);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

function tgzOf(entries, { trailer = Buffer.alloc(1024) } = {}) {
  return zlib.gzipSync(Buffer.concat([...entries.map(tarEntry), trailer]));
}

function packageEntries({ version = '1.0.0', name = PKG, manifest = {}, extra = [] } = {}) {
  return [
    { name: 'package/', type: '5', mode: 0o755 },
    {
      name: 'package/package.json',
      data: Buffer.from(JSON.stringify({ name, version, ...manifest })),
    },
    { name: 'package/dist/', type: '5', mode: 0o755 },
    { name: 'package/dist/agentd.js', data: Buffer.from('console.log("fx");\n'), mode: 0o755 },
    ...extra,
  ];
}

const sri = (bytes) => `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`;

function specLine(overrides = {}) {
  return {
    package: PKG,
    service: { entry: 'dist/agentd.js', memoryMax: null },
    systemPackages: [],
    ...overrides,
  };
}

function installInput(tgz, spec = specLine()) {
  return Buffer.concat([Buffer.from(`${JSON.stringify(spec)}\n`), tgz]);
}

/** Pin `key` for agent `label` in the sandbox, as `apphost enable|pin` writes it. */
function writePin(root, label, { key = relayKey, agent = label } = {}) {
  const file = path.join(root, core.APPHOST_PATHS.relayPinFile(label));
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  fs.writeFileSync(
    file,
    agentLib.relayPinJson({
      label,
      agent,
      kid: key.kid,
      publicKey: key.publicKey,
      panelUrl: 'https://203.0.113.5:9292',
      pinnedAt: '2026-10-16T08:00:00.000Z',
    }),
    { mode: 0o644 },
  );
}

const SIGNED = new Set(['install', 'activate', 'remove']);

/**
 * What the relay would sign for `argv` (and, for install, the spec line on
 * `stdin`): the payload the command asks for, by the agent the label names.
 * Null when the arguments could not make a job (the helper refuses them first).
 */
function jobFor(argv, stdin, over = {}) {
  const [command, label, route, ...rest] = argv;
  let kind;
  let payload;
  if (command === 'install') {
    const [version, integrity] = rest;
    let spec = specLine();
    try {
      const line = Buffer.from(stdin).toString('utf8').split('\n')[0];
      const parsed = JSON.parse(line);
      core.appJobPayload('app-install', { spec: { ...parsed, version, integrity } });
      spec = parsed;
    } catch {
      // An invalid spec line: signed with a valid one, refused when parsed.
    }
    kind = 'app-install';
    payload = { spec: { ...spec, version, integrity } };
  } else if (command === 'activate') {
    kind = 'app-activate';
    payload = { version: rest[0], package: PKG };
  } else {
    kind = 'app-remove';
    payload = { purge: rest.includes('--purge'), package: PKG };
  }
  const now = over.now ?? Date.now();
  return {
    agent: label,
    route,
    jobId: crypto.randomUUID(),
    kind,
    payload,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    ...over.fields,
  };
}

/** The signature line for `argv`; null when no job can be signed for it. */
function signatureFor(argv, stdin, over = {}) {
  let input;
  try {
    input = jobFor(argv, stdin, over);
    return `${JSON.stringify(core.signAppJob(input, over.key ?? relayKey))}\n`;
  } catch {
    return null;
  }
}

function setup(options = {}) {
  const root = sandbox(options);
  for (const label of [LABEL, 'vm2']) writePin(root, label);
  const system = fakeSystem(options);
  const chowns = [];
  const context = {
    root,
    run: system.run,
    chown: (p, uid, gid) => chowns.push([path.relative(root, p), uid, gid]),
    rootUid: UID,
    rootGid: GID,
    freeBytes: () => 10 * 2 ** 30,
    getuid: () => 0,
  };
  /**
   * Run the helper. `install`, `activate` and `remove` get the relay's
   * signature over what they ask in front of their stdin, as the agent
   * sends them; `sign: false` sends none, `sign: { key, fields, now }`
   * signs with another key or other fields.
   */
  const call = (argv, stdin, { sign, ...extra } = {}) => {
    // Never the test runner's own stdin: what the helper reads is given here.
    let input = SIGNED.has(argv[0]) && stdin === undefined ? Buffer.alloc(0) : stdin;
    if (SIGNED.has(argv[0]) && sign !== false) {
      const raw = typeof stdin === 'function' ? null : (stdin ?? Buffer.alloc(0));
      const line = signatureFor(argv, raw ?? Buffer.alloc(0), sign ?? {});
      if (line !== null) {
        const prefix = Buffer.from(line);
        input =
          typeof stdin === 'function'
            ? () => Buffer.concat([prefix, Buffer.from(stdin())])
            : Buffer.concat([prefix, Buffer.from(stdin ?? Buffer.alloc(0))]);
      }
    }
    return helper.main(argv, { ...context, stdin: input, ...extra });
  };
  const install = (version, tgz, { spec, label = LABEL, route = ROUTE, ...extra } = {}) =>
    call(['install', label, route, version, sri(tgz)], installInput(tgz, spec), extra);
  const at = (p) => path.join(root, p);
  return { root, system, chowns, context, call, install, at };
}

const SECRET = 'ab'.repeat(32);
const pluginConfig = (overrides = {}) => ({
  plugin: ROUTE,
  port: 21000,
  secret: SECRET,
  issuedAt: '2026-10-15T10:00:00.000Z',
  fetchedAt: '2026-10-15T10:00:01.000Z',
  acknowledged: false,
  ...overrides,
});
const configInput = (overrides) => Buffer.from(JSON.stringify(pluginConfig(overrides)));

const mode = (p) => (fs.statSync(p).mode & 0o7777).toString(8);
/** The entries of a directory; none when it does not exist. */
const listed = (p) => (fs.existsSync(p) ? fs.readdirSync(p) : []);
const ownerFile = (at, route = ROUTE) => at(`var/lib/lamalibre/apps/.owners/${route}.json`);

// ---------------------------------------------------------------------------
// Arguments and input
// ---------------------------------------------------------------------------

test('refused unless run as root', () => {
  assert.throws(() => helper.main(['status'], { getuid: () => 1000 }), /must run as root/);
});

test('arguments are validated before anything is read or written', () => {
  const { call, at } = setup();
  const tgz = tgzOf(packageEntries());
  const good = [LABEL, ROUTE, '1.0.0', sri(tgz)];
  const bad = [
    ['VM1', ...good.slice(1)],
    ['-vm', ...good.slice(1)],
    ['vm/1', ...good.slice(1)],
    ['x'.repeat(64), ...good.slice(1)],
    [LABEL, 'FX', good[2], good[3]],
    [LABEL, '-fx', good[2], good[3]],
    [LABEL, '../etc', good[2], good[3]],
    [LABEL, 'x'.repeat(101), good[2], good[3]],
    [LABEL, ROUTE, '1.0', good[3]],
    [LABEL, ROUTE, '01.0.0', good[3]],
    [LABEL, ROUTE, '1.0.0-01', good[3]],
    [LABEL, ROUTE, '1.0.0/../../x', good[3]],
    [LABEL, ROUTE, 'latest', good[3]],
    [LABEL, ROUTE, good[2], 'sha256-abc'],
    [LABEL, ROUTE, good[2], `${good[3]}x`],
  ];
  for (const args of bad) {
    assert.throws(
      () => call(['install', ...args], installInput(tgz)),
      helper.UsageError,
      args.join(' '),
    );
  }
  assert.throws(
    () => call(['install', ROUTE, '1.0.0', sri(tgz)], installInput(tgz)),
    helper.UsageError,
  );
  assert.throws(() => call(['config', ROUTE], configInput()), helper.UsageError);
  assert.throws(() => call(['activate', LABEL, ROUTE]), helper.UsageError);
  assert.throws(() => call(['remove', ROUTE]), helper.UsageError);
  assert.throws(() => call(['remove', LABEL, ROUTE, '--keep']), helper.UsageError);
  assert.throws(() => call(['remove', LABEL, ROUTE, '--purge', '--purge']), helper.UsageError);
  assert.throws(() => call(['status', ROUTE, 'more']), helper.UsageError);
  assert.throws(() => call(['upgrade', ROUTE]), /unknown command/);
  assert.deepEqual(fs.readdirSync(at('opt')), []);
});

test('exit statuses: refused 2, not installed 3, not the owner 4, not signed 5, failed 1', () => {
  assert.equal(helper.exitStatus(new helper.UsageError('x')), 2);
  assert.equal(helper.exitStatus(new helper.NotInstalledError('x')), 3);
  assert.equal(helper.exitStatus(new helper.NotOwnerError('x')), 4);
  assert.equal(helper.exitStatus(new helper.UnsignedError('x')), 5);
  assert.equal(helper.exitStatus(new Error('x')), 1);
  assert.equal(agentLib.APPHOST_EXIT_UNSIGNED, 5);
  assert.equal(agentLib.APPHOST_EXIT_NOT_OWNER, 4);
  assert.equal(agentLib.APPHOST_EXIT_NOT_INSTALLED, 3);
});

test('the service spec line is strict', () => {
  const ok = specLine({
    service: { entry: 'dist/agentd.mjs', memoryMax: '512M' },
    systemPackages: ['sqlite3', 'libpq5', 'sqlite3'],
  });
  assert.deepEqual(helper.parseSpecLine(JSON.stringify(ok)), {
    ...ok,
    systemPackages: ['libpq5', 'sqlite3'],
  });
  const bad = [
    'not json',
    JSON.stringify({ ...specLine(), version: '1.0.0' }),
    JSON.stringify({ ...specLine(), package: 'left-pad' }),
    JSON.stringify(specLine({ service: { entry: '../agentd.js', memoryMax: null } })),
    JSON.stringify(specLine({ service: { entry: '/etc/agentd.js', memoryMax: null } })),
    JSON.stringify(specLine({ service: { entry: 'dist/agentd.sh', memoryMax: null } })),
    JSON.stringify(specLine({ service: { entry: 'dist/agentd.js' } })),
    JSON.stringify(specLine({ service: { entry: 'dist/agentd.js', memoryMax: '1T' } })),
    JSON.stringify(specLine({ systemPackages: ['sqlite3; rm -rf /'] })),
    JSON.stringify(specLine({ systemPackages: ['-o=Dpkg::Pre-Invoke=x'] })),
    JSON.stringify(specLine({ systemPackages: 'sqlite3' })),
  ];
  for (const text of bad) assert.throws(() => helper.parseSpecLine(text), helper.UsageError, text);
});

test('a tarball that does not match its integrity is refused before anything is written', () => {
  const { call, at } = setup();
  const tgz = tgzOf(packageEntries());
  const other = tgzOf(packageEntries({ version: '1.0.1' }));
  assert.throws(
    () => call(['install', LABEL, ROUTE, '1.0.0', sri(other)], installInput(tgz)),
    /does not match its integrity/,
  );
  assert.throws(
    () =>
      call(['install', LABEL, ROUTE, '1.0.0', sri(tgz)], Buffer.from(JSON.stringify(specLine()))),
    helper.UsageError,
  );
  assert.deepEqual(fs.readdirSync(at('opt')), []);
});

test('the lock is taken before stdin is read; another operation holding it is waited for', () => {
  const { install, call, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  // A live owner (this process) holds the lock.
  fs.writeFileSync(at('run/lamaste-apphost.lock'), `${process.pid}\n`);
  let read = false;
  const stdin = () => {
    read = true;
    return configInput();
  };
  assert.throws(
    () => call(['config', LABEL, ROUTE], stdin, { lockWaitMs: 300 }),
    /another lamaste-apphost operation is still running \(PID \d+\)/,
  );
  assert.equal(read, false, 'stdin is not read while waiting');
  fs.rmSync(at('run/lamaste-apphost.lock'));
  assert.equal(call(['config', LABEL, ROUTE], stdin).ok, true);
  assert.equal(read, true);
});

test('lock: created with its content; a dead owner is taken over; an empty lock only once it is old', () => {
  const { context, at } = setup();
  const ctx = helper.createContext(context);
  const lock = at('run/lamaste-apphost.lock');

  const release = helper.acquireLock(ctx, 100);
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid}\n`);
  assert.deepEqual(
    fs.readdirSync(at('run')).filter((n) => n.startsWith('lamaste-apphost.lock')),
    ['lamaste-apphost.lock'],
    'no temp file is left beside it',
  );
  assert.throws(() => helper.acquireLock(ctx, 100), /still running/);
  release();
  assert.ok(!fs.existsSync(lock));

  fs.writeFileSync(lock, '2147483646\n');
  helper.acquireLock(ctx, 100)();

  // Empty (or unreadable) and young: someone is creating it — wait.
  fs.writeFileSync(lock, '');
  assert.throws(() => helper.acquireLock(ctx, 300), /still running/);
  // Empty and old: stale.
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);
  helper.acquireLock(ctx, 100)();
  assert.ok(!fs.existsSync(lock));
});

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

const refusedArchives = {
  'a file outside package/': [{ name: 'other/x.js', data: Buffer.from('x') }],
  'a top-level file': [{ name: 'evil.js', data: Buffer.from('x') }],
  'a dot-dot path': [{ name: 'package/../../etc/cron.d/x', data: Buffer.from('x') }],
  'an absolute path': [{ name: '/etc/cron.d/x', data: Buffer.from('x') }],
  'a ./ path': [{ name: './package/x.js', data: Buffer.from('x') }],
  'an empty segment': [{ name: 'package//x.js', data: Buffer.from('x') }],
  'a backslash': [{ name: 'package/a\\..\\x.js', data: Buffer.from('x') }],
  'a control character': [{ name: 'package/a\nb.js', data: Buffer.from('x') }],
  'a symlink': [{ name: 'package/link', type: '2', linkname: '/etc/shadow' }],
  'a relative symlink': [{ name: 'package/link', type: '2', linkname: 'dist' }],
  'a hard link': [{ name: 'package/hard', type: '1', linkname: 'package/package.json' }],
  'a character device': [{ name: 'package/tty', type: '3' }],
  'a block device': [{ name: 'package/sda', type: '4' }],
  'a FIFO': [{ name: 'package/fifo', type: '6' }],
  'a GNU long name': [{ name: '././@LongLink', type: 'L', data: Buffer.from('package/x') }],
  'a global PAX header': [{ name: 'pax_global_header', type: 'g', data: Buffer.from('') }],
  'an entry twice': [{ name: 'package/package.json', data: Buffer.from('{}') }],
  'a file where a directory is': [{ name: 'package/dist/agentd.js/x.js', data: Buffer.from('x') }],
};

for (const [what, extra] of Object.entries(refusedArchives)) {
  test(`an archive with ${what} is refused and nothing is installed`, () => {
    const { install, at } = setup();
    assert.throws(() => install('1.0.0', tgzOf(packageEntries({ extra }))), helper.UsageError);
    assert.deepEqual(listed(at('opt/lamalibre/apps')), [], 'no code or staging is left');
  });
}

/** A PAX header record list, lengths computed correctly unless given. */
function paxRecords(records) {
  return Buffer.from(
    records
      .map(([k, v]) => {
        const body = ` ${k}=${v}\n`;
        let len = body.length + 1;
        while (`${len}${body}`.length !== len) len = `${len}${body}`.length;
        return `${len}${body}`;
      })
      .join(''),
  );
}

test('PAX headers: strictly formed, only known fields, each once; a path is honoured and checked', () => {
  const header = (data) => ({ name: 'PaxHeader/x', type: 'x', data });
  const scan = (entries) => helper.scanTarball(zlib.gunzipSync(tgzOf(entries)));
  const escape = [
    header(paxRecords([['path', 'package/../../etc/passwd']])),
    { name: 'package/x.js' },
  ];
  assert.throws(() => scan(escape), helper.UsageError);
  const sparse = [header(paxRecords([['GNU.sparse.size', '1']])), { name: 'package/x.js' }];
  assert.throws(() => scan(sparse), /unsupported PAX/);

  const long = `package/${'d'.repeat(120)}/x.js`;
  const ok = [
    header(paxRecords([['path', long]])),
    { name: 'package/short.js', data: Buffer.from('x') },
  ];
  const { entries, bytes } = scan(ok);
  assert.deepEqual(
    entries.map((e) => e.path),
    [long],
  );
  assert.equal(bytes, 1);

  for (const raw of [
    '017 path=package/a\n', // leading zero
    '+16 path=package/a\n', // sign
    '16\tpath=package/a\n', // tab
    '16  path=package/a\n', // two spaces
    '17 path=package/a\n', // length one too long
    '15 path=package/a\n', // length one too short
    '16 path=package/ab', // no newline
    '16 =package/abcde\n', // no keyword
    `${paxRecords([['path', 'package/a']]).toString()}${paxRecords([['path', 'package/b']]).toString()}`,
  ]) {
    assert.throws(() => helper.parsePax(Buffer.from(raw)), helper.UsageError, JSON.stringify(raw));
  }
  assert.deepEqual(
    helper.parsePax(
      paxRecords([
        ['path', 'package/a'],
        ['mtime', '1.5'],
      ]),
    ),
    {
      path: 'package/a',
      mtime: '1.5',
    },
  );
});

test('an archive with a corrupt header or data after its end is refused', () => {
  const tar = zlib.gunzipSync(tgzOf(packageEntries()));
  const corrupt = Buffer.from(tar);
  corrupt[10] ^= 0x01;
  assert.throws(() => helper.scanTarball(corrupt), /corrupt header/);
  const trailing = Buffer.concat([
    tar,
    tarEntry({ name: 'package/late.js', data: Buffer.from('x') }),
  ]);
  assert.throws(() => helper.scanTarball(trailing), /data after its end/);
  assert.throws(() => helper.scanTarball(tar.subarray(0, 1024)), helper.UsageError);
});

test('unpacked in-process from the checked entries: files 0644, directories 0755, implicit directories made', () => {
  const tar = zlib.gunzipSync(
    tgzOf([
      { name: 'package/package.json', data: Buffer.from('{}') },
      { name: 'package/a/b/c.js', data: Buffer.from('c'), mode: 0o4755 },
      { name: 'package/a/', type: '5', mode: 0o777 },
    ]),
  );
  const staging = fs.mkdtempSync(path.join(scratch, 'stage-'));
  const { entries } = helper.scanTarball(tar);
  helper.extractEntries(tar, entries, staging);
  assert.equal(fs.readFileSync(path.join(staging, 'package/a/b/c.js'), 'utf8'), 'c');
  assert.equal(mode(path.join(staging, 'package/a/b/c.js')), '644', 'no set-id or exec bit');
  assert.equal(mode(path.join(staging, 'package/a')), '755');
  assert.equal(mode(path.join(staging, 'package/a/b')), '755');
  // A file the staging directory already holds is never written through.
  assert.throws(() => helper.extractEntries(tar, entries, staging), /same name/);
});

test('after unpacking only directories and single-link files may remain', () => {
  const staging = fs.mkdtempSync(path.join(scratch, 'stage-'));
  fs.mkdirSync(path.join(staging, 'package', 'dist'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'package', 'dist', 'a.js'), 'x');
  const ctx = { chown: () => {}, rootUid: UID, rootGid: GID };
  fs.symlinkSync('/etc/passwd', path.join(staging, 'package', 'link'));
  assert.throws(() => helper.validateTree(ctx, staging), /link, device/);
  fs.rmSync(path.join(staging, 'package', 'link'));
  fs.linkSync(path.join(staging, 'package', 'dist', 'a.js'), path.join(staging, 'package', 'b.js'));
  assert.throws(() => helper.validateTree(ctx, staging), /hard link/);
  fs.rmSync(path.join(staging, 'package', 'b.js'));
  fs.writeFileSync(path.join(staging, 'stray'), 'x');
  assert.throws(() => helper.validateTree(ctx, staging), /other than package/);
  fs.rmSync(path.join(staging, 'stray'));
  fs.chmodSync(path.join(staging, 'package', 'dist', 'a.js'), 0o4777);
  helper.validateTree(ctx, staging);
  assert.equal(mode(path.join(staging, 'package', 'dist', 'a.js')), '644');
});

// ---------------------------------------------------------------------------
// The bundled rule
// ---------------------------------------------------------------------------

const unbundled = {
  dependencies: { manifest: { dependencies: { 'left-pad': '^1.0.0' } } },
  optionalDependencies: { manifest: { optionalDependencies: { fsevents: '*' } } },
  bundleDependencies: { manifest: { bundleDependencies: ['left-pad'] } },
  'a preinstall script': { manifest: { scripts: { preinstall: 'curl x | sh' } } },
  'an install script': { manifest: { scripts: { install: 'node-gyp rebuild' } } },
  'a postinstall script': { manifest: { scripts: { postinstall: 'node setup.js' } } },
  'a binding.gyp': { extra: [{ name: 'package/binding.gyp', data: Buffer.from('{}') }] },
  'another package name': { name: '@lamalibre/other-agent' },
  'another version': { manifest: { version: '1.0.1' } },
};

for (const [what, fixture] of Object.entries(unbundled)) {
  test(`a package with ${what} is refused and nothing is installed`, () => {
    const { install, at, system } = setup();
    assert.throws(() => install('1.0.0', tgzOf(packageEntries(fixture))), helper.UsageError);
    assert.deepEqual(listed(at('opt/lamalibre/apps')), [], 'no code directory is left');
    assert.equal(system.users.size, 0);
    assert.ok(!fs.existsSync(ownerFile(at)), 'no owner record');
    assert.deepEqual(fs.readdirSync(at('etc/systemd/system')), []);
  });
}

test('a package whose entry is missing is refused', () => {
  const { install } = setup();
  const entries = packageEntries().filter((e) => e.name !== 'package/dist/agentd.js');
  assert.throws(() => install('1.0.0', tgzOf(entries)), /entry dist\/agentd\.js is not a file/);
});

test('empty dependency fields and other scripts are allowed', () => {
  const { install } = setup();
  const manifest = { dependencies: {}, bundleDependencies: [], scripts: { start: 'node x' } };
  assert.equal(install('1.0.0', tgzOf(packageEntries({ manifest }))).ok, true);
});

// ---------------------------------------------------------------------------
// Installing, configuring, versions, removing
// ---------------------------------------------------------------------------

test('install: code, account with its route, owner record, directories and unit; no tar runs', () => {
  const { install, system, chowns, at } = setup();
  const result = install('1.0.0', tgzOf(packageEntries()));
  assert.deepEqual(result, { ok: true, version: '1.0.0', unit: 'inactive' });
  assert.ok(!system.calls.some(([cmd]) => cmd === 'tar'), 'unpacked by the helper itself');

  const code = at('opt/lamalibre/apps/fx');
  assert.equal(fs.readlinkSync(path.join(code, 'current')), '1.0.0');
  assert.equal(mode(path.join(code, '1.0.0/package/package.json')), '644');
  assert.equal(mode(path.join(code, '1.0.0/package/dist/agentd.js')), '644');
  assert.equal(mode(path.join(code, '1.0.0/package')), '755');
  assert.ok(fs.existsSync(path.join(code, '1.0.0/apphost.json')));
  assert.deepEqual(
    listed(at('opt/lamalibre/apps')).filter((n) => n.startsWith('.')),
    [],
    'no staging directory is left behind',
  );

  const user = helper.serviceUser(ROUTE);
  const account = system.users.get(user);
  assert.equal(account.comment, 'lamaste-app route=fx');
  const useradd = system.calls.find(([cmd]) => cmd === 'useradd');
  assert.deepEqual(useradd.slice(1), [
    '--system',
    '--user-group',
    '--comment',
    'lamaste-app route=fx',
    '--no-create-home',
    '--home-dir',
    '/nonexistent',
    '--shell',
    '/usr/sbin/nologin',
    user,
  ]);

  const owner = JSON.parse(fs.readFileSync(ownerFile(at), 'utf8'));
  assert.equal(owner.route, ROUTE);
  assert.equal(owner.package, PKG);
  assert.equal(owner.label, LABEL);
  assert.ok(Date.parse(owner.since) > 0);
  assert.equal(mode(ownerFile(at)), '644');
  assert.equal(mode(at('var/lib/lamalibre/apps/.owners')), '755');

  assert.equal(mode(at('var/lib/lamalibre/apps/fx')), '700');
  assert.ok(
    chowns.some(
      ([p, u, g]) => p === 'var/lib/lamalibre/apps/fx' && u === account.uid && g === account.gid,
    ),
  );
  assert.equal(mode(at('etc/lamalibre/apps/fx')), '750');
  assert.ok(
    chowns.some(([p, u, g]) => p === 'etc/lamalibre/apps/fx' && u === UID && g === account.gid),
  );

  const unit = fs.readFileSync(at(`etc/systemd/system/${helper.unitName(ROUTE)}`), 'utf8');
  assert.equal(unit, helper.renderUnit(ROUTE, specLine()));
  assert.equal(mode(at(`etc/systemd/system/${helper.unitName(ROUTE)}`)), '644');
  assert.ok(system.calls.some(([cmd, verb]) => cmd === 'systemctl' && verb === 'daemon-reload'));
  assert.ok(
    !system.calls.some(
      ([cmd, verb]) => cmd === 'systemctl' && (verb === 'start' || verb === 'restart'),
    ),
    'not started without a config',
  );
});

test('the unit: fixed template and hardening; MemoryMax only when set; no W^X or ProcSubset', () => {
  const plain = helper.renderUnit(ROUTE, specLine()).split('\n');
  for (const line of [
    'User=lamaste-app-fx',
    'Group=lamaste-app-fx',
    'ExecStart=/usr/bin/node /opt/lamalibre/apps/fx/current/package/dist/agentd.js',
    'Environment=LAMASTE_APP_CONFIG=/etc/lamalibre/apps/fx/plugin-config.json',
    'Environment=LAMASTE_APP_DATA_DIR=/var/lib/lamalibre/apps/fx',
    'WorkingDirectory=/var/lib/lamalibre/apps/fx',
    'ProtectSystem=strict',
    'ReadWritePaths=/var/lib/lamalibre/apps/fx',
    'ReadOnlyPaths=/run',
    'NoNewPrivileges=yes',
    'PrivateDevices=yes',
    'TemporaryFileSystem=/dev/shm:nosuid,nodev,noexec',
    'PrivateIPC=yes',
    'RemoveIPC=yes',
    'ProtectProc=invisible',
    'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX',
    'SystemCallFilter=@system-service',
    'SystemCallErrorNumber=EPERM',
    'CapabilityBoundingSet=',
    'UMask=0077',
    'Restart=on-failure',
    'WantedBy=multi-user.target',
  ]) {
    assert.ok(plain.includes(line), line);
  }
  assert.ok(!plain.some((l) => l.startsWith('MemoryMax')));
  assert.ok(!plain.some((l) => l.startsWith('MemoryDenyWriteExecute')), 'V8 JIT needs W+X');
  assert.ok(!plain.some((l) => l.startsWith('ProcSubset')), 'os.cpus() reads /proc');
  const capped = helper
    .renderUnit(ROUTE, specLine({ service: { entry: 'a.js', memoryMax: '512M' } }))
    .split('\n');
  assert.ok(capped.includes('MemoryMax=512M'));
  assert.ok(capped.includes('ExecStart=/usr/bin/node /opt/lamalibre/apps/fx/current/package/a.js'));
});

test('config: written 0600 for the service account, never echoed, then the unit starts', () => {
  const { install, call, system, chowns, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  const result = call(['config', LABEL, ROUTE], configInput());
  assert.deepEqual(result, { ok: true, version: '1.0.0', unit: 'active' });
  assert.ok(!JSON.stringify(result).includes(SECRET));

  const file = at('etc/lamalibre/apps/fx/plugin-config.json');
  assert.equal(mode(file), '600');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), pluginConfig());
  const account = system.users.get(helper.serviceUser(ROUTE));
  assert.ok(
    chowns.some(
      ([p, u, g]) =>
        p.startsWith('etc/lamalibre/apps/fx/.lamaste-apphost-') &&
        u === account.uid &&
        g === account.gid,
    ),
    'the file is the service account’s before it is renamed into place',
  );
  const unit = helper.unitName(ROUTE);
  assert.ok(
    system.calls.some(
      ([cmd, verb, name]) => cmd === 'systemctl' && verb === 'enable' && name === unit,
    ),
  );
  assert.ok(
    system.calls.some(
      ([cmd, verb, name]) => cmd === 'systemctl' && verb === 'start' && name === unit,
    ),
  );

  // A rotation: no restart (the agent half re-reads the file); a new port: restart.
  system.calls.length = 0;
  call(['config', LABEL, ROUTE], configInput({ secret: 'cd'.repeat(32), previousSecret: SECRET }));
  assert.ok(!system.calls.some(([, verb]) => verb === 'restart'));
  call(['config', LABEL, ROUTE], configInput({ port: 21001 }));
  assert.ok(system.calls.some(([, verb, name]) => verb === 'restart' && name === unit));
});

test('config: refused shapes never quote the input; an agent half not installed is exit 3', () => {
  const { install, call } = setup();
  assert.throws(() => call(['config', LABEL, ROUTE], configInput()), helper.NotInstalledError);
  install('1.0.0', tgzOf(packageEntries()));
  const bad = [
    configInput({ plugin: 'other' }),
    configInput({ port: 0 }),
    configInput({ secret: 'short' }),
    configInput({ previousSecret: 'nothex'.repeat(11) }),
    configInput({ issuedAt: 'x\ny' }),
    configInput({ extra: SECRET }),
    Buffer.from(`not json ${SECRET}`),
    Buffer.alloc(64 * 1024 + 1, 0x20),
  ];
  for (const input of bad) {
    assert.throws(
      () => call(['config', LABEL, ROUTE], input),
      (err) => err instanceof helper.UsageError && !err.message.includes(SECRET),
    );
  }
});

test('versions: install switches current, keeps the previous one, prunes the rest; activate switches back', () => {
  const { install, call, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  call(['config', LABEL, ROUTE], configInput());
  install('1.1.0', tgzOf(packageEntries({ version: '1.1.0' })));
  const code = at('opt/lamalibre/apps/fx');
  assert.deepEqual(call(['status', ROUTE]).apps.fx, {
    versions: ['1.0.0', '1.1.0'],
    current: '1.1.0',
    previous: '1.0.0',
    unit: 'active',
    owner: { package: PKG, label: LABEL },
  });

  // The same version again (a retried job) changes nothing else.
  install('1.1.0', tgzOf(packageEntries({ version: '1.1.0' })));
  assert.equal(fs.readlinkSync(path.join(code, 'previous')), '1.0.0');

  const spec2 = specLine({ service: { entry: 'dist/agentd.js', memoryMax: '256M' } });
  install('1.2.0', tgzOf(packageEntries({ version: '1.2.0' })), { spec: spec2 });
  assert.deepEqual(fs.readdirSync(code).sort(), ['1.1.0', '1.2.0', 'current', 'previous']);
  const unitFile = at(`etc/systemd/system/${helper.unitName(ROUTE)}`);
  assert.ok(fs.readFileSync(unitFile, 'utf8').includes('MemoryMax=256M'));

  // Activating the previous version restores its unit too.
  assert.deepEqual(call(['activate', LABEL, ROUTE, '1.1.0']), {
    ok: true,
    version: '1.1.0',
    unit: 'active',
  });
  assert.equal(fs.readlinkSync(path.join(code, 'previous')), '1.2.0');
  assert.ok(!fs.readFileSync(unitFile, 'utf8').includes('MemoryMax'));
  assert.throws(() => call(['activate', LABEL, ROUTE, '1.0.0']), /not kept/);
  assert.throws(() => call(['activate', LABEL, 'gx', '1.0.0']), helper.NotInstalledError);
});

test('remove keeps the data, the account and the owner record unless --purge; a purge goes through a root-only trash', () => {
  const { install, call, system, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  call(['config', LABEL, ROUTE], configInput());
  fs.writeFileSync(at('var/lib/lamalibre/apps/fx/db.sqlite'), 'data');

  assert.deepEqual(call(['remove', LABEL, ROUTE]), { ok: true, version: null, unit: 'absent' });
  assert.ok(!fs.existsSync(at('opt/lamalibre/apps/fx')));
  assert.ok(!fs.existsSync(at('etc/lamalibre/apps/fx')));
  assert.ok(!fs.existsSync(at(`etc/systemd/system/${helper.unitName(ROUTE)}`)));
  assert.ok(fs.existsSync(at('var/lib/lamalibre/apps/fx/db.sqlite')));
  assert.ok(fs.existsSync(ownerFile(at)), 'the owner record stays with the data');
  assert.ok(system.users.has(helper.serviceUser(ROUTE)));
  assert.ok(
    system.calls.some(
      ([cmd, verb, flag]) => cmd === 'systemctl' && verb === 'disable' && flag === '--now',
    ),
  );

  // Installed again later by its owner, the kept data is still the service's.
  install('1.0.0', tgzOf(packageEntries()));
  assert.ok(fs.existsSync(at('var/lib/lamalibre/apps/fx/db.sqlite')));

  assert.deepEqual(call(['remove', LABEL, ROUTE, '--purge']), {
    ok: true,
    version: null,
    unit: 'absent',
  });
  assert.ok(!fs.existsSync(at('var/lib/lamalibre/apps/fx')));
  assert.ok(!fs.existsSync(ownerFile(at)));
  assert.equal(mode(at('var/lib/lamalibre/apps/.trash')), '700');
  assert.deepEqual(fs.readdirSync(at('var/lib/lamalibre/apps/.trash')), []);
  assert.ok(!system.users.has(helper.serviceUser(ROUTE)));
  assert.ok(!system.groups.has(helper.serviceUser(ROUTE)));
  // Removing what is not there is not an error.
  assert.deepEqual(call(['remove', LABEL, ROUTE, '--purge']), {
    ok: true,
    version: null,
    unit: 'absent',
  });
});

test('status: protocol, Node.js and every agent half with its owner', () => {
  const { install, call, at } = setup();
  // The Node.js it runs on is the one every agent half runs on (the unit's ExecStart).
  const node = process.versions.node;
  assert.deepEqual(call(['status']), { protocol: helper.PROTOCOL_VERSION, node, apps: {} });
  install('1.0.0', tgzOf(packageEntries()));
  // A directory without code or unit is not an installed agent half.
  fs.mkdirSync(at('opt/lamalibre/apps/hx'));
  assert.deepEqual(call(['status']), {
    protocol: helper.PROTOCOL_VERSION,
    node,
    apps: {
      fx: {
        versions: ['1.0.0'],
        current: '1.0.0',
        previous: null,
        unit: 'inactive',
        owner: { package: PKG, label: LABEL },
      },
    },
  });
  assert.deepEqual(call(['status', 'gx']).apps.gx, {
    versions: [],
    current: null,
    previous: null,
    unit: 'absent',
    owner: null,
  });
});

// ---------------------------------------------------------------------------
// Ownership: other agents, other packages, other accounts
// ---------------------------------------------------------------------------

test('another agent on the machine is refused the route and its kept data until the owner purges', () => {
  const { install, call, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  call(['config', LABEL, ROUTE], configInput());
  call(['remove', LABEL, ROUTE]); // data and owner record kept

  const other = 'vm2';
  assert.throws(
    () => install('1.0.0', tgzOf(packageEntries()), { label: other }),
    (err) =>
      err instanceof helper.NotOwnerError &&
      /fx belongs to @lamalibre\/fx-agent installed by agent "vm1"/.test(err.message) &&
      /not @lamalibre\/fx-agent from agent "vm2"/.test(err.message) &&
      err.message.includes('sudo lamaste-agent apphost remove fx --purge'),
  );
  install('1.0.0', tgzOf(packageEntries()));
  for (const argv of [
    ['config', other, ROUTE],
    ['activate', other, ROUTE, '1.0.0'],
    ['remove', other, ROUTE],
    ['remove', other, ROUTE, '--purge'],
  ]) {
    const stdin = argv[0] === 'config' ? configInput() : undefined;
    assert.throws(() => call(argv, stdin), helper.NotOwnerError, argv.join(' '));
  }
  assert.ok(fs.existsSync(at('opt/lamalibre/apps/fx/1.0.0')), 'nothing was removed');

  call(['remove', LABEL, ROUTE, '--purge']);
  assert.equal(install('1.0.0', tgzOf(packageEntries()), { label: other }).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(ownerFile(at), 'utf8')).label, other);
});

test('another package is refused a route whose data is kept for the first', () => {
  const { install, call } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  call(['remove', LABEL, ROUTE]);
  const intruder = '@lamalibre/intruder-agent';
  const spec = specLine({ package: intruder });
  assert.throws(
    () => install('1.0.0', tgzOf(packageEntries({ name: intruder })), { spec }),
    (err) =>
      err instanceof helper.NotOwnerError &&
      /belongs to @lamalibre\/fx-agent .*not @lamalibre\/intruder-agent/.test(err.message),
  );
  call(['remove', LABEL, ROUTE, '--purge']);
  assert.equal(install('1.0.0', tgzOf(packageEntries({ name: intruder })), { spec }).ok, true);
});

test('code or data without an owner record is not taken over', () => {
  const { install, at } = setup();
  fs.mkdirSync(at('var/lib/lamalibre/apps/fx'), { recursive: true });
  assert.throws(() => install('1.0.0', tgzOf(packageEntries())), /no owner record/);
  assert.equal(fs.readdirSync(at('var/lib/lamalibre/apps/fx')).length, 0);
});

test("an account of the name that is not the route's — or a lone group — is never used, given files or deleted", () => {
  const user = helper.serviceUser(ROUTE);
  const foreign = setup({ users: [{ name: user, uid: 1500, gid: 1500, comment: 'someone else' }] });
  assert.throws(() => foreign.install('1.0.0', tgzOf(packageEntries())), helper.NotOwnerError);
  assert.ok(!foreign.chowns.some(([, uid]) => uid === 1500), 'nothing chowned to it');
  assert.ok(!fs.existsSync(ownerFile(foreign.at)));
  assert.throws(() => foreign.call(['remove', LABEL, ROUTE, '--purge']), helper.NotOwnerError);
  assert.ok(foreign.system.users.has(user), 'not deleted');
  assert.ok(!foreign.system.calls.some(([cmd]) => cmd === 'userdel'));

  const noRecord = setup({ users: [{ name: user, uid: 1501, gid: 1501, comment: '' }] });
  assert.throws(
    () => noRecord.install('1.0.0', tgzOf(packageEntries())),
    /is not the account of fx/,
  );

  const loneGroup = setup({ groups: [{ name: user, gid: 1502 }] });
  assert.throws(
    () => loneGroup.install('1.0.0', tgzOf(packageEntries())),
    /group named .* exists without its account/,
  );
  assert.ok(!loneGroup.system.calls.some(([cmd]) => cmd === 'useradd'));
});

test('an install that fails after creating the account takes back what it created', () => {
  const { install, system, at } = setup();
  // /etc/lamalibre/apps is not a directory: the config directory cannot be made.
  fs.writeFileSync(at('etc/lamalibre/apps'), 'not a directory');
  assert.throws(() => install('1.0.0', tgzOf(packageEntries())), /not a root-owned directory/);
  assert.ok(system.calls.some(([cmd]) => cmd === 'useradd'));
  assert.ok(!system.users.has(helper.serviceUser(ROUTE)), 'the account it made is deleted');
  assert.ok(!fs.existsSync(ownerFile(at)), 'the owner record it wrote is deleted');
  assert.ok(
    !fs.existsSync(at('var/lib/lamalibre/apps/fx')),
    'the data directory it made is deleted',
  );
  assert.deepEqual(listed(at('opt/lamalibre/apps')), []);
});

test('a first install that fails once its code is in place leaves nothing behind', () => {
  const { install, system, at } = setup({ failSystemctl: (args) => args[0] === 'daemon-reload' });
  assert.throws(
    () => install('1.0.0', tgzOf(packageEntries())),
    /daemon-reload exited with status 1/,
  );
  assert.deepEqual(listed(at('opt/lamalibre/apps')), [], 'no code');
  assert.ok(!fs.existsSync(at(`etc/systemd/system/${helper.unitName(ROUTE)}`)), 'no unit');
  assert.ok(!system.users.has(helper.serviceUser(ROUTE)), 'no account');
  assert.ok(!fs.existsSync(ownerFile(at)), 'no owner record');
  assert.ok(!fs.existsSync(at('var/lib/lamalibre/apps/fx')), 'no data directory');
});

test('an update whose new version will not start goes back to the version that ran', () => {
  let failNextRestart = false;
  const { install, call, system, at } = setup({
    failSystemctl: (args) => {
      if (!failNextRestart || args[0] !== 'restart') return false;
      failNextRestart = false;
      return true;
    },
  });
  install('1.0.0', tgzOf(packageEntries()));
  call(['config', LABEL, ROUTE], configInput());
  failNextRestart = true;
  system.calls.length = 0;
  const spec2 = specLine({ service: { entry: 'dist/agentd.js', memoryMax: '256M' } });
  assert.throws(
    () => install('1.1.0', tgzOf(packageEntries({ version: '1.1.0' })), { spec: spec2 }),
    /restart .* exited with status 1/,
  );
  const code = at('opt/lamalibre/apps/fx');
  assert.equal(fs.readlinkSync(path.join(code, 'current')), '1.0.0');
  const unit = fs.readFileSync(at(`etc/systemd/system/${helper.unitName(ROUTE)}`), 'utf8');
  assert.ok(!unit.includes('MemoryMax'), "1.0.0's unit again");
  assert.equal(
    system.calls.filter(([cmd, verb]) => cmd === 'systemctl' && verb === 'restart').length,
    2,
    'the new version tried, then the old one restarted',
  );
  assert.deepEqual(call(['status', ROUTE]).apps.fx.current, '1.0.0');
  assert.equal(call(['status', ROUTE]).apps.fx.unit, 'active');
});

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

test('at most 50 agent halves per machine; a route already there may be installed again', () => {
  const { install, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  for (let i = 1; i < helper.ROUTES_MAX; i++) {
    fs.mkdirSync(at(`opt/lamalibre/apps/r${i}/1.0.0`), { recursive: true });
  }
  assert.throws(
    () => install('1.0.0', tgzOf(packageEntries()), { route: 'gx' }),
    /already holds 50 agent halves/,
  );
  assert.equal(install('1.1.0', tgzOf(packageEntries({ version: '1.1.0' }))).ok, true);
});

test('too little free space is refused before anything is unpacked', () => {
  const { install, at } = setup();
  assert.throws(
    () => install('1.0.0', tgzOf(packageEntries()), { freeBytes: () => 32 * 2 ** 20 }),
    /not enough free space .* MiB needed in \/opt\/lamalibre\/apps, 32 MiB free/,
  );
  assert.deepEqual(listed(at('opt/lamalibre/apps')), []);
});

test("free space is measured with the file system's own figures", () => {
  const free = helper.createContext().freeBytes(scratch);
  assert.ok(Number.isFinite(free) && free > 0, String(free));
});

test('system packages: the missing ones are installed with apt-get on Debian, refused elsewhere', () => {
  const spec = specLine({ systemPackages: ['sqlite3', 'libpq5'] });
  const debian = setup({ packages: ['libpq5'] });
  debian.install('1.0.0', tgzOf(packageEntries()), { spec });
  const apt = debian.system.calls.filter(([cmd]) => cmd === 'apt-get');
  assert.deepEqual(apt[1], [
    'apt-get',
    'install',
    '-y',
    '--no-install-recommends',
    '-o',
    'DPkg::Lock::Timeout=120',
    'sqlite3',
  ]);

  const fedora = setup({ osRelease: 'ID=fedora\n' });
  assert.throws(
    () => fedora.install('1.0.0', tgzOf(packageEntries()), { spec }),
    /not a Debian-family system/,
  );
  assert.equal(fedora.system.users.size, 0, 'nothing was created');

  // Present already: nothing to install, on any distribution.
  const present = setup({ osRelease: 'ID=fedora\n', packages: ['sqlite3', 'libpq5'] });
  assert.equal(present.install('1.0.0', tgzOf(packageEntries()), { spec }).ok, true);
  assert.ok(!present.system.calls.some(([cmd]) => cmd === 'apt-get'));
});

test('a tarball npm itself packed is accepted', () => {
  const dir = fs.mkdtempSync(path.join(scratch, 'pkg-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: PKG, version: '2.0.0', files: ['dist'] }),
  );
  fs.writeFileSync(path.join(dir, 'dist', 'agentd.js'), 'console.log("fx");\n');
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', dir], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  const tgz = fs.readFileSync(path.join(dir, JSON.parse(packed.stdout)[0].filename));
  const { install, at } = setup();
  assert.deepEqual(install('2.0.0', tgz), { ok: true, version: '2.0.0', unit: 'inactive' });
  assert.equal(
    fs.readFileSync(at('opt/lamalibre/apps/fx/2.0.0/package/dist/agentd.js'), 'utf8'),
    'console.log("fx");\n',
  );
});

// ---------------------------------------------------------------------------
// Only what the relay signed
// ---------------------------------------------------------------------------

/** The error the helper raises for a job the relay did not sign as asked. */
const unsigned = (pattern) => (err) =>
  err instanceof helper.UnsignedError && pattern.test(err.message);

test('signed jobs: none, another key, another key pinned, no pin or an untrusted one — refused, nothing done', () => {
  const tgz = tgzOf(packageEntries());
  for (const [what, prepare, sign, pattern] of [
    ['no signature', () => {}, false, /the relay's signature/],
    [
      'another relay',
      () => {},
      { key: otherKey },
      /signed with relay key .* has .* pinned; re-pin/,
    ],
    [
      'another key pinned',
      (root) => writePin(root, LABEL, { key: otherKey }),
      {},
      /signed with relay key .* re-pin the relay key: sudo lamaste-agent apphost pin/,
    ],
    [
      'no pin',
      (root) => fs.rmSync(path.join(root, core.APPHOST_PATHS.relayPinFile(LABEL))),
      {},
      /no relay key is pinned for agent "vm1"; re-pin/,
    ],
    [
      'a pin others may write',
      (root) => fs.chmodSync(path.join(root, core.APPHOST_PATHS.relayPinFile(LABEL)), 0o666),
      {},
      /not a root-owned file/,
    ],
    [
      'a pin directory others may write',
      (root) => fs.chmodSync(path.join(root, core.APPHOST_PATHS.relaysDir), 0o777),
      {},
      /is not a root-owned directory/,
    ],
    [
      'a pin that is a link',
      (root) => {
        const file = path.join(root, core.APPHOST_PATHS.relayPinFile(LABEL));
        fs.renameSync(file, `${file}.real`);
        fs.symlinkSync(`${file}.real`, file);
      },
      {},
      /is a link/,
    ],
    [
      'a pin whose key is not its kid',
      (root) => {
        const file = path.join(root, core.APPHOST_PATHS.relayPinFile(LABEL));
        const pin = JSON.parse(fs.readFileSync(file, 'utf8'));
        fs.writeFileSync(file, JSON.stringify({ ...pin, publicKey: otherKey.publicKey }));
      },
      {},
      /pinned for agent "vm1" is unreadable/,
    ],
  ]) {
    const { install, call, root, at, system } = setup();
    prepare(root);
    assert.throws(() => install('1.0.0', tgz, { sign }), unsigned(pattern), what);
    assert.throws(
      () => call(['remove', LABEL, ROUTE], undefined, { sign }),
      unsigned(pattern),
      what,
    );
    assert.deepEqual(listed(at('opt')), [], what);
    assert.deepEqual(system.calls, [], `${what}: no command ran`);
    assert.equal(helper.exitStatus(new helper.UnsignedError('x')), 5);
  }
});

test('signed jobs: current only — expired, or issued ahead beyond the clock skew', () => {
  const { install } = setup();
  const tgz = tgzOf(packageEntries());
  assert.throws(
    () => install('1.0.0', tgz, { sign: { now: Date.now() - 600_001 } }),
    unsigned(/the job has expired/),
  );
  assert.throws(
    () => install('1.0.0', tgz, { sign: { now: Date.now() + 10_000 } }),
    unsigned(/signed in the future/),
  );
  assert.equal(install('1.0.0', tgz, { sign: { now: Date.now() + 2_000 } }).ok, true);
});

test('signed jobs: a job runs once — replayed, it is refused; the ids are kept root-only until they expire', () => {
  const { context, at } = setup();
  const tgz = tgzOf(packageEntries());
  const argv = ['install', LABEL, ROUTE, '1.0.0', sri(tgz)];
  const line = signatureFor(argv, installInput(tgz));
  const stdin = Buffer.concat([Buffer.from(line), installInput(tgz)]);
  const run = () => helper.main(argv, { ...context, stdin });
  assert.equal(run().ok, true);
  assert.throws(run, unsigned(/has run already; a signed job runs once/));

  const jobs = at('var/lib/lamalibre/apps/.jobs');
  assert.equal(mode(jobs), '700');
  assert.equal(mode(path.join(jobs, 'used.json')), '600');
  const used = JSON.parse(fs.readFileSync(path.join(jobs, 'used.json'), 'utf8'));
  assert.equal(used.v, 1);
  assert.deepEqual(Object.keys(used.jobs).length, 1);

  // Once it expired the id is forgotten — and the job could not verify anyway.
  const later = () => helper.main(argv, { ...context, stdin, now: () => Date.now() + 700_000 });
  assert.throws(later, unsigned(/expired/));
  // An unreadable record refuses every signed job until an operator removes it.
  fs.writeFileSync(path.join(jobs, 'used.json'), '{ broken');
  assert.throws(
    () =>
      helper.main(argv, {
        ...context,
        stdin: Buffer.concat([
          Buffer.from(signatureFor(argv, installInput(tgz))),
          installInput(tgz),
        ]),
      }),
    /used\.json is unreadable; delete it/,
  );
});

test('signed jobs: install — exactly the version, integrity and service spec the relay signed', () => {
  const tgz = tgzOf(packageEntries());
  const spec = { ...specLine(), version: '1.0.0', integrity: sri(tgz) };
  const signedWith = (over) => ({ fields: { payload: { spec: { ...spec, ...over } } } });
  for (const [what, over] of [
    ['version', { version: '1.0.1' }],
    ['integrity', { integrity: sri(tgzOf(packageEntries({ version: '1.0.1' }))) }],
  ]) {
    const { install, at } = setup();
    assert.throws(
      () => install('1.0.0', tgz, { sign: signedWith(over) }),
      unsigned(/another version or tarball integrity/),
      what,
    );
    assert.deepEqual(listed(at('opt')), [], what);
  }
  for (const [what, over] of [
    ['system packages', { systemPackages: ['openssh-server'] }],
    ['entry', { service: { entry: 'dist/other.js', memoryMax: null } }],
    ['memoryMax', { service: { entry: 'dist/agentd.js', memoryMax: '64M' } }],
    ['package', { package: '@lamalibre/other-agent' }],
  ]) {
    const { install, system, at } = setup();
    assert.throws(
      () => install('1.0.0', tgz, { sign: signedWith(over) }),
      unsigned(/the service spec is not the one the relay signed/),
      what,
    );
    assert.ok(!system.calls.some(([cmd]) => cmd === 'apt-get' || cmd === 'useradd'), what);
    assert.deepEqual(listed(at('opt')), [], what);
  }
  // The same spec, its system packages in another order: the same approval.
  const { install } = setup();
  const sorted = specLine({ systemPackages: ['libpq5', 'sqlite3'] });
  const shuffled = specLine({ systemPackages: ['sqlite3', 'libpq5', 'sqlite3'] });
  assert.equal(
    install('1.0.0', tgz, {
      spec: shuffled,
      sign: { fields: { payload: { spec: { ...sorted, version: '1.0.0', integrity: sri(tgz) } } } },
    }).ok,
    true,
  );
});

test('signed jobs: the agent, route and command the relay signed for', () => {
  const tgz = tgzOf(packageEntries());
  const { install, call } = setup();
  assert.throws(
    () => install('1.0.0', tgz, { sign: { fields: { agent: 'vm9' } } }),
    unsigned(/the job is for agent "vm9", not "vm1"/),
  );
  assert.throws(
    () => install('1.0.0', tgz, { sign: { fields: { route: 'gx' } } }),
    unsigned(/the job is for gx, not fx/),
  );
  // A remove job's signature handed to an install, and the other way round.
  assert.throws(
    () =>
      install('1.0.0', tgz, {
        sign: { fields: { kind: 'app-remove', payload: { purge: true, package: PKG } } },
      }),
    unsigned(/an app-remove job, not app-install/),
  );
  install('1.0.0', tgz);
  assert.throws(
    () =>
      call(['remove', LABEL, ROUTE], undefined, {
        sign: { fields: { kind: 'app-activate', payload: { version: '1.0.0', package: PKG } } },
      }),
    unsigned(/an app-activate job, not app-remove/),
  );
  // The label on this machine and the relay's name for the agent may differ:
  // the pin says which name the relay's jobs carry.
  const renamed = setup();
  writePin(renamed.root, LABEL, { agent: 'relay-vm1' });
  assert.throws(
    () => renamed.install('1.0.0', tgz),
    unsigned(/for agent "vm1", not "relay-vm1" \(agent "vm1" on its relay\)/),
  );
  assert.equal(
    renamed.install('1.0.0', tgz, { sign: { fields: { agent: 'relay-vm1' } } }).ok,
    true,
  );
});

test('signed jobs: activate — the version and the package that owns the route', () => {
  const { install, call } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  install('1.1.0', tgzOf(packageEntries({ version: '1.1.0' })));
  assert.throws(
    () =>
      call(['activate', LABEL, ROUTE, '1.0.0'], undefined, {
        sign: { fields: { payload: { version: '1.1.0', package: PKG } } },
      }),
    unsigned(/the job activates 1\.1\.0, not 1\.0\.0/),
  );
  assert.throws(
    () =>
      call(['activate', LABEL, ROUTE, '1.0.0'], undefined, {
        sign: { fields: { payload: { version: '1.0.0', package: '@lamalibre/other-agent' } } },
      }),
    (err) =>
      err instanceof helper.NotOwnerError &&
      /fx is @lamalibre\/fx-agent, not @lamalibre\/other-agent/.test(err.message),
  );
  assert.throws(
    () => call(['activate', LABEL, ROUTE, '1.0.0'], Buffer.from('{}\n'), { sign: false }),
    unsigned(/the first line of stdin is not the relay's signature/),
  );
  // The signature is all `activate` takes on stdin.
  assert.throws(
    () => call(['activate', LABEL, ROUTE, '1.0.0'], Buffer.from('more\n')),
    /stdin holds only the relay's signature/,
  );
  assert.equal(call(['activate', LABEL, ROUTE, '1.0.0']).version, '1.0.0');
});

test("signed jobs: remove — the purge flag as signed, and never another package's data", () => {
  const { install, call, at, system } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  call(['config', LABEL, ROUTE], configInput());
  // Signed without purge, asked with --purge — and the other way round.
  assert.throws(
    () =>
      call(['remove', LABEL, ROUTE, '--purge'], undefined, {
        sign: { fields: { payload: { purge: false, package: PKG } } },
      }),
    unsigned(/removes fx without --purge/),
  );
  assert.throws(
    () =>
      call(['remove', LABEL, ROUTE], undefined, {
        sign: { fields: { payload: { purge: true, package: PKG } } },
      }),
    unsigned(/removes fx with --purge/),
  );
  // A purge signed for another package: the kept data is not its to delete.
  assert.throws(
    () =>
      call(['remove', LABEL, ROUTE, '--purge'], undefined, {
        sign: { fields: { payload: { purge: true, package: '@lamalibre/intruder-agent' } } },
      }),
    (err) =>
      err instanceof helper.NotOwnerError &&
      /fx is @lamalibre\/fx-agent, not @lamalibre\/intruder-agent; its data is kept/.test(
        err.message,
      ),
  );
  assert.ok(fs.existsSync(at('opt/lamalibre/apps/fx/1.0.0')), 'nothing was removed');
  assert.ok(fs.existsSync(at('var/lib/lamalibre/apps/fx')));
  assert.ok(!system.calls.some(([cmd]) => cmd === 'userdel'));
  assert.deepEqual(call(['remove', LABEL, ROUTE, '--purge']), {
    ok: true,
    version: null,
    unit: 'absent',
  });
});

test('operator: a caller already running as root removes without a signature; the command line never can', () => {
  const { install, call, context, at } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  // Not from the command line: argv carries no operator authority.
  assert.throws(
    () => call(['remove', LABEL, ROUTE, '--operator'], undefined, { sign: false }),
    helper.UsageError,
  );
  // Installing and activating always need the relay.
  assert.throws(
    () =>
      helper.main(['activate', LABEL, ROUTE, '1.0.0'], {
        ...context,
        operator: true,
        stdin: Buffer.alloc(0),
      }),
    helper.UnsignedError,
  );
  assert.deepEqual(
    helper.main(['remove', LABEL, ROUTE, '--purge'], { ...context, operator: true }),
    { ok: true, version: null, unit: 'absent' },
  );
  assert.ok(!fs.existsSync(at('var/lib/lamalibre/apps/fx')));
});

test('contract: what core signs the helper verifies — and nothing tampered with', () => {
  const now = Date.now();
  const input = {
    agent: 'vm1',
    route: 'fx',
    jobId: crypto.randomUUID(),
    kind: 'app-install',
    payload: { spec: { ...specLine(), version: '1.0.0', integrity: sri(Buffer.from('x')) } },
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
  };
  const pin = {
    kid: relayKey.kid,
    agent: 'vm1',
    publicKey: crypto.createPublicKey({
      key: Buffer.from(relayKey.publicKey, 'base64'),
      format: 'der',
      type: 'spki',
    }),
  };
  const expect = { pin, label: 'vm1', route: 'fx', kind: 'app-install', now };
  const signature = core.signAppJob(input, relayKey);
  const line = JSON.stringify(signature);
  const envelope = helper.verifySignature(line, expect);
  assert.deepEqual(envelope, {
    v: 1,
    typ: 'lamaste.apphost.job',
    kid: relayKey.kid,
    ...input,
  });
  // Both sides read the same envelope.
  assert.deepEqual(core.decodeAppJobSignature(signature).envelope, envelope);
  for (const kind of ['app-activate', 'app-remove']) {
    const payload =
      kind === 'app-activate' ? { version: '1.0.0', package: PKG } : { purge: true, package: PKG };
    const other = core.signAppJob({ ...input, kind, payload }, relayKey);
    assert.deepEqual(
      helper.verifySignature(JSON.stringify(other), { ...expect, kind }).payload,
      payload,
    );
  }

  // Every field changed after signing: refused.
  const original = JSON.parse(Buffer.from(signature.envelope, 'base64url').toString('utf8'));
  const resign = (patch) =>
    JSON.stringify({
      ...signature,
      envelope: Buffer.from(core.canonicalJson({ ...original, ...patch })).toString('base64url'),
    });
  for (const [field, value] of Object.entries({
    v: 2,
    typ: 'lamaste.relay.assertion',
    kid: otherKey.kid,
    agent: 'vm2',
    route: 'gx',
    jobId: crypto.randomUUID(),
    kind: 'app-remove',
    payload: { spec: { ...input.payload.spec, systemPackages: ['openssh-server'] } },
    issuedAt: new Date(now - 1000).toISOString(),
    expiresAt: new Date(now + 600_001).toISOString(),
  })) {
    assert.throws(
      () => helper.verifySignature(resign({ [field]: value }), expect),
      helper.UnsignedError,
      field,
    );
  }
  const sig = Buffer.from(signature.sig, 'base64url');
  sig[0] ^= 1;
  assert.throws(
    () =>
      helper.verifySignature(
        JSON.stringify({ ...signature, sig: sig.toString('base64url') }),
        expect,
      ),
    unsigned(/does not verify/),
  );
  // Not canonical, even signed: refused, as core refuses it.
  const text = JSON.stringify({ v: 1, typ: 'lamaste.apphost.job', kid: relayKey.kid, ...input });
  const forged = {
    envelope: Buffer.from(text).toString('base64url'),
    sig: crypto.sign(null, Buffer.from(text), relayKey.privateKey).toString('base64url'),
  };
  assert.throws(
    () => helper.verifySignature(JSON.stringify(forged), expect),
    unsigned(/not a valid app job/),
  );
  assert.equal(core.decodeAppJobSignature(forged), null);
  // A relay assertion made with the same key is no job.
  const assertion = core.signRelayAssertion(
    { aud: 'vm1', port: 9393, caller: { type: 'admin' }, method: 'GET', target: { path: '/' } },
    relayKey,
  );
  const [encoded, assertionSig] = assertion.split('.');
  assert.throws(
    () => helper.verifySignature(JSON.stringify({ envelope: encoded, sig: assertionSig }), expect),
    helper.UnsignedError,
  );
});

test('contract: canonical JSON, signature constants and paths equal the core library', () => {
  for (const value of [
    { b: 1, a: [{ d: null, c: 'x' }], e: { g: true, f: 1.5 } },
    { spec: specLine(), version: '1.0.0' },
    JSON.parse('{"__proto__":{"x":1},"a":1}'),
    [],
    'é ✓',
  ]) {
    assert.equal(helper.canonicalJson(value), core.canonicalJson(value));
  }
  assert.equal(helper.JOB_TYPE, core.APP_JOB_SIGNATURE_TYPE);
  assert.equal(helper.JOB_VERSION, core.APP_JOB_SIGNATURE_VERSION);
  assert.deepEqual(Object.values(helper.JOB_KINDS), [...core.APP_JOB_KINDS]);
  assert.equal(helper.JOB_MAX_LIFETIME_MS, core.APP_JOB_SIGNATURE_MAX_LIFETIME_MS);
  assert.equal(helper.JOB_CLOCK_SKEW_MS, core.APP_JOB_SIGNATURE_CLOCK_SKEW_MS);
  assert.equal(helper.ENVELOPE_MAX, core.APP_JOB_ENVELOPE_MAX_CHARS);
  assert.equal(helper.PATHS.relaysDir, core.APPHOST_PATHS.relaysDir);
  assert.equal(helper.PATHS.jobsDir, core.APPHOST_PATHS.jobsDir);
  for (const label of ['vm1', 'a', 'x'.repeat(63)]) {
    assert.equal(helper.PATHS.relayPinFile(label), core.APPHOST_PATHS.relayPinFile(label));
  }
});

test('contract: a pin the agent CLI writes is one the helper reads', () => {
  const root = sandbox();
  writePin(root, LABEL, { agent: 'relay-vm1' });
  const ctx = helper.createContext({ root, rootUid: UID, rootGid: GID });
  const pin = helper.readRelayPin(ctx, LABEL);
  assert.equal(pin.kid, relayKey.kid);
  assert.equal(pin.agent, 'relay-vm1');
  assert.equal(pin.publicKey.asymmetricKeyType, 'ed25519');
});

// ---------------------------------------------------------------------------
// Identical to @lamalibre/lamaste
// ---------------------------------------------------------------------------

test('contract: patterns, limits and the protocol equal the core library', () => {
  assert.equal(helper.ROUTE_RE.source, core.APPHOST_ROUTE_RE.source);
  assert.equal(helper.LABEL_RE.source, agentLib.AGENT_LABEL_RE.source);
  assert.equal(helper.INTEGRITY_RE.source, core.AGENT_HALF_INTEGRITY_RE.source);
  assert.equal(helper.SERVICE_USER_MAX, core.APP_SERVICE_USER_MAX);
  assert.equal(helper.PROTOCOL_VERSION, core.APPHOST_PROTOCOL_VERSION);
  assert.equal(helper.PATHS.helper, core.APPHOST_PATHS.helper);
  assert.equal(helper.PATHS.sudoers, core.APPHOST_PATHS.sudoers);
});

const ROUTES = [
  'fx',
  'market-indicators',
  'a'.repeat(18),
  'a'.repeat(19),
  'a'.repeat(20),
  'x'.repeat(100),
  'market-ind-1a2b3c4d',
  'plugin-with-a-long-name-0',
];

test('contract: names and paths derived from a route equal the core library', () => {
  for (const route of ROUTES) {
    assert.equal(helper.serviceUser(route), core.appServiceUser(route), route);
    assert.equal(
      helper.serviceAccountComment(route),
      agentLib.appServiceAccountComment(route),
      route,
    );
    assert.equal(helper.unitName(route), core.appUnitName(route), route);
    for (const key of ['codeDir', 'dataDir', 'configDir', 'configFile', 'ownerFile']) {
      assert.equal(helper.PATHS[key](route), core.APPHOST_PATHS[key](route), `${key} ${route}`);
    }
  }
});

test('account names: readable up to 30 characters, hashed at exactly 31, the two never equal', () => {
  const names = new Map();
  for (let length = 1; length <= 100; length++) {
    for (const route of ['a'.repeat(length), `${'b'.repeat(Math.max(0, length - 1))}c`]) {
      if (!helper.ROUTE_RE.test(route)) continue;
      const name = helper.serviceUser(route);
      assert.ok(name.length <= helper.SERVICE_USER_MAX, route);
      assert.ok(/^[a-z_][a-z0-9_-]*$/.test(name), name);
      if (name === `lamaste-app-${route}`) assert.ok(name.length <= 30, route);
      else assert.equal(name.length, 31, route);
      assert.ok(!names.has(name) || names.get(name) === route, `${route} and ${names.get(name)}`);
      names.set(name, route);
    }
  }
  // A route whose readable name would look like another's hashed one
  // (the collision the old 31-character short form allowed).
  const long = `market-indicators-${'x'.repeat(10)}`;
  const crafted = helper.serviceUser(long).slice('lamaste-app-'.length);
  if (helper.ROUTE_RE.test(crafted)) {
    assert.notEqual(helper.serviceUser(crafted), helper.serviceUser(long));
  }
});

test('contract: what the helper accepts equals what the core schemas accept', () => {
  const versions = [
    '1.0.0',
    '0.0.1',
    '10.20.30',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-0',
    '1.0.0-x-y',
    '1.0.0--',
    '1.0.0-0a',
    '01.0.0',
    '1.01.0',
    '1.0.01',
    '1.0.0-01',
    '1.0.0-',
    '1.0.0-a..b',
    '1.0.0-.a',
    '1.0',
    '1.0.0+build',
    'v1.0.0',
    '99999999999999999.0.0',
    `1.0.0-${'a'.repeat(94)}`,
    `1.0.0-${'a'.repeat(95)}`,
  ];
  for (const v of versions) {
    assert.equal(helper.isVersion(v), core.AgentHalfVersionSchema.safeParse(v).success, v);
  }
  const entries = [
    'dist/agentd.js',
    'agentd.mjs',
    'a/b/c.cjs',
    'dist/.hidden.js',
    '../agentd.js',
    'dist/../agentd.js',
    '/agentd.js',
    'dist//agentd.js',
    './agentd.js',
    'dist/./agentd.js',
    'agentd.ts',
    'agent d.js',
    'agentd.js\n',
    `${'a'.repeat(197)}.js`,
    `${'a'.repeat(198)}.js`,
  ];
  for (const e of entries) {
    const ok = typeof e === 'string' && e.length <= helper.ENTRY_MAX && helper.ENTRY_RE.test(e);
    assert.equal(ok, core.AgentServiceEntrySchema.safeParse(e).success, JSON.stringify(e));
  }
  const packages = [
    '@lamalibre/fx-agent',
    '@lamalibre/a',
    '@lamalibre/-x',
    '@lamalibre/Fx',
    '@other/fx',
    'fx-agent',
    `@lamalibre/${'a'.repeat(203)}`,
    `@lamalibre/${'a'.repeat(204)}`,
  ];
  for (const p of packages) {
    const ok = p.length <= helper.PACKAGE_MAX && helper.PACKAGE_RE.test(p);
    assert.equal(ok, core.AgentHalfPackageNameSchema.safeParse(p).success, p);
  }
  for (const m of ['512M', '1G', '999999K', '0M', '1T', '1000000M', '512m', '']) {
    assert.equal(
      helper.MEMORY_MAX_RE.test(m),
      core.AgentServiceMemoryMaxSchema.safeParse(m).success,
      m,
    );
  }
  for (const s of [
    'sqlite3',
    'libpq5',
    'g++',
    'libc6.1',
    'Sqlite',
    '-o',
    'a b',
    '',
    'x'.repeat(101),
  ]) {
    const ok = s.length <= helper.SYSTEM_PACKAGE_MAX && helper.SYSTEM_PACKAGE_RE.test(s);
    assert.equal(ok, core.SystemPackageNameSchema.safeParse(s).success, s);
  }
  for (const label of [
    'vm1',
    'a',
    'e2e-agent',
    'x'.repeat(63),
    'x'.repeat(64),
    'VM1',
    '-a',
    'a-',
    'a.b',
  ]) {
    assert.equal(helper.LABEL_RE.test(label), agentLib.AGENT_LABEL_RE.test(label), label);
  }
});

test('contract: the spec line the agent sends is one the helper accepts', () => {
  const spec = core.AgentHalfSpecSchema.parse({
    package: PKG,
    version: '1.0.0',
    integrity: `sha512-${Buffer.alloc(64, 7).toString('base64')}`,
    service: { entry: 'dist/agentd.js', memoryMax: '512M' },
    systemPackages: ['sqlite3'],
  });
  const line = JSON.stringify({
    package: spec.package,
    service: spec.service,
    systemPackages: spec.systemPackages,
  });
  assert.deepEqual(helper.parseSpecLine(line), {
    package: spec.package,
    service: spec.service,
    systemPackages: spec.systemPackages,
  });
  assert.ok(helper.INTEGRITY_RE.test(spec.integrity));
});

test("contract: the helper's status parses with the core library's schema", () => {
  const { install, call } = setup();
  install('1.0.0', tgzOf(packageEntries()));
  const parsed = agentLib.parseAppHostStatus(JSON.stringify(call(['status'])));
  assert.deepEqual(parsed.apps.fx.owner, { package: PKG, label: LABEL });
  assert.equal(parsed.node, process.versions.node);
});
