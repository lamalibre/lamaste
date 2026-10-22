/**
 * Relay assertions — how the relay proves to `lamaste-agentd` that a request
 * on the agent's loopback came through one of the relay's vhosts, and who
 * the caller was.
 *
 * lamaste-agentd listens on `127.0.0.1`. The relay reaches it through a
 * chisel tunnel whose remote ends on the relay's loopback, so two kinds of
 * process can open a connection to it without going through nginx: any OS
 * user on the agent machine, and any process on the relay. A request header
 * such as `X-SSL-Client-DN: CN=admin` or `Remote-User` therefore proves
 * nothing to the daemon. Instead the relay signs, per request,
 *
 *     X-Lamalibre-Relay-Assertion: <base64url(payload)>.<base64url(ed25519 signature)>
 *
 * The payload names the agent the request is for (`aud`), the tunnel port it
 * travels on (`port`), the caller (an mTLS certificate holder or an
 * Authelia user), the method and the target (the exact path for a
 * certificate caller on the agent-panel vhost, the plugin route for an
 * Authelia user on a plugin tunnel), the issue time, a nonce and the id of
 * the signing key. The daemon verifies the signature against the relay's
 * public keys, rejects anything older than {@link RELAY_ASSERTION_MAX_AGE_MS}
 * (with {@link RELAY_ASSERTION_CLOCK_SKEW_MS} of clock difference), and
 * rejects a nonce it has already seen.
 *
 * The relay signs with an Ed25519 key in `<stateDir>/relay-signing-key.json`
 * (0600, owned by the panel user): serverd creates it at startup and signs for
 * the agent-panel vhost; Gatekeeper reads it and signs for plugin tunnels.
 * Agents only ever hold the public key, fetched from the panel over their
 * pinned mTLS channel, so nothing an agent machine stores lets anyone mint an
 * assertion — for that agent or any other.
 *
 * Gatekeeper also vouches to the panel itself, for a plugin's user surface
 * (`/api/<route>/app/*` on the host bound to it): the audience is
 * {@link RELAY_PANEL_AUDIENCE}, which no agent label can be, the caller the
 * session's username alone (the panel takes the user's id, attributes and
 * roles from its own directory), and the target both the route and the raw
 * request path, which must lie on that route's user surface
 * (`user-surface.ts`). Such an assertion is valid nowhere else: an agent
 * daemon's audience is its label, and a verifier built before the panel
 * audience existed refuses it as `malformed`.
 *
 * Shared between the server side (signing) and the agent side (verifying);
 * depends on nothing but `node:crypto`, `node:fs` and the shared path rules.
 */

import crypto from 'node:crypto';
import { link, open, stat, unlink } from 'node:fs/promises';

import { NonceStore } from './caller-assertion.js';
import { AGENT_LABEL_REGEX } from './constants.js';
import { isUserSurfaceUrl } from './user-surface.js';

/** The request header that carries the assertion (lower case, as Node reports headers). */
export const RELAY_ASSERTION_HEADER = 'x-lamalibre-relay-assertion';

/** How long an assertion is valid after it was issued. */
export const RELAY_ASSERTION_MAX_AGE_MS = 60_000;

/** Clock difference tolerated between the relay and the agent. */
export const RELAY_ASSERTION_CLOCK_SKEW_MS = 5_000;

export const RELAY_ASSERTION_VERSION = 1 as const;

/** File name of the relay's signing key in its state directory. */
export const RELAY_SIGNING_KEY_FILE = 'relay-signing-key.json';

/**
 * The audience of an assertion for the panel itself — a request on a
 * plugin's user surface. `@` is no character of an agent label
 * (`AGENT_LABEL_REGEX`), so no agent daemon ever accepts one.
 */
export const RELAY_PANEL_AUDIENCE = '@panel';

/**
 * The port of an assertion for the panel: the panel's own listener on the
 * relay's loopback (`127.0.0.1:3100`), where nginx sends a user-surface
 * request.
 */
