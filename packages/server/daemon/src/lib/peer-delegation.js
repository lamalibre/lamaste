/**
 * The relay's delegation keys (4.13, slice 8): `<stateDir>/peer-delegation-keys.json`
 * (0600, atomic, written only by the panel; nothing else reads it). A
 * delegation (core `peer-delegation.ts`) is an HMAC-SHA256 token the relay
 * gives a plugin's agent half with a person's request, and checks when the
 * half calls another plugin on that person's behalf — only the relay ever
 * verifies one, so the key never leaves this file.
 *
 * Rotated daily: the current key becomes the previous one, which is kept
 * until the next rotation — longer than any delegation lives (5 minutes),
 * so no token signed before a rotation is refused because of it.
 */

import path from 'node:path';
import {
  PromiseChainMutex,
  atomicWriteJSON,
  generatePeerDelegationKey,
  isPeerDelegationKey,
  readJSONFile,
} from '@lamalibre/lamaste';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';
export const PEER_DELEGATION_KEYS_FILE = 'peer-delegation-keys.json';

/** How long a key signs before it becomes the previous one. */
export const PEER_DELEGATION_KEY_ROTATION_MS = 24 * 60 * 60_000;

const mutex = new PromiseChainMutex();
let cached = null;

function keysPath() {
  return path.join(STATE_DIR, PEER_DELEGATION_KEYS_FILE);
}

function isEntry(entry) {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    isPeerDelegationKey({ kid: entry.kid, secret: entry.secret }) &&
    typeof entry.createdAt === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt))
  );
}

function fresh(now) {
  return { ...generatePeerDelegationKey(), createdAt: new Date(now).toISOString() };
}

/**
 * The keys as stored — rotated (and created) when due. A file that cannot
 * be parsed is replaced: tokens signed under it are refused for their few
 * remaining minutes, nothing else depends on it.
 *
 * @returns {Promise<{ current: { kid: string, secret: string, createdAt: string }, previous: { kid: string, secret: string, createdAt: string } | null }>}
 */
function currentKeys(now = Date.now()) {
  if (cached && now - Date.parse(cached.current.createdAt) < PEER_DELEGATION_KEY_ROTATION_MS) {
    return Promise.resolve(cached);
  }
  return mutex.run(async () => {
    const stored = await readJSONFile(keysPath(), null);
    let keys =
      stored && stored.v === 1 && isEntry(stored.current)
        ? { current: stored.current, previous: isEntry(stored.previous) ? stored.previous : null }
        : null;
    let changed = false;
    if (!keys) {
      keys = { current: fresh(now), previous: null };
      changed = true;
    } else if (now - Date.parse(keys.current.createdAt) >= PEER_DELEGATION_KEY_ROTATION_MS) {
      keys = { current: fresh(now), previous: keys.current };
      changed = true;
    }
    if (changed) {
      await atomicWriteJSON(keysPath(), { v: 1, ...keys }, { mode: 0o600, refuseSymlink: true });
    }
    cached = keys;
    return keys;
  });
}

const asKey = (entry) => ({ kid: entry.kid, secret: entry.secret });

/** The key new delegations are signed with. */
export async function delegationSigningKey() {
  return asKey((await currentKeys()).current);
}

/** The keys a delegation is verified with: the current one and the previous one. */
export async function delegationVerifyKeys() {
  const keys = await currentKeys();
  return [asKey(keys.current), ...(keys.previous ? [asKey(keys.previous)] : [])];
}

/** Tests: forget what was read, so the file is read again. */
export function resetDelegationKeysForTests() {
  cached = null;
}
