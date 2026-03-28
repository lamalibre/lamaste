# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-03-28

### Added

- Add dual-mode desktop app — sidebar toggle switches between Agents (local agent management) and Servers (per-server admin panel with drill-down from server list)
- Add `@lamalibre/portlama-admin-panel` shared React package — admin UI pages, `AdminClientContext` abstraction, and components consumed by both web panel and desktop app
- Add per-server admin panel in desktop app — Dashboard, Tunnels, Services, Static Sites, Users, Certificates, Tickets, Plugins, and Settings pages via `portlama-admin-panel`
- Add "Manage" button on server cards — drills into that server's admin panel with back navigation to server list
- Add admin certificate detection and import — cloud-provisioned servers auto-detected, manual P12 import for agent-setup servers
- Add 2FA session support in desktop app — TOTP verification modal with in-memory session cookie storage (12h expiry)
- Add admin log streaming via HTTP polling — `admin_start_log_stream`/`admin_stop_log_stream` Tauri commands with per-service event filtering
- Add 50+ Tauri admin commands bridging desktop UI to panel-server API via admin mTLS (users, sites, certs, services, tickets, plugins, tunnels)
- Add `AdminClientContext` data client implementations — web via `apiFetch()`, desktop via Tauri `invoke()`
- Add cloud provisioning via DigitalOcean — create, monitor, and destroy servers directly from the desktop app without SSH or terminal commands
- Add `@lamalibre/portlama-cloud` package — cloud provider abstraction with DigitalOcean implementation, token scope validation, SSH provisioning, and NDJSON progress protocol
- Add Create Server wizard with 6-step flow: Overview → Token → Region → Size → Label → Create
- Add droplet size selection — curated list of Basic tier sizes filtered by region, with 512MB ($4/mo) as recommended default
- Add region latency probing via DigitalOcean Spaces endpoints (replaces decommissioned `speedtest-*.digitalocean.com`)
- Add token scope validation with dangerous-scope rejection — tokens with `database:delete`, `kubernetes:create`, etc. are blocked
- Add probe-based validation fallback when `account:read` scope is absent
- Add Overview/disclaimer step with risks, security measures, DO team isolation recommendation, documentation links, and "do not show again" persistence
- Add onboarding domain and email fields to the wizard — optionally sets domain on the panel during provisioning
- Add real-time provisioning progress with braille spinner and running command display in the wizard
- Add `provision-progress` Tauri event for live step-by-step progress updates from Rust backend to React frontend
- Add multi-server management — register, switch, health-monitor, and destroy servers from the Servers tab
- Add "Add Existing Server" flow for manually provisioned servers
- Add OS credential storage module — macOS Keychain (`security-framework` crate) and Linux libsecret (`secret-tool`) for API tokens and P12 passwords
- Add server registry at `~/.portlama/servers.json` with atomic writes and `load_effective_config()` fallback from active server to legacy `agent.json`
- Add cloud provisioning guide with step-by-step DO token setup, team isolation recommendation, and troubleshooting reference
- Add state-colored tray icon — green (connected), red (disconnected), amber (checking), gray (not configured)
- Add `set_tray_state` Tauri command for frontend-driven tray icon updates synced with connection status

### Changed

- Extract admin pages from `panel-client` into shared `portlama-admin-panel` package — web panel now imports from the shared package
- Update desktop app server list from agent-only tab to Servers mode landing page with drill-down navigation
- Update desktop sidebar to show mode-contextual navigation — agent tabs, server list, or per-server admin tabs

### Security

- Add path traversal validation on agent labels and server IDs in Rust filesystem operations
- Add cookie value allowlist validation before passing 2FA session cookies to curl
- Add file upload path validation — rejects symlinks, non-regular files, and curl metacharacters
- Add response body truncation in error messages — prevents server internals leaking to UI (max 200 chars, UTF-8 boundary safe)
- Add service action allowlist — only `start`, `stop`, `restart` accepted by `admin_service_action`
- Add max concurrent log stream limit (5) to prevent resource exhaustion
- Add `files` field to `portlama-admin-panel` package.json to prevent artifact leakage on npm publish

### Changed

- Update app icon to llama-only silhouette on transparent background (removed white square and "CODELAMA" text)
- Update tray icon to match new llama silhouette
- Remove duplicate tray icon caused by both `tauri.conf.json` and `tray.rs` creating separate instances
- Update documentation across 10+ files for cloud provisioning, multi-server support, and credential storage

### Security

