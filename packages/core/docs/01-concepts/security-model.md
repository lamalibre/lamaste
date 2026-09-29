# Security Model

> Lamaste uses a defense-in-depth strategy with multiple independent security layers — OS hardening, firewall, TLS encryption, mTLS authentication, TOTP 2FA, and service isolation — so that no single vulnerability compromises the system.

## In Plain English

Security in Lamaste works like layers of protection around a castle. Each layer is independent, so even if an attacker gets past one, they face another.

The outermost layer is the **firewall** — only four doors exist (ports 22, 80, 443, and 9292), and all others are sealed shut. The next layer is **encryption** — every conversation is in a secret language (TLS). Then comes **authentication** — the admin panel checks your digital ID card (client certificate), and the tunneled apps check your password and phone code (TOTP). The innermost layer is **isolation** — each service runs in its own room, and even if one is compromised, it cannot reach the others.

No single layer is perfect. Firewalls can be misconfigured. TLS has had vulnerabilities. Passwords get stolen. But the chance of all layers failing simultaneously is vanishingly small. This approach — multiple imperfect layers that together provide strong security — is called defense in depth.

## For Users

### What protects you

Here is every security measure Lamaste puts in place, from the outside in:

#### 1. Firewall (UFW)

Only four ports are open on your VPS:

| Port     | Service | Who needs it                                                       |
| -------- | ------- | ------------------------------------------------------------------ |
| 22/tcp   | SSH     | You, during installation only                                      |
| 80/tcp   | HTTP    | Let's Encrypt HTTP-01 challenge (certificate issuance and renewal) |
| 443/tcp  | HTTPS   | Everyone (domains)                                                 |
| 9292/tcp | HTTPS   | You (admin panel via IP; disabled when panel 2FA is enabled)       |

Every other port is blocked. A port scan of your VPS shows only these four services.

#### 2. fail2ban

An automated intrusion prevention system that watches log files for suspicious activity:

- **SSH jail** — bans an IP for 1 hour after 5 failed login attempts
- **nginx jail** — bans an IP for 1 hour after 5 failed HTTP authentication attempts

Banning means adding a firewall rule that drops all packets from the offending IP.

#### 3. SSH hardening

After installation, SSH is locked down:

| Setting                           | Value               | Effect                          |
| --------------------------------- | ------------------- | ------------------------------- |
| `PasswordAuthentication`          | `no`                | Only key-based auth accepted    |
| `PermitRootLogin`                 | `prohibit-password` | Root can log in with keys only  |
| `ChallengeResponseAuthentication` | `no`                | No keyboard-interactive prompts |

This means SSH brute-force attacks (trying passwords) are impossible. An attacker would need your private SSH key.

#### 4. TLS encryption

Every connection to your VPS is encrypted with TLS 1.2 or 1.3. Even if someone intercepts the traffic (e.g., on a public Wi-Fi network), they cannot read or modify it.

- Domain-based vhosts use Let's Encrypt certificates (trusted by all browsers)
- The IP-based admin panel uses a self-signed certificate (browser warning, but still encrypted)

#### 5. mTLS for admin and agent access

The admin panel requires a client certificate at the TLS layer. Without the certificate, nginx rejects the connection before any HTTP traffic is exchanged. See [mTLS](mtls.md) for full details.

**Agent-side TLS verification:** The agent verifies both servers it talks to. The panel uses a self-signed TLS server certificate that is separate from the mTLS CA used to sign client certificates, so `lamaste-agent setup` pins the panel's public key on first contact (trust on first use) and every later panel call rejects any other key; `lamaste-agent panel reset-pin` re-captures it after a deliberate rotation. The tunnel relay, `tunnel.<domain>`, has a publicly trusted Let's Encrypt certificate that the agent's Chisel client verifies normally (see 5a below).

**P12 password security:** The agent never passes the P12 password as a command-line argument. Curl calls use a temporary config file (created with mode `0600`, deleted after use), and openssl calls use the `LAMALIBRE_LAMASTE_P12_PASS` environment variable. This prevents the password from being visible in process listings (`ps aux`).

**Hardware-bound certificates:** Agents can enroll using a one-time token and a locally generated CSR, binding the private key to the macOS Keychain so it is non-extractable. The public `POST /api/enroll` endpoint uses the token as its sole authentication gate — no mTLS is required for enrollment itself, since the agent does not yet have a certificate. After enrollment, the agent authenticates with the Keychain-backed identity just like any other mTLS client. Admins can optionally upgrade their own authentication to hardware-bound mode (set `adminAuthMode` to `"hardware-bound"` in `panel.json`), which disables P12 download and certificate rotation through the panel UI. If the admin Keychain identity is lost, recovery is possible by running `lamaste-reset-admin` on the server, which reverts to standard P12 authentication.

Lamaste supports three types of certificates with different access levels:

- **Admin certificate** (`CN=admin`) — full access to all panel endpoints (for browser-based management)
- **Agent certificate** (`CN=agent:<label>`) — capability-based access (for tunnel agents on macOS and Linux)
- **Plugin-agent certificate** (`CN=plugin-agent:<delegator>:<name>`) — minimal identity for plugin agents participating in the ticket system, created via delegated enrollment

Agent certificates are generated from the panel UI and should be used instead of the admin certificate when connecting agents. Plugin-agent certificates are created when an existing agent delegates enrollment for a plugin's agents (e.g., a Sync server vouching for its Sync agents). Each agent is assigned granular capabilities that control what it can access:

| Capability       | Grants                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- |
| `tunnels:read`   | List the agent's own tunnels and fetch its Chisel config (always-on)                   |
| `tunnels:write`  | Create, update and delete tunnels the agent carries (restricted access mode only)      |
| `services:read`  | View service status                                                                    |
| `services:write` | Start/stop/restart services                                                            |
| `system:read`    | View system stats (CPU, RAM, disk)                                                     |
| `sites:read`     | List assigned sites and browse their files                                             |
| `sites:write`    | Upload and delete files on assigned sites                                              |
| `panel:expose`   | Expose agent management panel at `agent-<label>.<domain>` via mTLS-protected subdomain |
| `identity:read`  | Parse Authelia identity headers on plugin routes                                       |
| `identity:query` | Query panel for Authelia user metadata                                                 |

Capabilities are stored server-side and can be updated without reissuing the certificate. Regular agents default to `["tunnels:read"]`, while plugin-agents start with no capabilities at all — the admin must explicitly grant capabilities. Plugins can declare additional capabilities in their manifest (flat array or nested `{ agent: [...] }` format); these are merged with base capabilities dynamically and available for assignment to agent certificates. Ticket scopes also contribute capabilities dynamically: when a scope like `shell` declares `scopes: [{ name: 'shell:connect' }]`, the capability `shell:connect` becomes available for assignment alongside base and plugin capabilities. Users, certificates, agent management, and logs always remain admin-only. Site creation and deletion are also admin-only operations.

In addition to capabilities, regular agent certificates support **per-site scoping** via `allowedSites`. Each agent has a list of site names it is permitted to access. When an agent calls `GET /api/sites`, it only sees sites in its `allowedSites` list. File operations (upload, list, delete) require both the relevant capability and the site name in the agent's `allowedSites`. The admin manages site assignments from **Panel** > **Certificates** > edit agent > **Site Access**, or via the `PATCH /api/certs/agent/:label/allowed-sites` endpoint. Plugin-agents never have site access.

**Cascade revocation:** When a regular agent is revoked, all plugin-agents it delegated are automatically cascade-revoked in the same atomic operation. This ensures that revoking a compromised agent immediately terminates all downstream identities.

This three-level model (certificate type + capabilities + site scoping) means that even if a machine is compromised, the attacker is limited to whichever capabilities and sites were assigned to that agent — and the admin can revoke or reduce them immediately.

#### 5a. Tunnel ownership and the tunnel relay

Every tunnel is carried by exactly one agent (its `agentLabel`), and three things enforce that:

- **The panel API.** An agent certificate sees and acts on only its own tunnels — others are absent from its list and answer `404`. `GET /api/tunnels/agent-config` returns only the caller's tunnels. An agent cannot create a tunnel for another agent or move one; only an admin can. A plugin-agent certificate cannot create tunnels at all (it holds no Chisel credential). Every tunnel change runs under one lock with its validation inside it, so two concurrent requests cannot both claim a subdomain or port.
- **The Chisel authfile.** Each `agent-<label>` Chisel user may reverse-bind exactly `^R:127\.0\.0\.1:<port>$` for the enabled tunnels it owns, and nothing else. A second enrolled machine cannot bind another agent's port and take over its hostname. A `lamaste-no-grants` sentinel user keeps the authfile non-empty, because Chisel disables authentication outright on an empty authfile. The authfile holds every agent's password, so it is `0640`, group `lamaste-chisel` — readable by the Chisel process (`User=nobody`, `Group=lamaste-chisel`) and by nobody else.
- **Reserved ports.** A tunnel vhost proxies to `127.0.0.1:<port>` on the relay, so the ports of Lamaste's own services — 3100 (panel), 9090 (Chisel), 9091 (Authelia), 9292 (IP panel listener), 9294 (Gatekeeper) — can never be tunnel ports. A tunnel on 3100 or 9292 would otherwise publish the panel API, which trusts the client-certificate headers nginx sets: an administrator takeover. The rule is enforced by the request schema, inside the tunnel workflow, and again when the authfile grants are rendered; a port claimed by two tunnels is never granted either.
- **TLS verification on the agent.** The agent's Chisel client connects to `https://tunnel.<domain>:443` and verifies its Let's Encrypt certificate — there is no `--tls-skip-verify`. A machine on the path cannot impersonate the relay to collect the agent's credential or read tunnelled traffic. The credential itself is delivered through a 0600 environment file (Linux) or 0600 plist (macOS), never on the command line. The agent only ever connects to `tunnel.<enrolled domain>` and refuses a panel that reports a different domain. Agents upgraded from a version that exposed the credential in process arguments and 0644 unit files rotate it once, automatically.
- **Revocation releases tunnels.** Revoking an agent certificate removes its Chisel credential and detaches it from its tunnels (app tunnels become unassigned, its panel tunnel is removed), so a later enrollment reusing the label inherits nothing.
- **Fail closed at startup.** On every start the panel rewrites the Chisel unit and authfile from its state in the background. If that fails, Chisel is **stopped and disabled** (so a reboot cannot start it either) rather than left running with an authfile from an older version that may grant more than it should; reconciliation retries with backoff until it succeeds, then re-enables and starts it.

