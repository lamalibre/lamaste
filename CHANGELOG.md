# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-03-19

### Added

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

### Changed

- Update site file endpoints (`GET/POST/DELETE /api/sites/:id/files`) to accept agent certificates with appropriate capabilities
- Update `GET /api/sites` to filter results based on agent's `allowedSites` when accessed with an agent certificate
- Update sudoers template to use `portlama:portlama` instead of installer's UID for file ownership

### Security

- Add server-side file extension allowlist enforcement — blocks uploads of executable, scripting, and unknown file types regardless of client
- Add client-side (agent) file extension allowlist — catches disallowed files early with helpful error messages before upload
- Add ClamAV malware scanning in deploy pipeline — prevents deploying infected content to static sites
- Add symlink protection in deploy command directory scanner (skips symlinks, uses `lstat` to prevent TOCTOU)
- Add `encodeURIComponent` on all dynamic URL path segments in panel client API helpers and agent CLI
- Add regex validation on `allowedSites` entries in `UpdateAllowedSitesSchema`

**Affected packages:**
- `@lamalibre/portlama-panel-server` 0.1.0 → 0.1.1
- `@lamalibre/portlama-panel-client` 0.1.0 → 0.1.1
- `@lamalibre/create-portlama` 1.0.23 → 1.0.24
- `@lamalibre/portlama-agent` 1.0.1 → 1.0.2

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
