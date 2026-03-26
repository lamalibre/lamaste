# Panel Server Architecture

> The panel-server is a Fastify 5 REST API that manages all Portlama operations at runtime, from onboarding through tunnel management, running as a non-root systemd service on the VPS.

## In Plain English

The panel server is the brain of Portlama. It runs on the VPS as a background service and handles every management operation: setting up your domain, creating tunnels, managing users, renewing certificates, and monitoring services. When you interact with the Portlama admin panel in your browser, every action goes through this server.

It deliberately does not face the internet directly. nginx sits in front of it, handling TLS, client certificate verification, and domain routing. The panel server trusts that if a request reaches it, nginx has already verified the caller's identity.

## Overview

```
nginx (public)
  │
  ├── X-SSL-Client-Verify: SUCCESS
  ├── X-SSL-Client-DN: CN=admin,O=Portlama
  │
  ▼
Fastify Server (127.0.0.1:3100)
  │
  ├── Plugins
  │   ├── @fastify/cors
  │   ├── @fastify/cookie
  │   ├── @fastify/multipart (50 MB limit)
  │   ├── @fastify/websocket
  │   └── @fastify/static (SPA serving)
  │
  ├── Middleware (onRequest hooks)
  │   ├── mtls.js          → Verify mTLS, check revocation, parse role
  │   ├── twofa-session.js → Verify 2FA session cookie (after mTLS, before roleGuard)
  │   ├── role-guard.js    → Role-based access control (admin vs agent)
  │   └── onboarding-guard → Route access by onboarding state
  │
  ├── Routes
  │   ├── /api/health                    → Always accessible
  │   ├── /api/invite/*                  → Public (no mTLS required)
  │   ├── /api/onboarding/*             → Guarded: 410 after COMPLETED
  │   └── /api/* (management)           → Guarded: 503 before COMPLETED
  │
  ├── Error Handler
  │   └── errors.js        → Zod errors → 400, AppError → status, else → 500
  │
  └── SPA Fallback
      └── Non-/api 404s → serve index.html
```

## Server Entry (`src/index.js`)

The server entry point follows a straightforward initialization sequence:

```
1. loadConfig()                    → Read and validate /etc/portlama/panel.json
2. Load plugin capabilities        → getPluginCapabilities() → setPluginCapabilities()
3. Load ticket scope capabilities  → loadTicketScopeCapabilities()
4. Register Fastify plugins        → CORS, cookie, multipart, websocket, static files
5. Register publicContext           → Error handler + invite + enrollment routes (no mTLS)
6. Register protectedContext        → mTLS + 2FA session + role-guard + error handler + health/onboarding/management/plugin routes
7. Set 404 handler                 → SPA fallback for non-API routes
8. Listen on 127.0.0.1:3100
9. Start instance liveness interval → checkInstanceLiveness() every 60s
10. Register shutdown handlers       → SIGTERM, SIGINT
```

**Route registration contexts:** The server separates routes into two Fastify encapsulated contexts:

- **`publicContext`** — registers invite routes (`/api/invite/*`) and enrollment routes (`/api/enroll`) without mTLS middleware, allowing unauthenticated users to accept invitations and agents to enroll with one-time tokens
- **`protectedContext`** — registers mTLS middleware, 2FA session guard, role-guard, and all other routes (health, onboarding, management, plugins), requiring a valid client certificate

**Static file serving** resolves the panel-client `dist/` directory through a fallback chain:

- `config.staticDir` if set in `panel.json` (production: `/opt/portlama/panel-client/dist`)
- `../../panel-client/dist` relative to server source (development)
- `config.dataDir/panel-client/dist` as final fallback

**CORS origin** includes the IP-based URL (`https://<ip>:9292`) always, plus the domain-based panel URL (`https://panel.<domain>`) when a domain is configured. This prevents cross-origin requests from unrelated domains.

## Middleware Pipeline

### mTLS Verification (`middleware/mtls.js`)

Registered as a global `onRequest` hook that runs on every request before route handlers.

**Production behavior:**

- Reads the `X-SSL-Client-Verify` header set by nginx
- If the value is not `SUCCESS`, returns `403 { error: "mTLS certificate required" }`
- Checks the certificate serial (`X-SSL-Client-Serial` header) against `revoked.json` via `isRevoked()` — if revoked, returns `403 { error: "Certificate has been revoked" }`
- Parses `X-SSL-Client-DN` header to extract the CN field
- If CN starts with `agent:`, sets `request.certRole = 'agent'`, `request.certLabel` to the agent label, and loads `request.certCapabilities` from the agent registry
- Otherwise, sets `request.certRole = 'admin'`

