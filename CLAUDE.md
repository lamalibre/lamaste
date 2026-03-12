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
│   └── portlama-desktop/      @lamalibre/portlama-desktop — Tauri v2 desktop agent (WIP)
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

| Layer | Technology |
|-------|-----------|
| Installer | Node.js ESM, Listr2, execa |
| Panel backend | Fastify 5, Zod validation, WebSocket |
| Panel frontend | React 18, Vite, Tailwind, react-query |
| Tunnel server | Chisel (Go binary, WebSocket-over-HTTPS) |
| Auth | Authelia (TOTP 2FA, bcrypt) |
| Reverse proxy | nginx (TLS termination, mTLS, forward auth) |
| TLS | Let's Encrypt / certbot |
| Panel auth | mTLS client certificates |
| State | JSON files + YAML (no database) |
| Target OS | Ubuntu 24.04 LTS |

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

**Certificate scoping:**
- Admin cert (`CN=admin`) — full panel access
- Agent cert (`CN=agent:<label>`) — capability-based access, stored server-side in registry
- Revoked certs tracked in `revoked.json`, rejected by middleware
- Never give admin cert to Mac agents — generate scoped agent certs

**File operations:**
- YAML writes: atomic (temp → rename) — Authelia reads `users.yml` live
- After `users.yml` change: `systemctl restart authelia`
- Before nginx reload: `nginx -t` — rollback on failure
- Never delete the last Authelia user

## Environment Variables

| Variable | Package | Purpose |
|----------|---------|---------|
| `PORTLAMA_CONFIG` | panel-server | Path to panel.json (default: `/etc/portlama/panel.json`) |
| `NODE_ENV` | panel-server | `development` skips mTLS check |

## License

[Polyform Noncommercial 1.0.0](LICENSE.md). Commercial licensing: licence@codelama.com.tr
