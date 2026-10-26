/**
 * Shim — Authelia lifecycle + config management now lives in
 * `@lamalibre/lamaste/server`. This file wires the daemon's execa instance
 * and bcryptjs hasher to the parameterized core API.
 *
 * Users go through here alone: every write of users.yml is a locked
 * read-modify-write in `lib/directory.js` (`changeUsers`), which brings the
 * user directory in line and renders the domains afterwards. Authelia
 * watches the file (`authentication_backend.file.watch`) and applies a
 * change at each user's next request — nothing restarts it.
 *
 * users.yml also carries the groups Lamaste owns (core owned-groups.ts:
 * domain memberships with their kind, static sites' listed users, host
 * groups, OIDC client grants), which the domains' rendering writes
 * ({@link writeOwnedGroups}). Every write here passes through one file lock
 * and keeps them as that rendering last decided — a read-modify-write that
 * read the file before a rendering never writes an older set back; a user
 * the rendering did not know (created since, perhaps under a deleted
 * user's username) gets none until the next one; after a rendering failed,
 * writes only narrow. A write never drops a user it was not told to delete.
 * After every write the file is touched once Authelia's reload cooldown has
 * passed ({@link USERS_FILE_TOUCH_DELAY_MS}) — read again, the owned groups
 * applied again, written: Authelia skips a change that lands within half a
 * second of its previous reload, and this guarantees one reload after the
 * last write, with the groups Lamaste decided even if something else wrote
 * the file meanwhile. The identity tick and the start touch it too.
 *
 * Tests point the users file, the TOTP writer and the renderers elsewhere
 * ({@link setAutheliaForTests}).
 */

import { execa } from 'execa';
import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { PromiseChainMutex, isLamasteOwnedGroup, mergeOwnedGroups } from '@lamalibre/lamaste';
import {
  AUTHELIA_USERS,
  isAutheliaInstalled as isAutheliaInstalledCore,
  writeAutheliaConfig as writeAutheliaConfigCore,
  readAutheliaUsers,
  writeAutheliaUsers,
  readAutheliaUsersRaw,
  hashAutheliaPassword,
  startAuthelia as startAutheliaCore,
  reloadAuthelia as reloadAutheliaCore,
  isAutheliaRunning as isAutheliaRunningCore,
  updateAutheliaDomainAccess,
  autheliaWatchesUsersFile,
  updateAutheliaOidcProvider,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  writeTotpToDatabase as writeTotpToDatabaseCore,
  purgeAutheliaSecondFactors,
  autheliaHoldsOpaqueIdentifier,
} from '@lamalibre/lamaste/server';

/**
 * How long after a write of users.yml it is written again with the same
 * content: past Authelia's half-second reload cooldown (its watcher skips a
 * change within 0.5 s of its previous reload, it does not queue it).
 */
export const USERS_FILE_TOUCH_DELAY_MS = 600;

// bcryptjs hasher — signature matches the core lib's BcryptHashFn.
const bcryptHash = (password, cost) => bcrypt.hash(password, cost);

const restartRealAuthelia = () => reloadAutheliaCore(execa);
const writeRealTotp = (username, base32Secret) =>
  writeTotpToDatabaseCore(username, base32Secret, execa);

/** Authelia's per-user storage through the root helper — replaced in tests. */
const realUserStorage = Object.freeze({
  purgeSecondFactors: (username) => purgeAutheliaSecondFactors(username, execa),
  holdsOidcIdentifier: (username) => autheliaHoldsOpaqueIdentifier(username, execa),
});

/** Authelia's users file — another one in tests. */
let usersFile = AUTHELIA_USERS;
/** Restart Authelia (it reads its configuration when it starts) — replaced in tests. */
let restartAuthelia = restartRealAuthelia;
const realWatches = () => autheliaWatchesUsersFile();
/** Whether Authelia's configuration has it watch users.yml — replaced in tests (true). */
let watchesUsersFile = realWatches;
/** Whether users.yml changed since Authelia last (re)read it for certain — see {@link takeUsersFileDirty}. */
let usersFileDirty = false;
/** The reload touch's delay; null: none (tests unless they ask). */
let touchDelayMs = USERS_FILE_TOUCH_DELAY_MS;
/** Store a TOTP secret in Authelia's database — replaced in tests. */
let totpWriter = writeRealTotp;
/** Authelia's per-user storage — replaced in tests. */
let userStorage = realUserStorage;
const updateRealDomainAccess = (access) => updateAutheliaDomainAccess(access, execa);
/** Render the domains into Authelia's configuration — replaced in tests. */
let domainAccessWriter = updateRealDomainAccess;
const updateRealOidcProvider = (domains, clients, options) =>
  updateAutheliaOidcProvider(domains, clients, execa, options);
