import { execa } from 'execa';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { writeFileNoFollow } from './ownership.js';

/** Site name of the IP-based panel vhost (`https://<ip>:9292`). */
export const IP_PANEL_SITE = 'lamalibre-lamaste-panel-ip';

const AVAILABLE = `/etc/nginx/sites-available/${IP_PANEL_SITE}`;

/**
 * Request headers every location proxying to the panel sets: a relay
 * assertion reaches the panel only from a plugin's user surface on a tunnel
 * vhost, set from Gatekeeper's answer — never one a client sent here.
 */
const ASSERTION_CLEARED = `
        # A relay assertion comes only from Gatekeeper, on a plugin's user surface
        proxy_set_header X-Lamalibre-Relay-Assertion "";`;

/**
 * The IP-based panel vhost: mTLS on 9292 with the self-signed certificate
 * create-lamaste made for the relay's address. The panel disables it while
 * its 2FA is on (`sites-enabled` link only). Pure.
 *
 * @param {string} pkiDir
 * @returns {string}
 */
export function generateIpPanelVhost(pkiDir) {
  return `# Rate limit zone for public enrollment endpoint (5 requests/minute per IP)
limit_req_zone $binary_remote_addr zone=enroll:1m rate=5r/m;

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 9292 ssl;
    server_name _;

    ssl_certificate ${pkiDir}/self-signed.pem;
    ssl_certificate_key ${pkiDir}/self-signed-key.pem;

    include /etc/nginx/snippets/lamalibre-lamaste-mtls.conf;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Show certificate help page when client cert is missing or invalid
    error_page 495 496 /cert-help.html;
    location = /cert-help.html {
        root /opt/lamalibre/lamaste/lamaste-server-ui;
        internal;
    }

    # Proxy to serverd (mTLS required — reject if cert missing or invalid)
    location / {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;

        # Client cert headers — set from nginx TLS variables, never passed through from client
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;

        # Strip Authelia identity headers — not trusted on mTLS vhost
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";${ASSERTION_CLEARED}

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Public API paths (no mTLS verification check).
    # ssl_verify_client is 'optional' at server level, so TLS handshake
    # succeeds without a cert. These locations skip the $ssl_client_verify
    # check and clear cert headers so the backend sees no client identity.
    location /api/enroll {
        limit_req zone=enroll burst=5 nodelay;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        # Clear cert headers so the backend sees no client cert
        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        # Strip Authelia identity headers — not trusted on public endpoint
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";${ASSERTION_CLEARED}

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/invite {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        proxy_set_header X-SSL-Client-Verify "";
        proxy_set_header X-SSL-Client-DN "";
        proxy_set_header X-SSL-Client-Serial "";

        # Strip Authelia identity headers — not trusted on public endpoint
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";${ASSERTION_CLEARED}

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API paths with WebSocket upgrade support (mTLS required)
    location /api {
        if ($ssl_client_verify != SUCCESS) {
            return 496;
        }
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;

        # Client cert headers — set from nginx TLS variables, never passed through from client
        proxy_set_header X-SSL-Client-Verify $ssl_client_verify;
        proxy_set_header X-SSL-Client-DN $ssl_client_s_dn;
        proxy_set_header X-SSL-Client-Serial $ssl_client_serial;

        # Strip Authelia identity headers — not trusted on mTLS vhost
        proxy_set_header Remote-User "";
        proxy_set_header Remote-Groups "";
        proxy_set_header Remote-Name "";
        proxy_set_header Remote-Email "";${ASSERTION_CLEARED}

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket: only upgrade when client requests it
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
`;
}

/** The installed vhost's text, or null when there is none; never through a symlink. */
async function readInstalled() {
  let fh;
  try {
    fh = await open(AVAILABLE, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    return await fh.readFile('utf8');
  } finally {
    await fh.close();
  }
}

/**
 * Bring an installed IP-based panel vhost in line with what
 * {@link generateIpPanelVhost} renders now — the redeploy path; a fresh
 * install writes it itself. Only its text changes: its `sites-enabled` link
 * (the panel's 2FA unlinks it) stays as it is, and a relay without the vhost
 * gets none. Written atomically as root, never through a symlink; on a
 * failed `nginx -t` the previous text is restored and the error thrown.
 * Run as root.
 *
 * @param {string} pkiDir
 * @param {{ reload?: boolean }} [options] - reload nginx afterwards (default true)
 * @returns {Promise<{ changed: boolean }>}
 */
export async function refreshIpPanelVhost(pkiDir, { reload = true } = {}) {
  const previous = await readInstalled();
  const content = generateIpPanelVhost(pkiDir);
  if (previous === null || previous === content) return { changed: false };

  const owner = { mode: 0o644, uid: 0, gid: 0 };
  await writeFileNoFollow(AVAILABLE, content, owner);
  try {
    await execa('nginx', ['-t']);
  } catch (err) {
    await writeFileNoFollow(AVAILABLE, previous, owner);
    throw new Error(
      `nginx rejected the refreshed IP panel vhost; left as it was:\n${err.stderr || err.message}`,
    );
  }
  if (reload) await execa('systemctl', ['reload', 'nginx']);
  return { changed: true };
}
