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
 * the answer only as it validates it: an Ed25519 key whose id is derived
 * from the key, and the label the relay knows the agent by, which its
 * signed jobs must name. An agent without a pinned panel certificate is
 * not pinned: its channel could be anyone's.
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
import { listAgents, loadAgentConfig, readRelayPin, relayPinJson } from '@lamalibre/lamaste/agent';

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
const SYSTEM_ENV = Object.freeze({ PATH: '/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8' });

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
  const run =
    options.run ??
    ((file, args, opts) => execa(file, args, { ...opts, reject: false, extendEnv: false }));
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
 * must: the label one of this machine's, the relay's own label for the
 * agent, and its first key — the one it signs with — an Ed25519 key whose
 * id is derived from it.
 *
 * @param {unknown} entry
 * @param {Date} [now]
 * @returns {import('@lamalibre/lamaste/agent').RelayPin}
 */
export function relayPinFrom(entry, now = new Date()) {
  const e = /** @type {Record<string, unknown>} */ (entry ?? {});
  const label = e.label;
  if (typeof label !== 'string' || !AGENT_LABEL_REGEX.test(label)) {
    throw new Error('The relay keys name no valid agent label');
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
 * Pin the relay key of each entry {@link fetchRelayKeysAs} returned. One
 * label failing does not keep the others from being pinned; each result
 * says what happened (`previousKid`: the key pinned before, if any).
 *
 * @param {unknown[]} fetched
 * @param {{ root?: string, owner?: { uid: number, gid: number }, now?: Date }} [options]
 * @returns {Promise<Array<{ label: string, kid: string, agent: string, panelUrl: string, previousKid: string | null } | { label: string, error: string }>>}
 */
export async function pinRelayKeys(fetched, { root = '/', owner = ROOT_OWNER, now } = {}) {
  const results = [];
  for (const entry of fetched) {
    const label =
      entry && typeof entry === 'object' && typeof entry.label === 'string' ? entry.label : '?';
    try {
      const pin = relayPinFrom(entry, now);
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