- Add token scope validation — reject overly broad DO tokens, require minimum 5 resource groups (account, droplet, regions, ssh_key, tag)
- Add `portlama:managed` tag safety check — refuse to destroy droplets without the tag
- Add credential storage via OS keychain — tokens and P12 passwords never stored in plaintext files or passed as CLI arguments
- Add temporary SSH key lifecycle — ed25519 keypair generated per provisioning session, securely deleted after use
- Add cloud-init wait before apt operations — prevents cache corruption from concurrent background processes on fresh droplets
- Add panel health check via SSH before certificate enrollment — bypasses nginx mTLS requirement on `/api/` routes

**Affected packages:**

- `@lamalibre/portlama-admin-panel` 0.1.0 (new package)
- `@lamalibre/portlama-desktop` 0.1.3 → 0.1.6
- `@lamalibre/portlama-panel-client` 0.1.8 → 0.1.9
- `@lamalibre/portlama-cloud` 0.1.0 → 0.1.1
- `@lamalibre/create-portlama` 1.0.34 → 1.0.35

## [Unreleased] - 2026-03-26

### Added

- Add ticket system for agent-to-agent authorization — scopes, instances, assignments, tickets, and sessions
- Add Tickets management page in panel UI with tabs for scopes, instances, assignments, tickets, and sessions
- Add ticket API endpoints: scope CRUD, instance registration/heartbeat/deregister, assignment management, ticket request/validate/inbox, session lifecycle
- Add instance liveness tracking with automatic cleanup — active → stale (5 min) → dead (1 hr)
- Add agent panel-api functions for ticket operations (scope registration, instance management, ticket request/validate, session lifecycle)
- Add `@lamalibre/portlama-tickets` TypeScript SDK for client-side ticket lifecycle — `TicketClient`, `TicketInstanceManager` (source side), `TicketSessionManager` (target side)
- Add instance deregistration on SDK shutdown — `TicketInstanceManager.stop()` calls `DELETE /api/tickets/instances/:id` for immediate cleanup
- Add `certbot renew` force-renewal option — `renewCert(domain, { forceRenewal: true })` in certbot library

### Changed

- Extract reserved API prefixes into shared `constants.js` module — single source of truth for plugin and ticket scope name validation
- Use `renewCert()` library function in cert renewal route instead of raw `execa` call
- Add `--non-interactive` flag to `certbot certificates` invocations

### Security

- Constrain sudoers `openssl pkcs12 -export` rule to `-out /etc/portlama/pki/*` with required encryption flags — prevents arbitrary file writes
- Narrow sudoers `authelia storage *` to `authelia storage user totp generate *` — limits to the single subcommand actually used
- Add `--ignore-scripts` to `npm install --production` in installer and redeploy — blocks postinstall script execution from dependencies
- Add `enroll` to plugin reserved names — prevents plugin from shadowing the public enrollment endpoint
- Add `tickets` and `settings` to plugin reserved display labels — prevents sidebar navigation confusion
- Add self-ticket rejection — source agent cannot issue tickets targeting itself
- Add rate limit interval cleanup on graceful shutdown
- Replace raw `timingSafeEqual` with HMAC-SHA256 comparison — eliminates length-leak side channel using per-process random key and fixed-length digests
- Generate session IDs server-side via `crypto.randomBytes(16)` — prevents client-chosen ID collisions
- Enforce server-side `lastActivityAt` timestamps — prevents clients from extending session lifetime
- Add host validation on `transport.direct.host` — rejects private IPs, loopback, link-local, and cloud metadata endpoints (SSRF prevention)
- Tighten sudoers `mv` rules with specific temp-file prefixes — `portlama-authelia-*` for authelia configs, `chisel-*` for chisel binary (was `chisel_*`), remove dead `portlama-service-*` and `portlama-pki-*` rules
- Remove certbot stderr from HTTP error responses in cert renewal endpoint — details logged server-side only

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.32 → 1.0.34
- `@lamalibre/portlama-panel-server` 0.1.8 → 0.1.10
- `@lamalibre/portlama-panel-client` 0.1.6 → 0.1.8
- `@lamalibre/portlama-agent` 1.0.8 → 1.0.10
- `@lamalibre/portlama-tickets` 0.1.0 (new package)

## [Unreleased] - 2026-03-25

### Added

