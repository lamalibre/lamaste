/**
 * The signing keys of the relay's OIDC issuer, as Gatekeeper verifies a
 * native app's bearer access token with them (native-apps-design.md D3,
 * R6).
 *
 * Authelia publishes its key set at `/jwks.json`; one issuer key serves
 * every domain of the relay (only the issuer name differs, by the portal a
 * request names), so one set is cached for all. The key id is a constant
 * (`lamaste-oidc`), so a regenerated key would never look "unknown": the set
 * is fetched again on an unknown key id **or** a bad signature, at most once
 * every {@link ISSUER_KEYS_REFETCH_MS}. While no set has ever been read
 * (Authelia down since start) the caller answers 503, never 401 — an app
 * told "unauthenticated" would throw its tokens away.
 */

import { request as undiciRequest } from 'undici';
import { parseNativeIssuerKeys } from '@lamalibre/lamaste';
import type { NativeIssuerKey } from '@lamalibre/lamaste';

/** Authelia's key set, on its loopback listener. */
export const AUTHELIA_JWKS_URL = 'http://127.0.0.1:9091/jwks.json';

/** The fewest milliseconds between two fetches of the key set. */
export const ISSUER_KEYS_REFETCH_MS = 30_000;

/** How long one fetch may take. */
const ISSUER_KEYS_TIMEOUT_MS = 2_500;

/** A fetcher of Authelia's JWKS document for the portal `auth.<domain>` (tests replace it). */
export type JwksFetcher = (portal: string) => Promise<unknown>;

/** Fetch `/jwks.json` from Authelia as the portal `portal` (its issuer name follows the host). */
export const fetchAutheliaJwks: JwksFetcher = async (portal) => {
  const { statusCode, body } = await undiciRequest(AUTHELIA_JWKS_URL, {
    method: 'GET',
    headers: {
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': portal,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(ISSUER_KEYS_TIMEOUT_MS),
  });
  if (statusCode !== 200) {
    await body.dump();
    throw new Error(`Authelia answered ${statusCode} for its key set`);
  }
  return body.json();
};

export interface IssuerKeyCache {
  /** The keys held now; null while no key set has ever been read. */
  current(): readonly NativeIssuerKey[] | null;
  /**
   * Fetch the set again unless one was fetched in the last
   * {@link ISSUER_KEYS_REFETCH_MS}; true when a fetch replaced the keys.
   * Never throws: a failed fetch keeps the keys held.
   */
  refresh(portal: string): Promise<boolean>;
}

/**
 * A cache of the issuer's keys. `now` and `fetch` are for tests. Concurrent
 * refreshes share one fetch.
 */
export function createIssuerKeyCache(
  opts: {
    fetch?: JwksFetcher;
    now?: () => number;
    onError?: (message: string) => void;
  } = {},
): IssuerKeyCache {
  const fetchJwks = opts.fetch ?? fetchAutheliaJwks;
  const now = opts.now ?? Date.now;
  let keys: NativeIssuerKey[] | null = null;
  let fetchedAt = -Infinity;
  let inFlight: Promise<boolean> | null = null;

  return {
    current: () => keys,
    refresh(portal: string): Promise<boolean> {
      if (inFlight) return inFlight;
      if (now() - fetchedAt < ISSUER_KEYS_REFETCH_MS) return Promise.resolve(false);
      fetchedAt = now();
      inFlight = (async () => {
        try {
          const parsed = parseNativeIssuerKeys(await fetchJwks(portal));
          if (parsed.length === 0) throw new Error('The key set holds no RS256 signing key');
          keys = parsed;
          return true;
        } catch (err: unknown) {
          opts.onError?.(err instanceof Error ? err.message : String(err));
          return false;
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}
