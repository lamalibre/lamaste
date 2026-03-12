# Users API

> Manage Authelia users who authenticate to tunneled applications with TOTP two-factor authentication.

## In Plain English

When someone visits one of your tunneled apps (like `app.example.com`), they are prompted to log in through Authelia with a username, password, and a TOTP code from an authenticator app. The users API lets you create those login accounts, update their details, reset their TOTP secrets, and delete accounts you no longer need.

These are not admin panel users — the panel itself is protected by mTLS client certificates with no login screen. These users are for the apps you expose through tunnels.

## Authentication

All user endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

## Important Behavior

- **Password hashing:** Passwords are hashed with bcrypt (not argon2id — argon2id uses ~93MB per hash and causes OOM kills on a 512MB droplet).
- **Authelia restart:** After every user change that modifies `users.yml` (create, update, delete), Authelia is restarted via `systemctl restart authelia` to pick up the changes. If the restart fails, the operation still succeeds — a warning is logged but no error is returned to the client. Note: TOTP reset does **not** restart Authelia — it writes directly to Authelia's SQLite database via the `authelia storage user totp generate` CLI command, which takes effect immediately.
- **Atomic writes:** The `users.yml` file is written atomically (write to temp file, then rename) to prevent Authelia from reading a partially written file.
- **Last user protection:** You cannot delete the last remaining user. At least one user must always exist.

## Endpoints

### `GET /api/users`

