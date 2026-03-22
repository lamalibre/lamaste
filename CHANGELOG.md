# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-03-22

### Added

- Add plugin system with install, uninstall, enable, and disable lifecycle — plugins are `@lamalibre/`-scoped npm packages with a `portlama-plugin.json` manifest
- Add plugin server-side route mounting with two-level Fastify encapsulation — auth guard on outer scope prevents plugins from overriding access control
- Add plugin panel micro-frontend loader — plugins can ship a `panel.js` bundle rendered in the Plugins page
- Add dynamic capability registration — plugins declare capabilities in their manifest, which are merged with base capabilities for agent certificate scoping
- Add push install system for remote plugin management — admin enables a time-windowed push install session per agent, then sends install/update/uninstall commands
- Add push install policies with IP allow/deny lists, allowed plugins, and allowed actions
- Add push install session audit log with configurable retention (default 500 entries)
- Add `portlama-agent plugin` CLI commands: install, uninstall, update, list, and remote push-install polling
- Add Plugins page in the desktop app with install, uninstall, enable, disable, and push install management
- Add Plugins tab to the panel sidebar

### Changed

- Update agent certificate capabilities to support dynamic plugin-declared capabilities
- Update `GET /api/certs/agent` to return only currently valid capabilities (filtering against base + plugin set)

### Security

- Add `@lamalibre/` npm scope enforcement on all plugin install paths — server, agent, push install policies, and agent uninstall/update operations
- Add `--ignore-scripts` flag on all plugin `npm install` calls to block postinstall script execution
- Add reserved plugin name validation — names matching core API prefixes (`tunnels`, `plugins`, `health`, etc.) are rejected at install time
- Add `@lamalibre/` scope check on server module loading path as defense-in-depth against registry file tampering
- Add agent-side manifest name validation (`/^[a-z0-9-]+$/`) to prevent path traversal via malicious plugin names
- Add disabled-plugin route guard with 5-second TTL cache — disabled plugins return 503 without server restart
- Add `ScopedPackageSchema` validation on push install policy `allowedPlugins` field

- Add service discovery & marketplace UI in the desktop app — auto-detects 17 well-known local services (Ollama, ComfyUI, LM Studio, PostgreSQL, Redis, Docker containers, etc.) with one-click tunnel creation
- Add custom service definitions — users can register their own services with name, port, binary, process name, and category, persisted in `~/.portlama/services.json`
- Add Services tab in the desktop sidebar with category filtering (AI, Database, Docker, Dev, Media, Monitoring, Custom)
- Add shared `api.rs` module in the desktop app — extracted curl helpers from `commands.rs` for reuse across the Rust backend
- Add `@lamalibre/install-portlama-desktop` npx installer — downloads, caches, and installs the desktop app from GitHub Releases for macOS (arm64/x64) and Linux (x64)
- Add GitHub Actions workflow for desktop releases — manual trigger via `workflow_dispatch`, builds for macOS arm64, macOS x64, and Linux x64
- Add file type allowlist for static site uploads — only safe web assets (HTML, CSS, JS, images, fonts, media, documents, data, WASM) are accepted; server rejects disallowed extensions with 400
- Add ClamAV malware scanning via Docker in `portlama-agent deploy` — scans files before upload, aborts on infections, warns if Docker is unavailable
- Add extension allowlist check in `portlama-agent deploy` — aborts with listing if blocked files are found
- Add `sites:read` and `sites:write` agent capabilities for static site file management
- Add per-site scoping via `allowedSites` on agent certificates — agents can only see and modify files on sites explicitly assigned to them
- Add `PATCH /api/certs/agent/:label/allowed-sites` endpoint for managing agent site access
- Add site access UI in panel certificate management — assign sites to agents via checkboxes
- Add `portlama-agent sites` command to list, create, and delete static sites from the CLI
- Add `portlama-agent deploy <site> <path>` command to deploy a local directory to a static site
- Add Zod validation on file listing and upload query parameters for defense in depth
- Add remote shell access via tmux — admin can open a terminal on any agent machine through the existing WebSocket tunnel with `portlama-agent shell <label>`
- Add policy-based shell access control — named policies with IP allow/deny lists, command blocklists, inactivity timeouts, and file size limits
- Add 5-gate auth chain for shell sessions: global toggle → agent cert enabled → time window → IP check → admin cert
- Add shell session recording via `tmux pipe-pane`, stored on agent at `~/.portlama/shell-recordings/`
- Add session audit log on the panel server (`shell-sessions.json`)
- Add restricted shell wrapper (`portlama-shell.sh`) with hard-blocked patterns and configurable restricted commands
- Add file transfer between admin and agent: `portlama-agent cp <label>:/path ./local`
- Add session log viewer: `portlama-agent shell-log <label>`
- Add agent shell gateway: `portlama-agent shell-server` (background service, polls panel for shell access)
- Add Shell tab to the desktop app for managing policies, agent access, and sessions
- Add `GET /api/shell/agent-status` endpoint for agents to check their own shell access

