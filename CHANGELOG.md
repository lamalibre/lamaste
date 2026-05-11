# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-04-29

### Changed

- **Renamed product from Portlama to Lamaste.** v3.0.0 ships the rename across all product-scoped surfaces. The brand-split refactor that landed during the 2.0.0 work-in-progress made this tractable: helpers `productBundleId()` / `productUnit()` / `userProductRoot()` / `etcProductRoot()` (TS `branding.ts`, Rust `branding.rs`) now resolve `PROJECT = 'lamaste'`, cascading through every dynamically-derived identifier. The dated sections below describe work landed during the v3 cycle while the product was still called Portlama; identifiers there reflect the names as they were at the time. The mechanical translation to v3 names: `@lamalibre/portlama-*` → `@lamalibre/lamaste-*`, `com.lamalibre.portlama.*` → `com.lamalibre.lamaste.*`, `lamalibre-portlama-*` → `lamalibre-lamaste-*`, `/etc/lamalibre/portlama/` → `/etc/lamalibre/lamaste/`, `portlama:portlama` (unix user) → `lamaste:lamaste`, `product:portlama` → `product:lamaste`, `LAMALIBRE_PORTLAMA_*` → `LAMALIBRE_LAMASTE_*`, `portlama_2fa_session` → `lamaste_2fa_session`.
  - **NPM packages:** all 20 `@lamalibre/portlama-*` packages renamed to `@lamalibre/lamaste-*`. `@lamalibre/create-portlama{,-agent,-admin,-desktop,-e2e}` → `@lamalibre/create-lamaste-*`. `@lamalibre/portlama-local-plugin-hostd` → `@lamalibre/local-plugin-hostd` (drops product prefix per brand-split rule — the local plugin host is ecosystem-level). All packages aligned to **3.0.0**.
  - **CLI binaries:** `portlama-{agent,server,agentd,serverd,gatekeeper,cloud,reset-admin}` → `lamaste-*`; `portlama-local-plugin-hostd` → `lamalibre-local-plugin-hostd` (ecosystem). Sudoers wrappers `/usr/local/sbin/portlama-{sign-csr,pki-rename}` → `/usr/local/sbin/lamaste-*`.
  - **Unix user/group:** `portlama:portlama` → `lamaste:lamaste`. Sudoers rules, `useradd` arg, systemd `User=`/`Group=`, `chown` calls. `/etc/sudoers.d/portlama` → `/etc/sudoers.d/lamaste`; `/etc/fail2ban/jail.d/portlama.conf` → `/etc/fail2ban/jail.d/lamaste.conf`.
  - **launchd / systemd:** `com.lamalibre.portlama.*` → `com.lamalibre.lamaste.*`; `lamalibre-portlama-*` → `lamalibre-lamaste-*`. Ecosystem labels (`com.lamalibre.local-plugin-host`, `lamalibre-local-plugin-host`) unchanged.
  - **Filesystem paths:** `~/.lamalibre/portlama/` → `~/.lamalibre/lamaste/`; `/etc/lamalibre/portlama/` → `/etc/lamalibre/lamaste/`; `/opt/lamalibre/portlama/` → `/opt/lamalibre/lamaste/`; `/var/www/portlama/` → `/var/www/lamaste/`. Ecosystem paths (`~/.lamalibre/local/`, `/etc/lamalibre/`) unchanged.
  - **Environment variables:** `LAMALIBRE_PORTLAMA_*` (CONFIG, DATA*DIR, PKI_DIR, ENROLLMENT_TOKEN, P12_PASS, …) → `LAMALIBRE_LAMASTE*_`. Ecosystem vars (`LAMALIBRE*CLOUD_TOKEN`, `LAMALIBRE_FERIA_BIN`, `LAMALIBRE_SPACES*_`, `LAMALIBRE_ORG`, `LAMALIBRE_PROJECT`) unchanged.
  - **Tauri:** `productName "Portlama"` → `"Lamaste"`; window title likewise; identifier `com.lamalibre.portlama.desktop` → `com.lamalibre.lamaste.desktop`; cargo crate name `portlama-desktop` → `lamaste-desktop`; bumped to 3.0.0.
  - **2FA cookie:** `portlama_2fa_session` → `lamaste_2fa_session` (no installed base — 2.0.0 unshipped).
  - **DigitalOcean tag:** `product:portlama` → `product:lamaste`. `lamalibre:managed` (ecosystem) unchanged.
  - **DigitalOcean SSH key labels + systemd-run unit names:** `lamalibre-portlama-update-<hex>` → `lamalibre-lamaste-update-<hex>`.
  - **Deep-link query param:** `lamalibre://callback?product=portlama` → `?product=lamaste`. The `lamalibre://` scheme itself is ecosystem-wide; product-tagged callbacks are still single-product today (lamaste is the only product wired into the desktop dispatcher).
  - **nginx file objects:** `lamalibre-portlama-{panel-domain,panel-ip,auth,tunnel,app-<sub>,site-<id>,agent-panel-<sub>,mtls.conf,authz-cache.conf,authz-loc.conf}` → `lamalibre-lamaste-*`.
  - **Code identifiers:** `PORTLAMA_DIR` → `LAMASTE_DIR`; snake_case / camelCase / underscore-bounded `portlama` tokens (`install_portlama`, `portlamaExists`, `portlama_session`, `portlama_authz`, etc.) → `lamaste` equivalents.
  - **Vendor layout under `create-lamaste`:** `vendor/panel-server` → `vendor/serverd`; `vendor/portlama-server` → `vendor/server`; `vendor/portlama-server-ui` → `vendor/server-ui`. Install destinations on the VPS migrate from `/opt/lamalibre/portlama/{panel-server,portlama-server,portlama-server-ui}/` to `/opt/lamalibre/lamaste/{serverd,server,server-ui}/`.
  - **Repo path on GitHub** (`github.com/lamalibre/portlama`) is unchanged here. Renaming the GitHub repo is a separate coordinated action — clones, the desktop's Feria-sibling-discovery walker, and the `lamalibre/plugin-development` sibling repo will be updated together when that lands.
  - **Out of scope (intentionally unchanged):** `RESERVED_API_PREFIXES` (route names like `tunnels`, `agents`, `gatekeeper`); registry filenames (`agents.json`, `servers.json`, `storage-servers.json`); HTTP headers; Tauri event names; capability names — these are namespaced by the package they live in, not by reverse-DNS.

