# Users API

> Manage Authelia users who authenticate to tunneled applications with TOTP two-factor authentication.

## In Plain English

When someone visits one of your tunneled apps (like `app.example.com`), they are prompted to log in through Authelia with a username, password, and a TOTP code from an authenticator app. The users API lets you create those login accounts, update their details, reset their TOTP secrets, and delete accounts you no longer need.

These are not admin panel users — the panel itself is protected by mTLS client certificates with no login screen. These users are for the apps you expose through tunnels, and for the agent-hosted plugins that declare users of their own ([Agent-Hosted Plugins](agent-hosted-plugins.md#users-and-identity)).

Authelia keys users by username, which anyone can reuse. The panel therefore keeps a **user directory** beside Authelia's `users.yml`: every user gets a stable `userId` (a UUID v4) the moment their username appears, plugins key their data on it, and the directory keeps the row for good. A user is `active`, `disabled` (cannot sign in — the one offboarding action) or `removed` (deleted). A deleted user leaves a **tombstone** — the `userId` and the last known name and address — so a plugin's history stays readable, until an administrator **erases** it. A username that comes back after a deletion is a new user with a new `userId`.

## Authentication

All user endpoints require a valid mTLS client certificate and a completed onboarding. See the [API Overview](./overview.md) for details.

If onboarding is not complete, all endpoints return `503 Service Unavailable`.

## Important Behavior

- **Password hashing:** Passwords are hashed with bcrypt (not argon2id — argon2id uses ~93MB per hash and causes OOM kills on a 512MB droplet).
- **Authelia restart:** After every user change that modifies `users.yml` (create, update, delete), Authelia is restarted via `systemctl restart authelia` to pick up the changes. If the restart fails, the operation still succeeds — the failure is logged and listed in the response's `warnings`. Note: TOTP reset does **not** restart Authelia — it writes directly to Authelia's SQLite database via the `authelia storage user totp generate` CLI command, which takes effect immediately.
- **Atomic writes:** The `users.yml` file is written atomically (write to temp file, then rename) to prevent Authelia from reading a partially written file.
- **One lock for every user write:** creating, updating, disabling and deleting users, and accepting an invitation, are read-modify-writes of `users.yml` under one lock in the panel. Under the same lock the panel brings the directory in line with the file **before** Authelia restarts — so a disabled user is refused by plugins at once — then restarts Authelia, then recomputes the plugins' audiences. Concurrent user changes therefore run one after the other.
- **The directory follows `users.yml`, read only:** at start, after onboarding and every minute the panel reconciles the directory with the file without writing it (Authelia's own password reset rewrites it; an operator may edit it): an unknown username gets a new `userId`, a changed display name, email or `disabled` is adopted, and a username gone from the file — seen missing in two reads, so a half-written file never tombstones anyone — is removed as `deleted-outside`. Every change is audited (`directory.user.created`, `.updated`, `.removed`) by `userId` alone; audit entries never name a user.
- **Last user protection:** You cannot delete the last remaining user. At least one user must always exist.
- **Last administrator protection:** You cannot disable the last enabled member of the `admins` group.

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
      "groups": ["admins"],
      "disabled": false,
      "userId": "0b6c2f4e-8a1d-4f3b-9c55-1e2d3f4a5b6c",
      "status": "active"
    },
    {
      "username": "alice",
      "displayname": "Alice Smith",
      "email": "alice@example.com",
      "groups": ["developers"],
      "disabled": true,
      "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      "status": "disabled"
    }
  ]
}
```

| Field         | Type             | Description                                                                                                                              |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `username`    | `string`         | Unique login identifier                                                                                                                  |
| `displayname` | `string`         | Human-readable display name                                                                                                              |
| `email`       | `string`         | User's email address                                                                                                                     |
| `groups`      | `string[]`       | Authelia group memberships                                                                                                               |
| `disabled`    | `boolean`        | Authelia's `disabled: true` — the user cannot sign in                                                                                    |
| `userId`      | `string \| null` | The user's directory id; `null` until the directory has seen the user (within a minute of an edit of `users.yml` made outside the panel) |
| `status`      | `string`         | `active` or `disabled`                                                                                                                   |

Users deleted from `users.yml` are not listed here; the [directory](#get-api-identity-directory) keeps their tombstones.

**Errors:**

| Status | Body                                       | When                             |
| ------ | ------------------------------------------ | -------------------------------- |
| 500    | `{"error":"Failed to read user database"}` | Cannot read or parse `users.yml` |

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

| Field         | Type       | Validation                                                                                  | Description                                 |
| ------------- | ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `username`    | `string`   | 2-32 chars, lowercase alphanumeric + underscores + hyphens, starting with a letter or digit | Login identifier                            |
| `displayname` | `string`   | 1-100 chars                                                                                 | Display name                                |
| `email`       | `string`   | Valid email format                                                                          | Email address                               |
| `password`    | `string`   | 8-128 chars                                                                                 | Plain-text password (hashed before storage) |
| `groups`      | `string[]` | Optional, defaults to `[]`                                                                  | Authelia group memberships                  |

**Username regex** (the same rule applies to invitations — a leading `-` would read as a flag to Authelia's CLI when a TOTP secret is stored):

```
^[a-z0-9][a-z0-9_-]*$
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
    "groups": [],
    "disabled": false,
    "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
    "status": "active"
  }
}
```

A new user gets a new `userId`, even when an earlier, deleted user had the same username. What that earlier user left in Gatekeeper under the username — grants and group memberships — is removed **before** the new user is created ([Usernames and Gatekeeper](#usernames-and-gatekeeper)), so a reused username inherits nothing. `warnings` (`[{ step, message }]`) lists what went wrong after `users.yml` was written — the directory not updated, Authelia not restarted.

**Errors:**

| Status | Body                                                                    | When                                                                                                          |
| ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`              | Invalid username, email, or password length                                                                   |
| 409    | `{"error":"Username already exists"}`                                   | A user with this username already exists                                                                      |
| 503    | `{"error":"A removed user's grants …","code":"gatekeeper_unavailable"}` | An earlier user with this username left grants or groups in Gatekeeper, and Gatekeeper cannot remove them now |
| 500    | `{"error":"Failed to read user database"}`                              | Cannot read `users.yml`                                                                                       |
| 500    | `{"error":"Failed to hash password"}`                                   | bcrypt hashing failed                                                                                         |
| 500    | `{"error":"Failed to update user database"}`                            | Cannot write `users.yml`                                                                                      |

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

