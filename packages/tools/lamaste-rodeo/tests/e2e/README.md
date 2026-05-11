# Lamaste End-to-End Test Plan

## Overview

This directory contains end-to-end tests that verify the complete Lamaste system works correctly from installation through daily management operations. Tests exercise the real API endpoints using curl with mTLS client certificates.

## Test Inventory

| #   | Script                    | Description                                                                    | Requires DNS  |
| --- | ------------------------- | ------------------------------------------------------------------------------ | :-----------: |
| 01  | `01-fresh-install.sh`     | Node.js, panel service, health endpoint, static files                          |      No       |
| 02  | `02-mtls-enforcement.sh`  | mTLS enforcement: no-cert rejected, valid cert accepted, invalid cert rejected |      No       |
| 03  | `03-onboarding-flow.sh`   | Domain setup, DNS verification, provisioning, post-completion 410 behavior     | Yes (partial) |
| 04  | `04-tunnel-lifecycle.sh`  | Tunnel CRUD: create, list, nginx vhost, validation, delete, cleanup            |      No       |
| 05  | `05-user-lifecycle.sh`    | User CRUD: create, list, TOTP reset, update, delete, last-user protection      |      No       |
| 06  | `06-service-control.sh`   | Service list, restart, reload, panel stop protection, invalid service/action   |      No       |
| 07  | `07-cert-renewal.sh`      | Certificate list, force renewal, auto-renew timer status                       |      Yes      |
| 08  | `08-mtls-rotation.sh`     | mTLS rotation, P12 download, certificate fingerprint change                    |      No       |
| 09  | `09-ip-fallback.sh`       | IP:9292 access works independently of domain nginx configuration               |      No       |
| 10  | `10-resilience.sh`        | Service failure detection and recovery via API                                 |      No       |
| 11  | `11-input-validation.sh`  | Input validation across all API endpoints                                      |      No       |
| 12  | `12-user-invitations.sh`  | User invitation flow: create, accept, token validation                         |      No       |
| 13  | `13-site-lifecycle.sh`    | Static site CRUD, file upload/delete, settings, input validation               |      No       |
| 15  | `15-plugin-lifecycle.sh`  | Plugin management, push-install endpoints, enable/disable, policy CRUD         |      No       |
| 16  | `16-enrollment-tokens.sh` | Hardware-bound cert enrollment: token creation, public enrollment, registry    |      No       |
| 17  | `17-panel-2fa.sh`         | Built-in TOTP 2FA: setup, verify, session cookies, IP vhost toggle, reset      |      No       |

## Prerequisites

- **Target system**: Ubuntu 24.04 LTS with Lamaste installed (or Docker container)
- **Required tools**: `curl`, `jq`, `openssl`, `systemctl`
- **mTLS certificates**: Valid client cert, key, and CA cert

## Configuration

All tests read configuration from environment variables:

| Variable         | Default                                 | Description                                 |
| ---------------- | --------------------------------------- | ------------------------------------------- |
| `BASE_URL`       | `https://127.0.0.1:9292`                | Panel base URL                              |
| `CERT_PATH`      | `/etc/lamalibre/lamaste/pki/client.crt` | mTLS client certificate                     |
| `KEY_PATH`       | `/etc/lamalibre/lamaste/pki/client.key` | mTLS client key                             |
| `CA_PATH`        | `/etc/lamalibre/lamaste/pki/ca.crt`     | CA certificate                              |
| `CURL_TIMEOUT`   | `30`                                    | Curl timeout in seconds                     |
| `SKIP_DNS_TESTS` | `0`                                     | Set to `1` to skip tests requiring real DNS |

## Running Tests

### Individual test

```bash
bash tests/e2e/04-tunnel-lifecycle.sh
```

### All tests

```bash
bash tests/e2e/run-all.sh
```

### Skip DNS-dependent tests

```bash
SKIP_DNS_TESTS=1 bash tests/e2e/run-all.sh
```

### Custom panel URL and certs

```bash
BASE_URL=https://203.0.113.42:9292 \
CERT_PATH=/path/to/client.crt \
KEY_PATH=/path/to/client.key \
CA_PATH=/path/to/ca.crt \
bash tests/e2e/run-all.sh
```

## Docker-Based Testing

For isolated testing without a real droplet:

```bash
cd tests/e2e/docker

# Build and start
docker compose up -d

# Wait for healthcheck, then run tests
docker compose exec lamaste bash -c "
  cd /opt/lamalibre/lamaste/project
  npx @lamalibre/create-lamaste  # install on the container
  SKIP_DNS_TESTS=1 bash tests/e2e/run-all.sh
"

# Tear down
docker compose down
```

**Docker limitations:**

- Let's Encrypt tests cannot run (no real DNS). Use `SKIP_DNS_TESTS=1`.
- The container requires `--privileged` for systemd.
- Some mTLS behavior differs in development mode (`NODE_ENV=development`).

## Real Droplet Testing

1. Provision a fresh Ubuntu 24.04 droplet
2. Run the installer: `npx @lamalibre/create-lamaste`
3. Copy test scripts to the droplet or clone the repo
4. Run tests directly on the droplet:

```bash
bash tests/e2e/run-all.sh
```

For full DNS tests, point a real domain at the droplet's IP first.

## Test Output

Each test produces colored pass/fail output:

```
============================================================================
  Lamaste E2E: 04 — Tunnel Lifecycle
============================================================================

--- Pre-flight: check onboarding is complete ---
  [PASS] Onboarding is complete

--- Create tunnel ---
  [PASS] Tunnel creation returned ok: true
  [PASS] Tunnel subdomain matches
  ...

============================================================================
  Results: 12 passed, 0 failed, 0 skipped (12 total)
============================================================================
```

The master runner (`run-all.sh`) exits with code 0 if all tests pass, or code 1 if any fail.

## Architecture

- **`helpers.sh`** — Shared assertion functions, API request helpers, service wait utilities, colored logging, and test lifecycle management. All test scripts source this file.
- Each test script is independently executable and self-contained.
- Tests clean up after themselves (created tunnels, users, etc. are deleted).
- The test suite is designed to run sequentially; the master runner enforces ordering.

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied. The authors and contributors accept no liability for any damages, data loss, security incidents, or legal consequences arising from the use of this software.

Lamaste is designed for self-hosted use cases — personal projects, development environments, demos, and internal tools. It is not a substitute for production infrastructure. Production workloads require dedicated hosting, load balancing, redundancy, monitoring, and operational expertise that are beyond the scope of this project.

**You are solely responsible for what you expose through Lamaste.** By tunneling an application to the public internet, you grant anyone with access the ability to interact with that application as if they were on your local network. This carries inherent risks:

- **Arbitrary code execution:** If the tunneled application contains vulnerabilities or backdoors, remote attackers may exploit them to execute code on your machine, access your file system, or compromise your operating system.
- **Data exposure:** Misconfigured or insecure applications may leak sensitive data, credentials, or private files to the internet.
- **Lateral movement:** A compromised tunneled application may be used as an entry point to attack other devices and services on your local network.
- **Resource abuse:** Publicly accessible applications may be used for cryptocurrency mining, spam relaying, botnet hosting, or other abuse that could result in legal action against you.

Lamaste provides authentication and access control mechanisms, but no security measure is absolute. It is your responsibility to understand the software you expose, keep it updated, and assess the risks of making it publicly accessible. The authors of Lamaste bear no responsibility for the consequences of tunneling untrusted, vulnerable, or malicious software.
