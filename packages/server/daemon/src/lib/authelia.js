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
 * domain memberships with their kind, host groups, OIDC client grants),
 * which the domains' rendering writes ({@link writeOwnedGroups}). Every
 * write here passes through one file lock and keeps them as that rendering
 * last decided — a read-modify-write that read the file before a rendering
 * never writes an older set back. After every write the file is written
 * once more with the same content when Authelia's reload cooldown has
 * passed ({@link USERS_FILE_TOUCH_DELAY_MS}): Authelia skips a change that
 * lands within half a second of its previous reload, and this guarantees
 * one reload after the last write.
 *
 * Tests point the users file, the TOTP writer and the renderers elsewhere
 * ({@link setAutheliaForTests}).
 */

import { execa } from 'execa';
import bcrypt from 'bcryptjs';
import { PromiseChainMutex, mergeOwnedGroups } from '@lamalibre/lamaste';
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
 * @param {{ usersFile?: string, restart?: () => Promise<unknown>, writeTotp?: (username: string, secret: string) => Promise<void>, userStorage?: { purgeSecondFactors: (username: string) => Promise<void>, holdsOidcIdentifier: (username: string) => Promise<boolean> }, domainAccess?: (access: object) => Promise<{ changed: boolean }>, oidcProvider?: (domains: string[], clients: object[], options: object) => Promise<{ changed: boolean, clients: number }>, touchDelayMs?: number | null } | null} overrides
 */
export function setAutheliaForTests(overrides) {
  usersFile = overrides?.usersFile ?? AUTHELIA_USERS;
  restartAuthelia = overrides?.restart ?? restartRealAuthelia;
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

export function writeAutheliaConfig(domain, secrets) {
  return writeAutheliaConfigCore(domain, secrets);
}

// ---------------------------------------------------------------------------
// users.yml: one writer, the owned groups kept, a reload guaranteed
// ---------------------------------------------------------------------------

/** One write of users.yml at a time (a rendering's and a change's alike). */
const usersFileMutex = new PromiseChainMutex();

/**
 * The owned groups the domains' rendering last decided — `desired` by
 * username and the domain records they were decided for — or null before
 * the first rendering (a write then keeps the owned groups it was given).
 *
 * @type {{ desired: ReadonlyMap<string, readonly string[]>, domains: readonly string[] } | null}
 */
let ownedGroups = null;

/** The pending reload touch. */
let touchTimer = null;

/** `usersData` with the owned groups the last rendering decided, when there was one. */
function withOwnedGroups(usersData) {
  if (!ownedGroups) return usersData;
  const merged = mergeOwnedGroups(usersData.users ?? {}, ownedGroups.desired, ownedGroups.domains);
  return merged.changed ? { ...usersData, users: merged.users } : usersData;
}

/**
 * Write users.yml (holding the file lock) and schedule the reload touch:
 * once {@link USERS_FILE_TOUCH_DELAY_MS} have passed since the last write,
 * the file is written again as it is — unless something else (Authelia's
 * own password reset) wrote it meanwhile.
 */
async function writeUsersLocked(usersData) {
  await writeAutheliaUsers(usersData, usersFile);
  if (touchDelayMs === null) return;
  if (touchTimer) clearTimeout(touchTimer);
  const file = usersFile;
  const expected = JSON.stringify(usersData);
  touchTimer = setTimeout(() => {
    touchTimer = null;
    void usersFileMutex
      .run(async () => {
        const now = await readAutheliaUsersRaw(file);
        if (JSON.stringify(now) === expected) await writeAutheliaUsers(now, file);
      })
      .catch(() => {
        // The file changed hands or went (tests): the next write touches again.
      });
  }, touchDelayMs);
  touchTimer.unref();
}

/**
 * Write users.yml — every write of the file the panel makes. The owned
 * groups are those the last rendering decided (see {@link withOwnedGroups}).
 *
 * @param {import('@lamalibre/lamaste/server').UsersYamlFile} usersData
 */
export function writeUsers(usersData) {
  return usersFileMutex.run(() => writeUsersLocked(withOwnedGroups(usersData)));
}

/**
 * Give every user exactly the owned groups of `desired` (core
 * `renderOwnedGroups`) — the domains' rendering; `domains` are every
 * domain record. Compares first: an unchanged file is not written. From
 * now on every write keeps these groups. Returns whether the file changed.
 *
 * @param {ReadonlyMap<string, readonly string[]>} desired
 * @param {readonly string[]} domains
 * @returns {Promise<{ changed: boolean }>}
 */
export function writeOwnedGroups(desired, domains) {
  return usersFileMutex.run(async () => {
    const current = await readAutheliaUsersRaw(usersFile);
    ownedGroups = { desired, domains };
    const merged = mergeOwnedGroups(current.users ?? {}, desired, domains);
    if (!merged.changed) return { changed: false };
    await writeUsersLocked({ ...current, users: merged.users });
    return { changed: true };
  });
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
export function reloadAuthelia() {
  return restartAuthelia();
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
 * `domains` (the active domains' names).
 * @param {string[]} domains
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