**Development behavior:**

- When `NODE_ENV` is `development` (or unset), the check is bypassed
- Logs a warning on the first bypassed request
- Sets `request.certRole = 'admin'` by default

**Health check bypass:**

- `GET /api/health` always bypasses mTLS verification (used by systemd, load balancers, and internal provisioning checks)

In production, nginx uses `ssl_verify_client optional` at the server level, with per-location enforcement via `if ($ssl_client_verify != SUCCESS) { return 496; }` on protected locations. Public endpoints (`/api/enroll`, `/api/invite`) skip this check. The server middleware is a defense-in-depth measure that also performs revocation checking and role extraction.

### 2FA Session Guard (`middleware/twofa-session.js`)

Registered as a Fastify plugin in the protected context, runs after mTLS verification and before the role guard. When built-in 2FA is enabled (`panel2fa.enabled` in `panel.json`), this middleware enforces that admin requests carry a valid session cookie.

**Behavior:**

- If 2FA is not enabled, the middleware is a no-op — all requests pass through
- Agent requests (`request.certRole === 'agent'`) always bypass the 2FA check — agents authenticate via mTLS only
- Health, 2FA status, and 2FA verification endpoints are exempt (`/api/health`, `/api/settings/2fa`, `/api/settings/2fa/verify`)
- If an admin request lacks a valid session cookie, returns `401 { error: "2fa_required" }`
- Session cookies are issued by the `POST /api/settings/2fa/verify` endpoint after a valid TOTP code is presented
- Sessions are managed by `lib/session.js` using signed cookies (secret from `sessionSecret` in `panel.json`)

The Fastify constructor sets `trustProxy: 1` so that exactly one proxy hop (nginx) is trusted for `X-Forwarded-*` headers. This is more secure than `trustProxy: true` (which trusts all hops) and matches the documented deployment model where nginx is the sole reverse proxy.

### Onboarding Guard (`middleware/onboarding-guard.js`)

Two hook factories that enforce route access based on `config.onboarding.status`:

**`onboardingOnly()`** — applied to `/api/onboarding/*` (except `/status`):

- If status is `COMPLETED`, returns `410 Gone`
- Otherwise, allows the request

**`managementOnly()`** — applied to all `/api/*` management routes:

- If status is not `COMPLETED`, returns `503 { error: "Onboarding not complete", onboardingStatus }`
- Otherwise, allows the request

The `/api/onboarding/status` endpoint is deliberately unguarded — the panel client calls it on every page load to determine which UI mode to display.

### Role Guard (`middleware/role-guard.js`)

Registered as a Fastify plugin that decorates the server with a `requireRole(allowedRoles, opts)` function. This returns a `preHandler` hook used on individual routes to enforce role-based access control.

**Usage patterns:**

- `fastify.requireRole(['admin'])` — admin-only routes
- `fastify.requireRole(['admin', 'agent'])` — admin or any agent
- `fastify.requireRole(['admin', 'agent'], { capability: 'tunnels:write' })` — admin or agents with a specific capability

**Behavior:**

- Admin role always passes without capability checks
- If the request's `certRole` is not in the allowed list, returns `403 { error: "Insufficient certificate scope" }`
- If a capability is required and the agent lacks it, returns `403 { error: "Insufficient certificate capability" }`

### Error Handler (`middleware/errors.js`)

Registered as the global Fastify error handler. Normalizes all errors into a consistent response format:

```json
{
  "error": "Human-readable error summary",
  "details": {}
}
```

Error type resolution order:

| Error Type             | Detection                                                    | Response                                 |
| ---------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Zod validation         | `error.name === 'ZodError'` or `Array.isArray(error.issues)` | `400` with issue paths and messages      |
| Operational (AppError) | `error.isOperational === true`                               | Custom `statusCode` from error           |
| Fastify built-in       | `error.statusCode` in 400-499                                | Pass through status and message          |
| Unexpected             | Everything else                                              | `500 { error: "Internal server error" }` |

In development mode, unexpected errors include `details.message` and `details.stack`. In production, no internal details are leaked.

### AppError (`lib/app-error.js`)

