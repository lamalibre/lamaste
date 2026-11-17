import { BACKEND_COOKIE_MAP_FILE, renderBackendCookieMap } from '@lamalibre/lamaste';
import { ensureHttpConf } from './nginx-http-conf.js';

/**
 * The http-level nginx map that keeps Authelia's session cookie from every
 * tunnel and agent backend (core `renderBackendCookieMap`: the cookie name
 * Authelia is configured with, stripped pair by pair, no `Cookie` header at
 * all when one is left). Every vhost the panel renders for a tunnel or an
 * agent panel sets `Cookie` from its variable, so nginx refuses those vhosts
 * (`nginx -t`) while the map is missing: it is installed before the panel
 * first writes one — on a fresh install with nginx's own configuration, on
 * a redeploy before the panel restarts and re-renders the vhosts it finds.
 */

/**
 * Install or refresh the map as {@link BACKEND_COOKIE_MAP_FILE} — root-owned
 * 0644, written atomically and never through a symlink — then test nginx
 * and reload it. Idempotent. On a failed `nginx -t` the previous file (or
 * its absence) is restored and the error thrown: without the map no tunnel
 * vhost can be written, so the caller stops. Run as root.
 *
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export function ensureBackendCookieMap({ reload = true } = {}) {
  return ensureHttpConf({
    file: BACKEND_COOKIE_MAP_FILE,
    content: renderBackendCookieMap(),
    what: "the map that keeps Authelia's session cookie from tunnel backends",
    reload,
  });
}