/** Write Authelia's OIDC provider — replaced in tests. */
let oidcProviderWriter = updateRealOidcProvider;

/**
 * Point the users file, the Authelia restart, the TOTP writer, the
 * per-user storage and the domain rendering elsewhere (tests); `null`
 * restores Authelia's. The reload touch is off in tests unless
 * `touchDelayMs` asks for it. The owned groups the last rendering decided
 * are forgotten either way.
 *
 * @param {{ usersFile?: string, restart?: () => Promise<unknown>, watchesUsersFile?: () => Promise<boolean>, writeTotp?: (username: string, secret: string) => Promise<void>, userStorage?: { purgeSecondFactors: (username: string) => Promise<void>, holdsOidcIdentifier: (username: string) => Promise<boolean> }, domainAccess?: (access: object) => Promise<{ changed: boolean }>, oidcProvider?: (domains: object[], clients: object[], options: object) => Promise<{ changed: boolean, clients: number }>, touchDelayMs?: number | null } | null} overrides
 */
export function setAutheliaForTests(overrides) {
  usersFile = overrides?.usersFile ?? AUTHELIA_USERS;
  restartAuthelia = overrides?.restart ?? restartRealAuthelia;
  watchesUsersFile = overrides?.watchesUsersFile ?? (overrides ? async () => true : realWatches);
  usersFileDirty = false;
  touchDelayMs =
    overrides?.touchDelayMs !== undefined
      ? overrides.touchDelayMs
      : overrides
        ? null
        : USERS_FILE_TOUCH_DELAY_MS;
  ownedGroups = null;
  if (touchTimer) clearTimeout(touchTimer);
  touchTimer = null;
  totpWriter = overrides?.writeTotp ?? writeRealTotp;
  userStorage = overrides?.userStorage ?? realUserStorage;
  domainAccessWriter = overrides?.domainAccess ?? updateRealDomainAccess;
  oidcProviderWriter = overrides?.oidcProvider ?? updateRealOidcProvider;
}

/**
 * Delete `username`'s TOTP configuration and WebAuthn credentials from
 * Authelia's storage (idempotent; throws when the helper fails).
 *
 * @param {string} username
 */
export function purgeAutheliaUserSecondFactors(username) {
  return userStorage.purgeSecondFactors(username);
}

/**
 * Whether Authelia's storage holds an OpenID Connect opaque identifier for
 * `username` (throws when it cannot be told).
 *
 * @param {string} username
 */
export function autheliaHoldsOidcIdentity(username) {
  return userStorage.holdsOidcIdentifier(username);
}

/** True once create-lamaste has installed Authelia. */
export function isAutheliaInstalled() {
  return isAutheliaInstalledCore();
}

/**
 * Write Authelia's first configuration (onboarding): its rules name the
 * primary domain's groups by the key of its record, which onboarding has
 * made just before.
 */
export async function writeAutheliaConfig(domain, secrets) {
  const { domainGroupKey } = await import('./domains.js');
  const groupKey = (await domainGroupKey(domain)) ?? undefined;
  return writeAutheliaConfigCore(domain, secrets, groupKey ? { groupKey } : {});
}

// ---------------------------------------------------------------------------
// users.yml: one writer, the owned groups kept, a reload guaranteed
// ---------------------------------------------------------------------------

/** One write of users.yml at a time (a rendering's and a change's alike). */
const usersFileMutex = new PromiseChainMutex();

/**
 * The owned groups the domains' rendering last decided — `desired` by
 * username, the domain records they were decided for (every domain record
 * and every retired one), the usernames users.yml held then (`known`), and
 * whether a rendering failed since (`narrowOnly`) — or null before the
 * first rendering (a write then keeps the owned groups it was given).
 *
 * @type {{ desired: Map<string, readonly string[]>, domains: readonly string[], known: Set<string>, narrowOnly: boolean } | null}
 */
let ownedGroups = null;

/** The pending reload touch. */
let touchTimer = null;

/** `usersData` with the owned groups the last rendering decided, when there was one. */
function withOwnedGroups(usersData) {
  if (!ownedGroups) return usersData;
  const merged = mergeOwnedGroups(usersData.users ?? {}, ownedGroups.desired, ownedGroups.domains, {
    known: ownedGroups.known,
    narrowOnly: ownedGroups.narrowOnly,
  });
  return merged.changed ? { ...usersData, users: merged.users } : usersData;
}

/**
 * users.yml for a write (holding the file lock): a missing file is empty;
 * an empty file — read while another writer truncated it — is read again a
 * few times before it is believed.
 */
