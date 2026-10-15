/**
 * What `sudo lamaste-agent apphost enable|pin|disable` relies on when it
 * acts as root: a lamaste-agent install no other user can change (the
 * helper root installs comes from it); the sudoers rule — the helper only,
 * with a reset environment that never carries Node.js's own variables —
 * which visudo must accept; and the relay keys it pins — fetched as the
 * agent's user over each agent's pinned channel, validated by root, written
 * root-owned where the helper reads them.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A home of its own: the agent registry the root path reads is this one.
const home = mkdtempSync(path.join(tmpdir(), 'lamaste-apphost-setup-'));
process.env.HOME = home;
after(() => rmSync(home, { recursive: true, force: true }));

const setup = await import('../src/lib/apphost-setup.js');
const core = await import('@lamalibre/lamaste');
const agentLib = await import('@lamalibre/lamaste/agent');
const helper = createRequire(import.meta.url)(
  fileURLToPath(new URL('../scripts/lamaste-apphost', import.meta.url)),
);

/** A file system of `{ path: { uid, mode } }`; realpath maps through `links`. */
function fakeFs(entries, links = {}) {
  return {
    realpath: async (p) => links[p] ?? p,
    lstat: async (p) => {
      const e = entries[p];
      if (!e) throw Object.assign(new Error(`ENOENT ${p}`), { code: 'ENOENT' });
      return e;
    },
  };
}

const ROOT_DIR = { uid: 0, mode: 0o40755 };
const ROOT_FILE = { uid: 0, mode: 0o100755 };

const globalInstall = {
  '/': ROOT_DIR,
  '/usr': ROOT_DIR,
  '/usr/lib': ROOT_DIR,
  '/usr/lib/node_modules': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre/lamaste-agent': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre/lamaste-agent/scripts': ROOT_DIR,
  '/usr/lib/node_modules/@lamalibre/lamaste-agent/scripts/lamaste-apphost': ROOT_FILE,
};
const PKG = '/usr/lib/node_modules/@lamalibre/lamaste-agent';
const SOURCE = `${PKG}/scripts/lamaste-apphost`;

test('a root-owned global install is trusted, up to /', async () => {
  assert.deepEqual(await setup.untrustedPaths([PKG, SOURCE], fakeFs(globalInstall)), []);
});

test('anything another user owns or may write, anywhere up to /, is not', async () => {
  const userOwned = { ...globalInstall, [PKG]: { uid: 1000, mode: 0o40755 } };
  assert.deepEqual(await setup.untrustedPaths([PKG, SOURCE], fakeFs(userOwned)), [
    `${PKG} is owned by uid 1000, not root`,
  ]);
  const groupWritable = { ...globalInstall, '/usr/lib': { uid: 0, mode: 0o40775 } };
  assert.deepEqual(await setup.untrustedPaths([SOURCE], fakeFs(groupWritable)), [
    '/usr/lib is writable by its group or by others',
  ]);
  const worldWritableFile = { ...globalInstall, [SOURCE]: { uid: 0, mode: 0o100757 } };
  assert.match(
    (await setup.untrustedPaths([SOURCE], fakeFs(worldWritableFile))).join(),
    /lamaste-apphost is writable by its group or by others/,
  );
});

test('paths are judged where they really are (through links), each directory once', async () => {
  // npm's global bin is a link into a home directory the user owns (nvm).
  const nvm = {
    '/': ROOT_DIR,
    '/home': ROOT_DIR,
    '/home/ubuntu': { uid: 1000, mode: 0o40750 },
    '/home/ubuntu/.nvm': { uid: 1000, mode: 0o40755 },
  };
  const problems = await setup.untrustedPaths(
    ['/usr/lib/node_modules/@lamalibre/lamaste-agent'],
    fakeFs(nvm, { '/usr/lib/node_modules/@lamalibre/lamaste-agent': '/home/ubuntu/.nvm' }),
  );
  assert.deepEqual(problems, [
    '/home/ubuntu/.nvm is owned by uid 1000, not root',
    '/home/ubuntu is owned by uid 1000, not root',
  ]);
});