### 2026-04-28

### Changed

- Brand-split rename across all operational identifiers — ecosystem-level surfaces use `lamalibre.*`, product-level (Portlama-specific) surfaces use `lamalibre.portlama.*`. 2.0.0 has not shipped, so this is a breaking rename with zero installed-base impact. NPM package names (`@lamalibre/portlama-*`), reserved API prefixes, capability names, registry filenames (`agents.json`, `servers.json`, `storage-servers.json`), Tauri event names, and HTTP header conventions stay product-scoped and are unaffected.
  - **launchd labels:** `com.portlama.{cloud,storage,local-plugin-host}` → `com.lamalibre.*` (ecosystem); `com.portlama.{server,admin,agent,desktop,agentd,serverd,chisel-<label>,panel-<label>}` → `com.lamalibre.portlama.*` (product).
  - **systemd units:** `portlama-{agentd,serverd,gatekeeper,chisel-<label>,panel-<label>}` → `lamalibre-portlama-*`; `portlama-local-plugin-host` → `lamalibre-local-plugin-host` (ecosystem); legacy `portlama-panel` unit name retired in favour of `lamalibre-portlama-serverd` (matches the package name).
  - **nginx file objects:** `portlama-panel-domain`, `portlama-panel-ip`, `portlama-auth`, `portlama-tunnel`, `portlama-app-<subdomain>`, `portlama-site-<id>`, `portlama-agent-panel-<subdomain>`, `portlama-mtls.conf`, `portlama-authz-cache.conf`, `portlama-authz-loc.conf` → `lamalibre-portlama-*`.
  - **Filesystem paths:** `/etc/portlama/...` → `/etc/lamalibre/portlama/...`; `~/.lamalibre/.portlama/...` → `~/.lamalibre/portlama/...` (de-hide); `~/.lamalibre/.portlama/local/` → `~/.lamalibre/local/` (hoist to ecosystem); `/opt/portlama/` → `/opt/lamalibre/portlama/`; `/etc/portlama/portlama-update-*.sh` → `/etc/lamalibre/portlama/update-*.sh`.
  - **Environment variables:** `PORTLAMA_{CLOUD_TOKEN,SPACES_ACCESS_KEY,SPACES_SECRET_KEY,NODE_BIN,NPM_BIN,FERIA_BIN}` → `LAMALIBRE_*` (ecosystem); `PORTLAMA_{CONFIG,DATA_DIR,PKI_DIR,STATE_DIR,CHISEL_AUTHFILE,CHISEL_KEYFILE,AGENTD_PATH,ENROLLMENT_TOKEN,P12_PASS}` → `LAMALIBRE_PORTLAMA_*` (product).
  - **Deep links:** `portlama://callback?token=…&domain=…` → `lamalibre://callback?product=portlama#token=…&domain=…&nonce=…` — scheme is ecosystem-wide; product is selected by query string and OAuth-style fragment carries the volatile parts.
  - **Cloud tags:** `portlama:managed` (single tag) → `lamalibre:managed` plus `product:portlama` (both required) — disambiguates resources owned by other Lamalibre products on the same DigitalOcean account.
  - **Sudoers temp prefixes:** `/tmp/portlama-authelia-*`, `/tmp/portlama-curl-*`, `/tmp/chisel-*`, `/tmp/portlama-portlama-server-ui-build` → `/tmp/lamalibre-portlama-*` — keeps sudoers `mv` rules narrowly scoped to the new prefix.
  - **Browser globals:** `window.__portlamaPlugins` → `window.__lamalibrePlugins`; `localStorage["portlama-cloud-disclaimer-dismissed"]` → `localStorage["lamalibre.cloud.disclaimer-dismissed"]`.
  - **DigitalOcean SSH key labels:** `portlama-update-<hex>` → `lamalibre-portlama-update-<hex>`.

### 2026-04-04

### Added

