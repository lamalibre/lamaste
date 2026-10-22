# Gatekeeper API

> Endpoints for managing Gatekeeper authorization: groups, grants, access checks, diagnostics, and settings. All proxied endpoints go through the lamalibre-lamaste-serverd at `/api/gatekeeper/*`.

## Authentication

All Gatekeeper endpoints proxied through the panel require admin mTLS authentication. The internal `authz/tunnel/<fqdn>` and `authz/user-surface/<fqdn>` endpoints on `127.0.0.1:9294` are called by nginx only and are not exposed externally; Gatekeeper's own management API (`127.0.0.1:9294/api/*`, the shared secret in `gatekeeper-secret.json`) is called by the panel only.

**Grants and groups decide who uses agent-hosted plugins.** A plugin grant whose `context` names `roles` is an **entitlement** ([Agent-Hosted Plugins](agent-hosted-plugins.md#entitlements-and-the-audience)): every grant or group change that goes through the proxy is followed by a recompute of the plugins' audiences before the answer goes back, and anything given to a username — a user grant, a group membership — first clears what a removed user who held that username left in Gatekeeper ([Users API](users.md#usernames-and-gatekeeper)); when that cannot complete, the proxy answers `503` with `code: "gatekeeper_unavailable"`. Gatekeeper's own CLI writes the same database without telling the panel; the panel's minute-long recompute picks such edits up.

If the Gatekeeper service is unavailable, proxied endpoints return `503 Service Unavailable`.

---

## Groups

### Create Group

```
POST /api/gatekeeper/groups
```

**Auth:** Admin only

Create a new Gatekeeper group.

**Request body:**

| Field         | Type   | Required | Description                                               |
| ------------- | ------ | -------- | --------------------------------------------------------- |
| `name`        | string | Yes      | Group name (2-63 chars, lowercase alphanumeric + hyphens) |
| `description` | string | No       | Human-readable description                                |
| `createdBy`   | string | No       | Creator identifier                                        |

**Response (201):**

```json
{
  "ok": true,
  "group": {
    "name": "engineering",
    "description": "Engineering team",
    "createdBy": "admin",
    "members": [],
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 400 (invalid name format), 409 (group already exists), 503 (Gatekeeper unavailable)

---

### List Groups

```
GET /api/gatekeeper/groups
```

**Auth:** Admin only

Returns all groups.

**Response (200):**

```json
{
  "groups": [
    {
      "name": "engineering",
      "description": "Engineering team",
      "createdBy": "admin",
      "members": ["alice", "bob"],
      "createdAt": "2026-04-04T12:00:00.000Z"
    }
  ]
}
```

---

### Get Group

```
GET /api/gatekeeper/groups/:name
```

**Auth:** Admin only

Returns a single group with its members.

**Response (200):**

```json
{
  "group": {
    "name": "engineering",
    "description": "Engineering team",
    "createdBy": "admin",
    "members": ["alice", "bob"],
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 404 (group not found)

---

### Update Group

```
PATCH /api/gatekeeper/groups/:name
```

**Auth:** Admin only

Update a group's name or description.

**Request body:**

| Field         | Type   | Required | Description                                                   |
| ------------- | ------ | -------- | ------------------------------------------------------------- |
| `name`        | string | No       | New group name (2-63 chars, lowercase alphanumeric + hyphens) |
| `description` | string | No       | New description                                               |

**Response (200):**

```json
{
  "ok": true,
  "group": {
    "name": "eng",
    "description": "Updated description",
    "createdBy": "admin",
    "members": ["alice", "bob"],
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 400 (invalid name format), 404 (group not found), 409 (new name conflicts with existing group)

---

### Delete Group

```
DELETE /api/gatekeeper/groups/:name
```

**Auth:** Admin only

Delete a group. Any grants referencing this group as a principal are automatically revoked.

**Response (200):**

```json
{
  "ok": true,
  "deletedGrants": 3
}
```

**Errors:** 404 (group not found)

---

### Add Members

```
POST /api/gatekeeper/groups/:name/members
```

**Auth:** Admin only

Add one or more members to a group.

**Request body:**

| Field       | Type     | Required | Description                         |
| ----------- | -------- | -------- | ----------------------------------- |
| `usernames` | string[] | Yes      | Usernames to add (1-50 per request) |

**Response (201):**

```json
{
  "ok": true,
  "group": {
    "name": "engineering",
    "description": "Engineering team",
    "createdBy": "admin",
    "members": ["alice", "bob", "carol"],
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 400 (invalid or empty usernames array), 404 (group not found), 503 (a removed user's principal under one of the usernames cannot be cleared — `code: "gatekeeper_unavailable"`)

---

### Remove Member

```
DELETE /api/gatekeeper/groups/:name/members/:username
```

**Auth:** Admin only

Remove a single member from a group.

**Response (200):**

```json
{
  "ok": true,
  "group": {
    "name": "engineering",
    "description": "Engineering team",
    "createdBy": "admin",
    "members": ["alice", "bob"],
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 404 (group not found, or username not a member)

---

## Grants

### Create Grant

```
POST /api/gatekeeper/grants
```

**Auth:** Admin only

Create a new authorization grant linking a principal (user or group) to a resource.

**Request body:**

| Field           | Type   | Required | Description                               |
| --------------- | ------ | -------- | ----------------------------------------- |
| `principalType` | string | Yes      | `"user"` or `"group"`                     |
| `principalId`   | string | Yes      | Username or group name                    |
| `resourceType`  | string | Yes      | Type of resource being granted access to  |
| `resourceId`    | string | Yes      | Identifier of the specific resource       |
| `context`       | object | No       | Additional context metadata for the grant |

**Response (201):**

```json
{
  "ok": true,
  "grant": {
    "grantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "principalType": "group",
    "principalId": "engineering",
    "resourceType": "site",
    "resourceId": "docs.example.com",
    "context": null,
    "used": false,
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Plugin role grants.** For `resourceType: "plugin"` with `context.roles`, the panel checks the grant before Gatekeeper sees it: `resourceId` must be the route of an installed plugin that declares `identity` (`400`, `code: "no_identity"`) and `roles` a non-empty list of its role ids (`400`, `code: "invalid_roles"`, or `"unknown_roles"` with the `unknown` ones); they go on sorted and without repeats. The plugin's **People** panel and `lamaste-server plugins entitlements` manage these grants one principal at a time (`PUT /api/plugins/:name/entitlements` replaces a principal's role grants) — prefer them to creating one here. A plugin grant without `roles` (the desktop's local-install grants) never makes anyone a plugin user.

**Errors:** 400 (invalid body; a role grant as above), 409 (duplicate grant), 503 (Gatekeeper unavailable, or a removed user's principal under `principalId` cannot be cleared — `code: "gatekeeper_unavailable"`)

---

### List Grants

```
GET /api/gatekeeper/grants
```

**Auth:** Admin only

Returns all grants, optionally filtered by query parameters.

**Query parameters:**

| Parameter       | Type    | Description                      |
| --------------- | ------- | -------------------------------- |
| `principalType` | string  | Filter by `"user"` or `"group"`  |
| `principalId`   | string  | Filter by username or group name |
| `resourceType`  | string  | Filter by resource type          |
| `resourceId`    | string  | Filter by resource identifier    |
| `used`          | boolean | Filter by usage status           |

**Response (200):**

```json
{
  "grants": [
    {
      "grantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "principalType": "group",
      "principalId": "engineering",
      "resourceType": "site",
      "resourceId": "docs.example.com",
      "context": null,
      "used": false,
      "createdAt": "2026-04-04T12:00:00.000Z"
    }
  ]
}
```

---

### Get Grant

```
GET /api/gatekeeper/grants/:grantId
```

**Auth:** Admin only

Returns a single grant by ID.

**Response (200):**

```json
{
  "grant": {
    "grantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "principalType": "user",
    "principalId": "alice",
    "resourceType": "site",
    "resourceId": "docs.example.com",
    "context": null,
    "used": true,
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 404 (grant not found)

---

### Revoke Grant

```
DELETE /api/gatekeeper/grants/:grantId
```

**Auth:** Admin only

Revoke an existing grant.

**Response (200):**

```json
{
  "ok": true,
  "grant": {
    "grantId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "principalType": "user",
    "principalId": "alice",
    "resourceType": "site",
    "resourceId": "docs.example.com",
    "context": null,
    "used": false,
    "createdAt": "2026-04-04T12:00:00.000Z"
  }
}
```

**Errors:** 404 (grant not found), 409 (grant already revoked or in conflicting state)

---

## Diagnostics and Settings

### Check Access

```
GET /api/gatekeeper/access/check
```

**Auth:** Admin only

Test whether a user has access to a specific resource. Useful for debugging authorization decisions without making real requests.

**Query parameters:**

| Parameter      | Type   | Required | Description                |
| -------------- | ------ | -------- | -------------------------- |
| `username`     | string | Yes      | Username to check          |
| `resourceType` | string | Yes      | Type of resource           |
| `resourceId`   | string | Yes      | Identifier of the resource |

**Response (200) -- access granted:**

```json
{
  "allowed": true
}
```

**Response (200) -- access denied:**

```json
{
  "allowed": false,
  "resource": "site:docs.example.com",
  "templates": []
}
```

The `templates` array contains any access request templates available for the denied resource.

**Errors:** 400 (missing required query parameters)

---

### Bust Cache

```
POST /api/gatekeeper/cache/bust
```

**Auth:** Admin only

Invalidate all cached authorization decisions. Use this after making changes to grants or groups that need to take effect immediately.

**Response (200):**

```json
{
  "ok": true
}
```

---

### Get Settings

```
GET /api/gatekeeper/settings
```

**Auth:** Admin only

Returns the current Gatekeeper settings.

**Response (200):**

```json
{
  "settings": {
    "adminEmail": "admin@example.com",
    "adminName": "Admin",
    "slackChannel": null,
    "teamsChannel": null,
    "sessionCacheTtlMs": 300000,
    "accessLoggingEnabled": true,
    "accessLogRetentionDays": 30
  }
}
```

---

### Update Settings

```
PATCH /api/gatekeeper/settings
```

**Auth:** Admin only

Update Gatekeeper settings. Only provided fields are changed; omitted fields remain unchanged.

**Request body:**

| Field                    | Type    | Required | Description                                 |
| ------------------------ | ------- | -------- | ------------------------------------------- |
| `adminEmail`             | string  | No       | Admin contact email                         |
| `adminName`              | string  | No       | Admin display name                          |
| `slackChannel`           | string  | No       | Slack channel for notifications             |
| `teamsChannel`           | string  | No       | Microsoft Teams channel for notifications   |
| `sessionCacheTtlMs`      | number  | No       | Session cache TTL in milliseconds           |
| `accessLoggingEnabled`   | boolean | No       | Enable or disable access logging            |
| `accessLogRetentionDays` | number  | No       | Number of days to retain access log entries |

**Response (200):**

```json
{
  "ok": true,
  "settings": {
    "adminEmail": "admin@example.com",
    "adminName": "Admin",
    "slackChannel": "#lamaste-alerts",
    "teamsChannel": null,
    "sessionCacheTtlMs": 300000,
    "accessLoggingEnabled": true,
    "accessLogRetentionDays": 30
  }
}
```

**Errors:** 400 (invalid settings values)

---

### Get Access Log

```
GET /api/gatekeeper/access-log
```

**Auth:** Admin only

Returns access log entries for auditing authorization decisions.

**Query parameters:**

| Parameter | Type   | Required | Description                                      |
| --------- | ------ | -------- | ------------------------------------------------ |
| `limit`   | number | No       | Max entries to return (default varies, max 1000) |
| `offset`  | number | No       | Number of entries to skip                        |

**Response (200):**

```json
{
  "entries": [
    {
      "timestamp": "2026-04-04T12:05:00.000Z",
      "username": "alice",
      "resourceType": "site",
      "resourceId": "docs.example.com",
      "allowed": true
    }
  ],
  "total": 142
}
```

---

### Clear Access Log

```
DELETE /api/gatekeeper/access-log
```

**Auth:** Admin only

Delete all access log entries.

**Response (200):**

```json
{
  "ok": true,
  "removed": 142
}
```

Gatekeeper's own API also takes `?username=<u>` and `&before=<ISO 8601 UTC>`: only that user's entries — logged before they were removed, since a later user may have the same username — and the entries still queued for the log, so none of them is written afterwards. The panel calls it when it [erases](users.md#erasing-a-removed-user) a removed user; the proxy always clears everything.

---

## Internal Endpoints

These endpoints are not proxied through the lamalibre-lamaste-serverd and are not accessible externally.

### Authorization Check (nginx auth_request)

```
GET /authz/tunnel/:fqdn
```

**Host:** `127.0.0.1:9294`

This is the nginx `auth_request` target. nginx calls this endpoint on every request to a Gatekeeper-protected resource. The tunnel vhost names its tunnel in the path (`proxy_pass http://127.0.0.1:9294/authz/tunnel/<fqdn>;`) and sends the same hostname in `X-Original-URL` (with the request's path and query) and `Host`; a request whose `X-Original-URL` or `Host` names another hostname, or has no `Host`, is refused with 401. Gatekeeper validates the user's Authelia session cookie for that URL and checks the corresponding grant.

`GET /authz/check` — what tunnel vhosts written before 4.3 call, with `X-Original-URL` and `Host` taken from the client's `Host` header — answers `403` (logged as `vhost_predates_host_binding`): such a vhost closes its tunnel until the panel rewrites it, which it does at startup. See [nginx Configuration](../03-architecture/nginx-configuration.md#authorization-subrequests-name-their-own-hostname).

**Response codes:**

| Status | Meaning | Description                                                                       |
| ------ | ------- | --------------------------------------------------------------------------------- |
| 200    | Pass    | User is authenticated and authorized; request proceeds                            |
| 401    | No auth | No valid Authelia session; nginx redirects to login                               |
| 403    | Denied  | User is authenticated but lacks a grant; returns an HTML body with denial details |

This endpoint is bound to `127.0.0.1` only. External traffic never reaches it directly -- nginx forwards the subrequest internally.

### User-Surface Authorization (nginx auth_request)

```
GET /authz/user-surface/:fqdn
```

**Host:** `127.0.0.1:9294`

The `auth_request` target of a plugin's user surface — `/api/<route>/app` and everything under it on the host of a tunnel bound to the plugin ([Tunnels API](tunnels.md#user-surface-binding)). The vhost names its tunnel in the path, `X-Original-URL` and `Host`, as for `/authz/tunnel/:fqdn`, and sends `X-Original-Method`. Gatekeeper checks, in order: the hostnames agree; the tunnel is known, enabled, not public and has a user surface; the raw request target — what follows `https://<fqdn>` in `X-Original-URL`, never re-encoded by a URL parser — lies on the user surface of a route bound to the tunnel, with no `.` or `..` segment, backslash, percent-encoded `.`, `/` or `\`, or escape that does not decode; the Authelia session; on a `restricted` tunnel, the user's grant for the tunnel. Then it signs a **relay assertion for the panel**: Ed25519 with the relay signing key, audience `@panel`, port 3100, caller `{ type: "user", username }` — the username alone; the panel takes everything else about the user from its directory — bound to the method and the raw target (`{ route, path }`).

| Status | Meaning                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `X-Lamalibre-Relay-Assertion` for this one request; `Cache-Control: no-store`; no `Remote-*` headers                                                                                    |
| 401    | No valid session — nginx answers with `GET /authz/user-surface-unauthenticated`: a JSON `401 { "error": "unauthenticated" }`, never a redirect (the caller is an application's request) |
| 403    | Anything else refused, with an empty body — never the access-request page; the reason is logged (`user-surface authz denied`)                                                           |
| 503    | The relay signing key is unusable                                                                                                                                                       |

### Principals (Gatekeeper's own API)

```
DELETE /api/principals/user/:username
```

**Host:** `127.0.0.1:9294`, with the panel's secret. Not proxied.

Removes a user principal everywhere — every grant naming the username, of any resource type, and its membership of every group — in one transaction, holding the groups lock and then the grants lock. Idempotent. `{ "ok": true, "grantsRemoved": 2, "groupsLeft": 1 }`. The panel calls it when it deletes a user, retries it every minute while it is pending, and calls it before it creates a user, a grant or a membership under a username a removed user held ([Usernames and Gatekeeper](users.md#usernames-and-gatekeeper)).
