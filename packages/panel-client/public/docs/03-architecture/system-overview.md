# System Overview

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          INTERNET                                    │
│                                                                      │
│   Admin Browser ─── HTTPS + Client Cert ──▶ panel.example.com      │
│   (mTLS: no cert = TLS handshake rejection, no page loads)          │
│                                                                      │
│   Admin Browser ─── HTTPS + Client Cert ──▶ <droplet-ip>:9292      │
│   (always accessible, fallback if domain is lost)                    │
│                                                                      │
│   End Users ──── HTTPS + TOTP ──▶ app1.example.com                 │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                DigitalOcean Droplet ($4, 512MB)                │  │
│  │                                                                │  │
│  │  nginx (:443 + :9292)                                          │  │
│  │   ├─ <ip>:9292           → mTLS → panel-server (always on)     │  │
│  │   ├─ panel.example.com   → mTLS → panel-server (after setup)   │  │
│  │   ├─ auth.example.com    → Authelia :9091 (after setup)         │  │
│  │   ├─ tunnel.example.com  → Chisel WS :9090 (after setup)       │  │
│  │   └─ *.example.com       → Authelia forward auth → Chisel      │  │
│  │                                                                │  │
│  │  Panel Server (:3100 on 127.0.0.1)         ~30MB               │  │
│  │   ├─ Fastify REST API                                          │  │
│  │   ├─ Serves React UI (static files from panel-client build)    │  │
│  │   ├─ WebSocket → live journald log streaming                   │  │
│  │   ├─ Onboarding routes (first-time setup)                      │  │
│  │   └─ Management routes (tunnels, users, certs, services)       │  │
│  │                                                                │  │
│  │  Authelia (:9091)                          ~25MB               │  │
│  │   └─ TOTP 2FA for proxied applications                         │  │
│  │                                                                │  │
│  │  Chisel Server (:9090 on 127.0.0.1)        ~20MB               │  │
│  │   └─ WebSocket tunnel accepting Mac client connections          │  │
│  │                                                                │  │
│  │  PKI: /etc/portlama/pki/                                    │  │
│  │   ├─ ca.crt / ca.key       (Portlama CA, 10yr validity)     │  │
│  │   ├─ client.crt / .key     (Admin cert, CN=admin, 2yr)        │  │
│  │   ├─ client.p12            (Admin browser import bundle)       │  │
│  │   ├─ revoked.json          (Revoked cert serial numbers)       │  │
│  │   └─ agents/               (Agent certificate storage)         │  │
│  │       ├─ registry.json     (Agent metadata + capabilities)     │  │
│  │       └─ <label>/          (Agent certs, CN=agent:<label>)     │  │
│  │                                                                │  │
│  │  Config: /etc/portlama/                                     │  │
│  │   ├─ panel.json            (panel runtime config + state)       │  │
│  │   ├─ tunnels.json          (active tunnel definitions)          │  │
│  │   ├─ sites.json            (static site definitions)            │  │
│  │   └─ invitations.json      (user invitation records)            │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                              ▲ WebSocket tunnel (wss://)             │
│  ┌───────────────────────────┴────────────────────────────────────┐  │
│  │  Mac Studio (or any machine behind NAT/firewall)               │  │
│  │                                                                │  │
│  │   Portlama Desktop (Tauri v2) — dual mode                      │  │
│  │    ├─ Agent mode: service discovery + tunnel management        │  │
│  │    ├─ Server mode: full admin panel (via portlama-admin-panel) │  │
│  │    ├─ Multi-server registry (~/.portlama/servers.json)         │  │
│  │    ├─ Cloud provisioning (DigitalOcean via portlama-cloud)     │  │
│  │    └─ Credential storage (macOS Keychain / Linux libsecret)   │  │
│  │                                                                │  │
│  │   Chisel client (launchd daemon, auto-reconnect)               │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

## Port Allocation

| Port | Binding                             | Service         | Access                           |
| ---- | ----------------------------------- | --------------- | -------------------------------- |
| 443  | 0.0.0.0                             | nginx           | Public — all HTTPS traffic       |
| 9292 | 0.0.0.0 (nginx) → 127.0.0.1 (panel) | Panel via nginx | Public — mTLS required           |
| 9091 | 127.0.0.1                           | Authelia        | Internal only — proxied by nginx |
| 9090 | 127.0.0.1                           | Chisel server   | Internal only — proxied by nginx |

## RAM Budget (512MB Droplet)

| Component             | RAM        | Notes                                                    |
| --------------------- | ---------- | -------------------------------------------------------- |
| Ubuntu 24.04 baseline | ~120MB     | kernel + systemd + sshd                                  |
| nginx                 | ~15MB      | reverse proxy + TLS termination                          |
| Authelia              | ~25MB      | **must use bcrypt, not argon2id** (argon2id needs ~93MB) |
| Chisel server         | ~20MB      | Go binary, minimal footprint                             |
| Panel (Node.js)       | ~30MB      | Fastify is lightweight                                   |
| Fail2ban              | ~35MB      | SSH + nginx brute force protection                       |
| **Total**             | **~245MB** |                                                          |
| Free + buffers        | ~265MB     | comfortable headroom                                     |
| Swap (safety net)     | 1GB        | catches occasional spikes                                |

## Filesystem Layout

```
/etc/portlama/
├── panel.json              ← panel config (port, paths, state)
├── tunnels.json            ← active tunnel definitions
├── sites.json              ← static site definitions
├── invitations.json        ← user invitation records
└── pki/
    ├── ca.crt              ← Portlama CA certificate
    ├── ca.key              ← CA private key (600 permissions)
    ├── client.crt          ← Admin client certificate
    ├── client.key          ← Client private key
    ├── client.p12          ← PKCS12 browser bundle
    ├── self-signed.pem     ← Self-signed cert for IP:port access
    └── self-signed-key.pem ← Self-signed private key for IP:port access

/etc/nginx/
├── sites-available/
│   ├── portlama-panel-ip   ← IP:9292 mTLS vhost (always present)
│   ├── portlama-panel-domain ← panel.domain.com vhost (after onboarding)
│   ├── portlama-auth       ← auth.domain.com vhost (after onboarding)
│   ├── portlama-tunnel     ← tunnel.domain.com vhost (after onboarding)
│   ├── portlama-app-*      ← per-tunnel app vhosts (dynamic)
│   └── portlama-site-*     ← per-static-site vhosts (dynamic)
├── sites-enabled/             ← symlinks to above
└── snippets/
    └── portlama-mtls.conf  ← shared mTLS directives

/etc/authelia/
├── configuration.yml       ← Authelia config
└── users.yml               ← User database (bcrypt hashes)

/etc/systemd/system/
├── portlama-panel.service
├── chisel.service
└── authelia.service

/opt/portlama/
├── panel-server/           ← deployed panel backend
└── panel-client/           ← built React static files
```

## Security Model

### mTLS (Panel Access)

- nginx uses `ssl_verify_client optional` at the server level. Enforcement is per-location via `if ($ssl_client_verify != SUCCESS) { return 496; }` — public endpoints (`/api/enroll`, `/api/invite`) skip the check.
- No login page — connection is refused at TLS layer for invalid certs on protected locations
- On SSL errors (codes 495/496), nginx serves `cert-help.html` with certificate import instructions
- Panel backend double-checks via `X-SSL-Client-Verify: SUCCESS` header
- Agent certificates have capability-based access (capabilities stored in `agents/registry.json`)
- IP:9292 and panel.domain.com both enforce mTLS identically

### Authelia (Proxied App Access)

- End users authenticate with username + TOTP
- nginx `auth_request` to Authelia before proxying to tunneled apps
- Session cookies managed by Authelia
- bcrypt password hashing (not argon2id — RAM constraint)

### Firewall (UFW)

- Allow: 22 (SSH), 443 (HTTPS), 9292 (Panel)
- Deny: everything else
- Fail2ban watches SSH + nginx auth failures

### Service Isolation

- Chisel binds 127.0.0.1 only — never exposed directly
- Authelia binds 127.0.0.1 only — proxied through nginx
- Panel server binds 127.0.0.1 only — proxied through nginx
- All inter-service communication is localhost