- Add Gatekeeper authorization service — generic principal-to-resource grant model with Portlama groups, nginx auth_request integration, and inline access-request pages on 403 (`portlama-gatekeeper` 0.1.0)
- Add three tunnel access modes: `public` (no auth), `authenticated` (Authelia login), `restricted` (Authelia + grant check) — configurable per tunnel at creation time (`panel-server`, `portlama-gatekeeper`)
- Add Gatekeeper admin panel — Dashboard, Groups, Grants, Access Requests, and Settings pages with full CRUD (`portlama-admin-panel`, `portlama-desktop`)
- Add Gatekeeper installer task — deploys package, creates state files, writes systemd service and nginx cache config (`create-portlama`)
- Add Gatekeeper CLI for local group, grant, and access management (`portlama-gatekeeper`)
- Add migration from legacy `user-plugin-access.json` grants to Gatekeeper's generic grant model (`portlama-gatekeeper`)
- Add Gatekeeper concept and API reference documentation (`panel-client`)
- Add server discovery — find existing Portlama-managed DigitalOcean droplets with DNS domain resolution and panel URL detection (`portlama-cloud`, `portlama-desktop`)
- Add SSH-based admin recovery — recover admin access when P12 certificate is lost via ephemeral SSH key pair and `portlama-reset-admin` (`portlama-cloud`, `portlama-desktop`)
- Add Discover Server wizard — desktop UI for discovering existing servers, registering them, and recovering admin certificates via SSH (`portlama-desktop`)
- Add `--json` non-interactive mode to admin certificate upgrade CLI with NDJSON progress output for desktop integration (`install-portlama-admin`)
- Add step-by-step progress reporting to agent uninstall with per-step status (complete/skipped/warning/failed) (`portlama-desktop`)
- Add type-to-confirm safety dialog for agent uninstall requiring the agent label to be typed (`portlama-agent-panel`)
- Add gatekeeper design document for future tunnel access control system (`panel-client`)

### Changed

- Rewrite desktop admin certificate upgrade as thin shell-out to `install-portlama-admin --json` replacing ~250 lines of Rust reimplementation (`portlama-desktop`)
- Move agent uninstall from `commands.rs` to `agents.rs` with per-agent scoping instead of removing the entire `~/.portlama` directory (`portlama-desktop`)

### Fixed

- Fix Keychain identity invisible after admin certificate upgrade — trust the Portlama CA in the login keychain via `security add-trusted-cert` (`install-portlama-admin`)
- Fix macOS curl unable to use Keychain identities — create a P12 file with the upgraded certificate for curl-based tools alongside the non-extractable Keychain import (`install-portlama-admin`)
- Fix `portlama-reset-admin` not restarting panel-server after config change — cached `adminAuthMode` prevented the reset from taking effect (`panel-server`)
- Fix Tauri error messages not displayed in admin and agent panel toasts — normalize plain string errors from `invoke()` via `errorMessage()` helper (`portlama-admin-panel`, `portlama-agent-panel`)
- Fix agent uninstall not navigating back to agent list after completion (`portlama-agent-panel`, `portlama-desktop`)
- Fix domain detection only matching 2-part TLDs — use DigitalOcean zone names for base domain identification (`portlama-cloud`)

### Removed

- Remove `access-control-sync.js` — Authelia access control rule sync replaced by Gatekeeper authorization (`panel-server`)

### Security

- Add shared API secret for Gatekeeper localhost management routes — prevents unsandboxed plugins from manipulating grants directly (`portlama-gatekeeper`, `panel-server`)
- Add fail-closed authorization — Gatekeeper denies access when tunnel is not found or `X-Original-URL` is missing, preventing bypass on empty cache (`portlama-gatekeeper`)
- Add admin-only enforcement for non-restricted tunnel access modes — agents cannot create `public` or `authenticated` tunnels (`panel-server`)
- Add session cache hard cap (10k entries) and Authelia-cookie-only cache key to prevent memory exhaustion and cache pollution on 512MB droplets (`portlama-gatekeeper`)
- Add group member cap (1000 per group) to prevent disk/memory exhaustion via unbounded membership (`portlama-gatekeeper`)
- Add admin role guard to all Gatekeeper proxy routes (`panel-server`)
- Add symlink attack protection to server directory cleanup on server removal (`portlama-desktop`)
- Add path traversal protection to SSH recovery cleanup — canonicalize paths before validation and use canonical path for operations (`portlama-cloud`, `portlama-desktop`)
- Fix TOCTOU in recovery cleanup — pass canonicalized directory path to Node.js CLI instead of original user input (`portlama-desktop`)

### 2026-04-02

### Added

- Add agent-side user plugin access — non-admin Authelia users can access agent-hosted plugins via dedicated tunneled subdomains with per-user access control (`panel-server`, `portlama-agent`, `portlama-desktop`, `portlama-admin-panel`)
- Add `target` field to grants — `'local'` for desktop install (existing), `'agent:<label>'` for browser access to a specific agent's plugin (`panel-server`)
- Add `plugin` tunnel type — Authelia-protected subdomain with nginx path rewriting to route traffic to the correct plugin on an agent's panel server (`panel-server`)
- Add `syncAllAccessControl()` — unified Authelia access control rule builder that merges site rules with plugin tunnel grant rules (`panel-server`)
- Add `Remote-User` header authentication to agent panel server — enables Authelia-authenticated users to access plugin routes via tunneled subdomains (`portlama-agent`)
- Add target selector (Local/Agent) to admin grant creation modal and target column to grant table (`portlama-admin-panel`)
- Add "Open in Browser" button for agent-side grants in desktop My Plugins page (`portlama-desktop`)
- Add user-access grant methods and agents endpoint to web admin client (`panel-client`)

### Security

- Restrict Authelia-authenticated users to plugin routes only — block `/api/*` management endpoints on agent panel server (`portlama-agent`)
- Add `Remote-User` header format validation to prevent header injection attacks (`portlama-agent`)
- Tighten `pluginName` regex to `^@lamalibre\/[a-z0-9][a-z0-9._-]*$` to prevent nginx config injection via crafted package names (`panel-server`)
- Add `pathPrefix` validation in `writeAppVhost()` as defense-in-depth against nginx directive injection (`panel-server`)
- Add admin-only restriction for plugin tunnel creation — agents with `tunnels:write` cannot create plugin tunnels (`panel-server`)
- Add `restrictAccess` flag for plugin tunnel Authelia rules — deny all non-admin access when no grants exist (admins-only by default) (`panel-server`)
- Add Authelia config backup/rollback on restart failure — prevents bricked authentication on config errors (`panel-server`)
- Add hard cap of 200 active grants to prevent Authelia config DoS via unbounded rule growth (`panel-server`)
- Add reserved route prefix validation — block plugin tunnels that would collide with `api`, `plugin-bundles`, or `internal` paths (`panel-server`)
- Return error to admin when Authelia access control sync fails on grant create/revoke instead of silent success (`panel-server`)
- Expand auth requirement to all `/{pluginName}/` routes (not just `/api/` paths) to prevent authentication bypass on non-API plugin routes (`portlama-agent`)

