/**
 * Shim — Authelia lifecycle + config management now lives in
 * `@lamalibre/lamaste/server`. This file wires the daemon's execa instance
 * and bcryptjs hasher to the parameterized core API.
 */

import { execa } from 'execa';
import bcrypt from 'bcryptjs';
import {
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
  createUserFromInvitation as createUserFromInvitationCore,
  base32Encode,
  base32Decode,
  generateTotpSecret,
  writeTotpToDatabase as writeTotpToDatabaseCore,
} from '@lamalibre/lamaste/server';

// bcryptjs hasher — signature matches the core lib's BcryptHashFn.
const bcryptHash = (password, cost) => bcrypt.hash(password, cost);

/** True once create-lamaste has installed Authelia. */
export function isAutheliaInstalled() {
  return isAutheliaInstalledCore();
}

export function writeAutheliaConfig(domain, secrets) {
  return writeAutheliaConfigCore(domain, secrets);
}

export function createUser(username, password) {
  return createAutheliaUser(username, password, bcryptHash);
}

export function readUsers() {
  return readAutheliaUsers();
}

export function writeUsers(usersData) {
  return writeAutheliaUsers(usersData);
}

export function readUsersRaw() {
  return readAutheliaUsersRaw();
}

export function hashPassword(password) {
  return hashAutheliaPassword(password, bcryptHash);
}

export function startAuthelia() {
  return startAutheliaCore(execa);
}

export function reloadAuthelia() {
  return reloadAutheliaCore(execa);
}

export function isAutheliaRunning() {
  return isAutheliaRunningCore(execa);
}

export function updateAccessControl(sites) {
  return updateAutheliaAccessControl(sites, execa);
}

export function createUserFromInvitation(username, email, groups, hashedPassword) {
  return createUserFromInvitationCore(username, email, groups, hashedPassword, execa);
}

export function writeTotpToDatabase(username, base32Secret) {
  return writeTotpToDatabaseCore(username, base32Secret, execa);
}

// Pure helpers — no dependency injection needed
export { base32Encode, base32Decode, generateTotpSecret };
