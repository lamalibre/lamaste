# Onboarding Flow

## Overview

Onboarding is the browser-based first-time setup wizard. It runs after the installer and replaces what would traditionally be SSH configuration. The panel detects "not yet configured" state and presents the wizard instead of the management UI.

## State Machine

```
┌──────────────┐    domain set     ┌──────────────┐    DNS verified    ┌──────────────┐
│   FRESH      │ ──────────────▶   │  DOMAIN_SET  │ ──────────────▶    │  DNS_READY   │
│ (no domain)  │                   │              │                    │              │
└──────────────┘                   └──────────────┘                    └──────┬───────┘
                                                                              │
                                                                    provisioning starts
                                                                              │
┌──────────────┐   all services    ┌──────────────┐                    ┌──────▼───────┐
│  COMPLETED   │ ◀──────────────   │ PROVISIONING │ ◀─────────────     │ PROVISIONING │
│              │     running       │  (running)   │                    │  (started)   │
└──────────────┘                   └──────────────┘                    └──────────────┘
```

State is persisted in `/etc/lamalibre/lamaste/panel.json` under the `onboarding` key.

## Wizard Steps

### Step 1: Welcome & Domain Configuration

**What the user sees:**

```
┌─────────────────────────────────────────────────┐
│  Welcome to Lamaste                          │
│                                                  │
│  Your panel is secured with mTLS.                │
│  Let's configure your domain to unlock the       │
│  full stack: tunnels, auth, and TLS.             │
│                                                  │
│  Domain:  [example.com          ]                │
│  Email:   [admin@example.com    ]                │
│  (for Let's Encrypt notifications)               │
│                                                  │
│                          [Continue →]            │
└─────────────────────────────────────────────────┘
```

**API:** `POST /api/onboarding/domain` → saves domain + email to config

### Step 2: DNS Configuration

**What the user sees:**

```
┌─────────────────────────────────────────────────┐
│  Configure DNS                                   │
│                                                  │
│  Add these DNS records at your registrar:        │
│                                                  │
│  Type   Name              Value                  │
│  ─────  ────────────────  ─────────────────────  │
│  A      example.com       203.0.113.42           │
│  A      *.example.com     203.0.113.42           │
│                                                  │
│  The wildcard record enables subdomains for      │
│  tunneled applications (e.g., app1.example.com)  │
│                                                  │
│           [◀ Back]     [Verify DNS →]            │
└─────────────────────────────────────────────────┘
```

**API:** `POST /api/onboarding/verify-dns` → resolves domain A record, checks it matches droplet IP

**Behavior:**

- Shows spinner during verification
- If DNS doesn't resolve yet: "DNS not propagated yet. This can take a few minutes. Try again."
- If DNS points to wrong IP: "DNS resolves to X.X.X.X but this server is Y.Y.Y.Y"
- If OK: proceeds to step 3

### Step 3: Stack Provisioning

**What the user sees:**

```
┌─────────────────────────────────────────────────┐
│  Installing Stack                                │
│                                                  │
│  ✔ Installing Chisel tunnel server               │
│  ✔ Configuring Authelia (2FA)                    │
│  ● Issuing TLS certificates...                   │
│  ○ Configuring nginx virtual hosts               │
│  ○ Starting services                             │
│  ○ Running verification checks                   │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ $ certbot certonly -d example.com ...       │ │
│  │ Saving debug log to /var/log/letsencrypt... │ │
│  │ Requesting certificate...                   │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  Do not close this page.                         │
└─────────────────────────────────────────────────┘
```

**API:** `POST /api/onboarding/provision` → starts provisioning, streams progress via WebSocket

**Provisioning tasks (in order):**

1. Download and install Chisel binary + systemd service
2. Generate Authelia config + create initial admin user with a random password
3. Issue individual Let's Encrypt certificates for core subdomains (`panel.<domain>`, `auth.<domain>`, `tunnel.<domain>`)
4. Write nginx vhosts for panel, auth, tunnel subdomains
5. Start all services
6. Verify each service is healthy
7. Mark onboarding as COMPLETED

### Step 4: Setup Complete

**What the user sees:**

```
┌─────────────────────────────────────────────────┐
│  ✔ Lamaste is Ready                         │
│                                                  │
│  Your panel is now accessible at:                │
│  • https://panel.example.com (domain)            │
│  • https://203.0.113.42:9292 (direct IP)         │
│                                                  │
│  Authelia Admin Account:                         │
│  • Username: admin                               │
│  • Password: (displayed once, copy it now)       │
│                                                  │
│  Next steps:                                     │
│  1. Add your first tunnel                        │
│  2. Configure the tunnel agent                   │
│                                                  │
│                    [Go to Dashboard →]            │
└─────────────────────────────────────────────────┘
```

**After clicking "Go to Dashboard"**, the app transitions to management mode. The onboarding wizard never appears again (state is COMPLETED).

## API Endpoints

| Method | Path                               | Description                              |
| ------ | ---------------------------------- | ---------------------------------------- |
| GET    | `/api/onboarding/status`           | Returns current onboarding state         |
| POST   | `/api/onboarding/domain`           | Set domain + email                       |
| POST   | `/api/onboarding/verify-dns`       | Check DNS resolution                     |
| POST   | `/api/onboarding/provision`        | Start provisioning (returns immediately) |
| GET    | `/api/onboarding/provision/stream` | WebSocket for provisioning progress      |

## Error Recovery

- **Provisioning fails mid-way:** State tracks which sub-tasks completed. A retry resumes from the failed task, not from scratch.
- **DNS changes after setup:** Domain-based access may break, but IP:9292 always works. User can reconfigure domain through the management UI.
- **Browser closed during provisioning:** Reconnecting shows current progress. Provisioning continues server-side regardless.

## Security During Onboarding

- All onboarding endpoints require mTLS (same as management endpoints)
- The onboarding API is only available when state is not COMPLETED
- Once COMPLETED, onboarding endpoints return 410 Gone
- No sensitive data is transmitted — cert was already delivered via SCP during install