A lightweight error class for operational errors (expected failures):

```javascript
export class AppError extends Error {
  constructor(message, statusCode, details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}
```

Used in library code to signal expected error conditions (e.g., "DNS is not pointing to this server", "Cannot delete the last user").

## Route Structure

### Registration Hierarchy

```
publicContext (no mTLS):
  server.register(inviteRoutes, { prefix: '/api/invite' })
    ├── GET  /api/invite/:token           ← Get invitation details
    └── POST /api/invite/:token/accept    ← Accept invitation, set password
  server.register(enrollmentRoutes, { prefix: '/api/enroll' })
    └── POST /api/enroll                  ← Enroll agent with token + CSR

protectedContext (mTLS + role-guard):
  server.register(healthRoutes, { prefix: '/api' })
    └── GET /api/health

  server.register(onboardingRoutes, { prefix: '/api/onboarding' })
    ├── GET  /api/onboarding/status         ← No guard
    └── [guarded: onboardingOnly()]
        ├── POST /api/onboarding/domain
        ├── POST /api/onboarding/verify-dns
        ├── POST /api/onboarding/provision
        └── WS   /api/onboarding/provision/stream

  server.register(managementRoutes, { prefix: '/api' })
    └── [guarded: managementOnly()]
        ├── GET    /api/tunnels
        ├── POST   /api/tunnels
        ├── PATCH  /api/tunnels/:id
        ├── DELETE  /api/tunnels/:id
        ├── GET    /api/tunnels/mac-plist
        ├── GET    /api/sites
        ├── POST   /api/sites
        ├── PATCH  /api/sites/:id
        ├── DELETE  /api/sites/:id
        ├── POST   /api/sites/:id/verify-dns
        ├── GET    /api/sites/:id/files
        ├── POST   /api/sites/:id/files
        ├── DELETE  /api/sites/:id/files
        ├── GET    /api/system/stats
        ├── GET    /api/services
        ├── POST   /api/services/:name/:action
        ├── WS     /api/services/:name/logs
        ├── GET    /api/users
        ├── POST   /api/users
        ├── PUT    /api/users/:username
        ├── DELETE  /api/users/:username
        ├── POST   /api/users/:username/reset-totp
        ├── GET    /api/certs
        ├── GET    /api/certs/auto-renew-status
        ├── POST   /api/certs/:domain/renew
        ├── POST   /api/certs/mtls/rotate
        ├── GET    /api/certs/mtls/download
        ├── POST   /api/certs/admin/upgrade-to-hardware-bound
        ├── GET    /api/certs/admin/auth-mode
        ├── POST   /api/certs/agent
        ├── POST   /api/certs/agent/enroll
        ├── GET    /api/certs/agent
        ├── GET    /api/certs/agent/:label/download
        ├── DELETE /api/certs/agent/:label
        ├── PATCH  /api/certs/agent/:label/capabilities
        ├── PATCH  /api/certs/agent/:label/allowed-sites
        ├── GET    /api/invitations
        ├── POST   /api/invitations
        ├── DELETE  /api/invitations/:id
        ├── GET    /api/plugins
        ├── GET    /api/plugins/:name
        ├── POST   /api/plugins/install
        ├── POST   /api/plugins/:name/enable
        ├── POST   /api/plugins/:name/disable
        ├── DELETE /api/plugins/:name
        ├── GET    /api/plugins/push-install/config
        ├── PATCH  /api/plugins/push-install/config
        ├── GET    /api/plugins/push-install/policies
        ├── POST   /api/plugins/push-install/policies
        ├── PATCH  /api/plugins/push-install/policies/:id
        ├── DELETE /api/plugins/push-install/policies/:id
        ├── POST   /api/plugins/push-install/enable/:label
        ├── DELETE /api/plugins/push-install/enable/:label
        ├── POST   /api/plugins/push-install/:label
        ├── GET    /api/plugins/push-install/sessions
        ├── GET    /api/plugins/push-install/agent-status
        ├── GET    /api/settings/2fa
        ├── POST   /api/settings/2fa/setup
        ├── POST   /api/settings/2fa/confirm
        ├── POST   /api/settings/2fa/verify
        ├── POST   /api/settings/2fa/disable
        ├── POST   /api/tickets/scopes
        ├── GET    /api/tickets/scopes
        ├── DELETE /api/tickets/scopes/:name
        ├── POST   /api/tickets/instances
        ├── DELETE /api/tickets/instances/:instanceId
        ├── POST   /api/tickets/instances/:instanceId/heartbeat
        ├── POST   /api/tickets/assignments
        ├── DELETE /api/tickets/assignments/:agentLabel/:instanceScope
        ├── GET    /api/tickets/assignments
        ├── POST   /api/tickets
        ├── GET    /api/tickets/inbox
        ├── POST   /api/tickets/validate
        ├── GET    /api/tickets
        ├── DELETE /api/tickets/:ticketId
        ├── POST   /api/tickets/sessions
        ├── POST   /api/tickets/sessions/:sessionId/heartbeat
        ├── PATCH  /api/tickets/sessions/:sessionId
        ├── DELETE /api/tickets/sessions/:sessionId
        └── GET    /api/tickets/sessions

  server.register(pluginRouter, { prefix: '/api' })
    └── [guarded: managementOnly() + per-plugin admin-only auth scope]
        ├── /api/<pluginName>/*              ← Dynamic plugin server routes
        └── GET /api/<pluginName>/panel.js   ← Plugin panel bundle
```

