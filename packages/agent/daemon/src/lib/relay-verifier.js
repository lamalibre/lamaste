/**
 * Verification of relay assertions (`X-Lamalibre-Relay-Assertion`, see
 * `relay-assertion.ts` in the core library) in lamaste-agentd.
 *
 * The relay's public keys come from the panel (`GET /api/agents/me/relay-keys`)
 * over the agent's pinned mTLS channel, with the label the relay knows this
 * agent by: the audience assertions for it carry. That label comes from the
 * relay, not from the local configuration — a local registry name (`--label`)
 * may differ from it, and an agent set up from a P12 does not record it.
 * Keys and label are held in memory only and fetched when an assertion names
 * a key the daemon does not know — on the first request from the relay, and
 * after the relay rotated its key. The key id in an assertion is
 * unauthenticated input, so a fetch happens at most once per
 * {@link REFETCH_AFTER_SUCCESS_MS} (or {@link REFETCH_AFTER_FAILURE_MS} after
 * a failed fetch), whatever a caller sends.
 */

import { NonceStore, parseRelayKeysResponse, verifyRelayAssertion } from '@lamalibre/lamaste';

export const REFETCH_AFTER_SUCCESS_MS = 30_000;
export const REFETCH_AFTER_FAILURE_MS = 5_000;

/**
 * @typedef {object} RelayVerifier
 * @property {(header: string, method: string, url: string) => Promise<import('@lamalibre/lamaste').VerifyRelayAssertionResult>} verify
 */

/**
 * @param {object} opts
 * @param {number} opts.port - the port this daemon listens on
 * @param {() => Promise<unknown>} opts.fetchKeys - the panel's
 *        `{ keys: [{ kid, publicKey }], agentLabel }`
 * @param {{ info(o: object, m?: string): void, warn(o: object, m?: string): void }} opts.logger
 * @param {() => number} [opts.now]
 * @returns {RelayVerifier}
 */
export function createRelayVerifier({ port, fetchKeys, logger, now = Date.now }) {
  /** @type {Map<string, import('node:crypto').KeyObject>} */
  let keys = new Map();
  /** The label the relay knows this agent by; null until the first fetch. */
  let audience = null;
  let lastFetchAt = 0;
  let lastFetchOk = false;
  /** @type {Promise<boolean> | null} */
  let inflight = null;
  const nonces = new NonceStore();

  async function fetchNow() {
    try {
      const { agentLabel, keys: fetched } = parseRelayKeysResponse(await fetchKeys());
      const next = new Map(fetched.map(({ kid, publicKey }) => [kid, publicKey]));
      keys = next;
      audience = agentLabel;
      lastFetchOk = true;
      logger.info({ kids: [...next.keys()], agentLabel }, 'Loaded relay verification keys');
      return true;
    } catch (err) {
      lastFetchOk = false;
      logger.warn(
        { errMsg: String(err?.message ?? err) },
        'Failed to fetch relay verification keys — relay requests are refused until it succeeds',
      );
      return false;
    } finally {
      lastFetchAt = now();
    }
  }

  /** Fetch the keys now (rate limited); true when they were replaced. */
  function refresh() {
    if (inflight) return inflight;
    const wait = lastFetchOk ? REFETCH_AFTER_SUCCESS_MS : REFETCH_AFTER_FAILURE_MS;
    if (lastFetchAt !== 0 && now() - lastFetchAt < wait) return Promise.resolve(false);
    inflight = fetchNow().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    async verify(header, method, url) {
      // No audience yet means no keys yet either: every assertion is an
      // unknown key until the first fetch.
      const check = () =>
        verifyRelayAssertion(header, {
          keys,
          aud: audience ?? '',
          port,
          method,
          url,
          nonces,
          now: now(),
        });
      const first = check();
      if (first.ok || first.reason !== 'unknown_key') return first;
      return (await refresh()) ? check() : first;
    },
  };
}
