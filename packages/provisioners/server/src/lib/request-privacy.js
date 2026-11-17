import { REQUEST_PRIVACY_FILE, renderRequestPrivacyConf } from '@lamalibre/lamaste';
import { ensureHttpConf } from './nginx-http-conf.js';

/**
 * The http-level nginx file that keeps queries out of what nginx records
 * and what it tells Authelia (core `renderRequestPrivacyConf`): the map
 * `$lamaste_request_path` (the request's path without its query) and the
 * log format `lamaste_noquery`. Every server block the relay renders logs
 * in that format (`access_log /var/log/nginx/access.log lamaste_noquery;`,
 * replacing Ubuntu's `combined` log, query and referrer included), and the
 * locations that ask Authelia directly send it the path alone. nginx refuses
 * every one of those vhosts (`nginx -t`) while the file is missing: it is
 * installed before any of them is written — on a fresh install first among
 * nginx's steps, before the IP panel vhost; on a redeploy before the
 * running panel stops, so the installer's own sites refreshed later and the
 * vhosts the new panel re-renders at its start find it.
 */

/**
 * Install or refresh the file as {@link REQUEST_PRIVACY_FILE} — root-owned
 * 0644, atomically, never through a symlink — then test nginx and reload it.
 * Idempotent. On a failed `nginx -t` the previous file (or its absence) is
 * restored and the error thrown. Run as root.
 *
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export function ensureRequestPrivacyConf({ reload = true } = {}) {
  return ensureHttpConf({
    file: REQUEST_PRIVACY_FILE,
    content: renderRequestPrivacyConf(),
    what: 'the log format and map that keep queries out of the access log and Authelia',
    reload,
  });
}
