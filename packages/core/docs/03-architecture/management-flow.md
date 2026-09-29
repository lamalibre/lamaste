# Management Flow

## Overview

After onboarding completes, the panel becomes the full management interface for the Lamaste. All operations that would traditionally require SSH are handled through the UI.

## Management Areas

### Dashboard

- System stats: CPU, RAM, disk usage (polled every 5s)
- Service health: nginx, Chisel, Authelia, Panel (green/red indicators)
- Quick overview: active tunnels count, registered users count, cert expiry warnings

### Tunnels

Full lifecycle management of tunneled applications.

**Add Tunnel Flow:**

```
User fills form:
  Subdomain: [app1]  .example.com
  Local port: [8001]
  Agent:     [laptop]
  Description: [My web app]
           [Add Tunnel]
         │
         ▼
POST /api/tunnels
  ├─ tunnel lock taken (held until the response)
  ├─ agentLabel checked against the agent registry; port not reserved, not in use
  ├─ certbot issues TLS cert for app1.example.com
  ├─ nginx vhost written + symlinked + tested
  ├─ systemctl reload nginx
  ├─ tunnels.json updated
  ├─ chisel-users re-rendered: agent-laptop may bind ^R:127\.0\.0\.1:8001$
  │    (Chisel reloads the file itself — an added grant needs no restart)
  └─ response: { ok: true, tunnel: { ..., agentLabel: "laptop" } }
         │
         ▼
UI updates: new tunnel appears in list with its agent
  └─ within ~30 s laptop's sync timer fetches agent-config and starts forwarding 8001
```

**Remove Tunnel Flow:**

```
DELETE /api/tunnels/:id
  ├─ nginx vhost removed + reload
  ├─ tunnels.json updated
  ├─ chisel-users re-rendered (owner's grant for the port withdrawn)
  ├─ systemctl try-restart chisel (a withdrawn grant must end live sessions)
  └─ response: { ok: true }
         │
         ▼
  within ~30 s the owner's sync timer drops the remote — otherwise Chisel would
  reject the owner's whole session, and all its other tunnels with it
```

**Agent Integration:**

- Every tunnel is carried by one agent (`agentLabel`). The Chisel authfile grants each agent only the ports of the enabled tunnels it carries, so no agent can bind another's port
- Each agent's sync timer (`lamaste-agent sync`, every 30 s) fetches that agent's config via `GET /api/tunnels/agent-config` and converges its Chisel client; `lamaste-agent update` does the same at once and restarts the client
- On macOS, the agent writes a launchd plist; on Linux, a systemd user unit. An agent with no tunnels keeps the client stopped

### Users (Authelia)

CRUD for Authelia users who access tunneled applications.

**Add User:**

- Username + display name + email
- Password (bcrypt hashed, written to users.yml)
- TOTP enrollment: generate secret, show QR code
- `systemctl reload authelia` after users.yml change

**Edit User:**

- Change password, display name, email
- Reset TOTP (generate new secret + QR)

**Delete User:**

- Safety: cannot delete last user
- Removes from users.yml, reloads Authelia

### Certificates

Track and manage all TLS certificates.

**Certificate Types:**

1. **Let's Encrypt** — per-subdomain, auto-renewing via certbot
2. **mTLS CA** — 10yr validity, internal
3. **mTLS Admin** — 2yr validity, full panel access, importable to browser
4. **mTLS Agent** — 2yr validity, capability-based access, issued per agent

**Actions:**

- View all certs with expiry dates
- Force renewal of Let's Encrypt certs
- Rotate mTLS admin cert (generates new p12, shows download + password)
- Generate agent certificates (label, capabilities, download p12, share password)
- List and revoke agent certificates
- Update agent capabilities (without reissuing the certificate)
- Expiry warnings at 30/14/7 days

### Services

Direct control over system services.

**Service Control:**

- Start / Stop / Restart / Reload for: nginx, chisel, authelia, lamalibre-lamaste-serverd
- Status indicator (active/inactive/failed)
- Current uptime

**Live Logs:**

- WebSocket streaming of journald logs per service
- Real-time tail with auto-scroll
- Service selector dropdown

### Invitations

Admin can invite new users via a shareable link. The invitation workflow is separate from direct user creation.

**Create Invitation:**

- Admin provides username, email, optional groups, and expiry (1-30 days, default 7)
- Server generates a 64-byte hex token and returns an invite URL
- Invitation is stored in `invitations.json`