See [Tunneling](tunneling.md#ownership-and-grants) for the mechanics.

#### 5b. Tickets for agent-to-agent authorization

When agents need to communicate with each other (e.g., remote shell, file transfer), the ticket system adds two more layers of isolation on top of certificate capabilities:

1. **Certificate capability check** — both source and target agents must have the relevant scope capability on their certificates
2. **Ticket binding** — the source must own the instance, and the target must be explicitly assigned to it by the admin

Tickets are 256-bit random tokens, valid for 30 seconds, single-use, and validated with timing-safe comparison. After a ticket is consumed, a session tracks the connection with heartbeat re-validation every 60 seconds — checking that both certificates are still valid, capabilities still present, and the assignment still exists. If any condition fails, the session is immediately terminated.

A third isolation layer (transport CA) is available plugin-side for end-to-end verification, but is not enforced by the panel.

Rate limiting (10 tickets/agent/minute) and hard caps (200 instances, 1000 tickets, 500 sessions) protect against resource exhaustion on the 512 MB server.

See [Tickets](tickets.md) for the full model.

mTLS is stronger than a login page because:

- There is no password to brute-force
- There is no session to hijack
- There is no login endpoint to discover or attack
- The rejection happens before any application code runs

#### 6. TOTP 2FA for app access

Visitors to your tunneled apps authenticate through Authelia with a password and a TOTP code from their phone. See [Authentication](authentication.md) for full details.

#### 6b. Optional panel 2FA (admin only)

The admin can optionally enable a built-in TOTP 2FA layer for the panel itself. When enabled, the admin must present their mTLS client certificate **and** enter a TOTP code. Agents are exempt and continue to authenticate with mTLS only.

Key details:

- **Session cookie:** `lamaste_2fa_session`, HMAC-SHA256 signed, with 12-hour absolute expiry and 2-hour inactivity timeout. Cookie flags: `HttpOnly`, `Secure`, `SameSite=Strict`
- **Rate limiting:** 5 failed attempts within 2 minutes trigger a 5-minute ban
- **TOTP standard:** RFC 6238, SHA-1, 30-second period, +/-1 step clock drift, replay protection
- **IP vhost disabled:** When panel 2FA is enabled, the IP-based vhost (`https://<IP>:9292`) is disabled and access is domain-only. This is necessary because session cookies require a domain scope.
- **Recovery:** `sudo lamaste-reset-admin` clears 2FA settings and re-enables the IP vhost

See [Authentication](authentication.md) for setup details.

#### 7. Service isolation

Every internal service binds to `127.0.0.1` (localhost) only. Even if an attacker somehow reaches your VPS's internal network, they cannot connect to these services from outside:

| Service       | Bind address | Port |
| ------------- | ------------ | ---- |
| Panel server  | `127.0.0.1`  | 3100 |
| Authelia      | `127.0.0.1`  | 9091 |
| Chisel server | `127.0.0.1`  | 9090 |

nginx is the only service listening on public interfaces. It acts as a gateway, proxying authenticated requests to the internal services.

### The RAM constraint and bcrypt

Your VPS has only 512MB of RAM. This matters for security because some password hashing algorithms are memory-hungry. Argon2id (the "gold standard" for password hashing) allocates ~93MB per hash. On a 512MB system running multiple services, a single authentication attempt with argon2id can consume all available memory and crash everything.

Lamaste uses bcrypt instead. Bcrypt uses ~4KB per hash — over 23,000 times less memory — while still providing strong protection against brute-force attacks. The cost factor is set to 12, meaning each hash computation takes roughly 250ms, making large-scale password cracking impractical.

### Cloud provisioning security

When using the desktop app to create servers on DigitalOcean, the app enforces several safeguards:

- **Custom-scoped tokens** — the app requires 5 DigitalOcean resource groups (account, droplet, regions, ssh_key, tag) and rejects tokens with dangerous permissions (`database:delete`, `kubernetes:create`, `account:write`, etc.). An optional 6th group (`domain`) enables automatic DNS record creation during provisioning
- **Credential storage** — API tokens and P12 passwords are stored in the OS credential store (macOS Keychain / Linux libsecret), never in plaintext files or CLI arguments
- **`lamalibre:managed` + `product:lamaste` tag** — the app tags droplets it creates and refuses to destroy untagged droplets
- **Ephemeral SSH keys** — temporary ed25519 keys are generated for installation, then securely deleted afterward

**If you have other infrastructure on DigitalOcean, create a dedicated DigitalOcean team for Lamaste.** API tokens are account-wide — a token with `droplet:delete` can delete any droplet in the account, not just ones created by Lamaste. A separate team provides true resource-level isolation at no extra cost. See the [Cloud Provisioning guide](../02-guides/cloud-provisioning.md) for setup instructions.

### What is NOT included

Lamaste does not include:

- **Rate limiting at the application level** — fail2ban handles this at the network level
- **WAF (Web Application Firewall)** — your tunneled apps should implement their own input validation
- **DDoS protection** — consider Cloudflare or DigitalOcean's cloud firewall for DDoS mitigation
- **Automatic security updates** — enable Ubuntu's unattended-upgrades for OS patches

## For Developers

### Layer diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Internet                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Layer 1: UFW Firewall                                          │
│  Only ports 22, 80, 443, 9292 open                               │
│  Everything else: DROP                                          │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Layer 2: fail2ban                                              │
│  Monitors /var/log/auth.log and /var/log/nginx/error.log        │
│  Bans IPs after 5 failed attempts (1 hour)                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Layer 3: nginx TLS Termination                                 │
│  TLS 1.2/1.3 only, strong ciphers                              │
│  Panel vhosts: mTLS (client cert required)                      │
│  App vhosts: Gatekeeper/Authelia (per access mode)              │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
┌─────────────▼──┐  ┌───────▼───────┐  ┌──▼──────────────┐
│ Panel Server   │  │ Authelia      │  │ Chisel Server   │
│ 127.0.0.1:3100 │  │ 127.0.0.1:9091│  │ 127.0.0.1:9090  │
│ mTLS verified  │  │ TOTP verified │  │ per-agent grants│
└────────────────┘  └───────────────┘  └─────────────────┘
```

### UFW firewall implementation

The installer configures UFW in `packages/create-lamaste/src/tasks/harden.js`:

```javascript
// Set defaults
await execa('ufw', ['default', 'deny', 'incoming']);
await execa('ufw', ['default', 'allow', 'outgoing']);

// Allow only required ports
const requiredPorts = ['22/tcp', '80/tcp', '443/tcp', '9292/tcp'];
for (const port of requiredPorts) {
  await execa('ufw', ['allow', port]);
}

// Enable firewall
await execa('ufw', ['--force', 'enable']);
```

The task is idempotent — if UFW is already active with all required ports allowed, it skips the setup entirely. If UFW is active but missing some ports, it adds only the missing rules without resetting existing configuration.

### fail2ban configuration

fail2ban is configured via a drop-in file at `/etc/fail2ban/jail.d/lamaste.conf`:

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 5
bantime = 3600

[nginx-http-auth]
enabled = true
port = http,https
filter = nginx-http-auth
logpath = /var/log/nginx/error.log
maxretry = 5
bantime = 3600
```

Two jails are configured:

| Jail              | Monitors                   | Trigger             | Ban duration |
| ----------------- | -------------------------- | ------------------- | ------------ |
| `sshd`            | `/var/log/auth.log`        | 5 failed SSH logins | 1 hour       |
| `nginx-http-auth` | `/var/log/nginx/error.log` | 5 failed HTTP auths | 1 hour       |

Using a drop-in file in `jail.d/` rather than modifying `jail.local` preserves any existing fail2ban configuration and makes the Lamaste rules easy to identify and remove.

### SSH hardening implementation

The installer modifies `/etc/ssh/sshd_config` with a safe sequence:

```
1. Read original sshd_config
2. Check if all settings are already correct → skip if so
3. Apply regex modifications to produce new content
4. Write modified content to a temp file
5. Validate with sshd -t -f /path/to/temp
6. If validation fails → delete temp, leave original untouched
7. If validation passes → back up original, move temp into place
8. Restart sshd
```

The settings applied:

```
PasswordAuthentication no
PermitRootLogin prohibit-password
ChallengeResponseAuthentication no
```

The pre-installation backup is saved to `/etc/ssh/sshd_config.pre-lamaste` and is only created once (subsequent re-runs skip the backup step to preserve the original).

### Swap file

The installer creates a 1GB swap file as a safety net against memory pressure:

```javascript
await execa('fallocate', ['-l', '1G', '/swapfile']);
await execa('chmod', ['600', '/swapfile']);
await execa('mkswap', ['/swapfile']);
await execa('swapon', ['/swapfile']);
```

Swappiness is set to 10 (conservative — the kernel prefers using RAM and only swaps under heavy pressure):

```ini
# /etc/sysctl.d/99-lamaste.conf
vm.swappiness=10
```

The swap file is added to `/etc/fstab` to persist across reboots.

### RAM budget

The 512MB VPS RAM is carefully allocated:

| Service      | Typical RAM | Notes                             |
| ------------ | ----------- | --------------------------------- |
| OS baseline  | ~120MB      | Kernel, systemd, base processes   |
| nginx        | ~15MB       | Low-memory reverse proxy          |
| Authelia     | ~25MB       | Go binary, minimal footprint      |
| Chisel       | ~20MB       | Go binary, WebSocket multiplexing |
| Panel server | ~30MB       | Node.js, Fastify                  |
| fail2ban     | ~35MB       | Python-based, log monitoring      |
| **Total**    | **~245MB**  |                                   |
| **Headroom** | **~265MB**  | Available for spikes              |
| **Swap**     | **1GB**     | Safety net                        |

This budget is why bcrypt (not argon2id) is mandatory for password hashing. Argon2id's ~93MB per hash would consume over a third of total RAM on a single authentication attempt.

### bcrypt configuration

Authelia is configured with bcrypt cost factor 12:

```yaml
authentication_backend:
  file:
    path: /etc/authelia/users.yml
    password:
      algorithm: bcrypt
      bcrypt:
        cost: 12
```

Cost factor 12 means 2^12 = 4096 iterations. Benchmarks on typical hardware:

| Cost factor | Time per hash | Suitable for                    |
| ----------- | ------------- | ------------------------------- |
| 10          | ~65ms         | High-traffic sites              |
| 12          | ~250ms        | Lamaste (good balance)          |
| 14          | ~1000ms       | Very high security requirements |

At cost 12, an attacker with a stolen hash trying 4 passwords per second would need ~8 years to try 100 million passwords. This is sufficient for a self-hosted system that also has fail2ban and network-level protections.

### Service isolation details

All internal services bind to `127.0.0.1`, which means they only accept connections from the same machine. Even if an attacker gains network access to the VPS (e.g., through a compromised container on the same network segment), they cannot reach these services.

The Chisel server explicitly sets `--host 127.0.0.1` in its systemd unit, and runs unprivileged:

```ini
User=nobody
Group=lamaste-chisel
ExecStart=/usr/local/bin/chisel server --reverse --port 9090 --host 127.0.0.1 --keyfile /etc/lamalibre/lamaste/chisel-server.key --authfile /etc/lamalibre/lamaste/chisel-users
```

The unit also sets `NoNewPrivileges`, an empty `CapabilityBoundingSet`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp` and `PrivateDevices`. The binary is Chisel 1.12.0, which `create-lamaste` downloads from its fixed release URL and verifies against a pinned SHA-256 before unpacking it. The panel never installs or replaces it: at startup it only checks the installed version and, if it is not the pinned release, logs an error and restarts Chisel on every authfile change until `create-lamaste` is re-run.

`--authfile` restricts every connecting client to its own credential and port grants. The reverse listeners Chisel opens for agents also bind `127.0.0.1` only: agents may only request `R:127.0.0.1:<port>` remotes.

Authelia is configured in its YAML:

```yaml
server:
  address: 'tcp://127.0.0.1:9091/'
```

Authelia is reachable from the internet (`auth.<domain>`), so it runs as neither root nor `lamaste` but as its own system account, `lamaste-authelia`. Its unit (written by `create-lamaste`) sets `UMask=027`, `NoNewPrivileges`, an empty `CapabilityBoundingSet`, `ProtectSystem=strict` with `ReadWritePaths=/etc/authelia /var/log/authelia`, `PrivateTmp`, `PrivateDevices` and `SystemCallFilter=@system-service`. It can read its configuration through its group and write only its database, notification file, `users.yml` (rewritten on a password change) and its log. The binary is Authelia 4.39.28, downloaded by `create-lamaste` from its fixed release URL and verified against a pinned SHA-256 per architecture; a newer installed Authelia is kept, never downgraded.

The panel server binds to localhost in its Fastify configuration.

nginx is the only service with a public-facing socket. It listens on:

- `0.0.0.0:80`, which only redirects to HTTPS (and answers Let's Encrypt HTTP-01 challenges while certbot runs)
- `0.0.0.0:443` for domain-based vhosts
- `0.0.0.0:9292` for the IP-based admin panel

Tunnel vhosts never pass client-supplied `X-SSL-Client-*` headers to the app (the panel treats those headers from nginx as proof of a client certificate), and public tunnel vhosts also clear the `Remote-*` identity headers, which only an authenticated vhost may set.

### File permissions

Sensitive files use restrictive permissions:

| File                                                                | Mode  | Rationale                                         |
| ------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| `/etc/lamalibre/lamaste/pki/ca.key`                                 | `600` | CA private key — can sign new client certs        |
| `/etc/lamalibre/lamaste/pki/client.key`                             | `600` | Client private key                                |
| `/etc/lamalibre/lamaste/pki/client.p12`                             | `600` | PKCS12 bundle with private key                    |
| `/etc/lamalibre/lamaste/pki/.p12-password`                          | `600` | Password for the .p12 file                        |
| `/etc/authelia/configuration.yml`                                   | `640` | JWT and session secrets; group `lamaste-authelia` |
| `/etc/authelia/.secrets.json`                                       | `600` | Secret backup; the panel (`lamaste`) only         |
| `/etc/authelia/users.yml`                                           | `660` | Password hashes; Authelia rewrites it             |
| `/etc/authelia/db.sqlite3`, `notifications.txt`                     | `600` | Owned by `lamaste-authelia`                       |
| `/etc/lamalibre/lamaste/chisel-server.key`                          | `640` | Chisel SSH host key; group `lamaste-chisel`       |
| `/etc/lamalibre/lamaste/chisel-credentials.json`                    | `600` | Per-agent Chisel passwords                        |
| `/etc/lamalibre/lamaste/chisel-sentinel`                            | `600` | Sentinel Chisel user password                     |
| `/etc/lamalibre/lamaste/chisel-users`                               | `640` | Chisel authfile; group `lamaste-chisel` only      |
| `~/.lamalibre/lamaste/agents/<label>/`                              | `700` | Agent data directory (agent machine)              |
| `~/.lamalibre/lamaste/agents/<label>/chisel.json`, `chisel.env`     | `600` | Agent's Chisel credential (agent machine)         |
| `~/Library/LaunchAgents/com.lamalibre.lamaste.chisel-<label>.plist` | `600` | Carries `AUTH` in its environment (macOS agent)   |
| `/etc/lamalibre/lamaste/pki/`                                       | `700` | PKI directory itself                              |

Mode `600` means only the file owner can read or write. Mode `640` adds read access for the file's group, `660` also write access. Mode `700` means only the directory owner can list, read, or modify contents. See [Configuration Files](../06-reference/config-files.md#file-permissions-table) for the owner of every directory.

### Privilege boundary

The panel runs as the unprivileged `lamaste` user and cannot become root. `/etc/sudoers.d/lamaste` contains no wildcard: a sudoers `*` matches any characters, spaces included, so a rule such as `mv /tmp/site-index-* /var/www/lamaste/*` also accepts `-t /etc/sudoers.d`, `find /var/www/lamaste/*` accepts `-exec`, `cat /etc/authelia/*` reads `/etc/shadow`, `certbot renew --cert-name * ...` accepts `--deploy-hook <command>`, and an `openssl` rule accepts `-engine`. Every rule is either a fixed command line or a root-owned program that validates its own arguments:

| Rule                                       | What it allows                                                                                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemctl <verb> <service>` (fixed lines) | `start`/`stop`/`restart` of `nginx`, `chisel`, `authelia`, `lamalibre-lamaste-serverd`, `lamalibre-lamaste-gatekeeper`; `reload` of `nginx` and `authelia`; `try-restart`/`enable`/`disable` of `chisel`; `enable` of `authelia`; `enable`/`start` of `certbot.timer` |
| `nginx -t`                                 | Test the nginx configuration                                                                                                                                                                                                                                          |
| `/usr/local/sbin/lamaste-priv`             | Install/enable/remove the panel's own vhosts, store a TOTP secret, start a self-update (see below)                                                                                                                                                                    |
| `/usr/local/sbin/lamaste-certbot`          | `certbot certonly --nginx` (validated hostnames and email), `renew`, `renew-all`, `list`                                                                                                                                                                              |
| `/usr/local/sbin/lamaste-cert-info`        | Read-only `openssl` queries (expiry, 24 h validity, SAN) on a Let's Encrypt lineage                                                                                                                                                                                   |

There is no rule for `mv`, `cp`, `rm`, `chmod`, `chown`, `mkdir`, `cat`, `find`, `du`, `test`, `ln`, `openssl`, `systemd-run` or `systemctl daemon-reload`. What the panel does without them:

- **Its own files.** The PKI directory (the panel is the CA, and signs agent CSRs itself — see [Certificates](certificates.md)), the web root (`/var/www/lamaste`, `lamaste:www-data`), Authelia's configuration (`/etc/authelia`, `lamaste:lamaste-authelia`) and the Chisel authfile and key (group `lamaste-chisel`, of which `lamaste` is a member) belong to it or to a group it shares.
- **Binaries, units, accounts.** Chisel and Authelia (pinned, digest-verified releases), their systemd units and the service accounts are installed by `create-lamaste`, which runs as root. The panel never writes a unit or a binary; onboarding only checks they exist.
- **Code.** `/opt/lamalibre/lamaste` (panel, gatekeeper, `lamaste-server` CLI, UI, docs) is root-owned and read-only for `lamaste`, so a compromised panel cannot rewrite code that root later runs through `sudo lamaste-server`.

#### `lamaste-priv`

`/usr/local/sbin/lamaste-priv` is a root-owned (`0755`), zero-dependency Node.js program installed by `create-lamaste`. Content (vhost text, TOTP secrets) arrives on stdin, never on the command line, so it is not written to the sudo log. It reads nothing the `lamaste` user can write.

| Operation                                                                           | Does                                                                                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `nginx-site write\|backup\|restore\|discard-backup\|enable\|disable\|remove <name>` | Manage `sites-available/<name>` (and its `.bak`) and its `sites-enabled` link. `write` validates the vhost on stdin first.     |
| `authelia-totp <username>`                                                          | Store the TOTP secret from stdin with Authelia's CLI, run as `lamaste-authelia` (the database is that account's file)          |
| `self-update <version>`                                                             | Start `npx @lamalibre/create-lamaste@<version> --yes` in a transient systemd unit two seconds later (`MAJOR.MINOR.PATCH` only) |

Site names are limited to the panel's own vhosts: `lamalibre-lamaste-panel-domain`, `-auth`, `-tunnel`, `-app-<subdomain>`, `-agent-panel-<label>` and `-site-<uuid>`. `lamalibre-lamaste-panel-ip` (written by `create-lamaste`) may only be enabled or disabled.

**Why vhosts are validated.** nginx's master process runs as root and opens the files a configuration names: `access_log /etc/cron.d/x` with a crafted `log_format` would be a root shell. `lamaste-priv` parses every vhost and accepts only directives on a per-context allow-list, with arguments that cannot name a file outside what Lamaste serves:

- `listen 443` (`[::]:443`), optionally `ssl` / `http2` — port 80 belongs to the installer's HTTPS redirect
- `server_name` with hostnames only
- `ssl_certificate` / `ssl_certificate_key` only under `/etc/letsencrypt/live/<name>/{fullchain,privkey}.pem`
- `include` only `/etc/nginx/snippets/lamalibre-lamaste-*.conf`
- `root` / `alias` only under `/var/www/lamaste/`
- `proxy_pass` only `http://127.0.0.1:<port>[/path]`
- the `proxy_*`, `auth_request`, `auth_request_set`, `limit_req`, `limit_req_zone`, `map`, `add_header`, `error_page`, `return`, `rewrite`, `try_files`, `if`, `index`, `ssl_protocols`/`ssl_ciphers` directives the panel's generators use

Anything else is refused — including directives nginx would accept, backslashes, `${`, and non-ASCII text outside comments. A refused write leaves the previous vhost in place. `npm test` runs the allow-list's refusal tests and checks that every vhost the panel generates passes it.

#### Root code never writes through the panel's paths

`create-lamaste` (including a self-update the panel triggers) and `sudo lamaste-server` run as root on directories `lamaste` can write to, which a compromised panel could have seeded with symlinks. So root never writes through an existing path there: new files are created `O_EXCL | O_NOFOLLOW` under a random name, `fchown`ed and renamed into place; temporary directories are `mkdtemp`; `lamaste-server reset-admin` runs `openssl`, `cp` and `chmod` as `lamaste`; `lamaste-server plugins install|enable|disable|uninstall` re-runs itself as `lamaste` (npm and state writes) and only restarts the panel as root.

### Secret generation

All secrets are generated using `crypto.randomBytes`, which reads from the operating system's cryptographically secure random number generator (`/dev/urandom` on Linux):

```javascript
import { randomBytes } from 'crypto';
const password = randomBytes(24).toString('base64url');
```

No secrets are hardcoded in the codebase. Each installation generates unique secrets for:

- PKCS12 bundle password
- Authelia JWT secret
- Authelia session secret
- Authelia storage encryption key

### Onboarding state transitions

The onboarding system enforces a strict state machine that prevents accessing management features before the system is fully provisioned:

```
FRESH → DOMAIN_SET → DNS_READY → PROVISIONING → COMPLETED
```

| State          | Onboarding endpoints | Management endpoints |
| -------------- | -------------------- | -------------------- |
| `FRESH`        | Available            | Return 503           |
| `DOMAIN_SET`   | Available            | Return 503           |
| `DNS_READY`    | Available            | Return 503           |
| `PROVISIONING` | Available            | Return 503           |
| `COMPLETED`    | Return 410 Gone      | Available            |

After onboarding completes, all onboarding endpoints return 410 Gone. This prevents re-running onboarding, which could overwrite configuration or issue duplicate certificates.

### Atomic file writes

Configuration files that are read live by services (like Authelia's `users.yml`) are written atomically: a temporary file in the same directory, `fsync`, then `rename`. The rename is atomic on the same filesystem, so Authelia never reads a partially written file. `/etc/authelia` is setgid `lamaste-authelia`, so the new file belongs to that group; its mode decides whether Authelia may read it (`0640`), also rewrite it (`0660`), or not see it (`0600`). No `sudo` is involved.

### Source files

| File                                                       | Purpose                                                |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `packages/create-lamaste/src/tasks/harden.js`              | Swap, UFW, fail2ban, SSH hardening                     |
| `packages/create-lamaste/src/tasks/mtls.js`                | PKI generation, file permissions                       |
| `packages/create-lamaste/src/tasks/nginx.js`               | mTLS snippet, self-signed cert                         |
| `packages/lamaste-serverd/src/lib/authelia.js`             | bcrypt hashing, atomic writes                          |
| `packages/lamaste-serverd/src/lib/mtls.js`                 | Certificate rotation with rollback                     |
| `packages/lamaste-serverd/src/lib/nginx.js`                | Vhost write-with-rollback pattern                      |
| `packages/lamaste-serverd/src/middleware/mtls.js`          | Request-level mTLS check                               |
| `packages/lamaste-serverd/src/lib/totp.js`                 | Panel 2FA TOTP verification and replay protection      |
| `packages/lamaste-serverd/src/lib/session.js`              | HMAC-SHA256 session cookie signing                     |
| `packages/lamaste-serverd/src/middleware/twofa-session.js` | 2FA session enforcement (after mTLS, before roleGuard) |

## Quick Reference

### Security layers

| Layer                | Technology                           | Blocks                                |
| -------------------- | ------------------------------------ | ------------------------------------- |
| Firewall             | UFW                                  | Connections to non-allowed ports      |
| Intrusion prevention | fail2ban                             | Repeated failed login attempts        |
| SSH hardening        | sshd_config                          | Password-based SSH access             |
| TLS encryption       | Let's Encrypt / self-signed          | Traffic interception and tampering    |
| Admin auth           | mTLS client certificates             | Unauthorized admin access             |
| Admin 2FA (optional) | Built-in TOTP                        | Stolen certificate abuse              |
| Agent-to-agent auth  | Tickets (time-limited, single-use)   | Unauthorized cross-agent access       |
| Tunnel ownership     | Chisel authfile per-agent grants     | One agent hijacking another's host    |
| Reserved ports       | Tunnel port validation               | Publishing internal services          |
| Privileged commands  | No-wildcard sudoers, `lamaste-priv`  | Root code execution via extra flags   |
| Relay authenticity   | Agent verifies `tunnel.<domain>` TLS | Relay impersonation, credential theft |
| App auth             | Authelia TOTP 2FA                    | Unauthorized app access               |
| Service isolation    | `127.0.0.1` binding                  | Direct access to internal services    |
| File permissions     | `chmod 600`                          | Unauthorized secret access            |
| Atomic writes        | `mv` pattern                         | Partial file reads by services        |

### Firewall rules

```bash
# View current UFW rules
sudo ufw status verbose

# Expected output:
# 22/tcp    ALLOW IN    Anywhere
# 80/tcp    ALLOW IN    Anywhere
# 443/tcp   ALLOW IN    Anywhere
# 9292/tcp  ALLOW IN    Anywhere
```

### fail2ban commands

```bash
# Check jail status
sudo fail2ban-client status

# Check specific jail
sudo fail2ban-client status sshd
sudo fail2ban-client status nginx-http-auth

# Unban an IP manually
sudo fail2ban-client set sshd unbanip 1.2.3.4
```

### RAM budget

| Service           | RAM        | Percentage of 512MB |
| ----------------- | ---------- | ------------------- |
| OS baseline       | ~120MB     | 23%                 |
| nginx             | ~15MB      | 3%                  |
| Authelia (bcrypt) | ~25MB      | 5%                  |
| Chisel            | ~20MB      | 4%                  |
| Panel server      | ~30MB      | 6%                  |
| fail2ban          | ~35MB      | 7%                  |
| **Total**         | **~245MB** | **48%**             |
| **Available**     | **~265MB** | **52%**             |

### Password hashing comparison

| Algorithm          | Memory per hash | Time per hash | Suitable for 512MB VPS |
| ------------------ | --------------- | ------------- | ---------------------- |
| bcrypt (cost 12)   | ~4KB            | ~250ms        | Yes                    |
| argon2id (default) | ~93MB           | ~300ms        | No (causes OOM)        |

### Related documentation

- [mTLS](mtls.md) — client certificate authentication in detail
- [Authentication](authentication.md) — Authelia TOTP 2FA in detail
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — nginx as the security gateway
- [Certificates](certificates.md) — TLS certificate management
- [Tunneling](tunneling.md) — secure tunnel architecture