### Changed

- Update site file endpoints (`GET/POST/DELETE /api/sites/:id/files`) to accept agent certificates with appropriate capabilities
- Update `GET /api/sites` to filter results based on agent's `allowedSites` when accessed with an agent certificate
- Update sudoers template to use `portlama:portlama` instead of installer's UID for file ownership

### Security

- Add P12 password removed from process listings — agent curl calls use temporary config file (`-K`, O_EXCL + 0600), openssl uses `PORTLAMA_P12_PASS` environment variable. Stale config files cleaned up at module load.
- Add P12 password protection — curl uses a temporary config file (O_EXCL + mode `0600`, deleted in try/finally) and openssl uses `PORTLAMA_P12_PASS` environment variable, so the password never appears in process listings. Stale config files cleaned up at module load.
- Add PEM private key cleanup after CA extraction during setup — only `ca.crt` persists, client cert/key PEM files are deleted
- Add restrictive directory permissions (`0700`) on `~/.portlama/` and `~/.portlama/.pem/`
- Add curl config file atomic creation with `O_EXCL` and `0o600` permissions in the desktop app, preventing symlink attacks and race conditions
- Add input validation for custom service definitions — binary names, process names, categories validated against strict allowlists with length and count limits
- Add registry file validation on load to reject tampered entries in the desktop app
- Add subprocess timeouts (5-10s) on `pgrep`, `lsof`, and `docker ps` commands in the desktop app to prevent hangs
- Add Mutex-based serialization for registry mutations in the desktop app to prevent concurrent write races
- Add server-side file extension allowlist enforcement — blocks uploads of executable, scripting, and unknown file types regardless of client
- Add client-side (agent) file extension allowlist — catches disallowed files early with helpful error messages before upload
- Add ClamAV malware scanning in deploy pipeline — prevents deploying infected content to static sites
- Add symlink protection in deploy command directory scanner (skips symlinks, uses `lstat` to prevent TOCTOU)
- Add `encodeURIComponent` on all dynamic URL path segments in panel client API helpers and agent CLI
- Add regex validation on `allowedSites` entries in `UpdateAllowedSitesSchema`
- Add tmux special-key allowlist in shell gateway — only permitted key names (Enter, Escape, arrows, etc.) accepted
- Add strict CIDR prefix validation (1-32) for shell policy IP lists
- Add IPv6 normalization for IP access control — strips `::ffff:` prefix from IPv4-mapped addresses
- Add Mutex-based locking on shell session audit log to prevent concurrent write races
- Add PEM private key file permissions (0o600) in agent WebSocket helpers
- Add URL encoding on all dynamic path segments in desktop app Rust API calls

**Affected packages:**

- `@lamalibre/portlama-panel-server` 0.1.0 → 0.1.3
- `@lamalibre/portlama-panel-client` 0.1.0 → 0.1.2
- `@lamalibre/create-portlama` 1.0.23 → 1.0.26
- `@lamalibre/portlama-agent` 1.0.1 → 1.0.5
- `@lamalibre/portlama-desktop` 0.1.0 → 0.1.2
- `@lamalibre/install-portlama-desktop` 0.0.2 → 0.0.3

## [1.0.0] - 2026-03-12

### Added

- Initial release
- One-command installer (`npx @lamalibre/create-portlama`)
- Management dashboard with system stats and service health
- Tunnel management: CRUD, nginx vhost generation, TLS certificates
- User management: Authelia user CRUD, TOTP enrollment
- Certificate management: listing, renewal, mTLS rotation
- Mac launchd plist generation for Chisel client
- mTLS authentication for panel access
- Service control: start/stop/restart with live log streaming
- Browser-based onboarding wizard (domain, DNS verification, stack provisioning)
- OS hardening: swap, UFW, fail2ban, SSH lockdown
