# Portlama

Self-hosted secure tunneling platform. One command provisions a VPS, prints a certificate + URL, and SSH is never needed again. Everything is managed through a browser-based panel protected by mTLS client certificates.

## Repository Structure

```
portlama/
├── packages/
│   ├── create-portlama/       @lamalibre/create-portlama — zero-prompt installer CLI
│   ├── panel-server/          @lamalibre/portlama-panel-server — Fastify REST API
│   ├── panel-client/          @lamalibre/portlama-panel-client — React + Vite + Tailwind UI
│   ├── portlama-agent/        @lamalibre/portlama-agent — tunnel agent CLI (macOS & Linux)
│   ├── portlama-admin-panel/   @lamalibre/portlama-admin-panel — shared React admin UI (pages, context, components) used by panel-client and portlama-desktop
│   ├── portlama-desktop/      @lamalibre/portlama-desktop — Tauri v2 desktop app (dual-mode: agent management + server admin panel)
│   ├── install-portlama-desktop/ @lamalibre/install-portlama-desktop — npx installer for the desktop app
│   ├── install-portlama-admin/ @lamalibre/install-portlama-admin — npx admin cert upgrade to hardware-bound
│   ├── install-portlama-e2e-mcp/ @lamalibre/install-portlama-e2e-mcp — npx installer + MCP server for E2E test infrastructure
│   ├── portlama-tickets/      @lamalibre/portlama-tickets — SDK for ticket system (agent-to-agent authorization)
│   └── portlama-cloud/        @lamalibre/portlama-cloud — cloud provider abstraction for server provisioning
├── tests/
│   ├── e2e/                   Single-VM end-to-end tests
│   └── e2e-three-vm/          Three-VM integration tests (Multipass)
└── e2e-logs/                  Latest E2E test execution logs
```

## Development

```bash
npm install                    # install all workspace dependencies
npm run build                  # build all packages
npm run dev:server             # panel backend (needs ./dev/panel.json)
npm run dev:client             # panel frontend (proxies /api to :9292)
```

Build before considering a task complete. Avoid commands that hang (e.g., `npm start`).

## Tech Stack

| Layer          | Technology                                  |
| -------------- | ------------------------------------------- |
| Installer      | Node.js ESM, Listr2, execa                  |
| Panel backend  | Fastify 5, Zod validation, WebSocket        |
| Panel frontend | React 18, Vite, Tailwind, react-query       |
| Tunnel server  | Chisel (Go binary, WebSocket-over-HTTPS)    |
| Auth           | Authelia (TOTP 2FA, bcrypt)                 |
| Reverse proxy  | nginx (TLS termination, mTLS, forward auth) |
| TLS            | Let's Encrypt / certbot                     |
| Panel auth     | mTLS client certificates                    |
| Ticket SDK     | TypeScript, undici (mTLS HTTP client)        |
| Cloud SDK      | TypeScript, undici (DO REST API, provider abstraction) |
| State          | JSON files + YAML (no database)             |
| Target OS      | Ubuntu 24.04 LTS                            |

## Coding Conventions

**JavaScript / Node.js:**

- ES Modules everywhere (`import`, not `require`)
- `execa` (or `child_process.execFile` in minimal-dependency packages) for shell commands with array arguments — never string interpolation
- Zod schemas for all API input validation at route level
- Routes handle HTTP only — business logic in `lib/`
- Fastify logger, never `console.log` in library code

**React / Frontend:**

- Functional components with hooks
- `@tanstack/react-query` for data fetching — no `useEffect + fetch`
- Tailwind utility classes only — no CSS files
- Dark terminal aesthetic: `zinc-950` bg, `zinc-900` cards, `cyan-400` accents
- Icons from `lucide-react`

**Rust / Tauri (Desktop):**

- Shared HTTP helpers in `api.rs` — all panel API calls go through `curl_panel`
- Service discovery in `services.rs` — detection via `which`/`pgrep`/`lsof`/TCP probe, Docker via `docker ps`
- Cloud provisioning in `cloud.rs` — bridges React UI to `@lamalibre/portlama-cloud` Node.js CLI
- OS credential storage in `credentials.rs` — macOS `security` CLI, Linux `secret-tool`
- Multi-agent management in `agents.rs` — registry at `~/.portlama/agents.json`, per-agent data at `~/.portlama/agents/<label>/`, Tauri commands for agent start/stop/restart/logs/tunnels/config
- `config.rs` `load_effective_config()` — checks `agents.json` (multi-agent registry) first, then `servers.json` (active entry), then falls back to `agent.json` (legacy)
- `tokio::task::spawn_blocking` for subprocess calls and file I/O — never block the Tauri event loop
- Service registry persisted as JSON at `~/.portlama/services.json`
- Server registry persisted as JSON at `~/.portlama/servers.json`
- Agent registry persisted as JSON at `~/.portlama/agents.json` — multi-agent support with per-agent data directories
- Atomic file writes (temp → fsync → rename) for registry and config