- Add Linux (Ubuntu) support to portlama-agent — systemd service management alongside existing macOS launchd support
- Add platform-agnostic `GET /api/tunnels/agent-config` endpoint returning Chisel args, domain, and tunnel metadata for any platform
- Add `service-config.js` module that generates plist (macOS) or systemd unit (Linux) from the same Chisel args
- Add `service.js` unified service management abstraction dispatching to launchctl (macOS) or systemctl (Linux)
- Add `cert-store.js` portable certificate storage — macOS Keychain (non-extractable) or Linux P12 file (mode 0600)
- Add `PORTLAMA_ENROLLMENT_TOKEN` environment variable for token-based setup to avoid token exposure in process listings
- Add `chisel-args.js` shared module on panel-server, extracting Chisel argument construction from plist generation for reuse
- Add opt-in TOTP two-factor authentication for admin panel — setup, confirm, verify, and disable via Settings API
- Add Settings page in panel UI with 2FA enable/disable toggle, QR code display, and verification modal
- Add `twofa-session` Fastify middleware — runs after mTLS, before roleGuard, enforces 2FA session for admin cert holders
- Add HMAC-SHA256 signed session cookie (`portlama_2fa_session`) with 12h absolute / 2h inactivity expiry
- Add TOTP replay protection and +/-1 step drift window (RFC 6238, SHA-1, 30s period)
- Add rate limiting on 2FA verify endpoint — 5 attempts per 2 minutes per IP, 5-minute ban

### Changed

- Update agent description from "Mac agent" to cross-platform "tunnel agent for Portlama"
- Update all agent commands (`setup`, `update`, `status`, `uninstall`) to use platform-agnostic service and config abstractions
- Update `fetchPlist` → `fetchAgentConfig` in agent panel-api module, consuming the new platform-agnostic endpoint
- Update agent setup to detect platform and branch to Keychain import (macOS) or P12 file storage (Linux)
- Update E2E test scripts and orchestrator for Linux agent provisioning
- Update `portlama-reset-admin` CLI to clear 2FA state and re-enable IP vhost on recovery

### Security

- Add Chisel argument validation in `service-config.js` — rejects control characters, enforces `127.0.0.1`-only tunnel bindings to prevent pivoting via compromised panel response
- Add IP:9292 vhost auto-disable when 2FA is enabled — forces domain-only access to prevent certificate-only bypass
- Add agent cert (CN=agent:*) bypass for 2FA — agents never need a session cookie, only admin cert holders are challenged

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.31 → 1.0.32
- `@lamalibre/portlama-panel-server` 0.1.6 → 0.1.8
- `@lamalibre/portlama-panel-client` 0.1.4 → 0.1.6
- `@lamalibre/install-portlama-e2e-mcp` 0.1.3 → 0.1.4
- `@lamalibre/portlama-agent` 1.0.7 → 1.0.8

## [Unreleased] - 2026-03-24

### Added

- Add multi-page plugin manifest support — plugins can declare multiple panel pages with per-page icons and titles, rendered as grouped sidebar entries
- Add `displayName` field to plugin manifest for human-friendly sidebar section headers
- Add `config` field to plugin manifest for declarative plugin configuration schemas (type, default, enum, description)
- Add nested capabilities format (`{ agent: [...] }`) alongside existing flat array, normalized to flat array internally
- Add `apiPrefix` field to multi-page plugin manifest for declaring the plugin's API route prefix
- Update `/run-e2e` skill to use MCP E2E tools (`mcp__e2e__*`) as preferred method with orchestrate.sh as fallback

### Changed

- Update plugin management UI to show `displayName` as primary label with package name as subtitle
- Update plugin management UI to show page count for multi-page plugins

### Removed

- Remove built-in shell (remote tmux) feature — extracted to standalone plugin at `@lamalibre/shell`
- Remove `shell-server`, `shell`, `shell-log`, and `cp` commands from portlama-agent CLI
- Remove all `/api/shell/*` endpoints (12 REST + 2 WebSocket) from panel-server
- Remove Shell tab and Tauri shell commands from desktop app
- Remove `shell` from plugin RESERVED_NAMES to allow shell plugin registration

### Security

- Add path regex constraint on plugin page paths (`/^\/[a-z0-9-/]*$/`) to prevent route traversal
- Add config key regex constraint (`/^[a-zA-Z][a-zA-Z0-9_-]*$/`) to prevent prototype pollution via `__proto__` or `constructor` keys
- Add config default type validation — default value must match declared type
- Add config record size limits (max 50 keys, max 100 enum values per key) to prevent registry bloat on 512MB droplets
- Add `displayName` reserved label check — rejects names matching core navigation items (Dashboard, Tunnels, etc.)
- Add `displayName` printable ASCII constraint to prevent Unicode control character UI spoofing
- Add `apiPrefix` enforcement — must match `/api/{pluginName}` to prevent core route shadowing
- Add pages array bounds (max 50 pages) and uniqueness constraint on page paths within a plugin
- Add `Object.hasOwn()` guard on sidebar icon resolution to prevent prototype chain lookups

