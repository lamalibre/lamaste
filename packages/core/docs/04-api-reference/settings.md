# Settings API

> Two-factor authentication (2FA) configuration for the admin panel. All endpoints are admin-only and fall under the management route group.

## In Plain English

The settings API lets you enable, configure, and manage TOTP-based two-factor authentication for the admin panel. When 2FA is enabled, every admin request must carry both a valid mTLS client certificate and a valid session cookie. The session cookie is issued after the admin verifies a TOTP code and lasts for 12 hours (or 2 hours of inactivity, whichever comes first).

The lifecycle is:

1. **Check status** — `GET /api/settings/2fa` tells you whether 2FA is enabled.
2. **Setup** — `POST /api/settings/2fa/setup` generates a TOTP secret and returns a `otpauth://` URI for scanning with an authenticator app.
3. **Confirm** — `POST /api/settings/2fa/confirm` verifies the first code from the authenticator app, enabling 2FA and disabling the IP-based vhost.
4. **Verify (ongoing)** — `POST /api/settings/2fa/verify` is called at the start of each admin session to exchange a TOTP code for a session cookie.
5. **Disable** — `POST /api/settings/2fa/disable` turns off 2FA and re-enables the IP-based vhost. Requires a valid 2FA session and a TOTP code.

## Authentication

All endpoints require a valid mTLS admin certificate. The **status** (`GET /api/settings/2fa`) and **verify** (`POST /api/settings/2fa/verify`) endpoints are exempt from the 2FA session requirement — they must be accessible before the admin has a session cookie. All other endpoints require a valid 2FA session when 2FA is enabled.

**Note:** Agent certificates bypass 2FA entirely — the 2FA session middleware skips all requests where `certRole` is `agent`. Only admin certificate holders are subject to the 2FA requirement.

## Rate Limiting

The `/confirm`, `/verify`, and `/disable` endpoints enforce per-IP rate limiting:

- **5 attempts** per 2-minute sliding window
- **5-minute ban** once the limit is exceeded

Rate-limited requests receive:

**Response (429):**

```json
{
  "error": "Too many attempts. Try again later.",
  "retryAfter": 300
}
```

| Field        | Type     | Description                               |
| ------------ | -------- | ----------------------------------------- |
| `retryAfter` | `number` | Seconds until the ban expires             |

## Session Cookie

When `POST /api/settings/2fa/verify` succeeds, the server sets a `lamaste_2fa_session` cookie:

| Property     | Value            |
| ------------ | ---------------- |
| Name         | `lamaste_2fa_session` |
| Signing      | HMAC-SHA256      |
| HttpOnly     | Yes              |
| Secure       | Yes              |
| SameSite     | Strict           |
| Absolute TTL | 12 hours         |
| Inactivity   | 2 hours          |

If a request arrives with a valid mTLS certificate but without a valid 2FA session cookie (when 2FA is enabled), the API returns:

**Response (401):**

```json
{
  "error": "2fa_required"
}
```

## Endpoints

### `GET /api/settings/2fa`

Returns the current 2FA status. This endpoint is exempt from the 2FA session requirement, so the UI can check whether to show the verification prompt.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/settings/2fa | jq
```

**Response (200):**

```json
{
  "enabled": false,
  "setupComplete": false
}
```

| Field           | Type      | Description                                       |
| --------------- | --------- | ------------------------------------------------- |
| `enabled`       | `boolean` | Whether 2FA is currently active                   |
| `setupComplete` | `boolean` | Whether the initial setup and confirmation is done |

---

### `POST /api/settings/2fa/setup`

Generates a new TOTP secret and returns the provisioning URI for scanning with an authenticator app (Google Authenticator, 1Password, etc.) and a manual entry key for apps that do not support QR scanning.

Requires that a domain has been configured on the panel (enabling 2FA disables IP:9292 access, so a domain is required for continued access).

**Request:**

No request body.

```bash
curl -s -X POST --cert client.p12:password \
  https://203.0.113.42:9292/api/settings/2fa/setup | jq
```

**Response (200):**

```json
{
  "uri": "otpauth://totp/Lamaste%20Panel:admin?secret=JBSWY3DPEHPK3PXP&issuer=Lamaste%20Panel",
  "manualKey": "JBSWY3DPEHPK3PXP"
}
```

| Field       | Type     | Description                                            |
| ----------- | -------- | ------------------------------------------------------ |
| `uri`       | `string` | `otpauth://` URI — encode as QR code for scanning      |
| `manualKey` | `string` | Base32-encoded secret for manual entry in the auth app  |

**Errors:**

| Status | Body                                                                  | When                            |
| ------ | --------------------------------------------------------------------- | ------------------------------- |
| 400    | `{"error": "Domain must be configured before enabling 2FA", "details": {"hint": "..."}}` | No domain has been provisioned  |
| 409    | `{"error": "2FA is already enabled"}`                                 | 2FA is already active           |

---

### `POST /api/settings/2fa/confirm`

Verifies the first TOTP code after setup, completing the 2FA activation. Once confirmed, 2FA is enabled and the IP-based vhost is disabled (all access goes through the domain vhost). This is a one-time operation during setup.

**Request:**

```json
{
  "code": "123456"
}
```

| Field  | Type     | Required | Description                              |
| ------ | -------- | -------- | ---------------------------------------- |
| `code` | `string` | Yes      | 6-digit TOTP code from authenticator app |

```bash
curl -s -X POST --cert client.p12:password \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  https://203.0.113.42:9292/api/settings/2fa/confirm | jq
```

**Response (200):**

```json
{
  "enabled": true
}
```

