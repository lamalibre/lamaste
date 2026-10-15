/**
 * What `sudo lamaste-agent apphost enable|pin|disable` relies on when it
 * acts as root: that this lamaste-agent is a root-owned install (what root
 * runs and installs cannot have been changed by another user), the sudoers
 * rule it writes for the agent's user, and the relay keys it pins.
 *
 * **Relay keys.** The helper runs only app jobs the agent's relay signed,
 * verified with that relay's key as pinned here for each agent label on the
 * machine (`APPHOST_PATHS.relayPinFile`, root 0644 in root 0755
 * directories). The key is fetched over that agent's own pinned mTLS
 * channel (`GET /api/agents/me/relay-keys`) by the agent's user — root
 * never handles the agent's certificate or its password — and root accepts
 * the answer only as it validates it: a label the agent user's registry
 * lists (root reads it itself, and refuses a label root's own agents use
 * when the user is another), an Ed25519 key whose id is derived from the
 * key, and the label the relay knows the agent by, which its signed jobs
 * must name. An agent without a pinned panel certificate is not pinned: its
 * channel could be anyone's.
 */

import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import {
  AGENT_LABEL_REGEX,
  APPHOST_PATHS,
  parseRelayKeysResponse,
  relayPublicKeySpki,
} from '@lamalibre/lamaste';
import {
  agentsRegistryPathIn,
  listAgents,
  loadAgentConfig,
  readRelayPin,
  relayPinJson,
} from '@lamalibre/lamaste/agent';

/** The helper as this version of the agent CLI ships it. */
export const HELPER_SOURCE = fileURLToPath(
  new URL('../../scripts/lamaste-apphost', import.meta.url),
);

/** This CLI package's directory. */
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Environment variables Node.js acts on — options, module paths, files it
 * writes — that must never reach the root helper. sudo's env_reset drops
 * them already; the rule also takes them out of env_keep and puts them in
 * env_delete, so no other sudoers setting can let one through.
 */
export const HELPER_DENIED_ENV = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_EXTRA_CA_CERTS',
  'NODE_ICU_DATA',
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_REDIRECT_WARNINGS',
  'NODE_V8_COVERAGE',
  'NODE_COMPILE_CACHE',
  'NODE_PRESERVE_SYMLINKS',
  'NODE_DEBUG',
  'NODE_DEBUG_NATIVE',
  'NODE_TLS_REJECT_UNAUTHORIZED',
]);

/**
 * The sudoers file: the agent's user may run the helper as root — any
 * arguments, which the helper validates itself — with a reset environment.
 *
 * @param {string} user
 */
export function sudoersRule(user) {
  const helper = APPHOST_PATHS.helper;
  const denied = HELPER_DENIED_ENV.join(' ');
  return (
    '# Managed by lamaste-agent apphost: lets the agent run the app host helper as root.\n' +
    '# The helper validates every argument and derives every path itself; it runs with\n' +
    '# a reset environment and never with the Node.js variables below.\n' +
    `Defaults!${helper} env_reset\n` +
    `Defaults!${helper} !setenv\n` +
    `Defaults!${helper} env_keep -= "${denied}"\n` +
    `Defaults!${helper} env_delete += "${denied}"\n` +
    `${user} ALL=(root) NOPASSWD: ${helper}\n`
  );
}

/**
 * Refuse to hand app hosting to `user` while the rule names another user,
 * unless `force`: the helper serves one OS user per machine (the sudoers
 * rule names one user; an agent running as root needs none), so the other
 * user's agents could no longer install, update or remove their agent
 * halves — those stay on the machine with nobody to manage them.
 *
 * @param {string} user
 * @param {string | null} current  the user the installed rule names, or null
 * @param {boolean} force
 */
export function assertOneAppHostUser(user, current, force) {
  if (current === null || current === user || force) return;
  throw new Error(
    `The app host helper serves ${current} on this machine (${APPHOST_PATHS.sudoers}); it serves ` +
      `one OS user per machine, so enabling it for ${user} would leave ${current}'s agents unable ` +
      `to install, update or remove their agent halves (sudo lamaste-agent apphost status lists ` +
      `those installed). Unhost or uninstall the plugins those agents host on their panels ` +
      `first, then pass --force to hand app hosting to ${user}.`,
  );
}

/**
 * The files root runs or installs from this lamaste-agent: its package,
 * the helper source, and the core library it loads.
 */