- Add Feria dev registry — local npm registry for `@lamalibre/*` packages with release artifact storage and GitHub Actions workflow runner (`feria`)
- Add Feria-first download fallback to desktop installer — checks local registry before GitHub Releases (`install-portlama-desktop`)
- Add plugin sidebar injection to desktop app — multi-page plugins replace agent tabs with plugin-specific navigation (`portlama-desktop`, `portlama-agent-panel`)
- Export `AgentPluginPanel` component for standalone plugin embedding with `onPagesDiscovered` callback (`portlama-agent-panel`)
- Add Plugins tab to desktop agent mode (`portlama-desktop`)

### Security

- Fix shell injection in desktop installer — replace `execSync` string interpolation with `execFileSync` array arguments in `installMacOS()` (`install-portlama-desktop`)
- Fix path traversal in Feria package store — validate scoped package names and apply `path.basename()` to prevent directory escape (`feria`)
- Fix path traversal in Feria release store — sanitize `tag` and `filename` parameters with `path.basename()` (`feria`)
- Fix host header poisoning in Feria — hardcode `registryUrl` from server config instead of deriving from `Host` header (`feria`)
- Fix over-broad URL decoding in Feria — `rewriteUrl` now only decodes `%2f` instead of full `decodeURIComponent` (`feria`)
- Add HTTPS-to-HTTP redirect downgrade protection in desktop installer (`install-portlama-desktop`)
- Add redirect depth limit (max 5 hops) to prevent infinite redirect loops in desktop installer (`install-portlama-desktop`)
- Fix Content-Disposition header injection in Feria — use strict character allowlist for asset filenames (`feria`)

### Changed

- Update plugin microfrontend theme API to use oklch color values via `HOST_THEME` constant (`portlama-agent-panel`)

**Affected packages:** `@lamalibre/portlama-panel-server` 0.1.30, `@lamalibre/portlama-agent` 1.0.24, `@lamalibre/portlama-admin-panel` 0.1.5, `@lamalibre/portlama-panel-client` 0.1.11, `@lamalibre/portlama-desktop` 0.1.15, `@lamalibre/create-portlama` 1.0.53, `@lamalibre/feria` 0.1.1, `@lamalibre/install-portlama-desktop` 0.0.7, `@lamalibre/portlama-agent-panel` 0.1.3, `@lamalibre/portlama-cloud` 0.1.4, `@lamalibre/portlama-identity` 0.1.1, `@lamalibre/portlama-tickets` 0.1.1

### 2026-04-01

### Added

- Add Authelia login to desktop app — non-admin users authenticate via browser-based OAuth-like flow and install plugins they've been granted access to (`panel-server`, `portlama-desktop`, `portlama-admin-panel`)
- Add "User Plugin Access" admin page for granting per-user, per-plugin enrollment rights (`portlama-admin-panel`, `portlama-desktop`)
- Add user-access API endpoints: grant CRUD (admin), OAuth authorize/exchange flow (public), plugin listing and enrollment (user session) (`panel-server`)
- Add HMAC-SHA256 signed user session tokens with 12h expiry and 2h inactivity timeout, distinct from 2FA sessions via `type: 'user-access'` field (`panel-server`)
- Add `portlama://` deep link scheme for desktop app OAuth callback with domain verification against stored pending login (`portlama-desktop`)
- Add User Login and My Plugins pages to desktop app sidebar (`portlama-desktop`)
- Add `user-access` to reserved API prefixes (`panel-server`, `portlama-agent`)
- Add nginx Authelia forward auth location for `/api/user-access/authorize` on auth vhost and public locations for exchange/plugins/enroll on panel domain vhost (`panel-server`)

### Security

- Add domain validation in desktop user-access login to prevent URL injection via crafted domain strings (`portlama-desktop`)
- Add deep link domain verification — store expected domain before opening browser, reject callbacks with mismatched domains to prevent MITM token theft (`portlama-desktop`)
- Add OTP hard cap (50 active tokens) and rate limiting on all user-access nginx locations to prevent DoS (`panel-server`)
- Fix agent plugin server routes bypassing authentication hook — auth now covers `/<plugin>/api/` routes in addition to `/api/*` (`portlama-agent`)
- Fix grant-to-plugin mismatch — desktop validates that the requested package matches the grant's plugin name before installation (`portlama-desktop`)
- Remove enrollment token from desktop frontend response to reduce credential exposure window (`portlama-desktop`)
- Upgrade OTP timing-safe comparison to use HMAC-digest pattern matching ticket system for defense-in-depth (`panel-server`)
- Add consumed grant cleanup (90-day retention) and stale OTP cleanup to prevent unbounded state file growth (`panel-server`)

