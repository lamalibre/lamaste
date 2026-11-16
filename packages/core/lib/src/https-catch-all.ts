/**
 * The relay's port-443 catch-all (4.14.1): an nginx site create-lamaste
 * installs so that a hostname no site of the relay serves is refused at the
 * TLS handshake — never answered with another site's certificate and its
 * sign-in redirect, which is what nginx's implicit default server (the
 * first 443 block) did. The installer writes it; serverd checks that it is
 * in place and tells the administrators when it is not.
 */

/** The site's name in sites-available / sites-enabled. */
export const HTTPS_CATCH_ALL_SITE = 'lamalibre-lamaste-https-default';

/** Where nginx reads it from once enabled. */
export const HTTPS_CATCH_ALL_ENABLED_PATH = `/etc/nginx/sites-enabled/${HTTPS_CATCH_ALL_SITE}`;

/** How every vhost of the relay listens on 443 (IPv4, no http2): the catch-all takes this socket's default. */
export const RELAY_HTTPS_LISTEN = 'listen 443 ssl;';

/**
 * The TLS settings every 443 vhost of the relay carries — and the
 * catch-all too: nginx settles the protocol version (and the cipher list)
 * with the socket's default server, before SNI picks the site, so the
 * default server's settings are every name's floor. serverd's
 * `nginx-vhosts.test.js` holds its generators to these lines.
 */
export const RELAY_TLS_DIRECTIVES: readonly string[] = [
  'ssl_protocols TLSv1.2 TLSv1.3;',
  'ssl_ciphers HIGH:!aNULL:!MD5;',
  'ssl_prefer_server_ciphers on;',
];

/**
 * The site: the default server of the socket the relay's vhosts listen on
 * ({@link RELAY_HTTPS_LISTEN}), their TLS settings
 * ({@link RELAY_TLS_DIRECTIVES}), no certificate (`ssl_reject_handshake`,
 * nginx ≥ 1.19.4), nothing answered should a request reach it anyway
 * (`return 444`).
 */
export function renderHttpsCatchAllVhost(): string {
  return `# Managed by Lamaste — a hostname no site serves is refused at the TLS handshake.
server {
    listen 443 ssl default_server;
    server_name _;
${RELAY_TLS_DIRECTIVES.map((line) => `    ${line}`).join('\n')}
    ssl_reject_handshake on;
    return 444;
}
`;
}