### Onboarding Routes

The onboarding module (`routes/onboarding/index.js`) uses a nested registration pattern to apply the guard:

```javascript
export default async function onboardingRoutes(fastify, _opts) {
  // Status is always accessible — no guard
  await fastify.register(statusRoute);

  // All other routes are guarded: 410 after onboarding completes
  await fastify.register(async function guarded(app) {
    app.addHook('onRequest', onboardingOnly());
    await app.register(domainRoute);
    await app.register(dnsRoute);
    await app.register(provisionRoute);
  });
}
```

**Provisioning** is the most complex onboarding route. It uses a background task pattern:

1. `POST /provision` validates the onboarding state, starts the provisioning function asynchronously, and returns `202 Accepted`
2. `WS /provision/stream` connects clients to a real-time progress feed via an `EventEmitter`
3. The provisioning function emits progress events as it installs Chisel, Authelia, issues certificates, configures nginx, and verifies services
4. On completion, it updates `panel.json` to `COMPLETED` and emits final credentials

### Management Routes

The management module (`routes/management.js`) applies `managementOnly()` at the top level, guarding all child routes:

```javascript
export default async function managementRoutes(fastify, _opts) {
  fastify.addHook('onRequest', managementOnly());

  await fastify.register(tunnelRoutes);
  await fastify.register(sitesRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(servicesRoutes);
  await fastify.register(logsRoutes);
  await fastify.register(usersRoutes);
  await fastify.register(certsRoutes);
  await fastify.register(invitationRoutes);
  await fastify.register(pluginRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(ticketRoutes);
}
```

## Library Layer

Routes handle HTTP concerns only — request parsing, response formatting, status codes. All business logic lives in `src/lib/` modules.

### config.js — Configuration Management

- Loads and validates `panel.json` at startup via Zod schema
- Caches parsed config in a module-level variable
- `getConfig()` returns a `structuredClone` (callers cannot mutate the cache)
- `updateConfig(patch)` performs deep merge, re-validates, and writes atomically (temp → rename)

Config schema:

```
{
  ip: string,                                      // Required
  domain: string | null,                           // Set during onboarding
  email: string (email) | null,                    // Set during onboarding
  dataDir: string,                                 // /etc/portlama
  staticDir?: string,                              // /opt/portlama/panel-client/dist
  maxSiteSize?: number,                            // Default: 500 MB
  onboarding: {
    status: "FRESH" | "DOMAIN_SET" | "DNS_READY" | "PROVISIONING" | "COMPLETED"
  },
  panel2fa?: {
    enabled: boolean,                              // Default: false
    secret: string | null,                         // TOTP secret (base32)
    setupComplete: boolean                         // Default: false
  },
  sessionSecret?: string                           // HMAC key for signed session cookies
}
```

Config path resolution:

1. `PORTLAMA_CONFIG` environment variable (if set)
2. `dev/panel.json` relative to package root (if `NODE_ENV` is `development`)
3. `/etc/portlama/panel.json` (production default)

### state.js — Tunnel and Site State

Provides atomic read/write for `tunnels.json` and `sites.json`:

```
readTunnels()  → Array<Tunnel>     (returns [] if file missing)
writeTunnels() → void              (atomic: tmp → fsync → rename)
readSites()    → Array<Site>       (returns [] if file missing)
writeSites()   → void              (atomic: tmp → fsync → rename)
```