- Add agent plugin hosting — agents serve plugins on their panel server (port 9393) with routes at `/<name>/...`, matching local plugin host URL pattern (`portlama-agent`)
- Add agent plugin lifecycle library with install, enable, disable, uninstall, update, and bundle read operations (`portlama-agent`)
- Add plugin CRUD endpoints to agent panel API: list, install, enable, disable, uninstall, update, and bundle serving (`portlama-agent`)
- Add Plugins management page to agent panel with curated plugin list, install form, plugin detail with microfrontend loader, enable/disable toggles, update checking, and uninstall (`portlama-agent-panel`)
- Add "Move to Agent" migration flow in desktop Local Plugins page — copies plugin data, installs on agent, removes local copy (`portlama-desktop`)
- Add `POST /api/agents/plugins/report` endpoint — agents report enabled plugin capabilities to server with persistence across restarts (`panel-server`)
- Add 8 Tauri commands for agent plugin management: get, install, enable, disable, uninstall, update, check-update, fetch bundle with chunked IPC for large bundles (`portlama-desktop`)
- Add `agents` to reserved API prefixes to prevent plugin name collision (`panel-server`, `portlama-agent`)
- Add server-side storage system — AES-256-GCM encrypted credential storage, plugin bindings, and admin API (`panel-server`)
- Add `POST /api/system/update` endpoint for admin-triggered panel self-update via systemd-run (`panel-server`)
- Add CSR-based agent certificate upgrade to hardware-bound via `POST /api/certs/agent/upgrade-cert` (`panel-server`)
- Add enrollment token revocation via `DELETE /api/certs/agent/enroll/:label` (`panel-server`)
- Add `@lamalibre/install-portlama-agent` package for agent cert upgrade to hardware-bound (new)
- Add Storage admin page to panel and admin-panel shared package (`panel-client`, `portlama-admin-panel`)
- Add panel server updater module with SSH-based remote update and health verification (`portlama-cloud`)
- Add panel update commands to desktop app: `check_panel_update`, `update_panel_server` (`portlama-desktop`)
- Add storage-to-panel bridge commands in desktop: `push_storage_to_panel`, `bind_plugin_storage`, `setup_plugin_storage` (`portlama-desktop`)

### Changed

- Refactor agent plugin CLI to delegate to shared `agent-plugins.js` library — CLI is now a thin wrapper (`portlama-agent`)
- Expand systemd `ReadWritePaths` for agent panel service to include agent data directory for plugin runtime state (`portlama-agent`)
- Migrate panel-client pages to portlama-admin-panel shared package — panel-client now consumes pages from the shared library (`panel-client`, `portlama-admin-panel`)
- Replace P12-based agent enrollment with CSR-based token enrollment — agent generates keypair locally, sends CSR with one-time token (`portlama-agent`)
- Remove macOS Keychain identity import from agent CLI — desktop app handles Keychain via Rust crate (`portlama-agent`)
- Enrollment token creation now silently replaces existing active token for the same label instead of returning 409 (`panel-server`)

### Fixed

- Add CORS support to agent panel server for desktop app plugin microfrontends — Tauri and localhost origins with credentials (`portlama-agent`)
- Add localhost-origin mTLS bypass on agent panel server — plugin microfrontend browser fetches no longer require mTLS headers when accessed from the desktop app (`portlama-agent`)
- Fix agent panel `--json` flag not propagated from global CLI flags — `getPanelExposeStatus` returned human-readable text instead of JSON (`portlama-agent`)
- Fix agent plugin routes mounted at wrong prefix — plugins expect `/${name}/...` (matching local plugin host) not `/api/plugins/${name}/...` (`portlama-agent`)
- Fix plugin disable endpoint race condition — `setImmediate` replaced with `setTimeout(500)` to flush HTTP response before panel service restart (`portlama-agent`)
- Fix Tauri IPC crash with large plugin bundles — split JS source into 16KB chunks in Rust, join in JavaScript to avoid WebKit JSON parser limits (`portlama-desktop`)
- Fix CSP blocking plugin microfrontend API calls — add `http://127.0.0.1:*` to `connect-src` and `'unsafe-eval'` to `script-src` (`portlama-desktop`)
- Fix `panel.json` written with mode 0640 instead of 0600 — file contains session secrets (`panel-server`, `create-portlama`)
- Fix missing fsync before rename in config auto-write and updateConfig — crash could corrupt config (`panel-server`)
- Fix CORS `origin: true` on local plugin host reflecting arbitrary origins with credentials — restrict to Tauri and localhost origins (`portlama-agent`)
- Fix sudoers wildcard for self-update allowing potential argument injection — tighten to require `.sh` extension (`create-portlama`)
- Fix missing buffer length validation in `decryptCredential` — corrupted data could cause unpredictable crypto errors (`panel-server`)
- Fix read-only storage operations unnecessarily holding write mutex (`panel-server`)
- Fix update script not cleaned up when systemd-run launch fails (`panel-server`)

### Security

- Tighten sudoers rule for panel self-update: pin `.sh` extension, add descriptive comment about wildcard scope (`create-portlama`)
- Restrict local plugin host CORS to explicit origin allowlist instead of echoing any origin (`portlama-agent`)
- Change `panel.json` file permissions from 0640 to 0600 — contains `sessionSecret` and `panel2fa.secret` (`panel-server`, `create-portlama`)

**Affected packages:** panel-server 0.1.28, panel-client 0.1.10, portlama-agent 1.0.22, portlama-agent-panel 0.1.2, create-portlama 1.0.51, portlama-admin-panel 0.1.3, portlama-cloud 0.1.3, portlama-desktop 0.1.14, install-portlama-agent 1.0.0 (new)

---

### 2026-03-30

### Added

