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
# Restart is invoked by chisel-users.js after every credential mutation
# (chisel does not support graceful authfile reload). Pinned to bare service
# name — no wildcards so a compromised panel cannot restart arbitrary units.
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl reload authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable certbot.timer
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start certbot.timer
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl enable authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl start lamalibre-lamaste-serverd
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl stop lamalibre-lamaste-serverd
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl restart lamalibre-lamaste-serverd

# --- nginx config test ---
lamaste ALL=(root) NOPASSWD: /usr/sbin/nginx -t

# --- certbot: restrict to exact flag patterns used by the application ---
lamaste ALL=(root) NOPASSWD: /usr/bin/certbot certonly --nginx -d * --email * --agree-tos --non-interactive
lamaste ALL=(root) NOPASSWD: /usr/bin/certbot renew --non-interactive
lamaste ALL=(root) NOPASSWD: /usr/bin/certbot renew --cert-name * --non-interactive
lamaste ALL=(root) NOPASSWD: /usr/bin/certbot renew --cert-name * --force-renewal --non-interactive
lamaste ALL=(root) NOPASSWD: /usr/bin/certbot certificates --non-interactive

# --- openssl: read-only operations (no trailing wildcards) ---
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/lamalibre/lamaste/pki/* -serial -noout
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/lamalibre/lamaste/pki/* -enddate -noout
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -checkend 86400 -noout -in /etc/letsencrypt/live/*
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -enddate -noout -in /etc/letsencrypt/live/*
lamaste ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/letsencrypt/live/* -enddate -noout
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
# chisel-users authfile: written atomically via temp file then sudo mv
lamaste ALL=(root) NOPASSWD: /usr/bin/mv /tmp/lamalibre-lamaste-chisel-users-* /etc/lamalibre/lamaste/chisel-users
lamaste ALL=(root) NOPASSWD: /usr/bin/chown lamaste\\:lamaste /etc/lamalibre/lamaste/chisel-users
lamaste ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/lamalibre/lamaste/chisel-users
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