The atomic write pattern:

1. `writeFile` to `<path>.tmp`
2. Open the temp file and call `fd.sync()` to flush to disk
3. `rename` temp to final path (atomic on POSIX filesystems)

This ensures that a crash during write never corrupts the state file. The worst case is losing the latest write, leaving the previous state intact.

### nginx.js — Vhost Management

Provides functions for writing, enabling, disabling, testing, and reloading nginx configurations. The core pattern is **write-with-rollback**:

1. Backup existing vhost (if any) to `.bak`
2. Write new vhost via temp file + `sudo mv`
3. Create symlink in `sites-enabled`
4. Run `nginx -t` to validate
5. On success: `systemctl reload nginx`, delete backup
6. On failure: restore backup, remove new file

Additional functions `disableIpVhost()` and `enableIpVhost()` manage the IP-based panel vhost. When built-in 2FA is enabled, the IP vhost is disabled to prevent bypassing the domain-based 2FA session; disabling 2FA re-enables it.

See [nginx-configuration.md](./nginx-configuration.md) for detailed coverage.

### chisel.js — Tunnel Server Management

- Downloads Chisel binary from GitHub releases (`linux_amd64` asset)
- Writes systemd service unit (binds `127.0.0.1:9090`, `--reverse` mode)
- Manages service lifecycle (start, stop, restart)
- Serializes concurrent config updates via a promise-chain mutex

### authelia.js — Authentication Management

- Downloads Authelia binary from GitHub releases (`linux-amd64` tarball)
- Writes YAML configuration (bcrypt cost 12, file-based users, TOTP, session cookies)
- User CRUD: creates users with bcrypt-hashed passwords, reads/writes `users.yml`
- TOTP generation: `crypto.randomBytes(20)` → base32-encoded secret → `otpauth://` URI (parameterized `generateTotpSecret(username, { issuer })` — reused by panel 2FA via `lib/totp.js`)
- `base32Decode()` utility for decoding base32 TOTP secrets into raw bytes
- Manages service lifecycle

### certbot.js — Certificate Management

- Issues Let's Encrypt certificates using the nginx plugin (`certbot certonly --nginx`)
- Handles rate limit, DNS, and server block errors with specific error messages
- Supports wildcard certificate detection (skips individual issuance if wildcard covers the FQDN)
- Lists all managed certificates by parsing `certbot certificates` output
- Sets up auto-renewal via the `certbot.timer` systemd unit

### mtls.js — mTLS Certificate Operations

- Reads certificate expiry dates via `openssl x509 -enddate`
- Rotates admin client certificates: generate new key → CSR → sign with CA → PKCS12 → backup old → swap
- Generates agent-scoped client certificates with capability-based access
- Manages the agent registry: create, list, revoke, update capabilities and allowed sites
- Provides the PKCS12 download path for the certs API
- Manages dynamic capability sets: base capabilities + plugin capabilities + ticket scope capabilities via `getValidCapabilities()`
- Base capabilities: `tunnels:read`, `tunnels:write`, `services:read`, `services:write`, `system:read`, `sites:read`, `sites:write`

### tickets.js — Ticket System

Agent-to-agent authorization with scopes, instances, tickets, and sessions. Provides:

- **Scope registry** — register/unregister capability sets with transport configuration
- **Instance management** — register, heartbeat, deregister with liveness tracking (active → stale → dead)
- **Assignment management** — link agents to instances (admin-only)
- **Ticket operations** — request, validate (HMAC-SHA256 + `timingSafeEqual` with per-process random key), revoke with rate limiting (10/agent/min) and hard caps (200 instances, 1000 tickets, 500 sessions)
- **Session management** — create from validated ticket (server-generated session IDs via `crypto.randomBytes(16)`, server-enforced timestamps), heartbeat with multi-layer re-validation, status updates
- **Host validation** — `transport.direct.host` rejects private/reserved IPs and cloud metadata endpoints (SSRF prevention)
- **Periodic cleanup** — stale/dead instances, expired tickets, dead sessions
- **Concurrency** — promise-chain mutex with atomic file writes (temp → fsync → rename)

Client SDK: `@lamalibre/portlama-tickets` (TypeScript, undici) provides `TicketClient`, `TicketInstanceManager` (source side), and `TicketSessionManager` (target side) for plugin integration.