export const RELAY_PANEL_PORT = 3100;

const MAX_HEADER_LENGTH = 8192;
const MAX_PATH_LENGTH = 4096;
const MAX_FIELD_LENGTH = 256;
const MAX_GROUPS = 64;
const NONCE_BYTES = 16;
const NONCE_RE = /^[a-f0-9]{32}$/;
const KID_RE = /^[a-f0-9]{32}$/;
const METHOD_RE = /^[A-Z]{1,16}$/;
const ROUTE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const USERNAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
// A group is anything Authelia may name one, except a comma: agentd joins
// them back into `Remote-Groups`, which is comma separated.
// eslint-disable-next-line no-control-regex
const GROUP_RE = /^[^,\u0000-\u001f\u007f]{1,128}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const ED25519_SIGNATURE_BYTES = 64;

/**
 * An Authelia user on a plugin tunnel, as Gatekeeper read the session —
 * what lamaste-agentd passes on as `Remote-*`.
 */
export interface RelaySessionUser {
  readonly type: 'user';
  readonly username: string;
  readonly groups: readonly string[];
  readonly name: string;
  readonly email: string;
}

/**
 * An Authelia user on a plugin's user surface, vouched for to the panel
 * ({@link RELAY_PANEL_AUDIENCE}): the username alone — the panel takes
 * everything else about the user from its directory, never from the
 * session.
 */
export interface RelayPanelUser {
  readonly type: 'user';
  readonly username: string;
}

/**
 * Who made the request the relay vouches for. For an agent: a certificate
 * holder (`admin`, `agent`) or a {@link RelaySessionUser}; for the panel:
 * a {@link RelayPanelUser}, and nothing else.
 */
export type RelayCaller =
  | { readonly type: 'admin' }
  | { readonly type: 'agent'; readonly label: string }
  | RelaySessionUser
  | RelayPanelUser;

/**
 * What the request may do. A certificate caller on the agent-panel vhost
 * gets the exact request target nginx received (`path`, with the query
 * string). An Authelia user on a plugin tunnel gets the plugin route: nginx
 * rewrites that request under `/<route>/`, so the target the daemon sees is
 * normalized and cannot be compared byte for byte. A user on a plugin's
 * user surface gets both — the route, and the raw request target (`path`,
 * with the query string), which must lie on that route's user surface and
 * equal the target the panel received.
 */
export type RelayTarget =
  | { readonly path: string }
  | { readonly route: string }
  | { readonly route: string; readonly path: string };

export interface RelayAssertionPayload {
  readonly v: typeof RELAY_ASSERTION_VERSION;
  /** Id of the signing key ({@link relayKeyId}). */
  readonly kid: string;
  /** The agent label the request is for, or {@link RELAY_PANEL_AUDIENCE}. */
  readonly aud: string;
  /** The port the request travels on — the port the verifying daemon listens on. */
  readonly port: number;
  readonly caller: RelayCaller;
  /** Upper-case HTTP method. */
  readonly method: string;
  readonly target: RelayTarget;
  /** Issue time, milliseconds since the epoch. */
  readonly iat: number;
  /** 16 random bytes, hex; rejected on a second sight. */
  readonly nonce: string;
}

/** The relay's signing key, as loaded from its file. */
export interface RelaySigningKey {
  readonly kid: string;
  readonly privateKey: crypto.KeyObject;
  /** Base64 of the DER SubjectPublicKeyInfo — what agents verify with. */
  readonly publicKey: string;
  readonly createdAt: string;
}

/** A verification key as the panel hands it to agents. */
export interface RelayVerifyKey {
  readonly kid: string;
  /** Base64 of the DER SubjectPublicKeyInfo of an Ed25519 key. */
  readonly publicKey: string;
}

/** Key id: the first 16 bytes of the SHA-256 of the public key's DER SPKI, hex. */
export function relayKeyId(spkiDer: Buffer): string {
  return crypto.createHash('sha256').update(spkiDer).digest('hex').slice(0, 32);
}

