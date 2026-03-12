# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
