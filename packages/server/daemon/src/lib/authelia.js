/**
 * Shim — Authelia lifecycle + config management now lives in
 * `@lamalibre/lamaste/server`. This file wires the daemon's execa instance
 * and bcryptjs hasher to the parameterized core API.
 *
 * Users go through here alone: every write of users.yml is a locked
 * read-modify-write in `lib/directory.js` (`changeUsers`), which brings the
 * user directory in line before Authelia restarts. Tests point the users
 * file, the restart and the TOTP writer elsewhere
 * ({@link setAutheliaForTests}) — there is no Authelia to restart there.
 */

import { execa } from 'execa';
import bcrypt from 'bcryptjs';
import {
  AUTHELIA_USERS,
  isAutheliaInstalled as isAutheliaInstalledCore,
  writeAutheliaConfig as writeAutheliaConfigCore,
  createAutheliaUser,
  readAutheliaUsers,
  writeAutheliaUsers,
  readAutheliaUsersRaw,
  hashAutheliaPassword,
  startAuthelia as startAutheliaCore,
  reloadAuthelia as reloadAutheliaCore,
  isAutheliaRunning as isAutheliaRunningCore,
  updateAutheliaDomainAccess,
  updateAutheliaOidcProvider,
  createUserFromInvitation as createUserFromInvitationCore,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  writeTotpToDatabase as writeTotpToDatabaseCore,
  purgeAutheliaSecondFactors,
  autheliaHoldsOpaqueIdentifier,
} from '@lamalibre/lamaste/server';

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
/** Restart Authelia (it reads users.yml when it starts) — replaced in tests. */
let restartAuthelia = restartRealAuthelia;
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
 * restores Authelia's.
 *
 * @param {{ usersFile?: string, restart?: () => Promise<unknown>, writeTotp?: (username: string, secret: string) => Promise<void>, userStorage?: { purgeSecondFactors: (username: string) => Promise<void>, holdsOidcIdentifier: (username: string) => Promise<boolean> }, domainAccess?: (access: object) => Promise<{ changed: boolean }>, oidcProvider?: (domains: object[], clients: object[], options: object) => Promise<{ changed: boolean, clients: number }> } | null} overrides
 */
export function setAutheliaForTests(overrides) {
  usersFile = overrides?.usersFile ?? AUTHELIA_USERS;
  restartAuthelia = overrides?.restart ?? restartRealAuthelia;
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

export function writeAutheliaConfig(domain, secrets, members = []) {
  return writeAutheliaConfigCore(domain, secrets, members);
}

/** Add the default administrator to users.yml (onboarding) — inside `changeUsers`. */
export function createUser(username, password) {
  return createAutheliaUser(username, password, bcryptHash, usersFile);
}

export function readUsers() {
  return readAutheliaUsers(usersFile);
}

export function writeUsers(usersData) {
  return writeAutheliaUsers(usersData, usersFile);
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

/** Restart Authelia: it reads users.yml when it starts, and every session ends. */
export function reloadAuthelia() {
  return restartAuthelia();
}

export function isAutheliaRunning() {
  return isAutheliaRunningCore(execa);
}

/**
 * Bring Authelia's session cookies, access control and OIDC authorization
 * policies in line with the relay's domains and their members (core
 * `updateDomainAccess`) — lib/domains.js `syncDomainAccess` alone calls it.
 *
 * @param {import('@lamalibre/lamaste/server').DomainAccess} access
 * @returns {Promise<{ changed: boolean }>}
 */
export function updateDomainAccess(access) {
  return domainAccessWriter(access);
}

/**
 * Make Authelia's OIDC provider serve exactly these clients, each of one of
 * `domains` (the active domains with their members).
 * @param {import('@lamalibre/lamaste/server').AutheliaDomain[]} domains
 * @param {import('@lamalibre/lamaste/server').AutheliaOidcClient[]} clients
 * @param {import('@lamalibre/lamaste/server').OidcProviderOptions} [options]
 */
export function updateOidcProvider(domains, clients, options = {}) {
  return oidcProviderWriter(domains, clients, options);
}

/**
 * Add an invited user to users.yml — inside `changeUsers`, which restarts
 * Authelia once the directory knows the user.
 */
export function createUserFromInvitation(username, email, groups, hashedPassword) {
  return createUserFromInvitationCore(username, email, groups, hashedPassword, execa, {
    restart: false,
    usersFile,
  });
}

export function writeTotpToDatabase(username, base32Secret) {
  return totpWriter(username, base32Secret);
}

// Pure helpers — no dependency injection needed
export { base32Encode, base32Decode, generateTotpSecret };
