/**
 * Shared systemd unit and sudoers content generators.
 * Used by both the full installer (panel.js) and the redeploy flow (redeploy.js).
 */

/**
 * Generate the portlama-panel systemd service unit content.
 *
 * @param {{ installDir: string, configDir: string }} ctx
 * @returns {string}
 */
export function generateServiceUnit(ctx) {
  return `[Unit]
Description=Portlama Panel Server
After=network.target

[Service]
Type=simple
User=portlama
Group=portlama
WorkingDirectory=${ctx.installDir}/panel-server
ExecStart=/usr/bin/node src/index.js
Environment=NODE_ENV=production
Environment=CONFIG_FILE=${ctx.configDir}/panel.json
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=portlama-panel

# Security hardening
# Note: NoNewPrivileges is intentionally omitted — the panel needs sudo
# for provisioning (Chisel, Authelia, certbot, nginx, systemctl).
# Access is restricted via fine-grained sudoers rules in /etc/sudoers.d/portlama.
ProtectHome=true
ReadWritePaths=${ctx.configDir} /var/www/portlama
PrivateTmp=true

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Generate the portlama sudoers file content.
 *
 * @returns {string}
 */
export function generateSudoersContent() {
  return `# Portlama panel-server sudo rules
# Allows the portlama user to manage specific services and run specific commands

# --- systemctl: managed services ---
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl start nginx
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl stop nginx
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl restart nginx
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl start chisel
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl stop chisel
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl restart chisel
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl start authelia
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl stop authelia
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl restart authelia
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl reload authelia
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl enable certbot.timer
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl start certbot.timer
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl enable chisel
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl enable authelia
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl start portlama-panel
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl stop portlama-panel
portlama ALL=(root) NOPASSWD: /usr/bin/systemctl restart portlama-panel

# --- nginx config test ---
portlama ALL=(root) NOPASSWD: /usr/sbin/nginx -t

# --- certbot: restrict certonly to --nginx (code always passes --non-interactive) ---
# Note: trailing wildcard allows additional flags; trust boundary is @lamalibre/ scope
portlama ALL=(root) NOPASSWD: /usr/bin/certbot certonly --nginx *
portlama ALL=(root) NOPASSWD: /usr/bin/certbot renew
portlama ALL=(root) NOPASSWD: /usr/bin/certbot renew --cert-name *
portlama ALL=(root) NOPASSWD: /usr/bin/certbot certificates

# --- openssl: restricted to PKI and Let's Encrypt paths ---
portlama ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/portlama/pki/* *
portlama ALL=(root) NOPASSWD: /usr/bin/openssl x509 -in /etc/letsencrypt/live/* *
portlama ALL=(root) NOPASSWD: /usr/bin/openssl x509 -req -in /etc/portlama/pki/* *
portlama ALL=(root) NOPASSWD: /usr/bin/openssl genrsa -out /etc/portlama/pki/* *
portlama ALL=(root) NOPASSWD: /usr/bin/openssl req -new -key /etc/portlama/pki/* *
portlama ALL=(root) NOPASSWD: /usr/bin/openssl pkcs12 -export -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -out /etc/portlama/pki/*

# --- mv: restrict source to /tmp/ or known config paths ---
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /etc/nginx/sites-available/*
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /etc/systemd/system/chisel.service
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /etc/systemd/system/authelia.service
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /etc/systemd/system/portlama-panel.service
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /etc/portlama/pki/*
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /usr/local/bin/chisel
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /usr/local/bin/authelia
portlama ALL=(root) NOPASSWD: /usr/bin/mv /tmp/* /etc/authelia/*
portlama ALL=(root) NOPASSWD: /usr/bin/mv /etc/portlama/pki/*.new /etc/portlama/pki/*
portlama ALL=(root) NOPASSWD: /usr/bin/mv /etc/nginx/sites-available/*.bak /etc/nginx/sites-available/*

# --- cp: only within known paths ---
portlama ALL=(root) NOPASSWD: /usr/bin/cp /etc/nginx/sites-available/* /etc/nginx/sites-available/*.bak
portlama ALL=(root) NOPASSWD: /usr/bin/cp /etc/portlama/pki/* /etc/portlama/pki/*.bak

# --- Authelia directories, file reads, and TOTP database ---
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/authelia
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/authelia/*
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /var/log/authelia
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /var/log/authelia/*
portlama ALL=(root) NOPASSWD: /usr/bin/cat /etc/authelia/*
portlama ALL=(root) NOPASSWD: /usr/local/bin/authelia storage user totp generate *

# --- Static site file operations under /var/www/portlama/ ---
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/chown -R www-data\\:www-data /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/chown www-data\\:www-data /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/chown portlama\\:portlama /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/chmod -R 755 /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/rm -rf /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/rm -f /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/find /var/www/portlama/*
portlama ALL=(root) NOPASSWD: /usr/bin/du -sb /var/www/portlama/*

# --- PKI file permissions and ownership ---
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 600 /etc/portlama/pki/*
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/portlama/pki/*
portlama ALL=(root) NOPASSWD: /usr/bin/rm -f /etc/portlama/pki/*
portlama ALL=(root) NOPASSWD: /usr/bin/chown portlama\\:portlama /etc/portlama/pki/*

# --- Agent certificates (portlama-owned directory under pki) ---
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/portlama/pki/agents
portlama ALL=(root) NOPASSWD: /usr/bin/mkdir -p /etc/portlama/pki/agents/*
portlama ALL=(root) NOPASSWD: /usr/bin/chown portlama\\:portlama /etc/portlama/pki/agents
portlama ALL=(root) NOPASSWD: /usr/bin/chown -R portlama\\:portlama /etc/portlama/pki/agents/*
portlama ALL=(root) NOPASSWD: /usr/bin/rm -rf /etc/portlama/pki/agents/*

# --- nginx vhost file permissions and cleanup ---
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/nginx/sites-available/*
portlama ALL=(root) NOPASSWD: /usr/bin/rm -f /etc/nginx/sites-available/*
portlama ALL=(root) NOPASSWD: /usr/bin/rm -f /etc/nginx/sites-enabled/*
portlama ALL=(root) NOPASSWD: /usr/bin/ln -sf /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*

# --- systemd service file permissions ---
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/chisel.service
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/authelia.service
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/systemd/system/portlama-panel.service

# --- chisel and authelia binary permissions ---
portlama ALL=(root) NOPASSWD: /usr/bin/chmod +x /usr/local/bin/chisel
portlama ALL=(root) NOPASSWD: /usr/bin/chmod +x /usr/local/bin/authelia

# --- authelia config permissions ---
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 600 /etc/authelia/*
portlama ALL=(root) NOPASSWD: /usr/bin/chmod 644 /etc/authelia/*

# --- test file existence ---
portlama ALL=(root) NOPASSWD: /usr/bin/test -f /etc/nginx/sites-available/*
portlama ALL=(root) NOPASSWD: /usr/bin/test -r /etc/portlama/pki/*
`;
}