function signingKeyFromPem(privateKeyPem: string, createdAt: string): RelaySigningKey {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Relay signing key is not an Ed25519 key');
  }
  const spki = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return {
    kid: relayKeyId(spki),
    privateKey,
    publicKey: spki.toString('base64'),
    createdAt,
  };
}

/**
 * Parse a verification key the panel returned. The key id is derived from
 * the key itself, never taken on trust from the response.
 */
export function parseRelayVerifyKey(key: unknown): { kid: string; publicKey: crypto.KeyObject } {
  if (!key || typeof key !== 'object') throw new Error('Relay key is not an object');
  const k = key as Record<string, unknown>;
  if (typeof k['publicKey'] !== 'string' || typeof k['kid'] !== 'string') {
    throw new Error('Relay key needs a kid and a publicKey');
  }
  const der = Buffer.from(k['publicKey'], 'base64');
  const publicKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('Relay key is not an Ed25519 key');
  }
  const kid = relayKeyId(der);
  if (kid !== k['kid']) throw new Error('Relay key id does not match its key');
  return { kid, publicKey };
}

/** The public half of a signing key, as the panel publishes it. */
export function relayVerifyKeyOf(key: RelaySigningKey): RelayVerifyKey {
  return { kid: key.kid, publicKey: key.publicKey };
}

/** What `GET /api/agents/me/relay-keys` tells an agent, validated. */
export interface RelayKeysAnswer {
  /** The label the relay knows the calling agent by. */
  readonly agentLabel: string;
  /** The relay's verification keys, the one it signs with first; each id derived from its key. */
  readonly keys: readonly { readonly kid: string; readonly publicKey: crypto.KeyObject }[];
}

/**
 * Validate the panel's answer to `GET /api/agents/me/relay-keys` — the keys
 * relay assertions and app jobs are signed with, and the label the relay
 * knows the calling agent by. Throws when it is not that.
 */
export function parseRelayKeysResponse(response: unknown): RelayKeysAnswer {
  const r = (response ?? {}) as Record<string, unknown>;
  const list = r['keys'];
  const agentLabel = r['agentLabel'];
  if (!Array.isArray(list) || list.length > 16) {
    throw new Error('Panel returned malformed relay keys');
  }
  if (typeof agentLabel !== 'string' || !AGENT_LABEL_REGEX.test(agentLabel)) {
    throw new Error('Panel did not name this agent');
  }
  return { agentLabel, keys: list.map((entry) => parseRelayVerifyKey(entry)) };
}

/** Base64 of the DER SubjectPublicKeyInfo of a verification key — how keys are published and pinned. */
export function relayPublicKeySpki(publicKey: crypto.KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
}

// ---------------------------------------------------------------------------
// Signing key file
// ---------------------------------------------------------------------------

