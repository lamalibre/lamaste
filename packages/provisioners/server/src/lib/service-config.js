/**
 * Shared systemd unit and sudoers content generators.
 * Used by both the full installer (panel.js) and the redeploy flow (redeploy.js).
 */

/**
 * Generate the lamalibre-lamaste-serverd systemd service unit content.
 *
 * @param {{ installDir: string, configDir: string }} ctx
 * @returns {string}
 */
export function generateServiceUnit(ctx) {
  return `[Unit]
Description=Lamaste Panel Server
After=network.target

[Service]
Type=simple
User=lamaste
Group=lamaste
# Lets the panel hand the chisel authfile to the group chisel runs as.
SupplementaryGroups=lamaste-chisel
WorkingDirectory=${ctx.installDir}/serverd
ExecStart=/usr/bin/node src/index.js
Environment=NODE_ENV=production
Environment=CONFIG_FILE=${ctx.configDir}/panel.json
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=lamalibre-lamaste-serverd

# Security hardening
# Note: NoNewPrivileges is intentionally omitted — the panel needs sudo
# for provisioning (Chisel, Authelia, certbot, nginx, systemctl).
# Access is restricted via fine-grained sudoers rules in /etc/sudoers.d/lamaste.
ProtectHome=true
ReadWritePaths=${ctx.configDir} /var/www/lamaste
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Generate the lamaste sudoers file content.
 *
 * @returns {string}
 */
export function generateSudoersContent() {
  return `# Lamaste serverd sudo rules
# Allows the lamaste user to manage specific services and run specific commands

# --- systemctl: managed services ---
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start nginx
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop nginx
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart nginx
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop chisel
# Chisel reloads its authfile by itself. The panel restarts it only when a
# change revokes access (a removed or rotated credential, a withdrawn port
# grant) — \`try-restart\`, so a chisel stopped on purpose stays stopped — and
# when startup reconciliation changes the binary or the unit. Pinned to the
# bare service name so a compromised panel cannot restart arbitrary units.
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl try-restart chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl reload authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable certbot.timer
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start certbot.timer
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable chisel
# Disabled (with stop) when startup reconciliation cannot secure chisel, so a
# reboot does not start it on a stale authfile; re-enabled once it succeeds.
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl disable chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start lamalibre-lamaste-serverd
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop lamalibre-lamaste-serverd
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart lamalibre-lamaste-serverd

# --- nginx config test ---
lamaste ALL=(root) NOPASSWD: /usr/sbin/nginx -t

# --- Let's Encrypt: root-owned wrappers with fixed argument vectors ---
# A sudoers \`*\` matches spaces too, so rules such as
# \`certbot renew --cert-name * --non-interactive\` accepted
# \`--deploy-hook <cmd>\` and \`openssl x509 ... -in /etc/letsencrypt/live/*\`
# accepted \`-engine <lib.so>\` — root code execution for the lamaste user.
# The wrappers validate every argument (hostnames, email) and exec certbot /
# openssl with fixed flags. See scripts/lamaste-certbot, scripts/lamaste-cert-info.
lamaste ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-certbot
lamaste ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-cert-info

# --- openssl: read-only operations on the panel PKI ---
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/lamalibre/lamaste/pki/* -serial -noout
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/lamalibre/lamaste/pki/* -enddate -noout
# --- openssl / pki helpers ---
# Trust boundary: only @lamalibre/ scoped code runs as lamaste user.
# CSR signing was previously a wildcard rule allowing any /etc/lamalibre/lamaste/pki/*
# CSR to be signed with any args — a CSR with /CN=admin would be signed and
# yield a forged admin cert. It now goes through a wrapper that hardcodes the
# CA paths, validates the CSR subject (rejects CN=admin, restricts to agent
# label format), and constrains both input and output paths to
# /etc/lamalibre/lamaste/pki/agents/. Admin certs are issued only by the dedicated
# lamaste-server reset-admin flow which runs as root directly.
lamaste ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-sign-csr
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl genrsa -out /etc/lamalibre/lamaste/pki/* *
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl req -new -key /etc/lamalibre/lamaste/pki/* *
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -out /etc/lamalibre/lamaste/pki/*

# --- mv: restrict source to known temp-file prefixes (no bare /tmp/*) ---
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/site-index-* /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/site-upload-* /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/invite-page-* /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/nginx-* /etc/nginx/sites-available/*
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/lamalibre-lamaste-chisel-service-* /etc/systemd/system/chisel.service
# The chisel-users authfile needs no rule: the panel writes it itself, 0640,
# group lamaste-chisel (the group chisel runs as; the lamaste user is a member).
# chisel server private key: persistent SSH key so fingerprint stays stable
# across restarts. Chisel runs as nobody, so we chown/chmod accordingly.
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/lamalibre-lamaste-chisel-server-key-* /etc/lamalibre/lamaste/chisel-server.key
lamaste ALL=(root) NOPASSWD: /usr/bin/chown nobody\\:nogroup /etc/lamalibre/lamaste/chisel-server.key
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 0400 /etc/lamalibre/lamaste/chisel-server.key
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/authelia-service-* /etc/systemd/system/authelia.service
# Chisel binary install: namespaced prefix so any process writing a generic
# \`/tmp/chisel-*\` file cannot trigger this \`mv\` rule. The binary downloader in
# core/lib/src/server/chisel.ts must keep this prefix in sync.
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/lamalibre-lamaste-chisel-* /usr/local/bin/chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/authelia-* /usr/local/bin/authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/lamalibre-lamaste-authelia-* /etc/authelia/*
# PKI rename was previously a wildcard rule
#   mv /etc/lamalibre/lamaste/pki/*.new /etc/lamalibre/lamaste/pki/*
# that allowed overwriting arbitrary files in the PKI dir (e.g. ca.crt). It now
# goes through a wrapper that takes basenames only and confines both src and
# dst to /etc/lamalibre/lamaste/pki/.
lamaste ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-pki-rename
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /etc/nginx/sites-available/*.bak /etc/nginx/sites-available/*

# --- cp: only within known paths ---
lamaste ALL=(root) NOPASSWD: /usr/bin/cp /etc/nginx/sites-available/* /etc/nginx/sites-available/*.bak
lamaste ALL=(root) NOPASSWD: /usr/bin/cp /etc/lamalibre/lamaste/pki/* /etc/lamalibre/lamaste/pki/*.bak

# --- Authelia directories, file reads, and TOTP database ---
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/authelia/*
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /var/log/authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /var/log/authelia/*
lamaste ALL=(root) NOPASSWD: /usr/bin/cat /etc/authelia/*
lamaste ALL=(root) NOPASSWD: /usr/local/bin/authelia storage user totp generate *

# --- Static site file operations under /var/www/lamaste/ ---
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chown -R www-data\\:www-data /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chown www-data\\:www-data /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chown lamaste\\:lamaste /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod -R 755 /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/rm -rf /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/rm -f /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/find /var/www/lamaste/*
lamaste ALL=(root) NOPASSWD: /usr/bin/du -sb /var/www/lamaste/*

# --- PKI file permissions and ownership ---
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 600 /etc/lamalibre/lamaste/pki/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/lamalibre/lamaste/pki/*
lamaste ALL=(root) NOPASSWD: /usr/bin/rm -f /etc/lamalibre/lamaste/pki/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chown lamaste\\:lamaste /etc/lamalibre/lamaste/pki/*

# --- Agent certificates (lamaste-owned directory under pki) ---
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/lamalibre/lamaste/pki/agents
lamaste ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/lamalibre/lamaste/pki/agents/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chown lamaste\\:lamaste /etc/lamalibre/lamaste/pki/agents
lamaste ALL=(root) NOPASSWD: /usr/bin/chown -R lamaste\\:lamaste /etc/lamalibre/lamaste/pki/agents/*
lamaste ALL=(root) NOPASSWD: /usr/bin/rm -rf /etc/lamalibre/lamaste/pki/agents/*

# --- nginx vhost file permissions and cleanup ---
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/nginx/sites-available/*
lamaste ALL=(root) NOPASSWD: /usr/bin/rm -f /etc/nginx/sites-available/*
lamaste ALL=(root) NOPASSWD: /usr/bin/rm -f /etc/nginx/sites-enabled/*
lamaste ALL=(root) NOPASSWD: /usr/bin/ln -sf /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*

# --- systemd service file permissions ---
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/chisel.service
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/authelia.service
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/lamalibre-lamaste-serverd.service

# --- chisel and authelia binary permissions ---
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod +x /usr/local/bin/chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod +x /usr/local/bin/authelia

# --- authelia config permissions ---
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 600 /etc/authelia/*
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/authelia/*

# --- test file existence ---
lamaste ALL=(root) NOPASSWD: /usr/bin/test -f /etc/nginx/sites-available/*
lamaste ALL=(root) NOPASSWD: /usr/bin/test -r /etc/lamalibre/lamaste/pki/*

# --- self-update: run update script in its own cgroup (survives panel restart) ---
# Each argument is pinned except the script ID suffix (16-char hex from randomBytes).
# The sudoers wildcard only matches within a single argument — no trailing args accepted.
lamaste ALL=(root) NOPASSWD: /usr/bin/systemd-run --unit lamalibre-lamaste-update-* --no-block /usr/bin/bash /etc/lamalibre/lamaste/update-*.sh

# --- Gatekeeper service management ---
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start lamalibre-lamaste-gatekeeper
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop lamalibre-lamaste-gatekeeper
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart lamalibre-lamaste-gatekeeper
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable lamalibre-lamaste-gatekeeper
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/lamalibre-lamaste-gatekeeper.service
`;
}

/**
 * Generate the lamalibre-lamaste-gatekeeper systemd service unit content.
 *
 * @param {{ installDir: string, configDir: string }} ctx
 * @returns {string}
 */
export function generateGatekeeperServiceUnit(ctx) {
  return `[Unit]
Description=Lamaste Gatekeeper — tunnel authorization service
After=network.target authelia.service

[Service]
Type=simple
User=lamaste
Group=lamaste
WorkingDirectory=${ctx.installDir}/gatekeeper
ExecStart=/usr/bin/node dist/server/index.js
Environment=NODE_ENV=production
Environment=LAMALIBRE_LAMASTE_DATA_DIR=${ctx.configDir}
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=lamalibre-lamaste-gatekeeper

# Security hardening
ProtectHome=true
ReadWritePaths=${ctx.configDir}
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Root-owned sudoers wrapper scripts shipped in this package's scripts/
 * directory and installed to /usr/local/sbin. The sudoers rules reference
 * these absolute paths; each script validates its arguments and runs its
 * command with a fixed argument vector.
 */
export const SUDOERS_WRAPPERS = [
  { name: 'lamaste-sign-csr', dest: '/usr/local/sbin/lamaste-sign-csr' },
  { name: 'lamaste-pki-rename', dest: '/usr/local/sbin/lamaste-pki-rename' },
  { name: 'lamaste-certbot', dest: '/usr/local/sbin/lamaste-certbot' },
  { name: 'lamaste-cert-info', dest: '/usr/local/sbin/lamaste-cert-info' },
];

/**
 * The group the chisel server runs as. The 0640 chisel authfile (every
 * agent's tunnel password) belongs to it; the lamaste user is a member so the
 * panel can hand the file to the group without privileges. Must match
 * CHISEL_AUTHFILE_GROUP in @lamalibre/lamaste/server.
 */
export const CHISEL_GROUP = 'lamaste-chisel';

/** sites-available name of the port-80 catch-all. */
export const HTTP_REDIRECT_SITE = 'lamalibre-lamaste-http-redirect';

/**
 * The port-80 catch-all: every plain-HTTP request is redirected to HTTPS on
 * the same host and path. Without it nothing listens on :80 and `http://`
 * links to the relay's hostnames are refused.
 *
 * It does not get in the way of Let's Encrypt: certbot's nginx authenticator
 * (`certonly --nginx`, and renewals) clones this default_server block per
 * hostname for the length of an HTTP-01 challenge, answers the challenge
 * path ahead of the redirect, and restores the file afterwards — verified
 * on Ubuntu 24.04 (nginx 1.24, certbot 2.9) for new names, names with an
 * existing 443 block, multi-name lineages, and forced renewals.
 */
export function generateHttpRedirectVhost() {
  return `# Managed by Lamaste — plain HTTP is redirected to HTTPS.
server {
    listen 80 default_server;
    server_name _;
    return 301 https://$host$request_uri;
}
`;
}