- Add identity system for Authelia user metadata in plugin routes — plugins can identify which Authelia user is making a request through protected subdomains
- Add `@lamalibre/portlama-identity` SDK (v0.1.0) with `parseIdentity()` parser, `IdentityClient` for user/group queries, and Fastify plugin (`@lamalibre/portlama-identity/fastify`)
- Add `identity:read` and `identity:query` agent capabilities for identity header parsing and user metadata queries
- Add `GET /api/identity/self`, `GET /api/identity/users`, `GET /api/identity/users/:username`, `GET /api/identity/groups` panel API endpoints
- Add nginx `Remote-*` header clearing on all vhosts to prevent client-forged identity headers (panel domain, panel IP, app, static site, agent panel, public endpoints)
- Add identity capability toggles to admin certificate management UI
- Add "Create Storage Server" wizard to the desktop app — 3-step flow (Credentials → Configuration → Provisioning) for provisioning DigitalOcean Spaces buckets (`portlama-desktop`)
- Add storage server section to the Servers page with dedicated StorageServerCard component showing bucket details and destroy/remove actions (`portlama-desktop`)
- Add OS keychain storage for Spaces credentials via `com.portlama.storage` service — access key + secret key stored as JSON, never in plaintext (`portlama-desktop`)
- Add 9 Tauri commands for storage server lifecycle: credential management, validation, region listing, provisioning with NDJSON progress, registry CRUD, and destroy (`portlama-desktop`)
- Add `validate-spaces` CLI command for credential validation before provisioning (`portlama-cloud`)
- Add `StorageProvider` interface and DigitalOcean Spaces implementation for provisioning S3-compatible object storage independently from compute servers (`portlama-cloud`)
- Add `provision-storage`, `destroy-storage`, `storage-servers`, and `spaces-regions` CLI commands for storage lifecycle management (`portlama-cloud`)
- Add storage server registry at `~/.portlama/storage-servers.json` with atomic writes (`portlama-cloud`)
- Add minimal AWS Signature V4 signing for S3-compatible APIs using only `node:crypto` — no new dependencies (`portlama-cloud`)
- Extract shared `CleanupStack` from compute provisioner for reuse by both compute and storage provisioners (`portlama-cloud`)

### Changed

- Update E2E test infrastructure to use deterministic static IPs (`10.13.37.0/24`) — eliminates DHCP instability across snapshot restores
- Update E2E agent setup to use enrollment token flow instead of legacy P12 certificate transfer
- Update E2E VM provisioning with tiered snapshot system (node-ready → installed → provisioned) for faster iteration

**Affected packages:** portlama-identity 0.1.0 (new), panel-server 0.1.13, portlama-admin-panel 0.1.2, portlama-desktop 0.1.12, create-portlama 1.0.42, install-portlama-e2e-mcp 0.2.0, portlama-cloud 0.1.3

### Fixed

- Fix agent certificate revocation skipping active certs when a revoked entry with the same label exists in the registry
- Fix rate limiting blocking localhost API calls during rapid test/automation sequences — exempt `127.0.0.1` and `::1` from the global rate limit
- Fix `portlama-agent uninstall` hanging when run without a TTY (e.g. via `multipass exec` or CI) — use simple renderer when no terminal is attached
- Fix DigitalOcean token validation rejecting correctly-scoped tokens — update scope parser to handle both comma-separated and space-separated `X-OAuth-Scopes` header formats (OAuth 2.0 RFC 6749 compatibility)
- Fix stale scope names in dangerous-scope check — `loadbalancer:*` → `load_balancer:*`, `volume:*` → `block_storage:*` per current DO API
- Fix false rejection of tokens with `database:create` — now recognized as a DO-documented associated scope of `droplet:create`

**Affected packages:** panel-server 0.1.13, portlama-agent 1.0.16, portlama-cloud 0.1.2

### Security

- Fix SSRF in agent panel API proxy — validate that all curl targets use `https://` scheme before invocation (`portlama-agent`)
- Fix XSS and open-redirect in onboarding complete page — reject non-`https://` URLs in panel and auth link `href` attributes (`panel-client`)
- Fix clear-text password logging in installer summary and admin reset CLI — reference the password file path instead of printing the password (`create-portlama`, `panel-server`)
- Fix polynomial ReDoS in email validation regex used during cloud provisioning (`portlama-cloud`)
- Fix polynomial ReDoS in trailing-slash normalization for panel URLs and cert paths (`portlama-tickets`, `panel-server`)
- Fix incomplete HTML tag sanitization in documentation page heading ID generation (`panel-client`)
- Add `@fastify/rate-limit` (100 req/min) to panel server, agent panel server, and local plugin host (`panel-server`, `portlama-agent`)
- Add `permissions: contents: read` to CI workflow to follow least-privilege principle

**Affected packages:** panel-server 0.1.12, panel-client 0.1.9, portlama-agent 1.0.14, portlama-tickets 0.1.0, portlama-cloud 0.1.2, create-portlama 1.0.39

### 2026-03-29

### Added

- Add DigitalOcean DNS management to the cloud provisioning wizard — when the API token includes the `domain` resource group, the wizard shows a Domain step where users can select a DO-managed domain (or create a new one) and have A + wildcard A records created automatically after droplet creation
- Add `domains`, `create-domain`, and `domain-records` CLI commands to `portlama-cloud`
- Add `get_cloud_domains` and `create_cloud_domain` Tauri commands for desktop app integration
- Add `setup_dns` provisioning step between `wait_droplet` and `wait_ssh` — creates DNS records and registers them in the cleanup stack for rollback on failure
- Add standalone local plugin installation via the desktop app — install and manage `@lamalibre/` plugins directly on the local machine without requiring a server or agent
- Add "Local Plugins" sidebar section visible in both Agents and Servers modes in the desktop app
- Add local plugin host Fastify server on `127.0.0.1:9293` — mounts enabled plugin server routes and serves panel bundles, managed as a launchd/systemd user-level service
- Add curated plugin browser (Herd, Shell, Sync, Gate) with install, enable, disable, uninstall lifecycle
- Add plugin panel rendering via microfrontend loader for locally-installed plugins
- Add `modes` field to `portlama-plugin.json` manifest schema — plugins declare support for `server`, `agent`, and/or `local` execution modes (defaults to `['server', 'agent']`)
- Add bearer token authentication and Host header validation (DNS rebinding protection) to the local plugin host
- Add `local_plugins.rs` Tauri module with 11 commands for local plugin management from the desktop app