State files: `/etc/portlama/ticket-scopes.json` (scopes, instances, assignments) and `/etc/portlama/tickets.json` (tickets, sessions).

### services.js — Service Management

- Allowlisted services: `nginx`, `chisel`, `authelia`, `portlama-panel`
- Allowlisted actions: `start`, `stop`, `restart`, `reload`
- Safety check: cannot stop `portlama-panel` from the UI (would terminate the session)
- Queries status and uptime via `systemctl is-active` and `systemctl show --property=ActiveEnterTimestamp`

### system-stats.js — System Monitoring

- Uses the `systeminformation` npm package for cross-platform stats
- Returns CPU usage, core count, memory (total/used/free), disk (total/used/free), and system uptime
- 2-second cache to avoid hammering the system when multiple clients poll simultaneously

### files.js — Static Site File Operations

- Path validation with directory traversal prevention (rejects `..`, absolute paths, null bytes, hidden files)
- Creates site directories with default `index.html`
- Streaming file upload (memory-safe on 512 MB droplets): stream → temp file → `sudo mv`
- File listing via `sudo find` with formatted output
- All file operations use `sudo` since site directories are owned by `www-data`

## WebSocket Support

The server uses `@fastify/websocket` for two real-time features:

### Provisioning Progress Stream (`/api/onboarding/provision/stream`)

- Module-level `EventEmitter` shared between the POST handler (which starts provisioning) and WebSocket connections (which stream progress)
- On connect, sends full current state (for late-joining clients)
- Emits `{ task, title, status, message, log, progress: { current, total } }` for each step
- Completion event includes admin credentials and URLs

### Live Log Streaming (`/api/services/:name/logs`)

- Spawns `journalctl -f -u <service> -n 50` as a child process
- Streams stdout lines to WebSocket clients
- Cleans up the child process on WebSocket close

## SPA Fallback

The server's `setNotFoundHandler` implements client-side routing support:

```javascript
server.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api')) {
    return reply.code(404).send({ error: 'Not found' });
  }
  return reply.sendFile('index.html');
});
```

API routes that don't match return a proper 404 JSON response. All other routes serve `index.html`, allowing React Router to handle client-side navigation.

## Graceful Shutdown

The server registers handlers for `SIGTERM` and `SIGINT`:

```javascript
const shutdown = async (signal) => {
  server.log.info({ signal }, 'Received signal, shutting down gracefully');
  clearInterval(livenessInterval);
  clearRateLimitInterval();
  await server.close();
  process.exit(0);
};
```

The shutdown sequence stops the periodic instance liveness check (`livenessInterval`), clears the ticket rate-limit cleanup interval (`clearRateLimitInterval()`), and then calls `server.close()` which waits for active connections to finish before shutting down, ensuring in-flight requests complete cleanly.

## Key Files

