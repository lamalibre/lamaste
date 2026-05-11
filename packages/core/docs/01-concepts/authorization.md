# Authorization (Gatekeeper)

> Gatekeeper is a lightweight Fastify service on `127.0.0.1:9294` that sits between Authelia (authentication) and tunnel backends, acting as an nginx `auth_request` target for fine-grained access control. Authelia determines WHO you are; Gatekeeper determines WHAT you can access.

## In Plain English

Lamaste already has a front door guard (Authelia) who checks your ID and lets you into the building. Gatekeeper is the hallway guard who checks whether you are allowed into a specific room.

Without Gatekeeper, every authenticated user can access every tunneled app. That is fine when all your users are trusted, but once you expose apps to different teams, clients, or the public, you need to control who sees what. Gatekeeper adds that control without replacing Authelia — the two work together.

When a visitor requests a tunneled app, nginx first asks Authelia "is this person logged in?" and then asks Gatekeeper "is this person allowed to access this specific tunnel?" Only if both answer yes does nginx proxy the request through.

There are three access modes for tunnels:

- **Public** — no authentication at all. nginx proxies directly to the backend.
- **Authenticated** — Authelia login required. Any authenticated user passes through.
- **Restricted** — Authelia login required, then Gatekeeper checks for a specific grant. If the user does not have one, they see a friendly 403 page with pre-filled message templates to request access.

## For Users

### Dual group system

Lamaste has two separate group systems that serve different purposes:

**Authelia groups** are identity-tier groups stored in `users.yml` and managed through the Users page. These are broad categories that describe who a user is:

| Group      | Purpose                                    |
| ---------- | ------------------------------------------ |
| `admins`   | Server administrators                      |
| `internal` | Internal team members                      |
| `external` | External collaborators, clients, or guests |

**Lamaste groups** are access-control groups stored in `groups.json` and managed through the Gatekeeper dashboard. These are project-oriented groups that describe what a user can access:

| Example group  | Members                       |
| -------------- | ----------------------------- |
| `developers`   | alice, bob                    |
| `design-team`  | carol, dave                   |
| `beta-testers` | alice, carol, eve             |

The distinction matters because identity rarely maps cleanly to access. Alice might be an `internal` team member (Authelia group) who is on both the `developers` and `beta-testers` groups (Lamaste groups). Bob might be `external` but still in the `developers` group for a specific project.

Authelia groups are used for broad policy (e.g., all internal users can reach the intranet). Lamaste groups are used for fine-grained access control (e.g., only the design-team can reach the Figma proxy).

### Grants

Access is controlled through grants. A grant connects a principal (a user or a group) to a resource (a tunnel, a plugin, or any custom resource type).

For example:

- "User `alice` can access tunnel `staging-app`"
- "Group `developers` can access tunnel `api-docs`"
- "User `bob` can access plugin `herd`"

When a group is the principal, the grant expands to all members of that group at check time. If you add a new member to the `developers` group, they immediately gain access to everything granted to `developers` — no need to create individual grants.

Grants are not tunnel-specific. The resource model is generic: each grant has a resource type (e.g., `tunnel`, `plugin`) and a resource identifier. This means the same grant system works for tunnels, plugins, and any future resource types.

### Access modes for tunnels

Each tunnel can be configured with one of three access modes:

**Public.** No authentication. nginx proxies requests directly to the backend without involving Authelia or Gatekeeper. Use this for public-facing services like a marketing site or a public API.

**Authenticated.** Authelia login required, but no grant check. Any user who can log in through Authelia can access the tunnel. Use this for internal services where everyone on the team should have access.

**Restricted.** Authelia login required, and Gatekeeper checks for a matching grant. If the user has a grant (directly or through a group), the request passes through. If not, the user sees a 403 access request page. Use this for sensitive services that only specific people or teams should reach.

### Access request pages

When a user hits a restricted tunnel without a grant, they do not see a generic "403 Forbidden" error. Instead, Gatekeeper returns a user-friendly HTML page that explains they do not have access and offers pre-filled message templates for requesting it:

- **Email** — a mailto link with a pre-filled subject and body addressed to the admin
- **Slack** — a copy-ready message formatted for Slack
- **Teams** — a copy-ready message formatted for Microsoft Teams
- **WhatsApp** — a copy-ready message formatted for WhatsApp
- **Generic** — a plain-text message suitable for any other channel