- Add agent web panel expose feature — agents can serve their management panel at `agent-<label>.<domain>` via a tunnelled mTLS-protected subdomain
- Add `panel:expose` capability for agent certificates — admin grants per-agent permission to expose the panel
- Add `POST /api/tunnels/expose-panel`, `DELETE /api/tunnels/retract-panel`, `GET /api/tunnels/agent-panel-status` endpoints for panel tunnel lifecycle
- Add `type` field to tunnel records (`app` or `panel`) with `agent-` subdomain prefix reserved for panel tunnels
- Add mTLS nginx vhost for panel tunnels — uses client certificate verification instead of Authelia forward auth
- Add agent panel Fastify HTTP server (`panel-server.js`) serving the SPA and REST API on `localhost:9393`
- Add independent panel system service (`com.portlama.panel-<label>` on macOS, `portlama-panel-<label>` on Linux) so the panel survives agent restarts
- Add `portlama-agent panel` CLI command with `--enable [--port 9393]`, `--disable`, and `--status [--json]` modes
- Add web agent client (`createWebAgentClient()`) — HTTP-based `AgentClient` implementation for the web SPA
- Add web panel expose toggle in agent panel Settings page with status indicator and URL display
- Add Tauri commands `get_panel_expose_status` and `toggle_panel_expose` for desktop app integration
- Add `build` script to `create-portlama` that runs `bundle-vendor.js`, keeping bundled panel-server in sync with source
- Add E2E tests for panel expose in both single-VM (19-panel-expose.sh) and three-VM (15-panel-expose.sh) suites
- Add in-app agent installation wizard to desktop app — guides users through server selection, enrollment token generation, and real-time setup progress
- Add DNS record override option in the cloud provisioning Domain step — detects existing A/wildcard records with conflicting IPs and offers an override checkbox to update them in place
- Add `get_cloud_domain_records` Tauri command and `doPut` API helper for fetching and updating DigitalOcean DNS records
- Add full server-side onboarding completion to the cloud provisioner — after droplet creation, automatically runs domain setup, DNS verification, and provisioning via mTLS-authenticated SSH curl through nginx (port 9292)
- Add `domain` field to `ServerEntry` in both TypeScript and Rust — persists the configured domain in the local server registry
- Add two-step server destroy confirmation in desktop app — inline Yes/No prompt followed by a type-to-confirm modal requiring the exact server label

### Changed

- Replace Agents/Servers mode toggle in desktop app sidebar with unified section layout — AGENTS, SERVERS, and LOCAL sections are always visible, agents and servers listed inline with status indicators, drill-down expands sub-navigation within each section
- Move Overview from a wizard tab to a scrollable popup screen in the cloud provisioning wizard, freeing horizontal space for remaining steps
- Add `--json` global flag to `portlama-agent setup` for NDJSON progress output (desktop app integration)
- Add `install_agent` Tauri command — checks Node.js, installs CLI via npm, streams NDJSON progress as `agent-install-progress` events
- Add "Install Agent" button to Agents page empty state and "Add Agent" header button for existing agents
- Add E2E tests for agent JSON setup in both single-VM (20-agent-json-setup.sh) and three-VM (16-agent-json-setup.sh) suites
  - Single-VM suite passed; three-VM suite needs a clean re-run (orchestrator interrupted during cleanup)

- Add `@lamalibre/portlama-agent-panel` shared package — extract agent-mode pages (Dashboard, Tunnels, Services, Logs, Settings) into a host-agnostic React library with `AgentClientContext` abstraction
- Add `createDesktopAgentClient(label)` factory in the desktop app — Tauri-backed implementation of the `AgentClient` interface with multi-agent label binding
- Add URL scheme validation on all `openExternal` calls — only HTTP(S) URLs accepted
- Add cross-agent cache isolation — agent query data is cleared when switching between agents
- Add `--json` flag to `create-portlama` installer for NDJSON progress output, enabling programmatic consumption by desktop and CI tools
- Add local server installation from the desktop app — install Portlama directly on the local Linux machine via `pkexec` privilege escalation
- Add "Install on This Machine" option to the Servers page dropdown (disabled on macOS with "Linux only" indicator)
- Add `LocalInstallWizard` component with overview, progress streaming, and completion steps
- Add existing installation detection and import — register a pre-existing `/etc/portlama/` installation without reinstalling
- Add E2E tests for `--json` installer output in both single-VM and three-VM suites

### Changed

- Update desktop app to consume agent pages from `@lamalibre/portlama-agent-panel` instead of local page components
- Namespace all agent-panel React Query keys with `['agent', ...]` prefix to prevent collisions with admin-panel queries

### Fixed

- Fix dashboard memory readout showing inflated values on Linux — use `mem.active` / `mem.available` instead of `mem.used` / `mem.free` from `systeminformation`, which incorrectly included kernel buffers and disk cache
- Fix server health check returning offline for mTLS-protected servers — attach admin P12 certificate to the health check curl request
- Fix cleanup spinner not stopping after successful provisioning in the cloud wizard
- Remove white background from desktop app dock icon — icon now renders with transparency on macOS