| File                                                         | Role                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `packages/panel-server/src/index.js`                         | Server entry, plugin + route registration                      |
| `packages/panel-server/src/middleware/mtls.js`               | mTLS verification, revocation check, role parsing              |
| `packages/panel-server/src/middleware/role-guard.js`         | Role-based access control (admin vs agent capabilities)        |
| `packages/panel-server/src/middleware/onboarding-guard.js`   | Route access control by onboarding state                       |
| `packages/panel-server/src/middleware/twofa-session.js`      | 2FA session cookie verification (after mTLS, before roleGuard) |
| `packages/panel-server/src/middleware/errors.js`             | Global error handler (Zod, AppError, 500)                      |
| `packages/panel-server/src/routes/onboarding/index.js`       | Onboarding route registration + guard                          |
| `packages/panel-server/src/routes/onboarding/provision.js`   | Provisioning POST + WebSocket stream                           |
| `packages/panel-server/src/routes/invite.js`                 | Public invite acceptance routes (no mTLS)                      |
| `packages/panel-server/src/routes/enrollment.js`             | Public enrollment route (token + CSR, no mTLS)                 |
| `packages/panel-server/src/routes/management.js`             | Management route registration + guard                          |
| `packages/panel-server/src/routes/management/certs.js`       | Certificate management (mTLS, agent certs, admin auth mode)    |
| `packages/panel-server/src/routes/management/plugins.js`     | Plugin management + push install (admin-only)                  |
| `packages/panel-server/src/routes/management/invitations.js` | Invitation CRUD (admin-only)                                   |
| `packages/panel-server/src/routes/management/settings.js`    | 2FA settings: setup, confirm, verify, disable (admin-only)     |
| `packages/panel-server/src/routes/plugin-router.js`          | Dynamic plugin route mounting + disabled-plugin 503 handler    |
| `packages/panel-server/src/lib/config.js`                    | Config loading, validation (Zod), atomic update                |
| `packages/panel-server/src/lib/state.js`                     | tunnels.json + sites.json + invitations.json atomic read/write |
| `packages/panel-server/src/lib/revocation.js`                | Certificate revocation list management (revoked.json)          |
| `packages/panel-server/src/lib/invite-page.js`               | Invitation acceptance HTML page generator                      |
| `packages/panel-server/src/lib/nginx.js`                     | Vhost generation, write-with-rollback, reload                  |
| `packages/panel-server/src/lib/chisel.js`                    | Chisel install, service management, config update              |
| `packages/panel-server/src/lib/authelia.js`                  | Authelia install, config, user CRUD, TOTP                      |
| `packages/panel-server/src/lib/certbot.js`                   | Let's Encrypt issuance, renewal, listing                       |
| `packages/panel-server/src/lib/mtls.js`                      | mTLS cert info, client cert rotation, agent registry, capability management |
| `packages/panel-server/src/lib/plugins.js`                   | Plugin manifest validation, install/uninstall, registry CRUD   |
| `packages/panel-server/src/lib/push-install.js`              | Push install policies, sessions, agent enablement              |
| `packages/panel-server/src/lib/enrollment.js`                | Enrollment token creation, validation, consumption             |
| `packages/panel-server/src/lib/csr-signing.js`               | CSR signing for hardware-bound agent enrollment                |
| `packages/panel-server/src/lib/constants.js`                 | Reserved API prefixes shared across plugins and tickets        |
| `packages/panel-server/src/lib/services.js`                  | systemctl wrapper with allowlists                              |
| `packages/panel-server/src/lib/system-stats.js`              | CPU, memory, disk stats (cached)                               |
| `packages/panel-server/src/lib/files.js`                     | Static site file operations with path validation               |
| `packages/panel-server/src/lib/plist.js`                     | macOS launchd plist generator                                  |
| `packages/panel-server/src/lib/totp.js`                      | TOTP code generation and verification                          |
| `packages/panel-server/src/lib/session.js`                   | Signed session cookie creation and validation                  |
| `packages/panel-server/src/lib/tickets.js`                   | Ticket system: scopes, instances, assignments, sessions        |
| `packages/panel-server/src/routes/management/tickets.js`     | Ticket management HTTP route handlers                          |
| `packages/panel-server/src/lib/app-error.js`                 | Operational error class                                        |

## Design Decisions

### Why Fastify instead of Express?

Fastify provides schema-first validation, built-in WebSocket support via plugins, structured logging (pino), and measurably lower overhead per request. On a 512 MB droplet, the ~30 MB baseline matters. Express would work but offers no advantages for this use case.

### Why routes and lib are separate?

Routes handle HTTP concerns: parsing request bodies, setting status codes, formatting responses. Library modules handle business logic: reading files, calling system commands, managing state. This separation means the same business logic can be called from different contexts (routes, provisioning, future CLI tools) without HTTP coupling.

### Why not use a database?

At this scale (single admin, ~10 tunnels, ~5 users), JSON files provide faster access, zero operational overhead, and simpler debugging (you can `cat` the state file). The atomic write pattern ensures crash safety. If scale requirements change, the `state.js` module can be swapped for a database adapter without touching routes or other lib modules.

### Why check mTLS in both nginx and the server?

Defense-in-depth. nginx's `ssl_verify_client optional` with per-location `if ($ssl_client_verify != SUCCESS) { return 496; }` is the primary enforcement — it rejects connections at the TLS level before any HTTP processing on protected locations. The server middleware is a secondary check in case nginx is misconfigured or bypassed. In development mode, the server middleware is the only check (and it is bypassed).

### Why does provisioning run in the background?

Provisioning takes 2-5 minutes (downloading binaries, issuing certificates, configuring services). A synchronous HTTP request would time out. Instead, the POST endpoint starts the work and returns immediately, while the WebSocket stream provides real-time feedback. This pattern also allows late-joining clients to receive the current state on connect.