function parseSigningKeyFile(raw: string, filePath: string): RelaySigningKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${filePath} is not valid JSON`);
  }
  const p = (parsed ?? {}) as Record<string, unknown>;
  if (p['v'] !== 1 || typeof p['privateKey'] !== 'string' || typeof p['createdAt'] !== 'string') {
    throw new Error(`${filePath} is not a relay signing key file`);
  }
  return signingKeyFromPem(p['privateKey'], p['createdAt']);
}

/**
 * Create the key file exclusively: a 0600 temp file, fsynced, then linked
 * to the final name. `link` fails when the name exists, so two processes
 * racing here end up with one key, never a half-written one.
 */
async function createSigningKeyFile(filePath: string): Promise<void> {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const content =
    JSON.stringify(
      {
        v: 1,
        privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n';
  const tmp = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const handle = await open(tmp, 'wx', 0o600);
  // The temp file holds the private key: it goes away on every path.
  try {
    try {
      await handle.writeFile(content, 'utf-8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(tmp, filePath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

/** What identifies one state of the key file: content, and permissions too. */
interface FileStamp {
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly mode: number;
}

interface LoadedSigningKey {
  readonly key: RelaySigningKey;
  readonly stamp: FileStamp;
}

function stampOf(info: FileStamp): FileStamp {
  return {
    ino: info.ino,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    mode: info.mode,
  };
}

function sameStamp(a: FileStamp, b: FileStamp): boolean {
  return (
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.mode === b.mode
  );
}

/**
 * Read the key file through one descriptor, so the permission check and the
 * content are of the same file. A key other users can read is refused: it
 * may already be known to them.
 */
async function readSigningKeyFile(filePath: string): Promise<LoadedSigningKey> {
  const handle = await open(filePath, 'r');
  try {
    const info = await handle.stat();
    if ((info.mode & 0o077) !== 0) {
      throw new Error(
        `${filePath} is readable by other users (mode ${(info.mode & 0o777).toString(8)}); it must be 0600`,
      );
    }
    const key = parseSigningKeyFile(await handle.readFile('utf-8'), filePath);
    return { key, stamp: stampOf(info) };
  } finally {
    await handle.close();
  }
}

export interface RelaySignerOptions {
  /** Create the key file when it does not exist (the panel); otherwise only read it. */
  readonly create: boolean;
  /** How long a loaded key is used before the file is checked for a change. */
  readonly recheckMs?: number;
}

export interface RelaySigner {
  /**
   * The current signing key, or `null` when the file does not exist and the
   * signer may not create it. Throws when the file exists but is unusable
   * (bad permissions, bad content) — never signs with a key it cannot trust.
   */
  current(): Promise<RelaySigningKey | null>;
}

/**
 * A signer over the key file. The key is re-read when the file changes —
 * content or permissions, checked at most every `recheckMs` — so replacing
 * the file rotates the key without restarting the processes that sign.
 */
export function createRelaySigner(filePath: string, opts: RelaySignerOptions): RelaySigner {
  const recheckMs = opts.recheckMs ?? 5_000;
  let cached: LoadedSigningKey | null = null;
  let checkedAt = 0;
  let pending: Promise<RelaySigningKey | null> | null = null;

  async function load(): Promise<RelaySigningKey | null> {
    let info;
    try {
      info = await stat(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      if (!opts.create) return null;
      await createSigningKeyFile(filePath);
      info = await stat(filePath);
    }
    // A chmod changes ctime and mode, not the content: re-read, so a key
    // that became readable by others is refused rather than kept in use.
    if (cached && sameStamp(cached.stamp, info)) return cached.key;
    cached = await readSigningKeyFile(filePath);
    return cached.key;
  }

  return {
    async current() {
      if (cached && Date.now() - checkedAt < recheckMs) return cached.key;
      if (!pending) {
        pending = load()
          .catch((err: unknown) => {
            // Never keep signing with a key whose file went missing or bad.
            cached = null;
            throw err;
          })
          .then((key) => {
            if (!key) cached = null;
            checkedAt = Date.now();
            return key;
          })
          .finally(() => {
            pending = null;
          });
      }
      return pending;
    },
  };
}

// ---------------------------------------------------------------------------
// Sign / verify
// ---------------------------------------------------------------------------

function hasControl(value: string): boolean {
  return CONTROL_RE.test(value);
}

function isTargetPath(path: unknown): path is string {
  return str(path, MAX_PATH_LENGTH) && path.startsWith('/') && !path.includes(' ');
}

/** A caller for an agent: a certificate holder or a session user. */
function assertAgentCaller(caller: RelayCaller): void {
  if (caller.type === 'admin') return;
  if (caller.type === 'agent') {
    if (!AGENT_LABEL_REGEX.test(caller.label)) throw new Error('Invalid agent label in caller');
    return;
  }
  if (!USERNAME_RE.test(caller.username)) throw new Error('Invalid username in caller');
  if (!('groups' in caller)) {
    throw new Error("A user caller for an agent carries the session's groups, name and email");
  }
  if (caller.groups.length > MAX_GROUPS || !caller.groups.every((g) => GROUP_RE.test(g))) {
    throw new Error('Invalid groups in caller');
  }
  for (const field of [caller.name, caller.email]) {
    if (field.length > MAX_FIELD_LENGTH || hasControl(field)) {
      throw new Error('Invalid name or email in caller');
    }
  }
}

/** A target for an agent: a path for a certificate caller, a route for a session user. */
function assertAgentTarget(caller: RelayCaller, target: RelayTarget): void {
  if ('route' in target && 'path' in target) {
    throw new Error('A user-surface target (route and path) is only for the panel audience');
  }
  if ('path' in target) {
    if (caller.type === 'user') throw new Error('A user caller is bound to a route, not a path');
    if (!isTargetPath(target.path)) throw new Error('Invalid target path');
    return;
  }
  if (caller.type !== 'user') throw new Error('A certificate caller is bound to a path');
  if (!ROUTE_RE.test(target.route)) throw new Error('Invalid target route');
}

/**
 * The caller and target of an assertion for the panel, in the only form it
 * takes: a username, and a route with the raw request target on its user
 * surface. Throws on anything else.
 */
function panelCallerAndTarget(
  caller: RelayCaller,
  target: RelayTarget,
): { caller: RelayPanelUser; target: { route: string; path: string } } {
  if (caller.type !== 'user') throw new Error('The panel audience vouches for a user only');
  if (!USERNAME_RE.test(caller.username)) throw new Error('Invalid username in caller');
  if (!('route' in target) || !('path' in target)) {
    throw new Error('A user on the user surface is bound to a route and a path');
  }
  if (!ROUTE_RE.test(target.route)) throw new Error('Invalid target route');
  if (!isTargetPath(target.path) || !isUserSurfaceUrl(target.path, target.route)) {
    throw new Error("The target path is not on the route's user surface");
  }
  return {
    caller: { type: 'user', username: caller.username },
    target: { route: target.route, path: target.path },
  };
}

/**
 * Sign an assertion for one request. `iat` and `nonce` are filled in when
 * omitted; passing them is for tests. For {@link RELAY_PANEL_AUDIENCE} the
 * caller is signed as its username alone and the target must be the route
 * and the raw request target on its user surface.
 */
export function signRelayAssertion(
  input: Omit<RelayAssertionPayload, 'v' | 'kid' | 'iat' | 'nonce'> &
    Partial<Pick<RelayAssertionPayload, 'iat' | 'nonce'>>,
  key: RelaySigningKey,
): string {
  const panel = input.aud === RELAY_PANEL_AUDIENCE;
  if (!panel && !AGENT_LABEL_REGEX.test(input.aud)) throw new Error('Invalid audience label');
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error('Invalid port');
  }
  const method = input.method.toUpperCase();
  if (!METHOD_RE.test(method)) throw new Error('Invalid method');
  let caller: RelayCaller = input.caller;
  let target: RelayTarget = input.target;
  if (panel) {
    ({ caller, target } = panelCallerAndTarget(input.caller, input.target));
  } else {
    assertAgentCaller(input.caller);
    assertAgentTarget(input.caller, input.target);
  }
  const payload: RelayAssertionPayload = {
    v: RELAY_ASSERTION_VERSION,
    kid: key.kid,
    aud: input.aud,
    port: input.port,
    caller,
    method,
    target,
    iat: input.iat ?? Date.now(),
    nonce: input.nonce ?? crypto.randomBytes(NONCE_BYTES).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encoded, 'utf-8'), key.privateKey);
  return `${encoded}.${signature.toString('base64url')}`;
}

export type RelayAssertionRejection =
  | 'malformed'
  | 'unknown_key'
  | 'bad_signature'
  | 'wrong_audience'
  | 'wrong_port'
  | 'wrong_request'
  | 'expired'
  | 'future'
  | 'replayed';

export type VerifyRelayAssertionResult =
  | { readonly ok: true; readonly payload: RelayAssertionPayload }
  | { readonly ok: false; readonly reason: 'unknown_key'; readonly kid: string }
  | { readonly ok: false; readonly reason: Exclude<RelayAssertionRejection, 'unknown_key'> };

export interface VerifyRelayAssertionOptions {
  /** Verification keys by key id. */
  readonly keys: ReadonlyMap<string, crypto.KeyObject>;
  /** This agent's label — or, in the panel, {@link RELAY_PANEL_AUDIENCE}. */
  readonly aud: string;
  /** The port this daemon listens on. */
  readonly port: number;
  readonly method: string;
  /** The request target exactly as received (path and query string). */
  readonly url: string;
  readonly nonces: NonceStore;
  readonly now?: number | undefined;
}

function str(value: unknown, max = MAX_FIELD_LENGTH): value is string {
  return typeof value === 'string' && value.length <= max && !hasControl(value);
}

function parseCaller(raw: unknown): RelayCaller | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c['type'] === 'admin') return { type: 'admin' };
  if (c['type'] === 'agent') {
    const label = c['label'];
    return typeof label === 'string' && AGENT_LABEL_REGEX.test(label)
      ? { type: 'agent', label }
      : null;
  }
  if (c['type'] === 'user') {
    const { username, groups, name, email } = c;
    if (
      typeof username !== 'string' ||
      !USERNAME_RE.test(username) ||
      !Array.isArray(groups) ||
      groups.length > MAX_GROUPS ||
      !groups.every((g): g is string => typeof g === 'string' && GROUP_RE.test(g)) ||
      !str(name) ||
      !str(email)
    ) {
      return null;
    }
    return { type: 'user', username, groups, name, email };
  }
  return null;
}

function parseTarget(raw: unknown, caller: RelayCaller): RelayTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const path = t['path'];
  const route = t['route'];
  if (caller.type === 'user') {
    return path === undefined && typeof route === 'string' && ROUTE_RE.test(route)
      ? { route }
      : null;
  }
  return route === undefined && isTargetPath(path) ? { path } : null;
}

/** The caller and target of an assertion for the panel: a username, a route and a path. */
function parsePanelCallerAndTarget(
  rawCaller: unknown,
  rawTarget: unknown,
): { caller: RelayPanelUser; target: { route: string; path: string } } | null {
  if (!rawCaller || typeof rawCaller !== 'object' || !rawTarget || typeof rawTarget !== 'object') {
    return null;
  }
  const c = rawCaller as Record<string, unknown>;
  const t = rawTarget as Record<string, unknown>;
  const username = c['username'];
  const route = t['route'];
  const path = t['path'];
  if (
    c['type'] !== 'user' ||
    typeof username !== 'string' ||
    !USERNAME_RE.test(username) ||
    typeof route !== 'string' ||
    !ROUTE_RE.test(route) ||
    !isTargetPath(path)
  ) {
    return null;
  }
  return { caller: { type: 'user', username }, target: { route, path } };
}

function parsePayload(raw: Record<string, unknown>): RelayAssertionPayload | null {
  const { v, kid, aud, port, method, iat, nonce } = raw;
  if (
    v !== RELAY_ASSERTION_VERSION ||
    typeof kid !== 'string' ||
    !KID_RE.test(kid) ||
    typeof aud !== 'string' ||
    (aud !== RELAY_PANEL_AUDIENCE && !AGENT_LABEL_REGEX.test(aud)) ||
    typeof port !== 'number' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    typeof method !== 'string' ||
    !METHOD_RE.test(method) ||
    typeof iat !== 'number' ||
    !Number.isFinite(iat) ||
    typeof nonce !== 'string' ||
    !NONCE_RE.test(nonce)
  ) {
    return null;
  }
  if (aud === RELAY_PANEL_AUDIENCE) {
    const panel = parsePanelCallerAndTarget(raw['caller'], raw['target']);
    if (!panel) return null;
    return { v, kid, aud, port, caller: panel.caller, method, target: panel.target, iat, nonce };
  }
  const caller = parseCaller(raw['caller']);
  if (!caller) return null;
  const target = parseTarget(raw['target'], caller);
  if (!target) return null;
  return { v, kid, aud, port, caller, method, target, iat, nonce };
}

/** Whether a verified target admits the request target `url`. */
function targetAdmits(target: RelayTarget, url: string): boolean {
  if (!('route' in target)) return target.path === url;
  if (!('path' in target)) return urlIsUnderRoute(url, target.route);
  return target.path === url && isUserSurfaceUrl(target.path, target.route);
}

/** True when `url` (path and query string) lies under the plugin route. */
export function urlIsUnderRoute(url: string, route: string): boolean {
  const prefix = `/${route}`;
  return url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`);
}

