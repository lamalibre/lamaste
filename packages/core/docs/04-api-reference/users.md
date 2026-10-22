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
- **One lock for every user write:** creating, updating, disabling and deleting users, and accepting an invitation, are read-modify-writes of `users.yml` under one lock in the panel. Under the same lock the panel brings the directory in line with the file **before** Authelia restarts — so a disabled user is refused by plugins at once — [offboards](#offboarding) every user that stopped being one, then restarts Authelia, then recomputes the plugins' audiences. Concurrent user changes therefore run one after the other.
- **A change must stick:** Authelia's own password reset rewrites `users.yml` from what Authelia read when it started, so a change written just before its restart can be lost. After the restart the panel reads `users.yml` again and checks that it holds the change (the fields set, the user created or gone); when it does not, the change is made once more (and Authelia restarted again). When it still does not, the answer carries `"ok": false`, `"persisted": false` and a `persist` warning — never a silent success.
- **The directory follows `users.yml`, read only:** at start, after onboarding and every minute the panel reconciles the directory with the file without writing it (Authelia's own password reset rewrites it; an operator may edit it): an unknown username gets a new `userId`, a changed display name, email or `disabled` is adopted, and a username gone from the file — seen missing in two reads, so a half-written file never tombstones anyone — is removed as `deleted-outside`. A user the reconcile sees disabled or removed is offboarded exactly as one disabled or deleted through the API. Every change is audited (`directory.user.created`, `.updated`, `.removed`) by `userId` alone; audit entries never name a user.
- **Audit:** besides the directory's own entries, the users API records `user.password.set` (a password set through `PUT`), `user.groups.changed` (`added`, `removed` group names) and `user.totp.reset` — each by `userId` alone.
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

**Username regex** (the same rule applies to invitations — a leading `-` would read as a flag to Authelia's CLI, which the panel runs per username for TOTP secrets, second factors and OpenID Connect identities):

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

A new user gets a new `userId`, even when an earlier, deleted user had the same username. Before the new user is created ([Reused usernames](#reused-usernames)): the username is refused when Authelia holds an OpenID Connect identity for it; and when a deleted user held it, Gatekeeper drops everything it holds under the username (grants, group memberships) and Authelia the second factors (TOTP, WebAuthn) — always, not only when a cleanup was pending — so a reused username inherits no grant, group, role or second factor. `warnings` (`[{ step, message }]`) lists what went wrong after `users.yml` was written — the directory not updated, Authelia not restarted; a change that did not stick answers `200` with `"ok": false`, `"persisted": false`.

**Errors:**

| Status | Body                                                                                          | When                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | `{"error":"Validation failed","details":{"issues":[...]}}`                                    | Invalid username, email, or password length                                                                                                                                                            |
| 409    | `{"error":"Username already exists"}`                                                         | A user with this username already exists                                                                                                                                                               |
| 409    | `{"error":"Authelia holds an OpenID Connect identity …","code":"username_has_oidc_identity"}` | Authelia holds an OpenID Connect opaque identifier for the username: every relying party would take the new user for the earlier one ([Reused usernames](#reused-usernames)) — choose another username |
| 503    | `{"error":"A removed user's grants …","code":"gatekeeper_unavailable"}`                       | An earlier user with this username left grants or groups in Gatekeeper, and Gatekeeper cannot remove them now                                                                                          |
| 503    | `{"error":"Authelia's storage could not …","code":"authelia_storage_unavailable"}`            | Authelia's storage could not be checked for an OpenID Connect identity of the username, or an earlier user's second factors under it could not be deleted                                              |
| 500    | `{"error":"Failed to read user database"}`                                                    | Cannot read `users.yml`                                                                                                                                                                                |
| 500    | `{"error":"Failed to hash password"}`                                                         | bcrypt hashing failed                                                                                                                                                                                  |
| 500    | `{"error":"Failed to update user database"}`                                                  | Cannot write `users.yml`                                                                                                                                                                               |

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

`warnings` lists what did not happen after the write (the directory, Authelia's restart, the steps of [offboarding](#offboarding)); `"ok": false` with `"persisted": false` and a `persist` warning says the change did not stick ([above](#important-behavior)). A change of `groups` revokes the user's registry (Feria) tokens, whose scopes were granted from `feria-*` groups at login.

#### Disabling a user

`{ "disabled": true }` is the offboarding action. It sets Authelia's `disabled: true` — the user can no longer sign in — and, before Authelia restarts:

- the directory marks the user `disabled`, so every plugin's [user surface](agent-hosted-plugins.md#the-user-surface) refuses them at once (`403`);
- every plugin audience that holds them shows them `disabled`, and their agent halves are told;
- the user is [offboarded](#offboarding): their desktop app sessions end and their registry tokens are revoked (best effort — `warnings` on failure).

The user keeps their `userId`, grants and group memberships; `{ "disabled": false }` enables them again with everything as it was — except desktop sessions, which stay ended. A disabled user still counts as a user (they can be deleted). The last enabled member of the `admins` group cannot be disabled. A user disabled by editing `users.yml` is offboarded the same way when the next reconcile sees it.

#### Offboarding

One function, keyed by `userId`, for every way a user stops being one — disabled or deleted through this API, and disabled or gone from `users.yml` outside it (adopted by the minute's reconcile):

| Step                                                                                              | Disabled | Removed |
| ------------------------------------------------------------------------------------------------- | -------- | ------- |
| Desktop app sessions end: the user's session epoch (`panel.json` `userEpochs`, keyed by `userId`) | ✓        | ✓       |
| Registry (Feria) tokens revoked                                                                   | ✓        | ✓       |
| Grants in the legacy `user-plugin-access.json` removed                                            |          | ✓       |
| Gatekeeper drops every grant and group membership under the username (pending until it can)       |          | ✓       |
| Authelia deletes the user's TOTP configuration and WebAuthn credentials                           |          | ✓       |
| Gatekeeper's cached session verdicts dropped                                                      | ✓        | ✓       |

Desktop sessions are bound to the `userId` as well as the username: one is valid only while its user still holds the username and is enabled, so a username given to someone else never revives a session. Sessions issued before 4.5 carry no `userId` and are refused — desktop users sign in again once after the upgrade. An epoch older than a session's longest life (12 hours) can reject nothing and is dropped; `panel.json` names nobody.

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

Then, never rolled back — what fails is reported in `warnings` — the user is [offboarded](#offboarding):

1. Gatekeeper drops every grant naming the username (any resource type) and its membership of every Lamaste group, in one transaction ([Usernames and Gatekeeper](#usernames-and-gatekeeper)). When Gatekeeper cannot, the cleanup stays **pending** on the tombstone and is retried every minute; until it succeeds the username holds no role in any plugin and cannot be given to a new user.
2. Authelia deletes the user's TOTP configuration and WebAuthn credentials. When it cannot, the username cannot be given to a new user until it can ([Reused usernames](#reused-usernames)).
3. The user's registry (Feria) tokens are revoked, their grants in the legacy `user-plugin-access.json` removed, and their desktop app sessions ended.
4. Every plugin that had the user as a member is sent `remove` with reason `deleted` and what it last received about them.

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

| Field                              | Description                                                                                                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `userId`                           | Stable id (UUID v4); never reused                                                                                                                                                                                        |
| `username`, `displayName`, `email` | As `users.yml` last had them; all `null` once erased                                                                                                                                                                     |
| `status`                           | `active`, `disabled` or `removed`                                                                                                                                                                                        |
| `removedReason`                    | `deleted` (through Lamaste) or `deleted-outside` (gone from `users.yml` without it); `null` unless removed                                                                                                               |
| `removedAt`, `erasedAt`            | When the user was removed, and erased                                                                                                                                                                                    |
| `principalClearedAt`               | When Gatekeeper dropped what it held under the removed user's username; `null` on a removed user: **cleanup pending**                                                                                                    |
| `version`                          | 1 at creation, + 1 on every change                                                                                                                                                                                       |
| `erasure`                          | `{ requestedAt, requestedBy }` for an erased user, else `null`                                                                                                                                                           |
| `pendingErasures`                  | Names of the plugins that have not yet acknowledged this user's erasure — their hosting's agent half, or an agent that retains their data                                                                                |
| `pendingErasuresInactive`          | Among them, the plugins the feed does not reach now (uninstalled, or no longer declaring identity) whose data an agent keeps: the erasure reaches it when the plugin comes back, or goes with the data when it is purged |

### Erasing a removed user

Deleting keeps the tombstone; **erasing** scrubs it. An erasure of a removed user, in this order — anything that fails before the scrub leaves the tombstone as it was, still naming the username a later attempt needs:

1. Gatekeeper's principal cleanup, if it is still pending.
2. Gatekeeper's **access-request log**: the user's rows logged before they were removed (and those still queued for the log) are deleted.
3. Authelia's **second factors** for the username (TOTP, WebAuthn) are deleted, should their deletion at removal have failed.
4. The user's **invitations** made before they were removed are deleted from `invitations.json`.
5. The directory row is scrubbed to the bare `userId` (`username`, display name and email `NULL`, `erasedAt` set), who asked is recorded, and `directory.user.erased` is audited (`userId`, counts).
6. The audiences are recomputed: **every** plugin that ever had the user as a member — including one uninstalled while an agent keeps its data, or one that no longer declares identity — has the user's row rewritten to `remove` with reason `erased` and no attributes. A plugin that takes the feed is sent it: its agent half scrubs its own row and anonymises what the plugin keeps in the same transaction, and its cursor passing the change is the acknowledgement. One that does not now replays it when it comes back. Until then the plugin is listed in the user's `pendingErasures` (marked in `pendingErasuresInactive` when the feed does not reach it now) and the user in the plugin's — [Agent-Hosted Plugins](agent-hosted-plugins.md#erasure). Delivery takes seconds while the hosting agent is online, and happens when it reconnects otherwise. An agent half never takes an erased user back: an erasure is sticky in its projection.

**Outside Lamaste's reach:** Authelia keeps the username's OpenID Connect **opaque identifier** (Authelia 4.39 cannot delete one — which is why the username is never given to anyone again while it exists) and its own **authentication log**; nginx access logs and journald keep what they logged before (see [Monitoring](../05-operations/monitoring.md#logs-and-personal-data) for their retention); backups taken before the erasure keep everything. Plugins replay erasures at their daily reconcile, which is how an erasure reaches an agent half's data restored from an older backup; restoring the relay itself is covered in [Backup and Restore](../05-operations/backup-and-restore.md).

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

| Status | `code`                         | When                                                                                                                           |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 400    |                                | `userId` is not a UUID v4                                                                                                      |
| 404    | `user_not_found`               | No user with this id                                                                                                           |
| 409    | `user_not_removed`             | The user is active or disabled — delete them first, or delete and erase in one step (`DELETE /api/users/:username?erase=true`) |
| 409    | `already_erased`               | Erased already                                                                                                                 |
| 503    | `gatekeeper_unavailable`       | Gatekeeper could not clear the principal or purge its log — nothing was erased; try again                                      |
| 503    | `authelia_storage_unavailable` | Authelia's storage could not delete the second factors — nothing was erased; try again                                         |

### Usernames and Gatekeeper

Gatekeeper keys users by username too: the grants naming a user and their memberships of Lamaste groups would pass to anyone who later holds the username. So every removed user's **principal** is cleared in Gatekeeper — every grant naming the username, of any resource type, and its membership of every group, in one Gatekeeper transaction (`POST /api/principals/user/remove { username }` on Gatekeeper's own API, which only the panel calls; the username travels in the body, never in a URL) — when the user is removed (through Lamaste or outside it), every minute while that is pending (Gatekeeper was down), before an erasure, and **whenever a user is created under the username** — always then, pending or not: a restored `gatekeeper.db`, or a grant that raced the deletion, may have brought something back. Each cleanup is audited as `directory.user.principal-cleared` with the user ids.

A grant or a group membership given to a username through the panel (an entitlement, the Gatekeeper proxy) is given holding the users lock, so no deletion runs between the checks and the grant. A username a deleted user held and nobody holds now takes **nothing** — `409 username_deleted` (whatever it was given would pass to whoever is given the username next); a pending cleanup under a username is completed first (`503 gatekeeper_unavailable` while it cannot be). While a username's cleanup is pending it holds no role in any plugin. A username the directory never saw goes through: Gatekeeper may hold grants for a user still to come.

### Reused usernames

A new user under a username an earlier user held inherits **nothing**: not their `userId` (a new one), not their grants, group memberships or plugin roles (Gatekeeper's principal cleared at creation), not their second factors (Authelia's TOTP configuration and WebAuthn credentials deleted at removal and again at creation — `503 authelia_storage_unavailable` while they cannot be), not their desktop sessions (bound to the `userId`).

One thing Lamaste cannot take away: the **OpenID Connect identity**. Authelia gives each user an opaque identifier (the `sub` claim relying parties see — plugins that sign users in through Lamaste's OpenID Connect provider, a registry) the first time they sign in to one, keyed by username, and Authelia 4.39 has no way to delete it. A new user under that username would be the old user to every relying party. So **a username Authelia holds an opaque identifier for is never given to a new user**: creating a user (or accepting an invitation) under it is refused with `409 username_has_oidc_identity` — choose another username. The panel checks with Authelia's own CLI (`lamaste-priv authelia-user has-oidc-identifier`, which answers yes or no and nothing else).

---

## Quick Reference

| Method | Path                                    | Description                                                                              |
| ------ | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/users`                            | List all users (alphabetical, no sensitive fields), with `userId` and `status`           |
| POST   | `/api/users`                            | Create user (bcrypt hash + Authelia reload); a username with an OIDC identity is refused |
| PUT    | `/api/users/:username`                  | Update user fields (partial update); `disabled` disables/enables                         |
| DELETE | `/api/users/:username[?erase=true]`     | Delete user (not the last one); a tombstone stays unless erased                          |
| POST   | `/api/users/:username/reset-totp`       | Generate new TOTP secret                                                                 |
| GET    | `/api/identity/directory`               | Every user the directory knows, tombstones and erasures included                         |
| POST   | `/api/identity/directory/:userId/erase` | Erase a removed user                                                                     |

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