**TypeScript (Ticket SDK):**

- Strict mode, ES2022 target, ESM output (`verbatimModuleSyntax`, `isolatedModules`)
- undici for HTTP — use undici's `fetch` export (not global) for type-safe `dispatcher` support
- Response shape validation — `assertObject` checks before type assertions
- No runtime dependencies beyond `undici`

**Cloud SDK (portlama-cloud):**

- TypeScript, same conventions as portlama-tickets (strict, ESM, verbatimModuleSyntax)
- `undici` for HTTP — direct REST API calls to cloud providers, no heavy SDKs
- `child_process.execFile` for SSH/SCP/openssl commands (array args only)
- Provider abstraction: `CloudProvider` interface, each provider (DigitalOcean, etc.) implements it
- Token scope validation: reject over-scoped tokens, require minimum necessary permissions
- NDJSON progress protocol on stdout for Rust/Tauri integration
- SSH via `ssh-keygen`/`ssh`/`scp` commands — temporary ed25519 keys, secure-deleted after use. SSH TOFU accepted risk: first connection uses `accept-new`, pinned in per-session `known_hosts` for subsequent commands; DigitalOcean does not expose host fingerprints via API
- Credential storage: macOS Keychain (`security-framework` crate, no CLI) / Linux libsecret (`secret-tool` with stdin) — never plaintext, never in process args. Two services: `com.portlama.cloud` (API tokens), `com.portlama.server` (P12 passwords, keyed by server UUID)
- Token passed to Node.js via `PORTLAMA_CLOUD_TOKEN` env var (never CLI args)
- Server registry: `~/.portlama/servers.json` with atomic writes (tmp → 0600 → fsync → rename)
- Droplet safety: only operate on droplets tagged `portlama:managed`
- Cleanup stack: each resource creation registers a rollback; on failure, cleanup runs in reverse

**Installer:**

- Zero prompts — all configuration happens through browser onboarding UI
- Listr2 subtask lists with idempotent skip guards

## Critical Constraints

**RAM budget (512MB droplet):** Total stack ~245MB with ~265MB headroom + 1GB swap. Authelia MUST use bcrypt, NOT argon2id (argon2id uses ~93MB per hash → OOM).

**Security rules:**

- Panel vhost: `ssl_verify_client optional` at server level, `if ($ssl_client_verify != SUCCESS) { return 496; }` at protected locations — public endpoints (`/api/enroll`, `/api/invite`) skip the check
- All services bind `127.0.0.1` — nginx is the sole public-facing service
- `https://<ip>:9292` always works (mTLS) — fallback if domain is lost. Exception: when panel 2FA is enabled, the IP vhost is disabled (domain-only access)
- Secrets: `crypto.randomBytes`, never hardcoded
- Onboarding endpoints: 410 Gone after completion
- Management endpoints: 503 before onboarding completes
- Agent TLS: panel uses a self-signed server cert separate from the mTLS CA — agent uses `-k` / `rejectUnauthorized: false` until server certificate distribution is implemented. The mTLS client cert still authenticates the agent to the panel.
- P12 password protection: curl uses a temporary config file (`-K`, O_EXCL + 0600, cleaned up in try/finally) and openssl uses `PORTLAMA_P12_PASS` environment variable — password never appears in process listings. Stale config files cleaned up at module load.
- Agent directory `~/.portlama/` created with mode 0700. PEM private keys cleaned up after CA extraction during setup.
- Hardware-bound certificates: agent private keys can be imported into macOS Keychain as non-extractable (`security import -x`). Temporary key files exist on disk for seconds only during enrollment, then are securely deleted (overwrite + unlink).
- Enrollment tokens: one-time use, 10-minute expiry, stored at `/etc/portlama/pki/enrollment-tokens.json`. Public `/api/enroll` endpoint accepts token + CSR (no mTLS required — the token is the sole auth gate).
- Dual auth: agent config `authMethod` is `'p12'` (default, backwards compatible) or `'keychain'`. Panel API functions accept both calling conventions.
- Admin auth mode: panel.json `adminAuthMode` is `'p12'` (default) or `'hardware-bound'`. When hardware-bound, `GET /certs/mtls/download` and `POST /certs/mtls/rotate` return 410 Gone. Recovery: `sudo portlama-reset-admin` on the server (root-only CLI).
- Admin upgrade: `POST /certs/admin/upgrade-to-hardware-bound` accepts CSR, signs with CA, revokes old admin cert, sets `adminAuthMode: 'hardware-bound'`. One-way operation — reversible only via DO root console.
- Panel 2FA: opt-in TOTP two-factor authentication for admin panel (on top of mTLS). Config fields: `panel2fa: { enabled, secret, setupComplete }` and `sessionSecret` in `panel.json`. Agents bypass 2FA entirely (only admin cert holders need it). Enabling 2FA disables IP:9292 vhost (domain required). Session: HMAC-SHA256 signed cookie (`portlama_2fa_session`), 12h absolute expiry, 2h inactivity timeout, `HttpOnly`/`Secure`/`SameSite=Strict`. TOTP uses RFC 6238 with SHA-1, 30s period, +/-1 step drift window, replay protection. Rate limiting: 5 attempts / 2 min per IP, 5-min ban. Endpoints: `GET /settings/2fa` (status, exempt), `POST /settings/2fa/setup`, `POST /settings/2fa/confirm`, `POST /settings/2fa/verify` (exempt), `POST /settings/2fa/disable`. Recovery: `sudo portlama-reset-admin` clears 2FA, re-enables IP vhost, resets admin auth to P12. Middleware: `twofa-session.js` (Fastify plugin, runs after mTLS, before roleGuard). Dependency: `@fastify/cookie`.