### Security

- Fix shell injection vector in provisioner SSH curl command — domain and email values are now base64-encoded before shell interpolation, preventing command injection via crafted domain names
- Add server-side input validation for domain names, subdomains, and emails in the provisioner — validates format with strict regexes before any use
- Add pagination hard cap (MAX_PAGES=10) to DNS list functions to prevent unbounded memory consumption
- Validate tunnel UUID parameters with regex before URL interpolation in agent panel API proxy routes
- Enforce `panel:expose` capability on PATCH and DELETE operations for panel-type tunnels
- Prevent cross-agent panel tunnel spoofing — agents can only create panel tunnels matching their own certificate label
- Strip sensitive fields from agent panel config endpoint — return `hasCertificate` boolean instead of filesystem paths
- Restrict panel server port to unprivileged range (1024-65535)
- Validate panel server mTLS CN strictly — accept only `agent:<label>` or `admin` (not any non-agent cert)
- Use constant-memory log reading (`tail -n 200`) instead of unbounded `readFile` to prevent OOM on 512MB droplets
- Pass enrollment token via `PORTLAMA_ENROLLMENT_TOKEN` env var in desktop agent install — never exposed in process args
- Validate `panel_url` scheme (`https://` required) in `install_agent` Tauri command to prevent SSRF via `file://` or other protocols
- Add concurrency guard on `install_agent` — prevents race conditions from concurrent installations for the same label
- Use `npm install --ignore-scripts` when installing agent CLI from desktop app
- Validate NDJSON-supplied file paths against `/etc/portlama/pki/` prefix with symlink resolution to prevent path traversal
- Use `libc::getuid()` for privilege operations instead of the `$USER` environment variable
- Gate `CARGO_MANIFEST_DIR` dev paths to debug builds only to avoid leaking developer filesystem layout in release binaries
- Bound NDJSON line reads to 64 KB to prevent memory exhaustion from a misbehaving child process
- Inherit stderr from child process to avoid pipe deadlock on verbose installations

**Affected packages:**

- `@lamalibre/portlama-cloud`: 0.1.1 → 0.1.2
- `@lamalibre/portlama-panel-server`: 0.1.10 → 0.1.12
- `@lamalibre/portlama-panel-client`: 0.1.8 → 0.1.9
- `@lamalibre/portlama-agent`: 1.0.11 → 1.0.14
- `@lamalibre/portlama-agent-panel`: 0.1.0 → 0.1.1
- `@lamalibre/portlama-admin-panel`: 0.1.0 → 0.1.1
- `@lamalibre/portlama-desktop`: 0.1.6 → 0.1.12
- `@lamalibre/create-portlama`: 1.0.35 → 1.0.38

### 2026-03-28

### Added

- Add multi-agent support — configure multiple agents pointing to different Portlama servers, each with isolated config, certs, logs, and plugins at `~/.portlama/agents/<label>/`
- Add `list` command to show all configured agents with connection status
- Add `switch <label>` command to change the default agent
- Add `--label` global flag to target a specific agent from any command
- Add `plugin` command for local agent plugin management (install, uninstall, update, status)
- Add `uninstall --all` with confirmation prompt to remove all agents and `~/.portlama`
- Add Agents landing page in desktop app — list all agents with start/stop controls and per-agent drill-down into Dashboard, Tunnels, Logs, and Settings
- Add `agents.rs` Tauri module — agent registry management with start/stop/restart/logs/tunnels/config commands
- Add automatic migration from single-agent (`agent.json`) to multi-agent registry with legacy file cleanup
- Add `upsertAgent` registry helper — idempotent add-or-update for agent entries
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

- Update `load_effective_config()` to three-tier priority: `agents.json` → `servers.json` → `agent.json`
- Update per-agent service names to include label: `portlama-chisel-<label>` (plist/systemd)
- Update per-agent plugin state to `~/.portlama/agents/<label>/plugins.json` and `plugins/` directories
- Extract admin pages from `panel-client` into shared `portlama-admin-panel` package — web panel now imports from the shared package
- Update desktop app server list from agent-only tab to Servers mode landing page with drill-down navigation
- Update desktop sidebar to show mode-contextual navigation — agent tabs, server list, or per-server admin tabs

### Fixed

- Fix `launchctl list` PID parsing — use exact column match instead of substring to prevent false positives between agents with similar labels
- Fix `storeEnrolledCert` receiving enrollment CN instead of local agent label, causing writes to wrong directory
- Fix `loadRegistry` silently swallowing JSON parse errors — now only returns null for missing file, throws on corruption
- Fix `saveRegistry` and `saveAgentConfig` missing `fsync` before rename — prevents data loss on power failure
- Fix agent log directories created with world-readable 0o755 instead of 0o700
- Fix `uninstallLegacy` not unloading the running agent before removing files

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

### 2026-03-26

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

### 2026-03-25

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
- Add agent cert (CN=agent:\*) bypass for 2FA — agents never need a session cookie, only admin cert holders are challenged

**Affected packages:**

- `@lamalibre/create-portlama` 1.0.31 → 1.0.32
- `@lamalibre/portlama-panel-server` 0.1.6 → 0.1.8
- `@lamalibre/portlama-panel-client` 0.1.4 → 0.1.6
- `@lamalibre/install-portlama-e2e-mcp` 0.1.3 → 0.1.4
- `@lamalibre/portlama-agent` 1.0.7 → 1.0.8

### 2026-03-24

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

### 2026-03-23

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

### 2026-03-22

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
