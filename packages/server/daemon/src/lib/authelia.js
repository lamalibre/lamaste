/**
 * Shim — Authelia lifecycle + config management now lives in
 * `@lamalibre/lamaste/server`. This file wires the daemon's execa instance
 * and bcryptjs hasher to the parameterized core API.
 */

import { execa } from 'execa';
import bcrypt from 'bcryptjs';
import {
  installAuthelia as installAutheliaCore,
  writeAutheliaConfig as writeAutheliaConfigCore,
  createAutheliaUser,
  readAutheliaUsers,
  writeAutheliaUsers,
  readAutheliaUsersRaw,
  hashAutheliaPassword,
  writeAutheliaService as writeAutheliaServiceCore,
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

export function installAuthelia() {
  return installAutheliaCore(execa);
}

export function writeAutheliaConfig(domain, secrets) {
  return writeAutheliaConfigCore(domain, secrets, execa);
}

export function createUser(username, password) {
  return createAutheliaUser(username, password, execa, bcryptHash);
}

export function readUsers() {
  return readAutheliaUsers(execa);
}

export function writeUsers(usersData) {
  return writeAutheliaUsers(usersData, execa);
}

export function readUsersRaw() {
  return readAutheliaUsersRaw(execa);
}

export function hashPassword(password) {
  return hashAutheliaPassword(password, bcryptHash);
}

export function writeAutheliaService() {
  return writeAutheliaServiceCore(execa);
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
