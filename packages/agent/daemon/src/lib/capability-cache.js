/**
 * Per-label capability cache for the agent panel daemon.
 *
 * The panel daemon runs on the agent machine but the canonical capability
 * list for an `agent:<label>` mTLS cert lives on the panel server. To avoid
 * a panel round-trip on every request, we cache the result for 60 seconds
 * keyed by label.
 *
 * Security invariants:
 *
 * - On panel-fetch failure (network, 5xx, malformed JSON) we return `null`
 *   from `loadCapabilities()`. The caller MUST treat `null` as
 *   capability-deny (HTTP 503), not capability-allow. This is enforced in
 *   the auth hook in server.js.
 *
 * - The cache key is the label as parsed from the mTLS cert CN. nginx is
 *   the sole writer of `X-SSL-Client-DN`, so the label is trusted input
 *   for caching purposes.
 *
 * - TTL is short (60s) so capability revocations or grants on the panel
 *   take effect within a minute without restarting the daemon.
 *
 * - Negative results (panel reachable but agent has no entry) are NOT
 *   cached — those would mask out repaired registries and we want the
 *   next request to re-check.
 */

const TTL_MS = 60_000;

/**
 * @typedef {object} CapabilityEntry
 * @property {number} fetchedAt
 * @property {string[]} capabilities
 * @property {string[]} allowedSites
 */

/** @type {Map<string, CapabilityEntry>} */
const cache = new Map();

/**
 * Look up cached capabilities for a label. Returns null if missing/expired.
 * @param {string} label
 * @returns {{ capabilities: string[], allowedSites: string[] } | null}
 */
function readCache(label) {
  const entry = cache.get(label);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(label);
    return null;
  }
  return { capabilities: entry.capabilities, allowedSites: entry.allowedSites };
}

/**
 * Store an entry in the cache. No expiry timer is scheduled — entries are
 * lazily evicted on read (keeps the module free of background timers that
 * would prevent process exit).
 *
 * @param {string} label
 * @param {string[]} capabilities
 * @param {string[]} allowedSites
 */
function writeCache(label, capabilities, allowedSites) {
  cache.set(label, { fetchedAt: Date.now(), capabilities, allowedSites });
}

/**
 * Resolve capabilities for an agent label. Reads from cache when fresh,
 * otherwise queries the panel via the supplied fetcher.
 *
 * Returns `null` on any panel-fetch failure — the caller must treat that
 * as a capability-deny (do NOT default to allow).
 *
 * @param {string} label
 * @param {() => Promise<{ capabilities: string[], allowedSites: string[] }>} fetcher
 * @param {{ info(o: object, m?: string): void; warn(o: object, m?: string): void }} [logger]
 * @returns {Promise<{ capabilities: string[], allowedSites: string[] } | null>}
 */
export async function loadCapabilities(label, fetcher, logger) {
  const cached = readCache(label);
  if (cached) return cached;

  try {
    const { capabilities, allowedSites } = await fetcher();
    writeCache(label, capabilities, allowedSites);
    return { capabilities, allowedSites };
  } catch (err) {
    // Log but do NOT propagate — the auth hook converts a null result
    // into a 503 to the caller. We deliberately fail closed here.
    logger?.warn(
      { errMsg: String(err?.message ?? err), label },
      'Failed to fetch agent capabilities from panel — denying request',
    );
    return null;
  }
}

/**
 * Test/admin helper — drop a single label from the cache. Useful when the
 * server wants to invalidate after pushing a capability change.
 * @param {string} label
 */
export function evictCapabilities(label) {
  cache.delete(label);
}

/**
 * Test helper — clear the entire cache.
 */
export function clearCapabilityCache() {
  cache.clear();
}