**Accept Invitation (public):**

- Invited user opens the invite URL and sets their password
- Server creates the Authelia user with bcrypt-hashed password
- Invitation is marked as used

**Revoke Invitation:**

- Admin can delete a pending invitation before it is accepted

### Static Sites

Host static websites directly on the Lamaste server, served via nginx.

**Site Types:**

1. **Managed** — subdomain of the configured domain (e.g., `blog.example.com`). Certificate and nginx vhost are provisioned automatically on creation.
2. **Custom** — external domain. Requires DNS verification before certificate issuance and vhost activation.

**Features:**

- SPA mode (single-page application fallback to `index.html`)
- Authelia protection (restrict access to authenticated users)
- Per-site allowed user lists
- File management: upload, list, and delete files via the API
- Max upload size: 50 MB per file

## API Routes

### Tunnel Management

| Method | Path                              | Description                                    | Roles                          |
| ------ | --------------------------------- | ---------------------------------------------- | ------------------------------ |
| GET    | `/api/tunnels`                    | List tunnels (an agent sees only its own)      | admin, agent                   |
| POST   | `/api/tunnels`                    | Add tunnel (triggers nginx + certbot + chisel) | admin, agent (`tunnels:write`) |
| PATCH  | `/api/tunnels/:id`                | Move (admin), access mode, body limit, enable  | admin, agent (`tunnels:write`) |
| DELETE | `/api/tunnels/:id`                | Remove tunnel                                  | admin, agent (`tunnels:write`) |
| GET    | `/api/tunnels/agent-config`       | One agent's Chisel config                      | admin, agent (`tunnels:read`)  |
| GET    | `/api/tunnels/agent-panel-status` | Check agent panel expose status                | admin, agent (`panel:expose`)  |
| POST   | `/api/tunnels/expose-panel`       | Expose agent management panel as subdomain     | admin, agent (`panel:expose`)  |
| DELETE | `/api/tunnels/retract-panel`      | Retract agent management panel                 | admin, agent (`panel:expose`)  |

### User Management

| Method | Path                              | Description                             |
| ------ | --------------------------------- | --------------------------------------- |
| GET    | `/api/users`                      | List Authelia users                     |
| POST   | `/api/users`                      | Create user (bcrypt hash + TOTP secret) |
| PUT    | `/api/users/:username`            | Update user                             |
| DELETE | `/api/users/:username`            | Delete user (not last)                  |
| POST   | `/api/users/:username/reset-totp` | Generate new TOTP secret                |

### Certificate Management

| Method | Path                                    | Description                          |
| ------ | --------------------------------------- | ------------------------------------ |
| GET    | `/api/certs`                            | List all certs with expiry           |
| GET    | `/api/certs/auto-renew-status`          | Certbot auto-renewal timer status    |
| POST   | `/api/certs/:domain/renew`              | Force certbot renewal                |
| POST   | `/api/certs/mtls/rotate`                | Generate new admin client cert + p12 |
| GET    | `/api/certs/mtls/download`              | Download admin client.p12            |
| POST   | `/api/certs/agent`                      | Generate agent-scoped certificate    |
| GET    | `/api/certs/agent`                      | List agent certificates              |
| GET    | `/api/certs/agent/:label/download`      | Download agent .p12                  |
| PATCH  | `/api/certs/agent/:label/capabilities`  | Update agent capabilities            |
| PATCH  | `/api/certs/agent/:label/allowed-sites` | Update agent site access             |
| DELETE | `/api/certs/agent/:label`               | Revoke agent certificate             |

### Service Management

| Method | Path                          | Description                       | Roles                           |
| ------ | ----------------------------- | --------------------------------- | ------------------------------- |
| GET    | `/api/services`               | List service statuses             | admin, agent (`services:read`)  |
| POST   | `/api/services/:name/:action` | start/stop/restart/reload service | admin, agent (`services:write`) |
| GET    | `/api/services/:name/logs`    | WebSocket log stream              | admin only                      |

### Invitation Management

| Method | Path                   | Description                            | Roles |
| ------ | ---------------------- | -------------------------------------- | ----- |
| GET    | `/api/invitations`     | List all invitations (tokens redacted) | admin |
| POST   | `/api/invitations`     | Create a new invitation                | admin |
| DELETE | `/api/invitations/:id` | Revoke an invitation                   | admin |

**Public invite routes** (no mTLS required):