**Certificate scoping:**

- Admin cert (`CN=admin`) — full panel access
- Agent cert (`CN=agent:<label>`) — capability-based access, stored server-side in registry
  - Registry `enrollmentMethod`: `'p12'` (traditional) or `'hardware-bound'` (Keychain-bound)
  - `tunnels:read` / `tunnels:write` — tunnel listing and management
  - `services:read` / `services:write` — service status and control
  - `system:read` — system stats
  - `sites:read` / `sites:write` — static site file browsing and deployment (site CRUD is admin-only)
  - `allowedSites: string[]` — per-site scoping; agent sees and can deploy to only listed sites
- Plugins and ticket scopes declare additional capabilities; these are merged with base capabilities dynamically via `getValidCapabilities()` (base + plugin + ticket scope). Plugin capabilities come from manifest (flat array or nested `{ agent: [...] }` — normalized to flat array internally); ticket scope capabilities come from scope declarations registered via `/api/tickets/scopes`
- Plugin management endpoints (install, enable, push install) are admin-only at the route level
- Revoked certs tracked in `revoked.json`, rejected by middleware
- Never give admin cert to agents — generate scoped agent certs

**Plugin system:**

- Plugins are `@lamalibre/`-scoped npm packages with a `portlama-plugin.json` manifest (`name`, optional `displayName`, `version`, `description`, `capabilities`, `packages`, `panel`, `config`)
- Manifest `panel` field: flat format (`{ label, icon, route }`) for single-page plugins, or multi-page format (`{ pages: [{ path, title, icon?, description? }], apiPrefix? }`) — sidebar renders one entry per page with section header
- Manifest `config` field: declarative schema for plugin settings (`{ key: { type, default?, description?, enum? } }`) — stored in registry, used by plugin's settings UI
- Server-side plugin code runs unsandboxed in the panel process — `@lamalibre/` scope is the trust boundary
- All `npm install` calls use `--ignore-scripts` to block postinstall script execution
- Plugin names and ticket scope names matching core API prefixes are rejected — single source of truth in `lib/constants.js`: `health`, `onboarding`, `invite`, `enroll`, `tunnels`, `sites`, `system`, `services`, `logs`, `users`, `certs`, `invitations`, `plugins`, `tickets`, `settings`
- Plugin server routes are mounted with two-level Fastify encapsulation: auth guard on outer scope (plugin cannot override), plugin code on inner scope
- Plugin panel bundles served at `/{pluginName}/panel.js` with runtime `@lamalibre/` scope check
- Disabled plugins return 503 via `onRequest` hook (Fastify cannot remove routes at runtime — clean state requires restart)
- Push install: admin enables a time-windowed session per agent, then sends install/update/uninstall commands
- Push install policies: IP allow/deny lists, allowed plugins (`@lamalibre/` scope enforced via Zod), allowed actions
- Plugin state: `/etc/portlama/plugins.json` (registry), `/etc/portlama/plugins/` (per-plugin data directories)
- Agent plugin state: `~/.portlama/agents/<label>/plugins.json`, `~/.portlama/agents/<label>/plugins/` directories (legacy paths `~/.portlama/plugins.json` and `~/.portlama/plugins/` used only during migration)

**Ticket system (agent-to-agent authorization):**