test('what root runs and installs: this package, the helper source, the core library', () => {
  const paths = setup.trustedSourcePaths();
  assert.ok(paths.includes(setup.HELPER_SOURCE));
  assert.ok(existsSync(setup.HELPER_SOURCE));
  assert.ok(
    paths.some((p) => existsSync(path.join(p, 'package.json'))),
    'the package directory',
  );
  assert.ok(
    paths.some((p) => /core[/\\]lib|lamaste[/\\]dist/.test(p)),
    paths.join(', '),
  );
});

test('the sudoers rule: the helper only, a reset environment, no Node.js variables', () => {
  const rule = setup.sudoersRule('ubuntu');
  const lines = rule.split('\n').filter((l) => l && !l.startsWith('#'));
  const helper = '/usr/local/sbin/lamaste-apphost';
  const denied = setup.HELPER_DENIED_ENV.join(' ');
  assert.deepEqual(lines, [
    `Defaults!${helper} env_reset`,
    `Defaults!${helper} !setenv`,
    `Defaults!${helper} env_keep -= "${denied}"`,
    `Defaults!${helper} env_delete += "${denied}"`,
    `ubuntu ALL=(root) NOPASSWD: ${helper}`,
  ]);
  for (const name of [
    'NODE_OPTIONS',
    'NODE_PATH',
    'NODE_EXTRA_CA_CERTS',
    'NODE_REDIRECT_WARNINGS',
  ]) {
    assert.ok(setup.HELPER_DENIED_ENV.includes(name), name);
  }
});

test('app hosting serves one OS user per machine: another user takes it over only with --force', () => {
  // No rule yet, or the same user again: nothing to refuse.
  setup.assertOneAppHostUser('ubuntu', null, false);
  setup.assertOneAppHostUser('ubuntu', 'ubuntu', false);
  setup.assertOneAppHostUser('root', null, false);
  // A rule for another user — root included, which needs none — is not replaced silently.
  for (const user of ['deploy', 'root']) {
    assert.throws(
      () => setup.assertOneAppHostUser(user, 'ubuntu', false),
      (err) => {
        assert.match(err.message, /serves ubuntu on this machine/);
        assert.match(err.message, /one OS user per machine/);
        assert.match(err.message, new RegExp(`pass --force to hand app hosting to ${user}`));
        return true;
      },
    );
    setup.assertOneAppHostUser(user, 'ubuntu', true);
  }
});

