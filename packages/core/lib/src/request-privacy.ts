/**
 * What nginx records about a request, and what it tells Authelia about one:
 * the path, never the query.
 *
 * A query string is the application's: a plugin may carry a personal
 * identifier, a search term or a one-time code in it. The relay needs it
 * nowhere but on the way to the backend, so two places that would keep it
 * get the path alone:
 *
 * - **The access log.** Ubuntu's `nginx.conf` logs every request of every
 *   server to `/var/log/nginx/access.log` in nginx's `combined` format —
 *   `$request` (the request line, query included), `$remote_user` (a Basic
 *   username the client chose) and `$http_referer` (the previous page's URL,
 *   its query included) — kept 14 days by logrotate. An http-level
 *   `access_log` cannot be replaced from `conf.d` (a second one adds a log),
 *   but a server-level one replaces every inherited one: every server block
 *   the relay renders carries {@link ACCESS_LOG_DIRECTIVE}, which writes the
 *   same file in {@link ACCESS_LOG_FORMAT}.
 * - **Authelia.** Asked about a URL (`X-Original-URL` on
 *   `/api/authz/auth-request`), Authelia logs it at `info` whenever it
 *   refuses a signed-in user — into the journal. Lamaste's access-control
 *   rules decide by host and subject only (no `resources` rules), so the
 *   locations that ask Authelia directly tell it `https://<host>` +
 *   {@link REQUEST_PATH_VARIABLE}. (Gatekeeper, which also asks Authelia,
 *   cuts the query itself.)
 *
 * Both read {@link REQUEST_PATH_VARIABLE}, defined by the http-level file
 * {@link renderRequestPrivacyConf} renders — installed by create-lamaste as
 * {@link REQUEST_PRIVACY_FILE} before any vhost that names it is written:
 * nginx refuses a vhost naming the format or the variable without it.
 *
 * nginx's error log is another matter: on an upstream error (a tunnel down,
 * a backend that does not answer) it records the request line, query
 * included, and the referrer. It has no format; see the security model.
 *
 * Pure; shared by the panel's vhost generators and create-lamaste.
 */

/**
 * Where create-lamaste installs the http-level file: nginx's own
 * `nginx.conf` includes `/etc/nginx/conf.d/*.conf` before
 * `sites-enabled`, so the format and the variable exist when a vhost names
 * them. Root-owned 0644.
 */
export const REQUEST_PRIVACY_FILE = '/etc/nginx/conf.d/lamalibre-lamaste-request-privacy.conf';

/**
 * The request's path as the client sent it — `$request_uri` up to its first
 * `?` or `#`: not decoded (a percent-encoded byte stays encoded, so a log
 * line keeps its shape and Authelia gets a URL it can parse), and not
 * changed by an internal redirect (`error_page`, `try_files`, a `rewrite`),
 * unlike `$uri`. Empty for a request nginx could not parse.
 */
export const REQUEST_PATH_VARIABLE = '$lamaste_request_path';

/** The access-log format every server block of the relay logs in. */
export const ACCESS_LOG_FORMAT = 'lamaste_noquery';

/** The file it writes: Ubuntu's own, rotated by its logrotate rule. */
export const ACCESS_LOG_FILE = '/var/log/nginx/access.log';

/**
 * The server-level directive every server block the relay renders carries
 * — exactly this text; `lamaste-priv` accepts no other `access_log` at
 * server level. A location may still turn logging off (`access_log off;`).
 */
export const ACCESS_LOG_DIRECTIVE = `access_log ${ACCESS_LOG_FILE} ${ACCESS_LOG_FORMAT};`;

/**
 * The fields of {@link ACCESS_LOG_FORMAT}: `combined`'s shape, so the tools
 * that read nginx's log still parse it, with what may carry personal data
 * written as `-`:
 *
 * - `$remote_addr` — the client's address, kept: what an operator needs
 *   against abuse, as before.
 * - `-` (ident) — always `-` in `combined` too.
 * - `-` instead of `$remote_user` — a Basic username the client chose; the
 *   relay authenticates nobody with Basic.
 * - `[$time_local]` — kept.
 * - `"$request_method <path> $server_protocol"` instead of `"$request"` —
 *   the request line without its query ({@link REQUEST_PATH_VARIABLE}). The
 *   path itself is kept: an application that puts a personal identifier in
 *   a path segment still has it logged.
 * - `$status $body_bytes_sent` — kept.
 * - `"-"` instead of `"$http_referer"` — the previous page's URL, query
 *   included.
 * - `"$http_user_agent"` — kept: what tells a crawler from a browser.
 */
const ACCESS_LOG_FIELDS =
  '$remote_addr - - [$time_local] ' +
  `"$request_method ${REQUEST_PATH_VARIABLE} $server_protocol" ` +
  '$status $body_bytes_sent "-" "$http_user_agent"';

/**
 * The http-level nginx configuration create-lamaste writes as
 * {@link REQUEST_PRIVACY_FILE}: the map that defines
 * {@link REQUEST_PATH_VARIABLE} and the log format
 * {@link ACCESS_LOG_FORMAT}. Pure — a redeploy compares it byte for byte.
 *
 * The map's regular expression always matches (`[^?#]*` matches the empty
 * string), and its capture is positional: a named capture would define a
 * variable for every server.
 */
export function renderRequestPrivacyConf(): string {
  return [
    '# Lamaste: what nginx records about a request, and what it tells Authelia —',
    '# the path, never the query. Every server block the relay renders logs with',
    `# \`${ACCESS_LOG_DIRECTIVE}\`, and its locations that ask Authelia`,
    `# send \`X-Original-URL https://<host>${REQUEST_PATH_VARIABLE}\`. Written by`,
    '# create-lamaste. Do not edit.',
    '',
    `map $request_uri ${REQUEST_PATH_VARIABLE} {`,
    '    "~^([^?#]*)" $1;',
    '}',
    '',
    `log_format ${ACCESS_LOG_FORMAT} '${ACCESS_LOG_FIELDS}';`,
    '',
  ].join('\n');
}