- Scopes registered via `POST /api/tickets/scopes` (admin). Client SDK: `@lamalibre/portlama-tickets` (TypeScript, undici mTLS). Future: `portlama-tickets.json` manifest for declarative scope registration
- Two-layer isolation (panel-enforced): cert capability check → ticket binding (source/target). Self-tickets rejected (source cannot be target). Third layer (plugin transport CA) is plugin-side, not panel-enforced
- Instance IDs stored in `/etc/portlama/ticket-scopes.json`, NOT on agent certificates — admin assigns instance scopes via panel UI/API
- Tickets: single-use, 30-second expiry, `crypto.randomBytes(32)` (256-bit), HMAC-based timing-safe comparison (per-process random key, fixed-length digests via HMAC-SHA256 before `timingSafeEqual`), stored at `/etc/portlama/tickets.json`
- Ticket delivery: panel inbox per agent (`GET /api/tickets/inbox`), polling
- Sessions: heartbeat every 60s re-validates authorization (source cert not revoked, capability still present, assignment still valid); stale after 10 min (no activity), cleaned up after 24 hours
- Instance liveness: heartbeat every 60s (re-validates agent capability), stale after 5 min (no heartbeat), dead after 1 hour (removed with assignments)
- Rate limiting: 10 tickets per agent per minute
- Hard caps (DoS protection): 200 instances, 1000 tickets, 500 active sessions — returns 503 when exceeded
- Transport strategies: schema accepts `tunnel`, `relay`, `direct` — actual transport negotiation is plugin-side (panel stores preference only). `transport.direct.host` validates against a deny list (private/reserved IPs, loopback, link-local, cloud metadata endpoints) to prevent SSRF
- Scope registry: `POST /api/tickets/scopes` (admin), `GET /api/tickets/scopes` (admin), `DELETE /api/tickets/scopes/:name` (admin)
- Instance registration: `POST /api/tickets/instances` (admin/agent — requires certLabel, idempotent), `DELETE /api/tickets/instances/:instanceId` (admin/agent, owner or admin), `POST /api/tickets/instances/:instanceId/heartbeat` (admin/agent — requires certLabel)
- Instance assignment: `POST /api/tickets/assignments` (admin), `DELETE /api/tickets/assignments/:agentLabel/:instanceScope` (admin), `GET /api/tickets/assignments` (admin)
- Ticket operations: `POST /api/tickets` (admin/agent, request — requires certLabel), `GET /api/tickets/inbox` (admin/agent — requires certLabel), `POST /api/tickets/validate` (admin/agent — requires certLabel), `GET /api/tickets` (admin, list), `DELETE /api/tickets/:ticketId` (admin, revoke)
- Session management: `POST /api/tickets/sessions` (admin/agent — requires certLabel; session ID is server-generated via `crypto.randomBytes(16)`), `POST /api/tickets/sessions/:sessionId/heartbeat` (admin/agent — requires certLabel), `PATCH /api/tickets/sessions/:sessionId` (admin/agent — requires certLabel), `DELETE /api/tickets/sessions/:sessionId` (admin, kill), `GET /api/tickets/sessions` (admin, list)
- Error responses use same error message for all failure conditions in security-sensitive paths (ticket validation, deregistration — no information leakage); admin-facing endpoints return descriptive errors
- Concurrency: promise-chain mutex (same pattern as enrollment tokens)
- State files: atomic writes (temp → fsync → rename)

**File operations:**

- YAML writes: atomic (temp → rename) — Authelia reads `users.yml` live. Temp files use `portlama-authelia-` prefix (sudoers restricts `mv` to this prefix for `/etc/authelia/` targets)
- After `users.yml` change: `systemctl restart authelia`
- Certbot library (`lib/certbot.js`): `renewCert(domain, { forceRenewal })` accepts an options object; `forceRenewal: true` passes `--force-renewal` to certbot. `listCerts()` uses `certbot certificates --non-interactive`
- Before nginx reload: `nginx -t` — rollback on failure
- Never delete the last Authelia user

## Environment Variables

| Variable                    | Package        | Purpose                                                  |
| --------------------------- | -------------- | -------------------------------------------------------- |
| `PORTLAMA_CONFIG`           | panel-server   | Path to panel.json (default: `/etc/portlama/panel.json`) |
| `NODE_ENV`                  | panel-server   | `development` skips mTLS check                           |
| `PORTLAMA_ENROLLMENT_TOKEN` | portlama-agent | Enrollment token for `setup --token` (avoids process listing exposure) |
| `PORTLAMA_CLOUD_TOKEN`      | portlama-cloud | Cloud provider API token (never CLI args)                |

## License

[Polyform Noncommercial 1.0.0](LICENSE.md). Commercial licensing: license@codelama.com.tr
