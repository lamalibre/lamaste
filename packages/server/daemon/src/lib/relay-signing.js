/**
 * The relay's assertion signing key (`<stateDir>/relay-signing-key.json`,
 * 0600). The panel creates it at startup and signs agent-panel requests
 * with it; Gatekeeper reads the same file to sign for plugin tunnels.
 * Agents fetch the public half from `GET /api/agents/me/relay-keys`.
 * See `relay-assertion.ts` in the core library.
 */

import path from 'node:path';
import { createRelaySigner, relayVerifyKeyOf, RELAY_SIGNING_KEY_FILE } from '@lamalibre/lamaste';

const STATE_DIR = process.env.LAMALIBRE_LAMASTE_STATE_DIR || '/etc/lamalibre/lamaste';

export const relaySigner = createRelaySigner(path.join(STATE_DIR, RELAY_SIGNING_KEY_FILE), {
  create: true,
});

/**
 * Create the key if it does not exist yet, so Gatekeeper finds it, and log
 * its id. A key that exists but cannot be used (permissions, content) is an
 * error the operator must fix: nothing is signed with it, so the agent-panel
 * and plugin tunnels are refused until then.
 *
 * @param {{ info(o: object, m?: string): void, error(o: object, m?: string): void }} log
 */
export async function ensureRelaySigningKey(log) {
  try {
    const key = await relaySigner.current();
    if (key) log.info({ kid: key.kid }, 'Relay assertion signing key ready');
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      'Relay assertion signing key unusable — agent panels and plugin tunnels are refused',
    );
  }
}

/** The public keys agents verify relay assertions with (current key only). */
export async function relayVerifyKeys() {
  const key = await relaySigner.current();
  return key ? [relayVerifyKeyOf(key)] : [];
}
