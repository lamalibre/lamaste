/**
 * The original URL nginx names in `X-Original-URL` — what of it Authelia is
 * asked about, and where a request without a session is sent.
 *
 * nginx writes `https://<the vhost's own hostname>$request_uri`: the raw
 * request target, query included, exactly as the client sent it — which
 * may hold bytes above 0x7e and a raw `#` (nginx accepts both in a request
 * line). Node reads a header value as Latin-1, one character per byte.
 * Gatekeeper decides on that raw string (a user surface's target, the
 * assertion's path, byte for byte); Authelia is asked about it without its
 * query, and the sign-in redirect carries it whole.
 */

/**
 * The URL Authelia is asked about: the original URL up to its first `?` or
 * `#`, cut from the raw string — never parsed and serialised again, which
 * would re-encode the path. Authelia logs that URL whenever it refuses a
 * signed-in user, and the relay's access-control rules decide by host and
 * subject alone (no `resources` rules): the query is the application's.
 */
export function autheliaTargetUrl(originalUrl: string): string {
  const end = originalUrl.search(/[?#]/);
  return end === -1 ? originalUrl : originalUrl.slice(0, end);
}

/**
 * Whether `originalUrl` is anchored on `fqdn` as nginx writes it:
 * `https://`, the host (case-insensitive), then nothing, or a target that
 * begins with `/` or `?` — so neither a port, credentials nor another host
 * can follow the name. What comes after is the client's request target,
 * taken as it is: {@link signInRedirectUrl} encodes every byte that is not
 * unreserved.
 */
export function isAnchoredOn(originalUrl: string, fqdn: string): boolean {
  const prefix = `https://${fqdn.toLowerCase()}`;
  if (originalUrl.slice(0, prefix.length).toLowerCase() !== prefix) return false;
  const next = originalUrl.charAt(prefix.length);
  return next === '' || next === '/' || next === '?';
}

/** Characters `encodeURIComponent` leaves as they are. */
const UNRESERVED = /^[A-Za-z0-9\-_.!~*'()]$/;

/**
 * Percent-encode a header value byte for byte: Node holds it as Latin-1,
 * one character per byte as the client sent it, so each character is one
 * byte here — never re-encoded as UTF-8 (`encodeURIComponent` would turn
 * the two bytes of a UTF-8 `é` into four). For ASCII the result is
 * `encodeURIComponent`'s.
 */
export function encodeRawComponent(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'latin1')) {
    const char = String.fromCharCode(byte);
    out += UNRESERVED.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * The sign-in redirect for a request without a session: the portal of the
 * host's domain, `rd` the whole original URL — query included — encoded as
 * one query parameter (`&` in the original query would otherwise end it,
 * and nothing of it can break out of the parameter).
 */
export function signInRedirectUrl(domain: string, originalUrl: string): string {
  return `https://auth.${domain}/?rd=${encodeRawComponent(originalUrl)}`;
}