/**
 * Verify the assertion header of a request the daemon received. Checks, in
 * order: shape, key, signature, payload, audience, port, method and target,
 * age, and replay. The nonce is recorded only when everything else passed,
 * so a forged assertion cannot poison the store. A user-surface target
 * (route and path, the panel's) admits only its own path, and only while
 * that path lies on the route's user surface (`isUserSurfaceUrl`).
 *
 * `unknown_key` carries the key id so the caller can fetch the relay's keys
 * again (the relay may have rotated) — the id is unauthenticated input, so
 * that fetch must be rate limited.
 */
export function verifyRelayAssertion(
  header: string | undefined,
  opts: VerifyRelayAssertionOptions,
): VerifyRelayAssertionResult {
  if (typeof header !== 'string' || header.length === 0 || header.length > MAX_HEADER_LENGTH) {
    return { ok: false, reason: 'malformed' };
  }
  const dot = header.indexOf('.');
  if (dot <= 0 || dot === header.length - 1 || header.indexOf('.', dot + 1) !== -1) {
    return { ok: false, reason: 'malformed' };
  }
  const encoded = header.slice(0, dot);
  const signature = Buffer.from(header.slice(dot + 1), 'base64url');
  if (signature.length !== ED25519_SIGNATURE_BYTES) return { ok: false, reason: 'malformed' };

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'malformed' };
  }
  const kid = (raw as Record<string, unknown>)['kid'];
  if (typeof kid !== 'string' || !KID_RE.test(kid)) return { ok: false, reason: 'malformed' };

  const key = opts.keys.get(kid);
  if (!key) return { ok: false, reason: 'unknown_key', kid };
  let valid = false;
  try {
    valid = crypto.verify(null, Buffer.from(encoded, 'utf-8'), key, signature);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: 'bad_signature' };

  const payload = parsePayload(raw as Record<string, unknown>);
  if (!payload) return { ok: false, reason: 'malformed' };
  if (payload.aud !== opts.aud) return { ok: false, reason: 'wrong_audience' };
  if (payload.port !== opts.port) return { ok: false, reason: 'wrong_port' };
  if (payload.method !== opts.method.toUpperCase()) return { ok: false, reason: 'wrong_request' };
  if (!targetAdmits(payload.target, opts.url)) return { ok: false, reason: 'wrong_request' };

  const now = opts.now ?? Date.now();
  if (payload.iat > now + RELAY_ASSERTION_CLOCK_SKEW_MS) return { ok: false, reason: 'future' };
  const expiresAt = payload.iat + RELAY_ASSERTION_MAX_AGE_MS + RELAY_ASSERTION_CLOCK_SKEW_MS;
  if (expiresAt <= now) return { ok: false, reason: 'expired' };
  if (!opts.nonces.record(payload.nonce, expiresAt, now)) {
    return { ok: false, reason: 'replayed' };
  }
  return { ok: true, payload };
}