The response also sets the `lamaste_2fa_session` cookie (see [Session Cookie](#session-cookie)), so no separate `/verify` call is needed for the initial session.

**Errors:**

| Status | Body                                                                              | When                                |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------- |
| 400    | `{"error": "Code must be exactly 6 digits"}`                                      | Code format invalid                 |
| 400    | `{"error": "No 2FA setup in progress. Call POST /settings/2fa/setup first."}`     | No secret has been generated yet    |
| 401    | `{"error": "Invalid TOTP code"}`                                                  | TOTP code is incorrect or expired   |
| 409    | `{"error": "2FA is already enabled"}`                                             | 2FA is already active               |
| 429    | `{"error": "Too many attempts. Try again later."}`                                | Rate limit exceeded                 |
| 500    | `{"error": "Failed to disable IP vhost. 2FA was not enabled."}`                   | nginx config update failed          |

---

### `POST /api/settings/2fa/verify`

Verifies a TOTP code and issues a session cookie. Called at the start of each admin session when 2FA is enabled. This endpoint is exempt from the 2FA session requirement.

**Request:**

```json
{
  "code": "123456"
}
```

| Field  | Type     | Required | Description                              |
| ------ | -------- | -------- | ---------------------------------------- |
| `code` | `string` | Yes      | 6-digit TOTP code from authenticator app |

```bash
curl -s -X POST --cert client.p12:password \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  https://203.0.113.42:9292/api/settings/2fa/verify | jq
```

**Response (200):**

```json
{
  "verified": true
}
```

The response also sets the `lamaste_2fa_session` cookie (see [Session Cookie](#session-cookie) above).

**Errors:**

| Status | Body                                                | When                                |
| ------ | --------------------------------------------------- | ----------------------------------- |
| 400    | `{"error": "Code must be exactly 6 digits"}`        | Code format invalid                 |
| 400    | `{"error": "2FA is not enabled"}`                   | 2FA has not been activated          |
| 401    | `{"error": "Invalid TOTP code"}`                    | TOTP code is incorrect or expired   |
| 429    | `{"error": "Too many attempts. Try again later."}`  | Rate limit exceeded                 |

---

### `POST /api/settings/2fa/disable`

Disables 2FA. Requires both a valid 2FA session cookie and a TOTP code for confirmation. After disabling, the IP-based vhost is re-enabled and the session cookie requirement is removed.

**Note:** If re-enabling the IP vhost fails (e.g., nginx config error), 2FA is still disabled and the endpoint returns `200`. The failure is logged server-side. The admin would need to manually fix the nginx configuration or run `sudo lamaste-reset-admin` to restore the IP vhost.

**Request:**

```json
{
  "code": "123456"
}
```

| Field  | Type     | Required | Description                              |
| ------ | -------- | -------- | ---------------------------------------- |
| `code` | `string` | Yes      | 6-digit TOTP code from authenticator app |

```bash
curl -s -X POST --cert client.p12:password \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  https://203.0.113.42:9292/api/settings/2fa/disable | jq
```

**Response (200):**

```json
{
  "enabled": false
}
```

**Errors:**

| Status | Body                                                | When                                |
| ------ | --------------------------------------------------- | ----------------------------------- |
| 400    | `{"error": "Code must be exactly 6 digits"}`        | Code format invalid                 |
| 400    | `{"error": "2FA is not enabled"}`                   | 2FA was not active                  |
| 401    | `{"error": "Invalid TOTP code"}`                    | TOTP code is incorrect or expired   |
| 401    | `{"error": "2fa_required"}`                         | No valid 2FA session cookie         |
| 429    | `{"error": "Too many attempts. Try again later."}`  | Rate limit exceeded                 |

## Quick Reference

| Method | Path                       | Auth                                  | Rate Limited | Description                       |
| ------ | -------------------------- | ------------------------------------- | ------------ | --------------------------------- |
| GET    | `/api/settings/2fa`        | mTLS (exempt from 2FA session)        | No           | Get 2FA status                    |
| POST   | `/api/settings/2fa/setup`  | mTLS (2FA not yet active during use)  | No           | Generate TOTP secret              |
| POST   | `/api/settings/2fa/confirm`| mTLS (2FA not yet active during use)  | Yes          | Confirm initial code, enable 2FA  |
| POST   | `/api/settings/2fa/verify` | mTLS (exempt from 2FA session)        | Yes          | Verify code, issue session cookie |
| POST   | `/api/settings/2fa/disable`| mTLS + 2FA session                    | Yes          | Disable 2FA                       |

### Response Shapes

**Status:**

```json
{ "enabled": false, "setupComplete": false }
```

**Setup:**

```json
{ "uri": "otpauth://totp/...", "manualKey": "JBSWY3DPEHPK3PXP" }
```

**Confirm:**

```json
{ "enabled": true }
```

**Verify:**

```json
{ "verified": true }
```

**Disable:**

```json
{ "enabled": false }
```

### curl Cheat Sheet

```bash
# Check 2FA status
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/settings/2fa | jq

# Start 2FA setup
curl -s -X POST --cert client.p12:password \
  https://203.0.113.42:9292/api/settings/2fa/setup | jq

# Confirm setup with first code
curl -s -X POST --cert client.p12:password \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  https://203.0.113.42:9292/api/settings/2fa/confirm | jq

# Verify code to get session cookie
curl -s -X POST --cert client.p12:password \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  -c cookies.txt \
  https://203.0.113.42:9292/api/settings/2fa/verify | jq

# Disable 2FA (requires session cookie)
curl -s -X POST --cert client.p12:password \
  -H 'Content-Type: application/json' \
  -d '{"code":"123456"}' \
  -b cookies.txt \
  https://203.0.113.42:9292/api/settings/2fa/disable | jq
```