The templates include the user's name, the resource they tried to access, and a timestamp, so the admin receives all the context needed to create a grant.

### Managing groups and grants

From the Gatekeeper dashboard in the admin panel:

1. **Groups** — create Lamaste groups and add members (by Authelia username)
2. **Grants** — create grants connecting users or groups to resources
3. **Access Requests** — review incoming access requests from users who hit 403 pages
4. **Settings** — configure default access modes and other Gatekeeper behavior

### How changes take effect

Gatekeeper watches its state files (`groups.json`, `access-grants.json`) for changes. When you create a group, add a member, or create a grant through the admin panel, the change takes effect immediately — no service restart required.

## For Developers

### Architecture

Gatekeeper runs as an independent Fastify service on `127.0.0.1:9294`. nginx uses `auth_request` to delegate authorization decisions to it, similar to how Authelia handles authentication via the same pattern.

The request flow for a restricted tunnel:

```
1. Visitor requests staging.example.com
2. nginx sends auth_request to Authelia (127.0.0.1:9091)
3. Authelia validates session cookie:
   a. No valid session -> 401 -> nginx redirects to auth.example.com
   b. Valid session -> 200 with Remote-User/Remote-Groups headers
4. nginx sends auth_request to Gatekeeper (127.0.0.1:9294)
   - Forwards Remote-User, Remote-Groups, and Host headers
5. Gatekeeper checks for a matching grant:
   a. Grant exists (user or group match) -> 200
   b. No grant -> 403 with access request HTML page
6. If both return 200: nginx proxies to the tunnel backend
```

For public tunnels, nginx skips both auth_request directives. For authenticated tunnels, nginx uses only the Authelia auth_request and skips Gatekeeper.

### Grant model

The grant model is generic, not tunnel-specific:

```javascript
{
  grantId: 'g_abc123',           // unique identifier
  principalType: 'user',         // 'user' or 'group'
  principalId: 'alice',          // username or group name
  resourceType: 'tunnel',        // 'tunnel', 'plugin', or custom
  resourceId: 'staging-app',     // resource identifier
  context: {},                   // optional metadata
  used: false,                   // whether grant has been consumed
  createdAt: '2026-04-01T...',
  usedAt: null                   // consumption timestamp, or null
}
```

At authorization check time, Gatekeeper resolves the request in two steps:

1. **Direct match** — is there a grant where `principalType === 'user'` and `principalId` matches the `Remote-User` header?
2. **Group expansion** — for each Lamaste group the user belongs to, is there a grant where `principalType === 'group'` and `principalId` matches the group name?

If either step finds a matching grant for the requested resource, the check passes.

### Session caching

Authorization checks happen on every request to a restricted tunnel. A page load can trigger dozens or hundreds of subrequests (HTML, CSS, JS, images, API calls). Without caching, each subrequest would hit Authelia and Gatekeeper, creating unnecessary load.

Gatekeeper uses an in-memory session cache to solve this:

**Gatekeeper in-memory session cache.** When Gatekeeper receives a request, it extracts the user identity from the Authelia session. Validated sessions are cached in memory for 30 seconds (configurable via `sessionCacheTtlMs` in `gatekeeper.json`), keyed by the session cookie value. This means repeated Gatekeeper calls for the same session do not re-validate against Authelia.

> **Note:** The installer also writes an nginx `proxy_cache_path` snippet (`/etc/nginx/snippets/lamalibre-lamaste-authz-cache.conf`) for optional nginx-level caching, but the generated vhosts do not currently include `proxy_cache` directives. All authorization caching relies on the Gatekeeper's in-memory session cache.

**Effect:** On a warm cache, repeated subrequests for the same session are resolved from the in-memory cache without re-validating against Authelia. The 30-second default TTL ensures that revoked grants and expired sessions take effect within half a minute.

### File watching

Gatekeeper watches its state files using `fs.watch`:

| File           | Contains                          |
| -------------- | --------------------------------- |
| `groups.json`  | Lamaste groups and their members |
| `access-grants.json`  | All grants (user and group)       |