| Method | Path                        | Description                        |
| ------ | --------------------------- | ---------------------------------- |
| GET    | `/api/invite/:token`        | Get invitation details             |
| POST   | `/api/invite/:token/accept` | Accept invitation and set password |

### Static Sites Management

| Method | Path                        | Description                       | Roles                        |
| ------ | --------------------------- | --------------------------------- | ---------------------------- |
| GET    | `/api/sites`                | List all static sites             | admin, agent (`sites:read`)  |
| POST   | `/api/sites`                | Create a static site              | admin                        |
| DELETE | `/api/sites/:id`            | Delete a static site              | admin                        |
| PATCH  | `/api/sites/:id`            | Update site settings              | admin                        |
| POST   | `/api/sites/:id/verify-dns` | Verify DNS for custom domain site | admin                        |
| GET    | `/api/sites/:id/files`      | List files in site directory      | admin, agent (`sites:read`)  |
| POST   | `/api/sites/:id/files`      | Upload files (multipart)          | admin, agent (`sites:write`) |
| DELETE | `/api/sites/:id/files`      | Delete a file from site directory | admin, agent (`sites:write`) |

### System

| Method | Path                | Description          | Roles                        |
| ------ | ------------------- | -------------------- | ---------------------------- |
| GET    | `/api/system/stats` | CPU, RAM, disk usage | admin, agent (`system:read`) |
| GET    | `/api/health`       | Panel health check   | admin, agent (all)           |

## Sudoers Rules

The panel runs as a non-root user (`lamaste`) with specific sudo permissions, written to `/etc/sudoers.d/lamaste` by `generateSudoersContent()` in `packages/provisioners/server/src/lib/service-config.js`. There is no blanket `certbot *` or `systemctl *`. A sudoers `*` matches spaces too, so a rule like `certbot renew --cert-name * --non-interactive` would also accept `--deploy-hook <command>` — root code execution. Certbot and the Let's Encrypt `openssl` reads therefore go through root-owned wrappers in `/usr/local/sbin/` that validate every argument and run the program with a fixed argument vector. An excerpt:

```sudoers
# --- systemctl: managed services (bare service names, no wildcards) ---
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl try-restart chisel
# fail-closed startup reconciliation disables chisel, and re-enables it on success
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl disable chisel
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl reload authelia
lamaste ALL=(root) NOPASSWD: /usr/bin/systemctl daemon-reload
# ... start/stop/restart/enable for nginx, chisel, authelia, certbot.timer, lamalibre-lamaste-serverd

# --- nginx config test ---
lamaste ALL=(root) NOPASSWD: /usr/sbin/nginx -t

# --- Let's Encrypt: root-owned wrappers with fixed argument vectors ---
#   lamaste-certbot issue <email> <cert-name> <domain>...   certbot certonly --nginx
#   lamaste-certbot renew <cert-name> [force]               never with certbot's random delay
#   lamaste-certbot renew-all | list
#   lamaste-cert-info <lineage> enddate|checkend|san        read-only openssl queries
lamaste ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-certbot
lamaste ALL=(root) NOPASSWD: /usr/local/sbin/lamaste-cert-info

# ... plus scoped mv/cp/rm/chmod/chown rules for vhosts, Authelia config and
#     the PKI helpers (lamaste-sign-csr, lamaste-pki-rename)
# The chisel-users authfile needs no rule: the panel writes it itself, 0640,
# group lamaste-chisel (the group chisel runs as; the lamaste user is a member).
```

The wrappers accept only lowercase DNS hostnames (no wildcards or path characters, at most 100 per certificate) and a syntactically valid email address. Renewals the panel triggers pass `--no-random-sleep-on-renew`, because certbot otherwise sleeps up to about 8 minutes before a non-interactive renewal (a delay meant for `certbot.timer`) while an operator waits.

Redeploying the panel (`npx @lamalibre/create-lamaste` on an existing install) rewrites this file and reinstalls the wrappers, so upgrades pick up new rules.

## File Operation Safety

- **YAML writes** (users.yml): write to temp file, then atomic rename
- **nginx changes**: always run `nginx -t` before reload; rollback on failure
- **Authelia changes**: reload service after users.yml update
- **Chisel changes**: tunnel state is written first, then the authfile is re-rendered from it (per-agent port grants) and the service restarted
- **Last-user protection**: never delete the last Authelia user
- **State persistence**: tunnels.json updated atomically after each tunnel operation