Returns all Authelia users, sorted alphabetically by username. Sensitive fields (password hash, TOTP secret) are excluded from the response.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/users | jq
```

**Response (200):**

```json
{
  "users": [
    {
      "username": "admin",
      "displayname": "Admin User",
      "email": "admin@example.com",
      "groups": []
    },
    {
      "username": "alice",
      "displayname": "Alice Smith",
      "email": "alice@example.com",
      "groups": ["developers"]
    }
  ]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `username` | `string` | Unique login identifier |
| `displayname` | `string` | Human-readable display name |
| `email` | `string` | User's email address |
| `groups` | `string[]` | Authelia group memberships |

**Errors:**

| Status | Body | When |
|--------|------|------|
| 500 | `{"error":"Failed to read user database"}` | Cannot read or parse `users.yml` |

---

### `POST /api/users`

Creates a new Authelia user. The password is hashed with bcrypt before being stored in `users.yml`.

**Request:**

```json
{
  "username": "alice",
  "displayname": "Alice Smith",
  "email": "alice@example.com",
  "password": "s3cur3p4ssw0rd!",
  "groups": ["developers"]
}
```

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `username` | `string` | 2-32 chars, lowercase alphanumeric + underscores + hyphens | Login identifier |
| `displayname` | `string` | 1-100 chars | Display name |
| `email` | `string` | Valid email format | Email address |
| `password` | `string` | 8-128 chars | Plain-text password (hashed before storage) |
| `groups` | `string[]` | Optional, defaults to `[]` | Authelia group memberships |

**Username regex:**

```
^[a-z0-9_-]+$
```

```bash
curl -s --cert client.p12:password \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","displayname":"Alice Smith","email":"alice@example.com","password":"s3cur3p4ssw0rd!"}' \
  https://203.0.113.42:9292/api/users | jq
```

**Response (201):**

```json
{
  "ok": true,
  "user": {
    "username": "alice",
    "displayname": "Alice Smith",
    "email": "alice@example.com",
    "groups": []
  }
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed","details":{"issues":[...]}}` | Invalid username, email, or password length |
| 409 | `{"error":"Username already exists"}` | A user with this username already exists |
| 500 | `{"error":"Failed to read user database"}` | Cannot read `users.yml` |
| 500 | `{"error":"Failed to hash password"}` | bcrypt hashing failed |
| 500 | `{"error":"Failed to update user database"}` | Cannot write `users.yml` |

---

### `PUT /api/users/:username`

Updates one or more fields of an existing user. At least one field must be provided. Only the fields included in the request body are updated — omitted fields remain unchanged.

If a new password is provided, it is hashed with bcrypt before storage.

**Request:**

```json
{
  "displayname": "Alice J. Smith",
  "email": "alice.smith@example.com",
  "password": "n3wP4ssw0rd!",
  "groups": ["developers", "admins"]
}
```

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `displayname` | `string` | 1-100 chars, optional | New display name |
| `email` | `string` | Valid email, optional | New email address |
| `password` | `string` | 8-128 chars, optional | New password (hashed before storage) |
| `groups` | `string[]` | Optional | New group memberships (replaces entire list) |

All fields are optional, but at least one must be provided (validated by a Zod `.refine()`).

```bash
curl -s --cert client.p12:password \
  -X PUT \
  -H "Content-Type: application/json" \
  -d '{"displayname":"Alice J. Smith","groups":["developers","admins"]}' \
  https://203.0.113.42:9292/api/users/alice | jq
```

**Response (200):**

```json
{
  "ok": true,
  "user": {
    "username": "alice",
    "displayname": "Alice J. Smith",
    "email": "alice.smith@example.com",
    "groups": ["developers", "admins"]
  }
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Validation failed","details":{"issues":[...]}}` | No fields provided, or invalid field values |
| 404 | `{"error":"User not found"}` | No user with this username |
| 500 | `{"error":"Failed to read user database"}` | Cannot read `users.yml` |
| 500 | `{"error":"Failed to hash password"}` | bcrypt hashing failed (when password is updated) |
| 500 | `{"error":"Failed to update user database"}` | Cannot write `users.yml` |

---

### `DELETE /api/users/:username`

Deletes an Authelia user. The user is removed from `users.yml` and Authelia is reloaded.

You cannot delete the last remaining user. This safety check prevents accidentally locking out all users from tunneled applications.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/users/alice | jq
```

**Response (200):**

```json
{
  "ok": true
}
```

**Errors:**

| Status | Body | When |
|--------|------|------|
| 400 | `{"error":"Cannot delete the last user"}` | Only one user remains |
| 404 | `{"error":"User not found"}` | No user with this username |
| 500 | `{"error":"Failed to read user database"}` | Cannot read `users.yml` |
| 500 | `{"error":"Failed to update user database"}` | Cannot write `users.yml` |

---

### `POST /api/users/:username/reset-totp`

Generates a new TOTP secret for a user and writes it to Authelia's SQLite database via the `authelia storage user totp generate` CLI command. Returns an `otpauth://` URI that can be used to enroll an authenticator app. The old TOTP secret is immediately replaced — the user's existing authenticator enrollment becomes invalid.

**Request:**

No request body.

```bash
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/users/alice/reset-totp | jq
```

**Response (200):**

```json
{
  "ok": true,
  "totpUri": "otpauth://totp/Portlama:alice?secret=JBSWY3DPEHPK3PXP&issuer=Portlama&algorithm=SHA1&digits=6&period=30"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | Always `true` on success |
| `totpUri` | `string` | `otpauth://` URI for QR code generation or manual entry in an authenticator app |

The `totpUri` follows the [Key Uri Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) standard. The panel client renders this as a QR code for scanning with Google Authenticator, Authy, or similar apps.

**Errors:**

| Status | Body | When |
|--------|------|------|
| 404 | `{"error":"User not found"}` | No user with this username |
| 500 | `{"error":"Failed to read user database"}` | Cannot read `users.yml` |
| 500 | `{"error":"Failed to write TOTP configuration"}` | Cannot write TOTP secret to Authelia's SQLite database |

## Quick Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List all users (alphabetical, no sensitive fields) |
| POST | `/api/users` | Create user (bcrypt hash + Authelia reload) |
| PUT | `/api/users/:username` | Update user fields (partial update) |
| DELETE | `/api/users/:username` | Delete user (not the last one) |
| POST | `/api/users/:username/reset-totp` | Generate new TOTP secret |

### User Object Shape

Returned by list and mutation endpoints (sensitive fields excluded):

```json
{
  "username": "alice",
  "displayname": "Alice Smith",
  "email": "alice@example.com",
  "groups": ["developers"]
}
```

### Validation Summary

| Field | Rules |
|-------|-------|
| `username` | 2-32 chars, `/^[a-z0-9_-]+$/`, unique |
| `displayname` | 1-100 chars |
| `email` | Valid email format |
| `password` | 8-128 chars |
| `groups` | Array of strings, optional |

### curl Cheat Sheet

```bash
# List users
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/users | jq

# Create user
curl -s --cert client.p12:password \
  -X POST -H "Content-Type: application/json" \
  -d '{"username":"bob","displayname":"Bob","email":"bob@example.com","password":"mypassword"}' \
  https://203.0.113.42:9292/api/users | jq

# Update user (change display name and groups)
curl -s --cert client.p12:password \
  -X PUT -H "Content-Type: application/json" \
  -d '{"displayname":"Robert","groups":["admins"]}' \
  https://203.0.113.42:9292/api/users/bob | jq

# Delete user
curl -s --cert client.p12:password \
  -X DELETE \
  https://203.0.113.42:9292/api/users/bob | jq

# Reset TOTP
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/users/bob/reset-totp | jq
```