export function trustedSourcePaths() {
  const paths = [PACKAGE_DIR, HELPER_SOURCE];
  if (typeof import.meta.resolve === 'function') {
    paths.push(fileURLToPath(import.meta.resolve('@lamalibre/lamaste')));
  }
  return paths;
}

/**
 * Why root must not trust `paths`: each, resolved, and every directory
 * above it up to / must be root-owned and writable by no group or other
 * user — otherwise another user could change what root runs or installs.
 * Empty when they can be trusted.
 *
 * @param {string[]} paths
 * @param {{ lstat?: typeof lstat, realpath?: typeof realpath }} [fsOverrides] - tests
 * @returns {Promise<string[]>}
 */
export async function untrustedPaths(paths, fsOverrides = {}) {
  const lstatOf = fsOverrides.lstat ?? lstat;
  const resolve = fsOverrides.realpath ?? realpath;
  const problems = [];
  const seen = new Set();
  for (const p of paths) {
    let current = await resolve(p);
    for (;;) {
      if (!seen.has(current)) {
        seen.add(current);
        const st = await lstatOf(current);
        if (st.uid !== 0) {
          problems.push(`${current} is owned by uid ${st.uid}, not root`);
        } else if ((st.mode & 0o022) !== 0) {
          problems.push(`${current} is writable by its group or by others`);
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return problems;
}

/** How to get a lamaste-agent root can trust. */
export const ROOT_OWNED_INSTALL = 'sudo npm install -g @lamalibre/lamaste-agent';

// ---------------------------------------------------------------------------
// Relay keys
// ---------------------------------------------------------------------------

/** This CLI's entry, which root runs as the agent's user to fetch relay keys. */
const CLI_BIN = fileURLToPath(new URL('../../bin/lamaste-agent.js', import.meta.url));

const SUDO = '/usr/bin/sudo';
const GETENT = '/usr/bin/getent';
const SYSTEM_ENV = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' });

/** Run a system command with only the environment `options.env` gives, never rejecting. */
const runSystem = (file, args, options) =>
  execa(file, args, { ...options, reject: false, extendEnv: false });

/** The directories above a pin, outermost first; each root-owned, 0755. */
export const RELAY_PIN_DIRS = Object.freeze([
  '/etc/lamalibre',
  path.dirname(APPHOST_PATHS.relaysDir),
  APPHOST_PATHS.relaysDir,
]);

const ROOT_OWNER = Object.freeze({ uid: 0, gid: 0 });

/**
 * Text that came from the agent's user (an error it reported), made safe
 * for root to print: one line, no control characters — no terminal escape
 * sequences — and bounded.
 *
 * @param {unknown} text
 */
function userText(text) {
  return String(text)
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * What the relay of each agent label on this machine publishes, fetched
 * over each agent's own pinned mTLS channel — run as the agent's user
 * (`lamaste-agent apphost relay-keys --json`). An agent whose panel
 * certificate is not pinned is not asked.
 *
 * @param {{ label?: string, listLabels?: () => Promise<string[]>, loadConfig?: (label: string) => Promise<object | null>, fetchRelayKeys?: (config: object) => Promise<unknown> }} [options]
 * @returns {Promise<Array<{ label: string, panelUrl: string, agentLabel: string, keys: Array<{ kid: string, publicKey: string }> } | { label: string, error: string }>>}
 */
export async function collectRelayKeys(options = {}) {
  const listLabels =
    options.listLabels ?? (async () => (await listAgents()).map((agent) => agent.label));
  const loadConfig = options.loadConfig ?? loadAgentConfig;
  const fetchKeys =
    options.fetchRelayKeys ??
    (async (config) => (await import('./panel-api.js')).fetchRelayKeys(config));
  const labels = await listLabels();
  if (options.label !== undefined && !labels.includes(options.label)) {
    return [{ label: options.label, error: 'there is no agent of that label on this machine' }];
  }
  const out = [];
  for (const label of options.label !== undefined ? [options.label] : labels) {
    try {
      const config = await loadConfig(label);
      if (!config) throw new Error('the agent is not set up');
      if (!config.panelServerPubkeySha256) {
        throw new Error(
          "the agent has no pinned panel certificate, so its relay's answer cannot be trusted " +
            '(lamaste-agent panel reset-pin, or set the agent up again)',
        );
      }
      const answer = parseRelayKeysResponse(await fetchKeys(config));
      out.push({
        label,
        panelUrl: String(config.panelUrl),
        agentLabel: answer.agentLabel,
        keys: answer.keys.map(({ kid, publicKey }) => ({
          kid,
          publicKey: relayPublicKeySpki(publicKey),
        })),
      });
    } catch (err) {
      out.push({ label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/**
 * {@link collectRelayKeys} as agent user `user` — in this process for root,
 * otherwise this CLI run as that user (`sudo -n -u <user> -H`), so root
 * reads none of the agent's credentials. What comes back is the agent's
 * user's word: {@link relayPinFrom} validates it before anything is pinned.
 *
 * @param {string} user
 * @param {{ label?: string, run?: (file: string, args: string[], options: object) => Promise<{ exitCode: number, stdout: string, stderr: string }> }} [options]
 * @returns {Promise<unknown[]>}
 */
export async function fetchRelayKeysAs(user, options = {}) {
  if (user === 'root') {
    return collectRelayKeys({ label: options.label });
  }
  const run = options.run ?? runSystem;
  const args = [
    '-n',
    '-u',
    user,
    '-H',
    '--',
    process.execPath,
    CLI_BIN,
    'apphost',
    'relay-keys',
    '--json',
    ...(options.label !== undefined ? ['--label', options.label] : []),
  ];
  const result = await run(SUDO, args, {
    // Root's working directory may be one the user cannot enter.
    cwd: '/',
    env: { ...SYSTEM_ENV },
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.exitCode !== 0) {
    const why = userText(
      String(result.stderr ?? '')
        .trim()
        .split('\n')[0],
    );
    throw new Error(
      `Fetching the relay keys as ${user} failed (${why || `exit status ${result.exitCode}`})`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout).trim().split('\n').at(-1) ?? '');
  } catch {
    parsed = null;
  }
  if (!parsed || !Array.isArray(parsed.relays)) {
    throw new Error(`Fetching the relay keys as ${user} returned something unexpected`);
  }
  return parsed.relays;
}

/**
 * Where user `user` lives: its uid and home directory in the system's user
 * database (`getent passwd`, so users from NSS count too) — the HOME
 * `sudo -u <user> -H` gives this CLI when it fetches the relay keys.
 *
 * @param {string} user
 * @param {{ run?: (file: string, args: string[], options: object) => Promise<{ exitCode: number, stdout: string }> }} [options] - tests
 * @returns {Promise<{ uid: number, home: string }>}
 */
export async function lookupUser(user, options = {}) {
  const run = options.run ?? runSystem;
  const result = await run(GETENT, ['passwd', user], {
    cwd: '/',
    env: { ...SYSTEM_ENV },
    timeout: 30_000,
  });
  // getent: 2 is "no such key".
  if (result.exitCode === 2) throw new Error(`There is no user named "${user}"`);
  if (result.exitCode !== 0) {
    throw new Error(`Looking up user "${user}" failed (exit status ${result.exitCode})`);
  }
  const fields = (String(result.stdout).split('\n')[0] ?? '').split(':');
  const uid = Number(fields[2]);
  const home = fields[5] ?? '';
  if (fields.length !== 7 || fields[0] !== user || !Number.isSafeInteger(uid) || uid < 0) {
    throw new Error(`The user database's entry for "${user}" is not one root can use`);
  }
  if (!path.isAbsolute(home) || /\p{Cc}/u.test(home)) {
    throw new Error(`"${user}" has no usable home directory in the user database`);
  }
  return { uid, home };
}

/** The most an agent registry may weigh for root to read it. */
const REGISTRY_MAX_BYTES = 1024 * 1024;

/**
 * Read at most `max` + 1 bytes of an open file: the caller tells a file
 * that grew past `max` from one that fits.
 */
async function readBounded(fh, max) {
  const buf = Buffer.alloc(max + 1);
  let length = 0;
  while (length < buf.length) {
    const { bytesRead } = await fh.read(buf, length, buf.length - length, length);
    if (bytesRead === 0) break;
    length += bytesRead;
  }
  return buf.subarray(0, length);
}

/**
 * The labels of user `user`'s agents on this machine, read by root from
 * that user's agent registry — the one `lamaste-agent` lists its agents
 * from when run as that user, so the labels {@link fetchRelayKeysAs}
 * fetched relay keys for. The file lies in a home the user controls, so
 * root reads it as such: not through a link at its own name, not a FIFO
 * (opened without blocking), a regular file the user owns — never root's or
 * another user's file reached through a linked directory — at most 1 MiB,
 * and never echoed. No registry: no agents.
 *
 * @param {string} user
 * @param {{ lookup?: (user: string) => Promise<{ uid: number, home: string }> }} [options] - tests
 * @returns {Promise<{ user: string, registry: string, labels: ReadonlySet<string> }>}
 */
export async function agentLabelsOf(user, options = {}) {
  const { uid, home } = await (options.lookup ?? lookupUser)(user);
  const registry = agentsRegistryPathIn(home);
  let fh;
  try {
    fh = await open(registry, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (err) {
    if (err?.code === 'ENOENT') return { user, registry, labels: new Set() };
    if (err?.code === 'ELOOP') {
      throw new Error(
        `${registry} is a symbolic link; root reads the agent registry only as a file`,
      );
    }
    throw new Error(`${registry} cannot be read (${err?.code ?? 'unknown error'})`);
  }
  try {
    const st = await fh.stat();
    if (!st.isFile() || st.uid !== uid) {
      throw new Error(`${registry} is not a regular file ${user} owns`);
    }
    const bytes = await readBounded(fh, REGISTRY_MAX_BYTES);
    if (bytes.length > REGISTRY_MAX_BYTES) throw new Error(`${registry} is too large`);
    let parsed;
    try {
      parsed = JSON.parse(bytes.toString('utf-8'));
    } catch {
      parsed = null;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.agents)) {
      throw new Error(`${registry} is not an agent registry`);
    }
    const labels = parsed.agents
      .map((agent) => (agent && typeof agent === 'object' ? agent.label : undefined))
      .filter((label) => typeof label === 'string' && AGENT_LABEL_REGEX.test(label));
    return { user, registry, labels: new Set(labels) };
  } finally {
    await fh.close();
  }
}

/**
 * The agents a pin may name, as {@link machineAgentsOf} found them.
 *
 * @typedef {{ user: string, registry: string, labels: ReadonlySet<string>, rootLabels: ReadonlySet<string> }} MachineAgents
 */

/**
 * The agents a pin fetched as `user` may name: those `user`'s registry
 * lists. A pin is per label for the whole machine, and the helper serves
 * root as well as the user the sudoers rule names, so for any user but root
 * a label root's own agents use is left out too — that user's answer must
 * never replace the key root's agent verifies its jobs with.
 *
 * @param {string} user
 * @param {{ lookup?: (user: string) => Promise<{ uid: number, home: string }> }} [options] - tests
 * @returns {Promise<MachineAgents>}
 */
export async function machineAgentsOf(user, options = {}) {
  const own = await agentLabelsOf(user, options);
  const rootLabels = user === 'root' ? new Set() : (await agentLabelsOf('root', options)).labels;
  return { ...own, rootLabels };
}

/** An https URL of reasonable length with nothing in it a terminal would act on. */
function isPanelUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /\p{Cc}/u.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * The pin for one entry of {@link fetchRelayKeysAs}, validated as root
 * must: the label one of the agents {@link machineAgentsOf} found for the
 * user the keys were fetched as, the relay's own label for the agent, and
 * its first key — the one it signs with — an Ed25519 key whose id is
 * derived from it.
 *
 * @param {unknown} entry
 * @param {{ agents: MachineAgents, now?: Date }} options
 * @returns {import('@lamalibre/lamaste/agent').RelayPin}
 */
export function relayPinFrom(entry, { agents, now = new Date() }) {
  const e = /** @type {Record<string, unknown>} */ (entry ?? {});
  const label = e.label;
  if (typeof label !== 'string' || !AGENT_LABEL_REGEX.test(label)) {
    throw new Error('The relay keys name no valid agent label');
  }
  if (!agents.labels.has(label)) {
    throw new Error(
      `"${label}" is not an agent of ${agents.user} on this machine (${agents.registry} does not list it)`,
    );
  }
  if (agents.rootLabels.has(label)) {
    throw new Error(`"${label}" is one of root's agents on this machine; pin it with --user root`);
  }
  if (typeof e.error === 'string') throw new Error(userText(e.error));
  const panelUrl = e.panelUrl;
  if (!isPanelUrl(panelUrl)) throw new Error('The relay keys name no panel URL');
  const answer = parseRelayKeysResponse({ keys: e.keys, agentLabel: e.agentLabel });
  const key = answer.keys[0];
  if (!key) {
    throw new Error(
      "The relay publishes no key — its signing key is unusable (see the panel's log)",
    );
  }
  return {
    label,
    agent: answer.agentLabel,
    kid: key.kid,
    publicKey: relayPublicKeySpki(key.publicKey),
    panelUrl,
    pinnedAt: now.toISOString(),
  };
}

/**
 * A directory root owns and nobody else may write, made (0755) when it is
 * missing; anything else at the path is refused.
 */
async function ensureOwnedDirectory(dir, owner) {
  try {
    await mkdir(dir, { mode: 0o755 });
    const fh = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await fh.chown(owner.uid, owner.gid);
      await fh.chmod(0o755);
    } finally {
      await fh.close();
    }
  } catch (err) {
    if (err?.code !== 'EEXIST') throw err;
  }
  const st = await lstat(dir);
  if (!st.isDirectory() || st.uid !== owner.uid || (st.mode & 0o022) !== 0) {
    throw new Error(`${dir} is not a root-owned directory only root may write`);
  }
}

async function fsyncDir(dir) {
  const fh = await open(dir, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Write agent `pin.label`'s relay key: the directories above it root-owned
 * 0755, the file root 0644 — written under a hidden temporary name, then
 * renamed into place. `root` prefixes the paths and `owner` stands in for
 * root (tests).
 *
 * @param {import('@lamalibre/lamaste/agent').RelayPin} pin
 * @param {{ root?: string, owner?: { uid: number, gid: number } }} [options]
 */
export async function writeRelayPin(pin, { root = '/', owner = ROOT_OWNER } = {}) {
  for (const dir of RELAY_PIN_DIRS) await ensureOwnedDirectory(path.join(root, dir), owner);
  const dest = path.join(root, APPHOST_PATHS.relayPinFile(pin.label));
  const dir = path.dirname(dest);
  const tmp = path.join(dir, `.${path.basename(dest)}.${crypto.randomBytes(8).toString('hex')}`);
  const fh = await open(
    tmp,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      await fh.writeFile(relayPinJson(pin));
      await fh.chown(owner.uid, owner.gid);
      await fh.chmod(0o644);
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  await fsyncDir(dir);
}

/**
 * Pin the relay key of each entry {@link fetchRelayKeysAs} returned for the
 * user `agents` describes ({@link machineAgentsOf}). One label failing does
 * not keep the others from being pinned; each result says what happened
 * (`previousKid`: the key pinned before, if any — printed beside the new
 * one, so the operator can compare both with the relay's).
 *
 * @param {unknown[]} fetched
 * @param {{ agents: MachineAgents, root?: string, owner?: { uid: number, gid: number }, now?: Date }} options
 * @returns {Promise<Array<{ label: string, kid: string, agent: string, panelUrl: string, previousKid: string | null } | { label: string, error: string }>>}
 */
export async function pinRelayKeys(fetched, { agents, root = '/', owner = ROOT_OWNER, now }) {
  if (!agents) {
    throw new TypeError('pinRelayKeys needs the agents of the user the keys were fetched as');
  }
  const results = [];
  for (const entry of fetched) {
    const label =
      entry && typeof entry === 'object' && typeof entry.label === 'string' ? entry.label : '?';
    try {
      const pin = relayPinFrom(entry, { agents, now });
      const previous = await readRelayPin(pin.label, { root, ownerUid: owner.uid });
      await writeRelayPin(pin, { root, owner });
      results.push({
        label: pin.label,
        kid: pin.kid,
        agent: pin.agent,
        panelUrl: pin.panelUrl,
        previousKid: previous.state === 'pinned' ? previous.pin.kid : null,
      });
    } catch (err) {
      results.push({ label, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * The relay keys pinned on this machine, by agent label (`apphost status`).
 *
 * @param {{ root?: string, ownerUid?: number }} [options]
 * @returns {Promise<Record<string, import('@lamalibre/lamaste/agent').RelayPinState>>}
 */
export async function readRelayPins({ root = '/', ownerUid = 0 } = {}) {
  let names = [];
  try {
    names = await readdir(path.join(root, APPHOST_PATHS.relaysDir));
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const out = {};
  for (const name of names.sort()) {
    const label = name.endsWith('.json') ? name.slice(0, -'.json'.length) : null;
    if (label === null || !AGENT_LABEL_REGEX.test(label)) continue;
    out[label] = await readRelayPin(label, { root, ownerUid });
  }
  return out;
}

/** Remove every pinned relay key (`apphost disable`): the helper they were for is gone. */
export async function removeRelayPins({ root = '/' } = {}) {
  await rm(path.join(root, APPHOST_PATHS.relaysDir), { recursive: true, force: true });
  // Its parent goes too when nothing else is in it.
  await rmdir(path.join(root, path.dirname(APPHOST_PATHS.relaysDir))).catch(() => undefined);
}
