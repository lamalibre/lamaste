# Portlama

Self-hosted secure tunneling platform. One command provisions a VPS, prints a certificate + URL, and SSH is never needed again. Everything is managed through a browser-based panel protected by mTLS client certificates.

## Repository Structure

```
portlama/
├── packages/
│   ├── create-portlama/       @lamalibre/create-portlama — zero-prompt installer CLI
│   ├── panel-server/          @lamalibre/portlama-panel-server — Fastify REST API
│   ├── panel-client/          @lamalibre/portlama-panel-client — React + Vite + Tailwind UI
│   ├── portlama-agent/        @lamalibre/portlama-agent — Mac tunnel agent CLI
│   ├── portlama-desktop/      @lamalibre/portlama-desktop — Tauri v2 desktop agent (service discovery, tunnel management)
│   └── install-portlama-desktop/ @lamalibre/install-portlama-desktop — npx installer for the desktop app
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
| State          | JSON files + YAML (no database)             |
| Target OS      | Ubuntu 24.04 LTS                            |

## Coding Conventions

**JavaScript / Node.js:**

- ES Modules everywhere (`import`, not `require`)
- `execa` for shell commands with array arguments — never `child_process` or string interpolation
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
- `tokio::task::spawn_blocking` for subprocess calls — never block the Tauri event loop
- Service registry persisted as JSON at `~/.portlama/services.json`
- Atomic file writes (temp → rename) for registry and config

**Installer:**

- Zero prompts — all configuration happens through browser onboarding UI
- Listr2 subtask lists with idempotent skip guards

## Critical Constraints

**RAM budget (512MB droplet):** Total stack ~245MB with ~265MB headroom + 1GB swap. Authelia MUST use bcrypt, NOT argon2id (argon2id uses ~93MB per hash → OOM).

**Security rules:**

- Panel vhost: `ssl_verify_client on` — no cert = TLS rejected before HTTP
- All services bind `127.0.0.1` — nginx is the sole public-facing service
- `https://<ip>:9292` always works (mTLS) — fallback if domain is lost
- Secrets: `crypto.randomBytes`, never hardcoded
- Onboarding endpoints: 410 Gone after completion
- Management endpoints: 503 before onboarding completes
- Remote shell: 5-gate auth chain (global toggle → agent cert enabled → time window → IP check → admin cert) — shell access is never implicitly on
- Shell sessions use tmux on the agent machine — `portlama-shell.sh` wrapper enforces a command blocklist with hard-blocked patterns and restricted prefixes
- Shell session recordings stored on the agent in `~/.portlama/shell-recordings/`, audit log on the server in `shell-sessions.json`
- Agent TLS: panel uses a self-signed server cert separate from the mTLS CA — agent uses `-k` / `rejectUnauthorized: false` until server certificate distribution is implemented. The mTLS client cert still authenticates the agent to the panel.
- P12 password protection: curl uses a temporary config file (`-K`, O_EXCL + 0600, cleaned up in try/finally) and openssl uses `PORTLAMA_P12_PASS` environment variable — password never appears in process listings. Stale config files cleaned up at module load.
- Agent directory `~/.portlama/` created with mode 0700. PEM private keys cleaned up after CA extraction during setup.

**Certificate scoping:**

- Admin cert (`CN=admin`) — full panel access
- Agent cert (`CN=agent:<label>`) — capability-based access, stored server-side in registry
  - `tunnels:read` / `tunnels:write` — tunnel listing and management
  - `services:read` / `services:write` — service status and control
  - `system:read` — system stats
  - `sites:read` / `sites:write` — static site file browsing and deployment (site CRUD is admin-only)
  - `allowedSites: string[]` — per-site scoping; agent sees and can deploy to only listed sites
- Plugins declare additional capabilities in their manifest; these are merged with base capabilities dynamically via `getValidCapabilities()`
- Shell management endpoints (enable/disable, policies, sessions) are admin-only at the route level — there is no `shell:admin` capability
- Plugin management endpoints (install, enable, push install) are admin-only at the route level
- Revoked certs tracked in `revoked.json`, rejected by middleware
- Never give admin cert to Mac agents — generate scoped agent certs

**Plugin system:**

- Plugins are `@lamalibre/`-scoped npm packages with a `portlama-plugin.json` manifest
- Server-side plugin code runs unsandboxed in the panel process — `@lamalibre/` scope is the trust boundary
- All `npm install` calls use `--ignore-scripts` to block postinstall script execution
- Plugin names matching core API prefixes (`tunnels`, `plugins`, `health`, etc.) are rejected
- Plugin server routes are mounted with two-level Fastify encapsulation: auth guard on outer scope (plugin cannot override), plugin code on inner scope
- Plugin panel bundles served at `/{pluginName}/panel.js` with runtime `@lamalibre/` scope check
- Disabled plugins return 503 via `onRequest` hook (Fastify cannot remove routes at runtime — clean state requires restart)
- Push install: admin enables a time-windowed session per agent, then sends install/update/uninstall commands
- Push install policies: IP allow/deny lists, allowed plugins (`@lamalibre/` scope enforced via Zod), allowed actions
- Plugin state: `/etc/portlama/plugins.json` (registry), `/etc/portlama/plugins/` (per-plugin data directories)
- Agent plugin state: `~/.portlama/plugins.json`, `~/.portlama/plugins/` directories

**File operations:**

- YAML writes: atomic (temp → rename) — Authelia reads `users.yml` live
- After `users.yml` change: `systemctl restart authelia`
- Before nginx reload: `nginx -t` — rollback on failure
- Never delete the last Authelia user

## Environment Variables

| Variable          | Package      | Purpose                                                  |
| ----------------- | ------------ | -------------------------------------------------------- |
| `PORTLAMA_CONFIG` | panel-server | Path to panel.json (default: `/etc/portlama/panel.json`) |
| `NODE_ENV`        | panel-server | `development` skips mTLS check                           |

## License

[Polyform Noncommercial 1.0.0](LICENSE.md). Commercial licensing: licence@codelama.com.tr
