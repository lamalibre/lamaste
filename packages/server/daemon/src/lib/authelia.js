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
  updateAutheliaAccessControl,
  updateAutheliaOidcProvider,
  createUserFromInvitation as createUserFromInvitationCore,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  writeTotpToDatabase as writeTotpToDatabaseCore,
} from '@lamalibre/lamaste/server';

// bcryptjs hasher — signature matches the core lib's BcryptHashFn.
const bcryptHash = (password, cost) => bcrypt.hash(password, cost);

const restartRealAuthelia = () => reloadAutheliaCore(execa);
const writeRealTotp = (username, base32Secret) =>
  writeTotpToDatabaseCore(username, base32Secret, execa);

/** Authelia's users file — another one in tests. */
let usersFile = AUTHELIA_USERS;
/** Restart Authelia (it reads users.yml when it starts) — replaced in tests. */
let restartAuthelia = restartRealAuthelia;
/** Store a TOTP secret in Authelia's database — replaced in tests. */
let totpWriter = writeRealTotp;

/**
 * Point the users file, the Authelia restart and the TOTP writer elsewhere
 * (tests); `null` restores Authelia's.
 *
 * @param {{ usersFile?: string, restart?: () => Promise<unknown>, writeTotp?: (username: string, secret: string) => Promise<void> } | null} overrides
 */
export function setAutheliaForTests(overrides) {
  usersFile = overrides?.usersFile ?? AUTHELIA_USERS;
  restartAuthelia = overrides?.restart ?? restartRealAuthelia;
  totpWriter = overrides?.writeTotp ?? writeRealTotp;
}

/** True once create-lamaste has installed Authelia. */
export function isAutheliaInstalled() {
  return isAutheliaInstalledCore();
}

export function writeAutheliaConfig(domain, secrets) {
  return writeAutheliaConfigCore(domain, secrets);
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

export function updateAccessControl(sites) {
  return updateAutheliaAccessControl(sites, execa);
}

/**
 * Make Authelia's OIDC provider serve exactly these clients.
 * @param {string} domain
 * @param {import('@lamalibre/lamaste/server').AutheliaOidcClient[]} clients
 * @param {import('@lamalibre/lamaste/server').OidcProviderOptions} [options]
 */
export function updateOidcProvider(domain, clients, options = {}) {
  return updateAutheliaOidcProvider(domain, clients, execa, options);
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
