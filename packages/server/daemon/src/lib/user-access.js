/**
 * Shim — user-access grant + OTP management now lives in
 * `@lamalibre/lamaste/server`. This file resolves the dataDir from env
 * and forwards to the core library, preserving the daemon-local API.
 */

import {
  createGrant as createGrantCore,
  listGrants as listGrantsCore,
  listGrantsForUser as listGrantsForUserCore,
  revokeGrant as revokeGrantCore,
  removeGrantsForUser as removeGrantsForUserCore,
  consumeGrant as consumeGrantCore,
  createOTP as createOTPCore,
  validateAndConsumeOTP as validateAndConsumeOTPCore,
} from '@lamalibre/lamaste/server';

function dataDir() {
  return process.env.LAMALIBRE_LAMASTE_DATA_DIR || '/etc/lamalibre/lamaste';
}

export function createGrant(username, pluginName, logger, options = {}) {
  return createGrantCore(dataDir(), username, pluginName, logger, options);
}

export function listGrants() {
  return listGrantsCore(dataDir());
}

export function listGrantsForUser(username) {
  return listGrantsForUserCore(dataDir(), username);
}

export function revokeGrant(grantId, logger) {
  return revokeGrantCore(dataDir(), grantId, logger);
}

export function removeGrantsForUser(username, logger) {
  return removeGrantsForUserCore(dataDir(), username, logger);
}

export function consumeGrant(grantId, username, logger) {
  return consumeGrantCore(dataDir(), grantId, username, logger);
}

export function createOTP(username, input, logger) {
  return createOTPCore(dataDir(), username, input, logger);
}

export function validateAndConsumeOTP(token, verifier) {
  return validateAndConsumeOTPCore(dataDir(), token, verifier);
}