## 2026-03-23

### Added

- Add MCP server for E2E test infrastructure with 19 tools: VM lifecycle, snapshots, provisioning, test execution with dependency resolution, and two-tier logging
- Add npx installer (`npx @lamalibre/install-portlama-e2e-mcp`) that auto-registers the MCP server with Claude Code via `claude mcp add`
- Add VM resource profiles (production/development/performance) matching real deployment tiers
- Add snapshot checkpoint system for fast VM state restore between test iterations
- Add hot-reload tool for re-deploying individual packages to VMs without full reprovisioning
- Add test dependency graph so individual tests can run with automatic prerequisite resolution
- Add auto-discovery of test files from filesystem with git-tracked allowlist — only committed scripts matching `NN-name.sh` are executable
- Add hardware-bound certificate enrollment for agents — private keys generated in macOS Keychain as non-extractable, enrolled via one-time tokens and CSR signing
- Add `POST /api/certs/agent/enroll` admin endpoint to generate enrollment tokens (10-minute expiry, single-use)
- Add `POST /api/enroll` public endpoint for agents to enroll with token + CSR (no mTLS required)
- Add `portlama-agent setup --token <token> --panel-url <url>` for hardware-bound agent enrollment
- Add admin hardware-bound certificate upgrade via `POST /api/certs/admin/upgrade-to-hardware-bound`
- Add `GET /api/certs/admin/auth-mode` endpoint to check admin authentication mode
- Add `portlama-reset-admin` CLI tool for emergency admin cert recovery (root-only, server console)
- Add `@lamalibre/install-portlama-admin` package for admin hardware-bound certificate upgrade via npx
- Add enrollment method badge (P12 / Hardware-Bound) to agent certificate list in panel UI
- Add "Enrollment Token" button to panel UI with token display, copy, and setup command
- Add `enrollmentMethod` field to agent registry and certificate list API response
- Add nginx rate limiting on public `/api/enroll` endpoint (5 requests/minute per IP)

### Changed

- Update nginx mTLS snippet to `ssl_verify_client optional` with per-location enforcement, enabling public endpoints alongside mTLS-protected routes
- Update all agent CLI commands to support both P12 and Keychain authentication via config object dispatch
- Update Tauri desktop app config and API layer to support optional P12 fields and Keychain identity
- Hide P12 download button for hardware-bound agents in panel UI
- Block P12 download and rotation with 410 Gone when admin uses hardware-bound authentication

### Security

- Add domain parameter validation (regex) in E2E MCP to prevent shell injection in provisioning commands
- Add path traversal protection on E2E MCP log and test result file reads
- Add snapshot name validation in E2E MCP to prevent argument injection
- Add restricted file permissions (0o700 dir, 0o600 files) for E2E MCP state files containing credentials
- Add P12 password transfer via file in E2E MCP instead of command-line arguments to prevent process listing exposure
- Add explicit environment variable allowlist in E2E MCP for child processes instead of forwarding full `process.env`
- Add git-tracked file allowlist for test script execution — untracked or injected `.sh` files are rejected
- Add timing-safe token comparison (`crypto.timingSafeEqual`) for enrollment tokens on public endpoint
- Add mutex (`withTokenLock`) to serialize token creation and consumption, preventing TOCTOU races
- Add CSR structural validation (`openssl req -verify`) before signing in both agent and admin paths
- Add CSR size limit (8192 bytes) to prevent resource exhaustion on the public enrollment endpoint
- Add enrollment token file permissions (`mode: 0o600`) and agent registry permissions (`mode: 0o640`)
- Add label re-validation in CSR signing as defense-in-depth against DN injection
- Add error message sanitization on public enrollment endpoint (5xx errors return generic message)
- Add keychain auth guard for shell commands with clear error message instead of crash

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.27 → 1.0.28
- `@lamalibre/portlama-panel-server` 0.1.3 → 0.1.4
- `@lamalibre/portlama-panel-client` 0.1.2 → 0.1.3
- `@lamalibre/portlama-agent` 1.0.5 → 1.0.6
- `@lamalibre/portlama-desktop` 0.1.2 → 0.1.3
- `@lamalibre/install-portlama-admin` — → 1.0.0 (new)
- `@lamalibre/install-portlama-e2e-mcp` — → 0.1.0 (new)

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