test('visudo accepts the sudoers rule', { skip: !existsSync('/usr/sbin/visudo') }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lamaste-sudoers-'));
  try {
    const file = path.join(dir, 'lamaste-apphost');
    writeFileSync(file, setup.sudoersRule('ubuntu'), { mode: 0o440 });
    execFileSync('/usr/sbin/visudo', ['-c', '-q', '-f', file], { stdio: 'pipe' });
    // …and refuses a broken one, so the check means something.
    writeFileSync(path.join(dir, 'broken'), 'ubuntu ALL=(root NOPASSWD: /bin/true\n', {
      mode: 0o440,
    });
    assert.throws(() =>
      execFileSync('/usr/sbin/visudo', ['-c', '-q', '-f', path.join(dir, 'broken')], {
        stdio: 'pipe',
      }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Relay keys
// ---------------------------------------------------------------------------

const UID = process.getuid();
const GID = process.getgid();
const OWNER = { uid: UID, gid: GID };
const PANEL = 'https://203.0.113.5:9292';

async function relayKey(name) {
  return core.createRelaySigner(path.join(home, `${name}.json`), { create: true }).current();
}

/** What the agent's user's `apphost relay-keys --json` reports for one agent. */
function fetchedFor(label, key, extra = {}) {
  return {
    label,
    panelUrl: PANEL,
    agentLabel: label,
    keys: [core.relayVerifyKeyOf(key)],
    ...extra,
  };
}

const mode = (p) => (statSync(p).mode & 0o777).toString(8);

/** The agents of `user` on this machine, as root found them in its registry. */
function machineAgents(labels, rootLabels = [], user = 'ubuntu') {
  return {
    user,
    registry: `/home/${user}/.lamalibre/lamaste/agents.json`,
    labels: new Set(labels),
    rootLabels: new Set(rootLabels),
  };
}

test("relay keys are fetched over each agent's pinned channel only, as the agent's user", async () => {
  const key = await relayKey('relay-a');
  const configs = {
    vm1: { panelUrl: PANEL, panelServerPubkeySha256: 'pin=' },
    vm2: { panelUrl: PANEL }, // no pinned panel certificate
  };
  const asked = [];
  const options = {
    listLabels: async () => ['vm1', 'vm2', 'vm3'],
    loadConfig: async (label) => configs[label] ?? null,
    fetchRelayKeys: async (config) => {
      asked.push(config);
      return { keys: [core.relayVerifyKeyOf(key)], agentLabel: 'relay-vm1' };
    },
  };
  const out = await setup.collectRelayKeys(options);
  assert.deepEqual(out[0], {
    label: 'vm1',
    panelUrl: PANEL,
    agentLabel: 'relay-vm1',
    keys: [{ kid: key.kid, publicKey: key.publicKey }],
  });
  assert.match(out[1].error, /no pinned panel certificate/);
  assert.match(out[2].error, /not set up/);
  assert.equal(asked.length, 1, 'an agent whose channel is not pinned is not asked');
  assert.deepEqual(await setup.collectRelayKeys({ ...options, label: 'vm9' }), [
    { label: 'vm9', error: 'there is no agent of that label on this machine' },
  ]);
  // A relay that answers with a key whose id is not its own: refused.
  const lying = await setup.collectRelayKeys({
    ...options,
    label: 'vm1',
    fetchRelayKeys: async () => ({
      keys: [{ kid: 'ab'.repeat(16), publicKey: key.publicKey }],
      agentLabel: 'vm1',
    }),
  });
  assert.match(lying[0].error, /key id does not match/);

  // For another user: this CLI run as that user — sudo -n -u <user> -H, a
  // minimal environment, no credential in sight.
  const runs = [];
  const run = async (file, args, opts) => {
    runs.push({ file, args, opts });
    return { exitCode: 0, stdout: JSON.stringify({ relays: out }), stderr: '' };
  };
  assert.deepEqual(await setup.fetchRelayKeysAs('ubuntu', { run, label: 'vm1' }), out);
  assert.equal(runs[0].file, '/usr/bin/sudo');
  assert.deepEqual(runs[0].args.slice(0, 5), ['-n', '-u', 'ubuntu', '-H', '--']);
  assert.equal(runs[0].args[5], process.execPath);
  assert.match(runs[0].args[6], /bin[/\\]lamaste-agent\.js$/);
  assert.deepEqual(runs[0].args.slice(7), ['apphost', 'relay-keys', '--json', '--label', 'vm1']);
  assert.deepEqual(Object.keys(runs[0].opts.env).sort(), ['LANG', 'PATH']);
  await assert.rejects(
    setup.fetchRelayKeysAs('ubuntu', {
      run: async () => ({ exitCode: 1, stdout: '', stderr: 'sudo: unknown user ubuntu\n' }),
    }),
    /as ubuntu failed \(sudo: unknown user ubuntu\)/,
  );
  await assert.rejects(
    setup.fetchRelayKeysAs('ubuntu', { run: async () => ({ exitCode: 0, stdout: 'hello' }) }),
    /returned something unexpected/,
  );
  // Root's own agents are read in this process: none here yet.
  assert.deepEqual(await setup.fetchRelayKeysAs('root'), []);
});

test("pins are validated by root: its own label, an Ed25519 key derived to its id, the relay's name", async () => {
  const key = await relayKey('relay-a');
  const now = new Date('2026-10-16T09:00:00.000Z');
  const agents = machineAgents(['vm1']);
  const pin = setup.relayPinFrom(fetchedFor('vm1', key, { agentLabel: 'relay-vm1' }), {
    agents,
    now,
  });
  assert.deepEqual(pin, {
    label: 'vm1',
    agent: 'relay-vm1',
    kid: key.kid,
    publicKey: key.publicKey,
    panelUrl: PANEL,
    pinnedAt: now.toISOString(),
  });
  const bad = (entry, pattern) =>
    assert.throws(() => setup.relayPinFrom(entry, { agents }), pattern);
  bad({ ...fetchedFor('vm1', key), label: '../etc' }, /no valid agent label/);
  // A label the agent user's registry does not list: not one of this machine's.
  bad(
    fetchedFor('vm2', key),
    /"vm2" is not an agent of ubuntu on this machine \(\/home\/ubuntu\/\.lamalibre\/lamaste\/agents\.json does not list it\)/,
  );
  // A label root's own agents use: another user's answer never replaces its key.
  assert.throws(
    () => setup.relayPinFrom(fetchedFor('vm1', key), { agents: machineAgents(['vm1'], ['vm1']) }),
    /"vm1" is one of root's agents on this machine; pin it with --user root/,
  );
  bad({ ...fetchedFor('vm1', key), panelUrl: 'http://x' }, /no panel URL/);
  bad({ ...fetchedFor('vm1', key), keys: [] }, /publishes no key/);
  bad({ ...fetchedFor('vm1', key), agentLabel: 'VM1' }, /did not name this agent/);
  bad(
    {
      ...fetchedFor('vm1', key),
      keys: [{ kid: 'ab'.repeat(16), publicKey: key.publicKey }],
    },
    /key id does not match/,
  );
  const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey;
  const der = ec.export({ type: 'spki', format: 'der' });
  bad(
    {
      ...fetchedFor('vm1', key),
      keys: [{ kid: core.relayKeyId(der), publicKey: der.toString('base64') }],
    },
    /not an Ed25519 key/,
  );
  bad({ label: 'vm1', error: 'the agent is not set up' }, /not set up/);
  // What the agent's user reports is printed by root: no terminal escapes get through.
  bad({ ...fetchedFor('vm1', key), panelUrl: `${PANEL}/\u001b[2J` }, /no panel URL/);
  assert.throws(
    () =>
      setup.relayPinFrom(
        { label: 'vm1', error: 'bad\u001b]0;owned\u0007 news\nline two' },
        { agents },
      ),
    (err) => err.message === 'bad ]0;owned news line two',
  );
});

test('pinning writes root-owned directories and files the helper reads; a re-pin says what it replaced', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lamaste-pin-root-'));
  mkdirSync(path.join(root, 'etc'));
  try {
    const a = await relayKey('relay-a');
    const b = await relayKey('relay-b');
    const agents = machineAgents(['vm1', 'vm2', 'vm3']);
    const results = await setup.pinRelayKeys(
      [
        fetchedFor('vm1', a, { agentLabel: 'relay-vm1' }),
        { label: 'vm2', error: 'the agent is not set up' },
        fetchedFor('vm3', b),
        fetchedFor('vm4', b),
      ],
      { agents, root, owner: OWNER },
    );
    assert.deepEqual(results, [
      { label: 'vm1', kid: a.kid, agent: 'relay-vm1', panelUrl: PANEL, previousKid: null },
      { label: 'vm2', error: 'the agent is not set up' },
      { label: 'vm3', kid: b.kid, agent: 'vm3', panelUrl: PANEL, previousKid: null },
      {
        label: 'vm4',
        error:
          '"vm4" is not an agent of ubuntu on this machine (/home/ubuntu/.lamalibre/lamaste/agents.json does not list it)',
      },
    ]);
    for (const dir of setup.RELAY_PIN_DIRS) {
      assert.equal(mode(path.join(root, dir)), '755', dir);
      assert.equal(statSync(path.join(root, dir)).uid, UID);
    }
    const file = path.join(root, core.APPHOST_PATHS.relayPinFile('vm1'));
    assert.equal(mode(file), '644');
    assert.deepEqual(readdirSync(path.dirname(file)).sort(), ['vm1.json', 'vm3.json'], 'no temp');
    // What the agent reports, and what the helper verifies with.
    const read = await agentLib.readRelayPin('vm1', { root, ownerUid: UID });
    assert.equal(read.state, 'pinned');
    assert.equal(read.pin.kid, a.kid);
    const ctx = helper.createContext({ root, rootUid: UID, rootGid: GID });
    assert.equal(helper.readRelayPin(ctx, 'vm1').agent, 'relay-vm1');
    assert.equal(helper.readRelayPin(ctx, 'vm1').kid, a.kid);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).panelUrl, PANEL);

    // The relay rotated: pinned again, the old key named.
    const again = await setup.pinRelayKeys([fetchedFor('vm1', b, { agentLabel: 'relay-vm1' })], {
      agents,
      root,
      owner: OWNER,
    });
    assert.deepEqual(again, [
      { label: 'vm1', kid: b.kid, agent: 'relay-vm1', panelUrl: PANEL, previousKid: a.kid },
    ]);
    const pins = await setup.readRelayPins({ root, ownerUid: UID });
    assert.deepEqual(Object.keys(pins), ['vm1', 'vm3']);
    assert.equal(pins.vm1.pin.kid, b.kid);

    // A directory someone else may write is not written into.
    chmodSync(path.join(root, core.APPHOST_PATHS.relaysDir), 0o777);
    const refused = await setup.pinRelayKeys([fetchedFor('vm1', a)], {
      agents,
      root,
      owner: OWNER,
    });
    assert.match(refused[0].error, /is not a root-owned directory only root may write/);
    chmodSync(path.join(root, core.APPHOST_PATHS.relaysDir), 0o755);

    // Without the agents of the user the keys came from, nothing is pinned.
    await assert.rejects(
      setup.pinRelayKeys([fetchedFor('vm1', a)], { root, owner: OWNER }),
      /needs the agents of the user/,
    );

    await setup.removeRelayPins({ root });
    assert.equal(existsSync(path.join(root, core.APPHOST_PATHS.relaysDir)), false);
    assert.deepEqual(await setup.readRelayPins({ root, ownerUid: UID }), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the root path reads root's own agents: a pin needs a set-up agent with a pinned panel", async () => {
  const dir = path.join(home, '.lamalibre', 'lamaste');
  mkdirSync(path.join(dir, 'agents', 'vm1'), { recursive: true });
  writeFileSync(
    path.join(dir, 'agents.json'),
    JSON.stringify({ version: 2, currentLabel: 'vm1', agents: [{ label: 'vm1' }] }),
  );
  writeFileSync(
    path.join(dir, 'agents', 'vm1', 'config.json'),
    JSON.stringify({ panelUrl: PANEL, authMethod: 'p12' }),
  );
  const out = await setup.fetchRelayKeysAs('root');
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'vm1');
  assert.match(out[0].error, /no pinned panel certificate/);
});

test("root finds the agent user's home in the user database, as sudo -H gives it", async () => {
  const runs = [];
  const run =
    (stdout, exitCode = 0) =>
    async (file, args, opts) => {
      runs.push({ file, args, opts });
      return { exitCode, stdout };
    };
  assert.deepEqual(
    await setup.lookupUser('ubuntu', {
      run: run('ubuntu:x:1000:1000:Ubuntu,,,:/home/ubuntu:/bin/bash\n'),
    }),
    { uid: 1000, home: '/home/ubuntu' },
  );
  assert.equal(runs[0].file, '/usr/bin/getent');
  assert.deepEqual(runs[0].args, ['passwd', 'ubuntu']);
  assert.deepEqual(Object.keys(runs[0].opts.env).sort(), ['LANG', 'PATH']);
  await assert.rejects(setup.lookupUser('nobody2', { run: run('', 2) }), /no user named "nobody2"/);
  await assert.rejects(
    setup.lookupUser('ubuntu', { run: run('other:x:1000:1000::/home/other:/bin/sh\n') }),
    /not one root can use/,
  );
  await assert.rejects(
    setup.lookupUser('ubuntu', { run: run('ubuntu:x:1000:1000::relative/home:/bin/sh\n') }),
    /no usable home directory/,
  );
});

test("root reads the agent user's registry only as a file that user owns, and never echoes it", async () => {
  const userHome = mkdtempSync(path.join(tmpdir(), 'lamaste-agent-user-'));
  const lookup = async () => ({ uid: UID, home: userHome });
  const registryDir = path.join(userHome, '.lamalibre', 'lamaste');
  const registry = path.join(registryDir, 'agents.json');
  try {
    // No registry: no agents.
    assert.deepEqual([...(await setup.agentLabelsOf('ubuntu', { lookup })).labels], []);

    mkdirSync(registryDir, { recursive: true });
    writeFileSync(
      registry,
      JSON.stringify({
        version: 2,
        currentLabel: 'vm1',
        agents: [{ label: 'vm1' }, { label: 'vm2' }, { label: '../etc' }, { label: 7 }, null],
      }),
    );
    const found = await setup.agentLabelsOf('ubuntu', { lookup });
    assert.equal(found.registry, registry);
    assert.deepEqual([...found.labels], ['vm1', 'vm2']);

    // Owned by someone else (root's file through a linked directory, say): refused.
    await assert.rejects(
      setup.agentLabelsOf('ubuntu', { lookup: async () => ({ uid: UID + 1, home: userHome }) }),
      /is not a regular file ubuntu owns/,
    );
    // Not JSON: refused without its content.
    writeFileSync(registry, 'root:$6$secret-hash:19000:0:99999:7:::\n');
    await assert.rejects(setup.agentLabelsOf('ubuntu', { lookup }), (err) => {
      assert.match(err.message, /is not an agent registry$/);
      assert.doesNotMatch(err.message, /secret-hash/);
      return true;
    });
    // Too large.
    writeFileSync(registry, `{"agents":[],"pad":"${'x'.repeat(1024 * 1024)}"}`);
    await assert.rejects(setup.agentLabelsOf('ubuntu', { lookup }), /is too large/);
    // A link at the registry's name is not followed.
    rmSync(registry);
    const elsewhere = path.join(userHome, 'elsewhere.json');
    writeFileSync(elsewhere, JSON.stringify({ agents: [{ label: 'vm9' }] }));
    symlinkSync(elsewhere, registry);
    await assert.rejects(setup.agentLabelsOf('ubuntu', { lookup }), /is a symbolic link/);

    // For any user but root, root's own agents' labels come along to be refused.
    rmSync(registry);
    writeFileSync(registry, JSON.stringify({ agents: [{ label: 'vm1' }] }));
    const rootHome = mkdtempSync(path.join(tmpdir(), 'lamaste-agent-root-'));
    try {
      mkdirSync(path.join(rootHome, '.lamalibre', 'lamaste'), { recursive: true });
      writeFileSync(
        path.join(rootHome, '.lamalibre', 'lamaste', 'agents.json'),
        JSON.stringify({ agents: [{ label: 'r1' }] }),
      );
      const homes = { ubuntu: userHome, root: rootHome };
      const both = async (user) => ({ uid: UID, home: homes[user] });
      const agents = await setup.machineAgentsOf('ubuntu', { lookup: both });
      assert.deepEqual([...agents.labels], ['vm1']);
      assert.deepEqual([...agents.rootLabels], ['r1']);
      const asRoot = await setup.machineAgentsOf('root', { lookup: both });
      assert.deepEqual([...asRoot.labels], ['r1']);
      assert.deepEqual([...asRoot.rootLabels], []);
    } finally {
      rmSync(rootHome, { recursive: true, force: true });
    }
  } finally {
    rmSync(userHome, { recursive: true, force: true });
  }
});