| Field         | Type       | Validation            | Description                                                                 |
| ------------- | ---------- | --------------------- | --------------------------------------------------------------------------- |
| `displayname` | `string`   | 1-100 chars, optional | New display name                                                            |
| `email`       | `string`   | Valid email, optional | New email address                                                           |
| `password`    | `string`   | 8-128 chars, optional | New password (hashed before storage)                                        |
| `groups`      | `string[]` | Optional              | New group memberships (replaces entire list)                                |
| `disabled`    | `boolean`  | Optional              | `true` disables the user, `false` enables them ([below](#disabling-a-user)) |

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
    "groups": ["developers", "admins"],
    "disabled": false,
    "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
    "status": "active"
  }
}
```

`warnings` lists what did not happen after the write (the directory, Authelia's restart, ending the user's desktop sessions, revoking registry tokens). A change of `groups` revokes the user's registry (Feria) tokens, whose scopes were granted from `feria-*` groups at login.

#### Disabling a user

`{ "disabled": true }` is the offboarding action. It sets Authelia's `disabled: true` — the user can no longer sign in — and, before Authelia restarts:

- the directory marks the user `disabled`, so every plugin's [user surface](agent-hosted-plugins.md#the-user-surface) refuses them at once (`403`);
- every plugin audience that holds them shows them `disabled`, and their agent halves are told;

then, best effort (`warnings` on failure): their desktop app sessions end (a new per-user session epoch) and their registry tokens are revoked. The user keeps their `userId`, grants and group memberships; `{ "disabled": false }` enables them again with everything as it was. A disabled user still counts as a user (they can be deleted). The last enabled member of the `admins` group cannot be disabled.

**Errors:**

| Status | Body                                                                            | When                                             |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------ |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`                      | No fields provided, or invalid field values      |
| 400    | `{"error":"Cannot disable the last enabled administrator","code":"last_admin"}` | Disabling the last enabled member of `admins`    |
| 404    | `{"error":"User not found"}`                                                    | No user with this username                       |
| 500    | `{"error":"Failed to read user database"}`                                      | Cannot read `users.yml`                          |
| 500    | `{"error":"Failed to hash password"}`                                           | bcrypt hashing failed (when password is updated) |
| 500    | `{"error":"Failed to update user database"}`                                    | Cannot write `users.yml`                         |

