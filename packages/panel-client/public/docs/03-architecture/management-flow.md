# Management Flow

## Overview

After onboarding completes, the panel becomes the full management interface for the Portlama. All operations that would traditionally require SSH are handled through the UI.

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
  Description: [My web app]
           [Add Tunnel]
         │
         ▼
POST /api/tunnels
  ├─ certbot issues TLS cert for app1.example.com
  ├─ nginx vhost written + symlinked + tested
  ├─ systemctl reload nginx
  ├─ chisel.service rewritten with updated -R flags
  ├─ systemctl restart chisel
  ├─ tunnels.json updated
  └─ response: { ok: true, fqdn: "app1.example.com" }
         │
         ▼
UI updates: new tunnel appears in list
  └─ Download Mac plist button (regenerated with all tunnel ports)
```

**Remove Tunnel Flow:**

```
DELETE /api/tunnels/:id
  ├─ nginx vhost removed + reload
  ├─ chisel.service updated (port removed)
  ├─ systemctl restart chisel
  ├─ tunnels.json updated
  └─ response: { ok: true }
```

**Mac Agent Integration:**

- "Download Mac Agent Config" button generates a launchd plist
- Plist includes all current tunnel ports
- Instructions shown for installing on Mac:
  ```
  cp portlama.plist ~/Library/LaunchAgents/
  launchctl load ~/Library/LaunchAgents/portlama.plist
  ```

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
4. **mTLS Agent** — 2yr validity, capability-based access, issued per Mac agent

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

- Start / Stop / Restart / Reload for: nginx, chisel, authelia, portlama-panel
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

Host static websites directly on the Portlama server, served via nginx.

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

| Method | Path                     | Description                                    | Roles |
| ------ | ------------------------ | ---------------------------------------------- | ----- |
| GET    | `/api/tunnels`           | List all tunnels                               | admin, agent (`tunnels:read`) |
| POST   | `/api/tunnels`           | Add tunnel (triggers nginx + certbot + chisel) | admin, agent (`tunnels:write`) |
| PATCH  | `/api/tunnels/:id`       | Toggle tunnel enabled/disabled                 | admin, agent (`tunnels:write`) |
| DELETE | `/api/tunnels/:id`       | Remove tunnel                                  | admin, agent (`tunnels:write`) |
| GET    | `/api/tunnels/mac-plist` | Download Mac launchd plist                     | admin, agent (`tunnels:read`) |

### User Management

| Method | Path                              | Description                             |
| ------ | --------------------------------- | --------------------------------------- |
| GET    | `/api/users`                      | List Authelia users                     |
| POST   | `/api/users`                      | Create user (bcrypt hash + TOTP secret) |
| PUT    | `/api/users/:username`            | Update user                             |
| DELETE | `/api/users/:username`            | Delete user (not last)                  |
| POST   | `/api/users/:username/reset-totp` | Generate new TOTP secret                |

### Certificate Management

| Method | Path                              | Description                          |
| ------ | --------------------------------- | ------------------------------------ |
| GET    | `/api/certs`                      | List all certs with expiry           |
| GET    | `/api/certs/auto-renew-status`    | Certbot auto-renewal timer status    |
| POST   | `/api/certs/:domain/renew`        | Force certbot renewal                |
| POST   | `/api/certs/mtls/rotate`          | Generate new admin client cert + p12 |
| GET    | `/api/certs/mtls/download`        | Download admin client.p12            |
| POST   | `/api/certs/agent`                | Generate agent-scoped certificate    |
| GET    | `/api/certs/agent`                | List agent certificates              |
| GET    | `/api/certs/agent/:label/download`| Download agent .p12                  |
| PATCH  | `/api/certs/agent/:label/capabilities` | Update agent capabilities       |
| PATCH  | `/api/certs/agent/:label/allowed-sites` | Update agent site access      |
| DELETE | `/api/certs/agent/:label`         | Revoke agent certificate             |

### Service Management

| Method | Path                          | Description                | Roles |
| ------ | ----------------------------- | -------------------------- | ----- |
| GET    | `/api/services`               | List service statuses      | admin, agent (`services:read`) |
| POST   | `/api/services/:name/:action` | start/stop/restart/reload service | admin, agent (`services:write`) |
| GET    | `/api/services/:name/logs`    | WebSocket log stream       | admin only |

### Invitation Management

| Method | Path                     | Description                           | Roles |
| ------ | ------------------------ | ------------------------------------- | ----- |
| GET    | `/api/invitations`       | List all invitations (tokens redacted)| admin |
| POST   | `/api/invitations`       | Create a new invitation               | admin |
| DELETE | `/api/invitations/:id`   | Revoke an invitation                  | admin |

**Public invite routes** (no mTLS required):

| Method | Path                          | Description                          |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/api/invite/:token`          | Get invitation details               |
| POST   | `/api/invite/:token/accept`   | Accept invitation and set password   |

### Static Sites Management

| Method | Path                          | Description                          | Roles |
| ------ | ----------------------------- | ------------------------------------ | ----- |
| GET    | `/api/sites`                  | List all static sites                | admin, agent (`sites:read`) |
| POST   | `/api/sites`                  | Create a static site                 | admin |
| DELETE | `/api/sites/:id`              | Delete a static site                 | admin |
| PATCH  | `/api/sites/:id`              | Update site settings                 | admin |
| POST   | `/api/sites/:id/verify-dns`   | Verify DNS for custom domain site    | admin |
| GET    | `/api/sites/:id/files`        | List files in site directory         | admin, agent (`sites:read`) |
| POST   | `/api/sites/:id/files`        | Upload files (multipart)             | admin, agent (`sites:write`) |
| DELETE | `/api/sites/:id/files`        | Delete a file from site directory    | admin, agent (`sites:write`) |

### System

| Method | Path                | Description          | Roles |
| ------ | ------------------- | -------------------- | ----- |
| GET    | `/api/system/stats` | CPU, RAM, disk usage | admin, agent (`system:read`) |
| GET    | `/api/health`       | Panel health check   | admin, agent (all) |

## Sudoers Rules

The panel runs as a non-root user (`portlama`) with specific sudo permissions:

```sudoers
portlama ALL=(ALL) NOPASSWD: /bin/systemctl start nginx
portlama ALL=(ALL) NOPASSWD: /bin/systemctl stop nginx
portlama ALL=(ALL) NOPASSWD: /bin/systemctl restart nginx
portlama ALL=(ALL) NOPASSWD: /bin/systemctl reload nginx
portlama ALL=(ALL) NOPASSWD: /bin/systemctl start chisel
portlama ALL=(ALL) NOPASSWD: /bin/systemctl stop chisel
portlama ALL=(ALL) NOPASSWD: /bin/systemctl restart chisel
portlama ALL=(ALL) NOPASSWD: /bin/systemctl start authelia
portlama ALL=(ALL) NOPASSWD: /bin/systemctl stop authelia
portlama ALL=(ALL) NOPASSWD: /bin/systemctl restart authelia
portlama ALL=(ALL) NOPASSWD: /bin/systemctl reload authelia
portlama ALL=(ALL) NOPASSWD: /usr/sbin/nginx -t
portlama ALL=(ALL) NOPASSWD: /usr/bin/certbot *
```

## File Operation Safety

- **YAML writes** (users.yml): write to temp file, then atomic rename
- **nginx changes**: always run `nginx -t` before reload; rollback on failure
- **Authelia changes**: reload service after users.yml update
- **Chisel changes**: restart service after port list update
- **Last-user protection**: never delete the last Authelia user
- **State persistence**: tunnels.json updated atomically after each tunnel operation
