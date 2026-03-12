# Certificates API

> List, renew, rotate, and download the TLS and mTLS certificates that secure Portlama.

## In Plain English

Portlama manages two kinds of certificates:

1. **Let's Encrypt certificates** — these are the standard HTTPS certificates that browsers trust. Each domain and subdomain gets one, and they auto-renew every 60-90 days via certbot.

2. **mTLS client certificates** — this is the special certificate in your browser that proves you are the admin. It is self-signed by Portlama's own certificate authority and used to access the management panel.

The certificates API lets you see all certificates and their expiry dates, force an early renewal of any Let's Encrypt certificate, rotate the mTLS client certificate (generating a new one), download the client certificate file, and check whether the auto-renewal timer is running.

## Authentication

All certificate endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

## Endpoints

### `GET /api/certs`

Returns all certificates from both sources (Let's Encrypt and mTLS), sorted by days until expiry (soonest first).

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/certs | jq
```

**Response (200):**

```json
{
  "certs": [
    {
      "type": "mtls-ca",
      "domain": null,
      "expiresAt": "2036-03-13T00:00:00.000Z",
      "daysUntilExpiry": 3650,
      "path": "/etc/portlama/pki/ca.crt",
      "expiringSoon": false
    },
    {
      "type": "mtls-client",
      "domain": null,
      "expiresAt": "2028-03-13T00:00:00.000Z",
      "daysUntilExpiry": 730,
      "path": "/etc/portlama/pki/client.crt",
      "expiringSoon": false
    },
    {
      "type": "letsencrypt",
      "domain": "panel.example.com",
      "expiresAt": "2026-06-11T00:00:00.000Z",
      "daysUntilExpiry": 90,
      "path": "/etc/letsencrypt/live/panel.example.com/fullchain.pem",
      "expiringSoon": false
    },
    {
      "type": "letsencrypt",
      "domain": "app.example.com",
      "expiresAt": "2026-04-12T00:00:00.000Z",
      "daysUntilExpiry": 30,
      "path": "/etc/letsencrypt/live/app.example.com/fullchain.pem",
      "expiringSoon": true
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `type` | `string` | `"letsencrypt"`, `"mtls-ca"`, or `"mtls-client"` |
| `domain` | `string \| null` | Domain name for Let's Encrypt certs, `null` for mTLS certs |
| `expiresAt` | `string` | ISO 8601 expiry date |
| `daysUntilExpiry` | `number` | Days remaining until expiry |
| `path` | `string` | Filesystem path to the certificate |
| `expiringSoon` | `boolean` | `true` if fewer than 30 days remain |

The endpoint never fails entirely — if one source (Let's Encrypt or mTLS) cannot be read, the other source's certificates are still returned. Errors are logged server-side.

---

### `GET /api/certs/auto-renew-status`

Checks the status of the certbot auto-renewal systemd timer. Portlama looks for both `certbot.timer` and `certbot-renew.timer` (different distributions use different names).

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/certs/auto-renew-status | jq
```

**Response (200) — timer active:**

```json
{
  "active": true,
  "nextRun": "2026-03-14T03:00:00.000Z",
  "lastRun": "2026-03-13T03:00:00.000Z"
}
```

**Response (200) — timer inactive:**

```json
{
  "active": false,
  "nextRun": null,
  "lastRun": null
}
```

| Field | Type | Description |
|-------|------|-------------|
| `active` | `boolean` | Whether the certbot renewal timer is running |
| `nextRun` | `string \| null` | ISO 8601 timestamp of next scheduled run, or `null` |
| `lastRun` | `string \| null` | ISO 8601 timestamp of last run, or `null` |

This endpoint always returns 200. If the timer status cannot be determined, it returns `active: false` with null timestamps.

---

### `POST /api/certs/:domain/renew`

Forces immediate renewal of a Let's Encrypt certificate using `certbot renew --force-renewal`. After renewal, the new expiry date is read from the certificate, and nginx is reloaded to pick up the new cert.

**Request:**

No request body. The domain is specified in the URL path.

**URL parameter validation:**

The `:domain` parameter is validated against `^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` — a strict DNS hostname regex that enforces valid label lengths and boundary characters.

```bash
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/certs/app.example.com/renew | jq
```

**Response (200):**

```json
{
  "ok": true,
  "domain": "app.example.com",
  "newExpiry": "2026-06-11T00:00:00.000Z"
}
```

**Response (200) — with warning:**

```json
{
  "ok": true,
  "domain": "app.example.com",
  "newExpiry": "2026-06-11T00:00:00.000Z",
  "warning": "Certificate renewed but nginx reload failed"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | `true` if renewal succeeded |
| `domain` | `string` | The renewed domain |
| `newExpiry` | `string \| null` | ISO 8601 expiry date of the new certificate, or `null` if it could not be read |
| `warning` | `string` | Present if nginx reload or config test failed after renewal |

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed","details":{"issues":[...]}}` | Invalid domain format |
| 404 | `{"error":"Certificate not found"}` | certbot has no certificate with this name |
| 500 | `{"error":"Certificate renewal failed","details":"..."}` | certbot command failed |

The certbot command has a 90-second timeout. If it times out, a 500 error is returned.

---

### `POST /api/certs/mtls/rotate`

Rotates the mTLS client certificate. This generates a new certificate and key pair, replacing the existing one. After rotation, nginx is reloaded to accept the new certificate.

**This is a disruptive operation.** After rotation, you must download and import the new client certificate into your browser. The old certificate will no longer be accepted.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/certs/mtls/rotate | jq
```

**Response (200):**

```json
{
  "ok": true,
  "p12Password": "a1b2c3d4e5f6...",
  "expiresAt": "2028-03-16T00:00:00.000Z",
  "warning": "Your current browser certificate is now invalid. Download and import the new certificate before closing this page."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | `true` if rotation succeeded |
| `p12Password` | `string` | Random hex password for the new `.p12` bundle. Only shown once |
| `expiresAt` | `string` | ISO 8601 expiry date of the new certificate (2-year validity) |
| `warning` | `string` | Always present. Notes that the old certificate is now invalid. If nginx reload or config test also fails, the warning is appended with details |

**Errors:**

| Status | Body | When |
|--------|------|------|
| 500 | `{"error":"mTLS rotation failed: ..."}` | Certificate generation or file operations failed |
| 500 | `{"error":"CA key not found — cannot sign new certificate"}` | CA key missing from PKI directory |

---

### `GET /api/certs/mtls/download`

Downloads the current mTLS client certificate as a PKCS#12 (`.p12`) file. This is the file you import into your browser or keychain.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -o client.p12 \
  https://203.0.113.42:9292/api/certs/mtls/download
```

**Response (200):**

Returns `Content-Type: application/x-pkcs12` with `Content-Disposition: attachment; filename="client.p12"`.

The response body is the raw binary PKCS#12 file.

**Errors:**

| Status | Body | When |
|--------|------|------|
| 404 | `{"error":"No client certificate found"}` | The `.p12` file does not exist at the expected path |
| 500 | `{"error":"Failed to download certificate"}` | File read failed |

---

## Agent Certificate Endpoints

Agent certificates provide scoped access for Mac tunnel clients. Only admins can manage agent certificates.

### `POST /api/certs/agent`

Generates a new agent-scoped certificate with the specified label and capabilities. The certificate CN is set to `agent:<label>`.

**Request:**

```json
{
  "label": "macbook-pro",
  "capabilities": ["tunnels:read", "tunnels:write"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `label` | `string` | Yes | 1-50 characters, lowercase letters, numbers, and hyphens only |
| `capabilities` | `string[]` | No | List of capabilities. Defaults to `["tunnels:read"]`. Must always include `tunnels:read` |

**Valid capabilities:** `tunnels:read`, `tunnels:write`, `services:read`, `services:write`, `system:read`

```bash
curl -s --cert client.p12:password \
  -X POST -H 'Content-Type: application/json' \
  -d '{"label":"macbook-pro","capabilities":["tunnels:read","tunnels:write"]}' \
  https://203.0.113.42:9292/api/certs/agent | jq
```

**Response (200):**

```json
{
  "ok": true,
  "label": "macbook-pro",
  "p12Password": "a1b2c3d4e5f6...",
  "serial": "ABC123DEF456...",
  "expiresAt": "2028-03-16T00:00:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | `true` if generation succeeded |
| `label` | `string` | The agent label |
| `p12Password` | `string` | Random hex password for the `.p12` bundle. Only shown once |
| `serial` | `string` | Certificate serial number |
| `expiresAt` | `string` | ISO 8601 expiry date (2-year validity) |

**Important:** The `p12Password` is only returned at generation time. It cannot be retrieved later.

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed","details":{...}}` | Invalid label format or missing `tunnels:read` |
| 409 | `{"error":"Agent certificate with label \"macbook-pro\" already exists"}` | Label already in use (non-revoked) |
| 500 | `{"error":"Agent certificate generation failed: ..."}` | OpenSSL or file operation failed |

---

### `GET /api/certs/agent`

Lists all agent certificates with their status, capabilities, and expiry information.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/certs/agent | jq
```

**Response (200):**

```json
{
  "agents": [
    {
      "label": "macbook-pro",
      "serial": "ABC123DEF456...",
      "capabilities": ["tunnels:read", "tunnels:write"],
      "createdAt": "2026-03-16T10:00:00.000Z",
      "expiresAt": "2028-03-16T10:00:00.000Z",
      "revoked": false,
      "expiringSoon": false
    },
    {
      "label": "office-imac",
      "serial": "789GHI012...",
      "capabilities": ["tunnels:read"],
      "createdAt": "2026-03-10T08:00:00.000Z",
      "expiresAt": "2028-03-10T08:00:00.000Z",
      "revoked": true,
      "expiringSoon": false
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `label` | `string` | Agent identifier (matches certificate CN `agent:<label>`) |
| `serial` | `string` | Certificate serial number |
| `capabilities` | `string[]` | Granted capabilities |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `expiresAt` | `string` | ISO 8601 expiry timestamp |
| `revoked` | `boolean` | Whether the certificate has been revoked |
| `expiringSoon` | `boolean` | `true` if the certificate is not revoked and fewer than 30 days remain until expiry |

---

### `GET /api/certs/agent/:label/download`

Downloads an agent certificate as a PKCS#12 (`.p12`) file.

**Request:**

No request body. The label is specified in the URL path.

```bash
curl -s --cert client.p12:password \
  -o macbook-pro.p12 \
  https://203.0.113.42:9292/api/certs/agent/macbook-pro/download
```

**Response (200):**

Returns `Content-Type: application/x-pkcs12` with `Content-Disposition: attachment; filename="macbook-pro.p12"`.

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed",...}` | Invalid label format |
| 404 | `{"error":"Agent certificate \"macbook-pro\" not found"}` | No P12 file on disk (may have been revoked) |

---

### `PATCH /api/certs/agent/:label/capabilities`

Updates the capabilities for an existing agent certificate. Capabilities are stored server-side in the agent registry, not in the certificate itself, so no certificate reissue is needed.

**Request:**

```json
{
  "capabilities": ["tunnels:read", "tunnels:write", "system:read"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `capabilities` | `string[]` | Yes | New capability list. Must include `tunnels:read` |

```bash
curl -s --cert client.p12:password \
  -X PATCH -H 'Content-Type: application/json' \
  -d '{"capabilities":["tunnels:read","tunnels:write","system:read"]}' \
  https://203.0.113.42:9292/api/certs/agent/macbook-pro/capabilities | jq
```

**Response (200):**

```json
{
  "ok": true,
  "label": "macbook-pro",
  "capabilities": ["tunnels:read", "tunnels:write", "system:read"]
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed",...}` | Invalid capability or missing `tunnels:read` |
| 404 | `{"error":"Agent certificate \"macbook-pro\" not found"}` | No active agent with this label |

---

### `DELETE /api/certs/agent/:label`

Revokes an agent certificate. The certificate serial is added to the revocation list, the registry entry is marked as revoked, and the P12 files are deleted from disk. The agent loses access immediately.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/certs/agent/macbook-pro | jq
```

**Response (200):**

```json
{
  "ok": true,
  "label": "macbook-pro"
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed",...}` | Invalid label format |
| 404 | `{"error":"Agent certificate \"macbook-pro\" not found"}` | No agent with this label, or already revoked |

---

## Certificate Types

### Let's Encrypt Certificates

- **Issued by:** Let's Encrypt CA (publicly trusted)
- **Purpose:** HTTPS for tunnel subdomains and panel domain
- **Validity:** 90 days
- **Renewal:** Automatic via `certbot.timer` (runs twice daily, renews when < 30 days remain)
- **Path pattern:** `/etc/letsencrypt/live/<domain>/fullchain.pem`
- **Issued during:** Onboarding provisioning (panel cert) and tunnel creation (per-subdomain certs)

### mTLS Client Certificates

- **Issued by:** Portlama's self-signed CA
- **Purpose:** Admin authentication to the management panel
- **Validity:** 2 years
- **Renewal:** Manual via `/api/certs/mtls/rotate`
- **Path:** `/etc/portlama/pki/client.p12`
- **Issued during:** Initial installation by `create-portlama`

### Agent Certificates

- **Issued by:** Portlama's self-signed CA
- **Purpose:** Scoped access for Mac tunnel clients (`CN=agent:<label>`)
- **Validity:** 2 years
- **Capabilities:** Server-side, updatable without reissuing the certificate
- **Path:** `/etc/portlama/pki/agents/<label>/client.p12`
- **Issued via:** `POST /api/certs/agent` (admin only)
- **Revocation:** Immediate via `/api/certs/agent/:label` (serial added to revocation list)

## Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/certs` | List all certs (sorted by expiry) |
| GET | `/api/certs/auto-renew-status` | Check certbot timer status |
| POST | `/api/certs/:domain/renew` | Force-renew a Let's Encrypt cert |
| POST | `/api/certs/mtls/rotate` | Rotate mTLS client certificate |
| GET | `/api/certs/mtls/download` | Download client.p12 file |
| POST | `/api/certs/agent` | Generate agent certificate |
| GET | `/api/certs/agent` | List agent certificates |
| GET | `/api/certs/agent/:label/download` | Download agent .p12 file |
| PATCH | `/api/certs/agent/:label/capabilities` | Update agent capabilities |
| DELETE | `/api/certs/agent/:label` | Revoke agent certificate |

### Certificate Object Shape

```json
{
  "type": "letsencrypt",
  "domain": "app.example.com",
  "expiresAt": "2026-06-11T00:00:00.000Z",
  "daysUntilExpiry": 90,
  "path": "/etc/letsencrypt/live/app.example.com/fullchain.pem",
  "expiringSoon": false
}
```

### curl Cheat Sheet

```bash
# List all certificates
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/certs | jq

# Check auto-renewal timer
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/certs/auto-renew-status | jq

# Force-renew a certificate
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/certs/app.example.com/renew | jq

# Rotate mTLS certificate
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/certs/mtls/rotate | jq

# Download client certificate
curl -s --cert client.p12:password \
  -o client-new.p12 \
  https://203.0.113.42:9292/api/certs/mtls/download

# Generate an agent certificate
curl -s --cert client.p12:password \
  -X POST -H 'Content-Type: application/json' \
  -d '{"label":"macbook-pro","capabilities":["tunnels:read","tunnels:write"]}' \
  https://203.0.113.42:9292/api/certs/agent | jq

# List agent certificates
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/certs/agent | jq

# Update agent capabilities
curl -s --cert client.p12:password \
  -X PATCH -H 'Content-Type: application/json' \
  -d '{"capabilities":["tunnels:read","services:read"]}' \
  https://203.0.113.42:9292/api/certs/agent/macbook-pro/capabilities | jq

# Revoke an agent certificate
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/certs/agent/macbook-pro | jq
```