When a file changes, Gatekeeper reloads its in-memory state and invalidates the session cache. This means changes made through the admin panel API (which writes to these files atomically) take effect immediately without restarting the Gatekeeper service.

State files use the same atomic write pattern as the rest of Lamaste (temp file with `O_EXCL` + mode `0600` -> `fsync` -> rename).

### Access request page generation

When Gatekeeper denies a request (no matching grant), it returns a 403 response with an HTML page instead of a bare status code. The page is generated from templates in `packages/lamaste-gatekeeper/src/lib/templates.ts` and includes:

- The username (from `Remote-User` header)
- The resource they attempted to access (from `Host` header)
- A human-readable timestamp
- Pre-filled message templates for email (mailto link), Slack, Teams, WhatsApp, and a generic plain-text format

The HTML is self-contained (inline CSS, no external dependencies) so it renders correctly even when all other assets are blocked by the 403.

### State files

| File                               | Purpose                           | Format |
| ---------------------------------- | --------------------------------- | ------ |
| `/etc/lamalibre/lamaste/groups.json`        | Lamaste groups and members       | JSON   |
| `/etc/lamalibre/lamaste/access-grants.json` | All grants                        | JSON   |

### Source files

| File                                                        | Purpose                                              |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| `packages/lamaste-gatekeeper/src/server/index.ts`          | Fastify server setup, file watching                  |
| `packages/lamaste-gatekeeper/src/server/routes/authz.ts`   | Authorization check endpoint (nginx auth_request)    |
| `packages/lamaste-gatekeeper/src/server/routes/grants.ts`  | Grant CRUD API                                       |
| `packages/lamaste-gatekeeper/src/server/routes/groups.ts`  | Group CRUD API                                       |
| `packages/lamaste-gatekeeper/src/server/routes/access-request.ts` | Access request submission and listing          |
| `packages/lamaste-gatekeeper/src/lib/authz.ts`             | Authorization logic (grant matching, group expansion) |
| `packages/lamaste-gatekeeper/src/lib/grants.ts`            | Grant storage and atomic writes                      |
| `packages/lamaste-gatekeeper/src/lib/groups.ts`            | Group storage and atomic writes                      |
| `packages/lamaste-gatekeeper/src/lib/templates.ts`         | Access request HTML page generation                  |
| `packages/lamaste-serverd/src/routes/management/gatekeeper-proxy.js` | Admin panel proxy to Gatekeeper API             |
| `packages/lamaste-serverd/src/lib/nginx.js`                    | Vhost generation with Gatekeeper auth_request block  |

## Quick Reference

### Service

| Property     | Value                |
| ------------ | -------------------- |
| Listen       | `127.0.0.1:9294`     |
| Runtime      | Fastify (TypeScript) |
| State files  | `groups.json`, `access-grants.json` in `/etc/lamalibre/lamaste/` |
| RAM usage    | Minimal (in-process) |

### Access modes

| Mode          | Authelia | Gatekeeper | Who can access              |
| ------------- | -------- | ---------- | --------------------------- |
| Public        | No       | No         | Anyone on the internet      |
| Authenticated | Yes      | No         | Any logged-in Authelia user |
| Restricted    | Yes      | Yes        | Users with a matching grant |

### Cache TTLs

| Layer                        | TTL       | Key                           |
| ---------------------------- | --------- | ----------------------------- |
| Gatekeeper in-memory session | 30s       | Session cookie value          |

### Group comparison

| Property    | Authelia groups                  | Lamaste groups                     |
| ----------- | -------------------------------- | ----------------------------------- |
| Purpose     | Identity classification          | Access control                      |
| Storage     | `users.yml`                      | `groups.json`                       |
| Managed by  | Authelia (via panel Users page)  | Gatekeeper (via panel Gatekeeper page) |
| Examples    | `admins`, `internal`, `external` | `developers`, `design-team`         |
| Granularity | Broad (who you are)              | Fine (what you access)              |

### Related documentation

- [Authentication](authentication.md) — Authelia TOTP 2FA and the forward-auth pattern that Gatekeeper builds upon
- [nginx Reverse Proxy](nginx-reverse-proxy.md) — auth_request configuration and vhost generation
- [Security Model](security-model.md) — authorization as part of defense-in-depth
- [Tunneling](tunneling.md) — tunnel types and access modes
