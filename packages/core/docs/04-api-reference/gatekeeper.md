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

**OIDC client grants.** For `resourceType: "oidc-client"` the panel checks that `resourceId` is a client an installed plugin declares (`400`, `code: "unknown_oidc_client"`) that signs users in (`400`, `code: "service_oidc_client"`). Such a grant admits an **external member** of the plugin's domain to the client's sign-in ([Registry and OIDC](registry-and-oidc.md#several-domains-one-issuer-each)); members need none. Gatekeeper is not in the OIDC path — it only keeps the grant; the panel renders it into Authelia.

**Every grant or group change through the proxy re-renders** who may reach what: the groups Lamaste owns in `users.yml` (external members' host groups follow their grants on `restricted` hosts) — applied by Authelia without a restart.

**Errors:** 400 (invalid body; a role grant or an OIDC client grant as above), 409 (duplicate grant), 503 (Gatekeeper unavailable, or a removed user's principal under `principalId` cannot be cleared — `code: "gatekeeper_unavailable"`)

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

Delete all access log entries. It takes no query: Gatekeeper refuses one (`400`), so a narrowing query from an older caller never clears the whole log instead.

**Response (200):**

```json
{
  "ok": true,
  "removed": 142
}
```

### Purge One User's Access-Log Entries

```
POST /api/gatekeeper/access-log/purge
```

**Auth:** Admin only

```json
{ "username": "alice", "before": "2026-10-22T08:00:00.000Z" }
```

Deletes only that user's entries — logged before `before` (ISO 8601 UTC, optional) when given, since a later user may have the same username — and the entries still queued for the log, so none of them is written afterwards. `{ "ok": true, "removed": 3 }`; `400` for a body that is not `{ username, before? }`. The username travels in the body, never in a URL that request logs keep. The panel calls Gatekeeper's `POST /api/access-log/purge` itself when it [erases](users.md#erasing-a-removed-user) a removed user.

---

## Internal Endpoints

These endpoints are not proxied through the lamalibre-lamaste-serverd and are not accessible externally.

### Authorization Check (nginx auth_request)

```
GET /authz/tunnel/:fqdn
```

**Host:** `127.0.0.1:9294`

This is the nginx `auth_request` target. nginx calls this endpoint on every request to a Gatekeeper-protected resource. The tunnel vhost names its tunnel in the path (`proxy_pass http://127.0.0.1:9294/authz/tunnel/<fqdn>;`) and sends the same hostname in `X-Original-URL` (with the request's path and query) and `Host`; a request whose `X-Original-URL` or `Host` names another hostname, or has no `Host`, is refused with 401. Gatekeeper validates the user's Authelia session cookie for that URL and checks the corresponding grant.

**The session cookie.** Of the browser's `Cookie` header Gatekeeper reads the `authelia_session` pair alone (core `autheliaSessionCookies`: a pair whose name, spaces and tabs trimmed, is exactly `authelia_session`) and sends Authelia `Cookie: authelia_session=<value>` — never the browser's other cookies. A request carrying **more than one** `authelia_session` is refused with `401` before Authelia is asked (logged `duplicate_authelia_cookie`): another host under the domain can plant a second one under another path, and which one Authelia would read is not Gatekeeper's to guess. A validated session is cached for `sessionCacheTtlMs` (30 s) under an HMAC of the cookie value **and the tunnel host** — Authelia decides per host, so a session accepted on one host is asked about again on another.

**Rate limit.** Every authorization route (`/authz/tunnel/:fqdn`, `/authz/user-surface/:fqdn`, `/authz/user-surface-unauthenticated`, `/authz/check`) allows 6000 requests a minute per client address and tunnel host (`AUTHZ_RATE_LIMIT_PER_CLIENT`), `429` past it. The client address is `X-Forwarded-For`, which nginx sets to `$remote_addr` on every subrequest and Gatekeeper trusts from `127.0.0.1` only (`trustProxy`) — one client exhausting its bucket leaves the others theirs. The management API keeps one shared bucket (1000 a minute): only the panel and local tooling reach it.

**Logs.** A refusal is logged with the tunnel, the reason and the request id — never the username (`no_matching_grant` included). The access-request log (`accessLoggingEnabled`) is the one place Gatekeeper records who asked.

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

The `auth_request` target of a plugin's user surface — `/api/<route>/app` and everything under it on the host of a tunnel bound to the plugin ([Tunnels API](tunnels.md#user-surface-binding)) or of the site the plugin owns ([Web surface](agent-hosted-plugins.md#web-surface)). Gatekeeper reads both kinds of host from `tunnels.json` and `sites.json`, re-read when either changes, the way the panel reads them (core `userSurfaceHosts`): a route two hosts would serve is served by neither, and a host whose name another host shares is no host. Where this section says tunnel, read the host; a site's grant is a `site` grant. The vhost names its tunnel in the path, `X-Original-URL` and `Host`, as for `/authz/tunnel/:fqdn`, and sends `X-Original-Method`. Gatekeeper checks, in order: the hostnames agree; the tunnel is known, enabled, not public and has a user surface; the raw request target — what follows `https://<fqdn>` in `X-Original-URL`, never re-encoded by a URL parser — lies on the user surface of a route bound to the tunnel, with no `.` or `..` segment, backslash, percent-encoded `.`, `/`, `\` or `%` (`%25`), or escape that does not decode; the tunnel's agent hosts the plugin — it carries the plugin's internal tunnel, the one `tunnels.json` records for the route (core `tunnelServedUserSurfaceRoutes`; refused `not_hosting_agent` otherwise: the tunnel moved or its agent revoked, the plugin hosted elsewhere or not at all); the Authelia session, read as for `/authz/tunnel/:fqdn` (one `authelia_session` only); on a `restricted` tunnel, the user's grant for the tunnel. Then it signs a **relay assertion for the panel**: Ed25519 with the relay signing key, audience `@panel`, port 3100, caller `{ type: "user", username }` — the username alone; the panel takes everything else about the user from its directory — bound to the method and the raw target (`{ route, path }`).

| Status | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `X-Lamalibre-Relay-Assertion` for this one request; `Cache-Control: no-store`; no `Remote-*` headers                                                                                                                                                                                                                                                                                                                                 |
| 401    | No valid session (or more than one session cookie) — nginx answers with `GET /authz/user-surface-unauthenticated`: a JSON `401 { "error": "unauthenticated" }`, never a redirect (the caller is an application's request)                                                                                                                                                                                                            |
| 403    | Anything else refused — never the access-request page; the reason is logged (`user-surface authz denied`) and named in `X-Lamalibre-Refusal`: `not_a_member` for a user who is not a member of the host's domain, `forbidden` otherwise. nginx keeps only the status and headers (`auth_request`) and answers the application itself: `403 { "error": "not_a_member" }` for that value, `403 { "error": "forbidden" }` for any other |
| 503    | The relay signing key is unusable                                                                                                                                                                                                                                                                                                                                                                                                    |

### Web-Surface Shell Authorization (nginx auth_request)

```
GET /authz/user-surface-shell/:fqdn
```

**Host:** `127.0.0.1:9294`

The `auth_request` target of every path of a plugin-owned site but its user surface's API: the shell of the plugin's [web surface](agent-hosted-plugins.md#web-surface). The vhost names the site in the path, `X-Original-URL` and `Host`. Gatekeeper checks, in order: the hostnames agree; the host is a site a plugin owns; its route is served (the plugin hosted, no other host serving the route); the Authelia session (one `authelia_session` only); the user is in the plugin's **audience** — an entitlement on the plugin (`resourceType: "plugin"`, `resourceId: <route>`) with a non-empty `context.roles`, to the user or to one of their Lamaste groups (a grant without roles never counts); on a `restricted` site, a grant on the site (`resourceType: "site"`, `resourceId: <site id>`). The panel decides again, from its directory, on every request to the plugin's API — a disabled or removed user, a plugin not ready.

| Status | Meaning                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Allowed; nothing else is passed on — nginx serves the shell from disk, no backend receives a user                                                             |
| 401    | No valid session (or more than one session cookie) — nginx redirects a page to the login                                                                      |
| 403    | No entitlement or no site grant: the access-request page, served inline; anything else refused (not a web surface, not served, names disagree): an empty body |

Every answer is `Cache-Control: no-store`. A refusal for want of an entitlement or a grant is logged with the resource and the reason only, and recorded in the access-request log when it is on.

### Domain membership

Every authorization route (tunnel, user surface, shell) checks the user's membership of the host's domain after Authelia, from `/etc/lamalibre/lamaste/domains.json` (written by the panel, watched like `tunnels.json`): `{ "v": 2, "domains": [{ "name", "members": [username…], "externals": [username…] }] }`, active domains and active people only. A missing or unreadable projection, one of another version, or a host under no domain, refuses (fail closed). Authelia's own 403 — it renders the same membership — is no longer taken for "not signed in": a signed-in non-member gets **403** with the domain refusal page (the domain, the admin contact, a sign-out link to `https://auth.<domain>/logout`; no username), or JSON `{ "error": "not_a_member" }` on a user surface, instead of a 401 that sent the browser back to the sign-in page in a loop. Refusals are never cached; a membership change busts the session cache.

**External members** reach only what names them. After the membership check:

| Route             | `authenticated` host                                     | `restricted` host                        |
| ----------------- | -------------------------------------------------------- | ---------------------------------------- |
| Tunnel            | access-request page (403), logged `external_not_granted` | their grant (to them or a Lamaste group) |
| User surface      | 403, `X-Lamalibre-Refusal: forbidden`                    | the host's grant                         |
| Web-surface shell | access-request page (403)                                | the plugin's audience and the site grant |

Members are unchanged. **Groups Lamaste owns** (`lamaste:…`, and hostnames under the relay's domains — [Domains API](domains.md#where-membership-is-enforced)) are stripped from `Remote-Groups` and from a plugin tunnel's relay assertion: a backend sees only the groups an administrator assigned.

### Refusal Page (nginx `error_page 403`)

```
GET /authz/refusal/:fqdn
```

What an Authelia-protected static site answers a signed-in user Authelia refused with (the site asks Authelia directly, not Gatekeeper). Always 403 with the refusal page; reads no session and decides nothing.

### Principals (Gatekeeper's own API)

```
POST /api/principals/user/remove
{ "username": "alice" }
```

**Host:** `127.0.0.1:9294`, with the panel's secret. Not proxied.

Removes a user principal everywhere — every grant naming the username, of any resource type, and its membership of every group — in one transaction, holding the groups lock and then the grants lock. Idempotent. `{ "ok": true, "grantsRemoved": 2, "groupsLeft": 1 }`; `400` for a body that is not `{ username }` (1–100 characters), never echoing it. The username travels in the body, never in a URL that request logs keep (the `DELETE /api/principals/user/:username` of earlier 4.5 builds is gone). The panel calls it when a user is removed, retries it every minute while it is pending, and calls it before it creates a user under a username a removed user held — always then — and before it gives a grant or a membership to a username whose cleanup is pending ([Usernames and Gatekeeper](users.md#usernames-and-gatekeeper)).

**Request logging.** Gatekeeper logs one metadata line per request — method, route pattern (`/authz/tunnel/:fqdn`, never the URL), status, duration — and no client address; Fastify's own request lines are off.