async function readCurrentLocked() {
  for (let attempt = 0; ; attempt++) {
    let content;
    try {
      content = await readFile(usersFile, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return { users: {} };
      throw err;
    }
    if (content.trim().length > 0 || attempt >= EMPTY_READ_RETRIES) {
      return readAutheliaUsersRaw(usersFile);
    }
    await new Promise((resolve) => setTimeout(resolve, EMPTY_READ_RETRY_MS));
  }
}

/** How often an empty users.yml is read again before a write believes it, and how far apart. */
const EMPTY_READ_RETRIES = 3;
const EMPTY_READ_RETRY_MS = 50;

/**
 * Write users.yml (holding the file lock) and schedule the reload touch
 * ({@link touchUsersFileLocked}) for {@link USERS_FILE_TOUCH_DELAY_MS}
 * after the last write. A write that changes the file marks it dirty
 * ({@link takeUsersFileDirty}).
 */
async function writeUsersLocked(usersData, current) {
  if (JSON.stringify(current) !== JSON.stringify(usersData)) usersFileDirty = true;
  await writeAutheliaUsers(usersData, usersFile);
  scheduleTouch();
}

function scheduleTouch() {
  if (touchDelayMs === null) return;
  if (touchTimer) clearTimeout(touchTimer);
  touchTimer = setTimeout(() => {
    touchTimer = null;
    void usersFileMutex.run(touchUsersFileLocked).catch(() => {
      // The file went or cannot be read (tests): the next write, the tick or
      // the next start touches again.
    });
  }, touchDelayMs);
  touchTimer.unref();
}

/**
 * Read users.yml, apply the owned groups the last rendering decided, and
 * write it — whether or not anything changed: a write Authelia's watcher
 * skipped in its cooldown is reloaded now, and a change something else
 * made meanwhile (a hand edit) gets Lamaste's groups back.
 */
async function touchUsersFileLocked() {
  const current = await readCurrentLocked();
  const next = withOwnedGroups(current);
  if (next !== current) usersFileDirty = true;
  await writeAutheliaUsers(next, usersFile);
}

/**
 * Touch users.yml now ({@link touchUsersFileLocked}) — at start and on the
 * identity tick, so a reload a restart of the panel cut short (its touch
 * pending) or skipped for any reason is never missing for long.
 */
export function touchUsersFile() {
  return usersFileMutex.run(touchUsersFileLocked);
}

/**
 * Whether users.yml changed since this was last asked — and forget it.
 * When Authelia is not known to watch the file (its configuration could not
 * be brought in line), the domains' rendering restarts it after such a
 * change, so it reads the file as 4.7 did.
 */
export function takeUsersFileDirty() {
  const dirty = usersFileDirty;
  usersFileDirty = false;
  return dirty;
}

/** Whether Authelia's configuration has it watch users.yml (core `autheliaWatchesUsersFile`). */
export function autheliaWatchesUsers() {
  return watchesUsersFile();
}

/**
 * Write users.yml — every write of the file the panel makes. The owned
 * groups are those the last rendering decided (see {@link withOwnedGroups}).
 * Refused when it would drop a user `deleting` does not name — a write
 * built from a read that missed users (a partial file) never removes them;
 * a user it deletes is forgotten by the owned groups as well, so whoever
 * takes the username next inherits none of them.
 *
 * @param {import('@lamalibre/lamaste/server').UsersYamlFile} usersData
 * @param {{ deleting?: readonly string[] }} [opts]
 */
export function writeUsers(usersData, { deleting = [] } = {}) {
  return usersFileMutex.run(async () => {
    const current = await readCurrentLocked();
    const next = usersData.users ?? {};
    const dropped = Object.keys(current.users ?? {}).filter((u) => !Object.hasOwn(next, u));
    if (dropped.some((u) => !deleting.includes(u))) {
      throw new Error(
        'users.yml was not written: it would remove users this change does not delete (read the file again and retry)',
      );
    }
    if (ownedGroups) {
      for (const u of dropped) {
        ownedGroups.desired.delete(u);
        ownedGroups.known.delete(u);
      }
    }
    await writeUsersLocked(withOwnedGroups(usersData), current);
  });
}

/**
 * Give every user exactly the owned groups of `desired` (core
 * `renderOwnedGroups`) — the domains' rendering; `domains` are every
 * domain record and every retired one. Compares first: an unchanged file
 * is not written. From now on every write keeps these groups (and adds
 * them only to the users the file holds now). Returns whether the file
 * changed.
 *
 * @param {ReadonlyMap<string, readonly string[]>} desired
 * @param {readonly string[]} domains
 * @returns {Promise<{ changed: boolean }>}
 */
export function writeOwnedGroups(desired, domains) {
  return usersFileMutex.run(async () => {
    const current = await readCurrentLocked();
    ownedGroups = {
      desired: new Map(desired),
      domains,
      known: new Set(Object.keys(current.users ?? {})),
      narrowOnly: false,
    };
    const merged = mergeOwnedGroups(current.users ?? {}, desired, domains);
    if (!merged.changed) return { changed: false };
    await writeUsersLocked({ ...current, users: merged.users }, current);
    return { changed: true };
  });
}

/**
 * After a rendering failed to compute or write the owned groups: until the
 * next one succeeds, writes only narrow (keep the owned groups a user holds
 * that the last rendering decided too, add none) — what it decided may be
 * older than the relay's state.
 */
export function narrowOwnedGroupsOnly() {
  if (ownedGroups) ownedGroups.narrowOnly = true;
}

/**
 * The owned groups each user of users.yml holds now, and whether each is
 * enabled — what the domains' rendering weighs a narrowing against.
 *
 * @param {readonly string[]} domains every domain record and every retired one
 * @returns {Promise<Map<string, { groups: string[], active: boolean }>>}
 */
export async function heldOwnedGroups(domains) {
  const raw = await readAutheliaUsersRaw(usersFile);
  const out = new Map();
  for (const [username, entry] of Object.entries(raw.users ?? {})) {
    const groups = Array.isArray(entry?.groups)
      ? entry.groups.filter((g) => typeof g === 'string' && isLamasteOwnedGroup(g, domains))
      : [];
    out.set(username, { groups, active: entry?.disabled !== true });
  }
  return out;
}

/**
 * Add the default administrator (group `admins`) to users.yml at
 * onboarding — inside `changeUsers`.
 */
export async function createUser(username, password) {
  const hash = await hashPassword(password);
  if (!hash || !hash.startsWith('$2')) throw new Error('Bcrypt hashing produced invalid output');
  const usersData = await readUsersForWrite();
  usersData.users[username] = {
    displayname: username,
    password: hash,
    email: `${username}@lamaste.local`,
    groups: ['admins'],
  };
  await writeUsers(usersData);
  return { username, created: true };
}

/** users.yml for a read-modify-write: a missing file starts empty, an unreadable one is refused. */
async function readUsersForWrite() {
  try {
    return await readAutheliaUsersRaw(usersFile);
  } catch (err) {
    if (err.code === 'ENOENT') return { users: {} };
    throw err;
  }
}

export function readUsers() {
  return readAutheliaUsers(usersFile);
}

/** users.yml as written, password hashes included; throws when it cannot be read or parsed. */
export function readUsersRaw() {
  return readAutheliaUsersRaw(usersFile);
}

export function hashPassword(password) {
  return hashAutheliaPassword(password, bcryptHash);
}

export function startAuthelia() {
  return startAutheliaCore(execa);
}

/**
 * Restart Authelia — every session ends. A change of users.yml needs none
 * (Authelia watches it); only configuration rewrites restart it, in core.
 */
export async function reloadAuthelia() {
  const restarted = await restartAuthelia();
  usersFileDirty = false;
  return restarted;
}

export function isAutheliaRunning() {
  return isAutheliaRunningCore(execa);
}

/**
 * Bring Authelia's session cookies and access control in line with the
 * relay's domains and protected sites (core `updateDomainAccess`) —
 * lib/domains.js `syncDomainAccess` alone calls it.
 *
 * @param {import('@lamalibre/lamaste/server').DomainAccess} access
 * @returns {Promise<{ changed: boolean }>}
 */
export function updateDomainAccess(access) {
  return domainAccessWriter(access);
}

/**
 * Make Authelia's OIDC provider serve exactly these clients, each of one of
 * `domains` (the active domains, each with its group key).
 * @param {import('@lamalibre/lamaste/server').AutheliaDomain[]} domains
 * @param {import('@lamalibre/lamaste/server').AutheliaOidcClient[]} clients
 * @param {import('@lamalibre/lamaste/server').OidcProviderOptions} [options]
 */
export function updateOidcProvider(domains, clients, options = {}) {
  return oidcProviderWriter(domains, clients, options);
}

/**
 * Add an invited user to users.yml — inside `changeUsers`, which brings the
 * directory and the domains' rendering in line with it.
 */
export async function createUserFromInvitation(username, email, groups, hashedPassword) {
  const usersData = await readUsersForWrite();
  if (usersData.users[username]) throw new Error(`User '${username}' already exists`);
  usersData.users[username] = { displayname: username, email, password: hashedPassword, groups };
  await writeUsers(usersData);
  return { username, created: true };
}

export function writeTotpToDatabase(username, base32Secret) {
  return totpWriter(username, base32Secret);
}

// Pure helpers — no dependency injection needed
export { base32Encode, base32Decode, generateTotpSecret };