---

### `DELETE /api/users/:username`

Deletes an Authelia user: the user is removed from `users.yml`, the directory turns their row into a **tombstone** (`removed`, reason `deleted`, keeping the `userId`, the username and the last display name and email, so plugins' history stays readable), and Authelia restarts. With `?erase=true` the tombstone is [erased](#erasing-a-removed-user) at once as well.

You cannot delete the last remaining user. This safety check prevents accidentally locking out all users from tunneled applications.

Then, never rolled back — what fails is reported in `warnings`:

1. Gatekeeper drops every grant naming the username (any resource type) and its membership of every Lamaste group, in one transaction ([Usernames and Gatekeeper](#usernames-and-gatekeeper)). When Gatekeeper cannot, the cleanup stays **pending** on the tombstone and is retried every minute; until it succeeds the username holds no role in any plugin and cannot be given to a new user.
2. The user's registry (Feria) tokens are revoked, their grants in the legacy `user-plugin-access.json` removed, and their desktop app sessions ended.
3. Every plugin that had the user as a member is sent `remove` with reason `deleted` and what it last received about them.

**Request:**

No request body. Query: `erase` — `true` to erase the tombstone in the same call.

```bash
curl -s --cert client.p12:password \
  -X DELETE \
  "https://203.0.113.42:9292/api/users/alice?erase=true" | jq
```

**Response (200):**

```json
{
  "ok": true,
  "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
  "principalCleared": true,
  "erased": true
}
```

| Field              | Type             | Description                                                                                                |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `userId`           | `string \| null` | The tombstone's id; `null` when the directory held no row for the user (nothing to erase then — a warning) |
| `principalCleared` | `boolean`        | Gatekeeper dropped the grants and memberships under the username; `false`: pending, retried every minute   |
| `erased`           | `boolean`        | Only with `?erase=true`: whether the tombstone was erased (`false` with a warning — erase it later by id)  |
| `warnings`         | `array`          | What did not happen: `{ step, message }` (or a sentence)                                                   |

**Errors:**

| Status | Body                                         | When                       |
| ------ | -------------------------------------------- | -------------------------- |
| 400    | `{"error":"Cannot delete the last user"}`    | Only one user remains      |
| 404    | `{"error":"User not found"}`                 | No user with this username |
| 500    | `{"error":"Failed to read user database"}`   | Cannot read `users.yml`    |
| 500    | `{"error":"Failed to update user database"}` | Cannot write `users.yml`   |

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
  "totpUri": "otpauth://totp/Lamaste:alice?secret=JBSWY3DPEHPK3PXP&issuer=Lamaste&algorithm=SHA1&digits=6&period=30"
}
```

| Field     | Type      | Description                                                                     |
| --------- | --------- | ------------------------------------------------------------------------------- |
| `ok`      | `boolean` | Always `true` on success                                                        |
| `totpUri` | `string`  | `otpauth://` URI for QR code generation or manual entry in an authenticator app |

The `totpUri` follows the [Key Uri Format](https://github.com/google/google-authenticator/wiki/Key-Uri-Format) standard. The panel client renders this as a QR code for scanning with Google Authenticator, Authy, or similar apps.

**Errors:**

| Status | Body                                             | When                                                   |
| ------ | ------------------------------------------------ | ------------------------------------------------------ |
| 404    | `{"error":"User not found"}`                     | No user with this username                             |
| 500    | `{"error":"Failed to read user database"}`       | Cannot read `users.yml`                                |
| 500    | `{"error":"Failed to write TOTP configuration"}` | Cannot write TOTP secret to Authelia's SQLite database |

## The User Directory

The directory lives in the panel's `state.db` (migration `0013`): one row per user it ever knew, never deleted, and the directory's own id (`directoryId`, a UUID v4 made with the store), which tells a plugin's agent half when the store it follows was replaced. Admin only.

### `GET /api/identity/directory`

Every user the directory knows — members by username, then the removed, then the erased — with who erased each erased one and the plugins that have not yet acknowledged an erasure.

```json
{
  "directoryId": "3b0e5c1a-7f2d-4c8e-9a1b-2c3d4e5f6a7b",
  "users": [
    {
      "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
      "username": "alice",
      "displayName": "Alice Smith",
      "email": "alice@example.com",
      "status": "removed",
      "removedReason": "deleted",
      "removedAt": "2026-10-22T08:00:00.000Z",
      "erasedAt": null,
      "principalClearedAt": "2026-10-22T08:00:00.120Z",
      "version": 4,
      "createdAt": "2026-10-01T10:00:00.000Z",
      "updatedAt": "2026-10-22T08:00:00.000Z",
      "erasure": null,
      "pendingErasures": []
    }
  ]
}
```

| Field                              | Description                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `userId`                           | Stable id (UUID v4); never reused                                                                                     |
| `username`, `displayName`, `email` | As `users.yml` last had them; all `null` once erased                                                                  |
| `status`                           | `active`, `disabled` or `removed`                                                                                     |
| `removedReason`                    | `deleted` (through Lamaste) or `deleted-outside` (gone from `users.yml` without it); `null` unless removed            |
| `removedAt`, `erasedAt`            | When the user was removed, and erased                                                                                 |
| `principalClearedAt`               | When Gatekeeper dropped what it held under the removed user's username; `null` on a removed user: **cleanup pending** |
| `version`                          | 1 at creation, + 1 on every change                                                                                    |
| `erasure`                          | `{ requestedAt, requestedBy }` for an erased user, else `null`                                                        |
| `pendingErasures`                  | Names of the plugins whose agent half has not yet acknowledged this user's erasure                                    |

### Erasing a removed user

Deleting keeps the tombstone; **erasing** scrubs it. An erasure of a removed user, in this order — anything that fails before the scrub leaves the tombstone as it was, still naming the username a later attempt needs:

1. Gatekeeper's principal cleanup, if it is still pending.
2. Gatekeeper's **access-request log**: the user's rows logged before they were removed (and those still queued for the log) are deleted.
3. The user's **invitations** made before they were removed are deleted from `invitations.json`.
4. The directory row is scrubbed to the bare `userId` (`username`, display name and email `NULL`, `erasedAt` set), who asked is recorded, and `directory.user.erased` is audited (`userId`, counts).
5. The audiences are recomputed: every plugin that had the user as a member is sent `remove` with reason `erased` and no attributes; its agent half scrubs its own row and anonymises what the plugin keeps in the same transaction, and its cursor passing the change is the acknowledgement. Until then the plugin is listed in the user's `pendingErasures` (and the user in the plugin's — [Agent-Hosted Plugins](agent-hosted-plugins.md#erasure)). Delivery takes seconds while the hosting agent is online, and happens when it reconnects otherwise.

**Outside Lamaste's reach:** Authelia's own authentication log and its database, nginx access logs, and backups taken before the erasure. Plugins replay erasures at their daily reconcile, which is how an erasure reaches an agent half's data restored from an older backup.

### `POST /api/identity/directory/:userId/erase`

Erases a removed user. 30 a minute.

**Response (200):**

```json
{
  "ok": true,
  "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
  "erasedAt": "2026-10-22T08:05:00.000Z",
  "invitationsPurged": 1,
  "accessLogPurged": 3
}
```

**Errors:**

| Status | `code`                   | When                                                                                                                           |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 400    |                          | `userId` is not a UUID v4                                                                                                      |
| 404    | `user_not_found`         | No user with this id                                                                                                           |
| 409    | `user_not_removed`       | The user is active or disabled — delete them first, or delete and erase in one step (`DELETE /api/users/:username?erase=true`) |
| 409    | `already_erased`         | Erased already                                                                                                                 |
| 503    | `gatekeeper_unavailable` | Gatekeeper could not clear the principal or purge its log — nothing was erased; try again                                      |

### Usernames and Gatekeeper

Gatekeeper keys users by username too: the grants naming a user and their memberships of Lamaste groups would pass to anyone who later holds the username. So every removed user's **principal** is cleared in Gatekeeper — every grant naming the username, of any resource type, and its membership of every group, in one Gatekeeper transaction (`DELETE /api/principals/user/:username` on Gatekeeper's own API, which only the panel calls) — when the user is deleted through Lamaste, every minute while that is pending (Gatekeeper was down, or the user disappeared from `users.yml` outside Lamaste), before an erasure, and **before anything is created under the username again**: a new user, a grant or a group membership through the panel (refused with `503 gatekeeper_unavailable` while it cannot complete). While a username's cleanup is pending it holds no role in any plugin. Each cleanup is audited as `directory.user.principal-cleared` with the user ids.

---

## Quick Reference

| Method | Path                                    | Description                                                                    |
| ------ | --------------------------------------- | ------------------------------------------------------------------------------ |
| GET    | `/api/users`                            | List all users (alphabetical, no sensitive fields), with `userId` and `status` |
| POST   | `/api/users`                            | Create user (bcrypt hash + Authelia reload)                                    |
| PUT    | `/api/users/:username`                  | Update user fields (partial update); `disabled` disables/enables               |
| DELETE | `/api/users/:username[?erase=true]`     | Delete user (not the last one); a tombstone stays unless erased                |
| POST   | `/api/users/:username/reset-totp`       | Generate new TOTP secret                                                       |
| GET    | `/api/identity/directory`               | Every user the directory knows, tombstones and erasures included               |
| POST   | `/api/identity/directory/:userId/erase` | Erase a removed user                                                           |

From the CLI (through the running panel, `--json` for NDJSON): `lamaste-server users list`, `users disable <username>`, `users enable <username>`, `users delete <username> [--erase]`, `users erase <userId>`, `users directory`. The panel's Users page and the desktop app (`AdminClient` `getUsers`, `disableUser`, `enableUser`, `deleteUser(username, { erase })`, `getUserDirectory`, `eraseDirectoryUser`) do the same — see [Managing Users](../02-guides/managing-users.md).

### User Object Shape

Returned by list and mutation endpoints (sensitive fields excluded):

```json
{
  "username": "alice",
  "displayname": "Alice Smith",
  "email": "alice@example.com",
  "groups": ["developers"],
  "disabled": false,
  "userId": "7d9e1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
  "status": "active"
}
```

### Validation Summary

| Field         | Rules                                         |
| ------------- | --------------------------------------------- |
| `username`    | 2-32 chars, `/^[a-z0-9][a-z0-9_-]*$/`, unique |
| `displayname` | 1-100 chars                                   |
| `email`       | Valid email format                            |
| `password`    | 8-128 chars                                   |
| `groups`      | Array of strings, optional                    |

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

# Disable a user (offboarding); {"disabled":false} enables them again
curl -s --cert client.p12:password \
  -X PUT -H "Content-Type: application/json" \
  -d '{"disabled":true}' \
  https://203.0.113.42:9292/api/users/bob | jq

# Delete a user and erase what the directory keeps of them
curl -s --cert client.p12:password \
  -X DELETE \
  "https://203.0.113.42:9292/api/users/bob?erase=true" | jq

# The directory, tombstones included
curl -s --cert client.p12:password \
  https://203.0.113.42:9292/api/identity/directory | jq

# Reset TOTP
curl -s --cert client.p12:password \
  -X POST \
  https://203.0.113.42:9292/api/users/bob/reset-totp | jq
```
