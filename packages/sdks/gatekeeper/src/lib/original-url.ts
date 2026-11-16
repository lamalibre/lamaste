/**
 * The original URL nginx names in `X-Original-URL` — what of it Authelia is
 * told, and where a request without a session is sent.
 *
 * nginx writes `https://<the vhost's own hostname>$request_uri`: the raw
 * request target, query included. Gatekeeper decides on that raw string
 * (a user surface's target, the assertion's path, byte for byte); Authelia
 * gets it without its query, and the sign-in redirect carries it whole.
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
 * Whether `originalUrl` is a URL on `fqdn` as nginx writes it: `https://`,
 * the host (case-insensitive), then nothing or a target beginning with `/`
 * or `?` — never another host, a port, credentials or a fragment.
 */
export function isOriginalUrlOn(originalUrl: string, fqdn: string): boolean {
  const prefix = `https://${fqdn.toLowerCase()}`;
  if (originalUrl.slice(0, prefix.length).toLowerCase() !== prefix) return false;
  const rest = originalUrl.slice(prefix.length);
  if (rest !== '' && rest[0] !== '/' && rest[0] !== '?') return false;
  // A request target is printable ASCII without spaces (nginx refuses others).
  return /^[\x21-\x7e]*$/.test(rest) && !rest.includes('#');
}

/**
 * The sign-in redirect for a request without a session: the portal of the
 * host's domain, `rd` the whole original URL — query included — encoded as
 * one query parameter (`&` in the original query would otherwise end it).
 */
export function signInRedirectUrl(domain: string, originalUrl: string): string {
  return `https://auth.${domain}/?rd=${encodeURIComponent(originalUrl)}`;
}
