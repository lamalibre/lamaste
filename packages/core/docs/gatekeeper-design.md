# Lamaste Gatekeeper — Design Document

## Overview

`@lamalibre/lamaste-gatekeeper` is a standalone authorization package for Lamaste. It manages **groups** and **grants**, enforces tunnel access control via a lightweight Fastify service, and serves user-friendly "request access" pages when access is denied.

It follows the same architectural pattern as `@lamalibre/lamaste-tickets` — a solid library at the core, with a service, CLI, and desktop as consumers.

---

## Motivation

### Problem

- App tunnels currently allow **all Authelia-authenticated users** — no per-user or per-group restrictions
- Plugin tunnel access uses a plugin-specific grant model (`user-plugin-access.json`) that doesn't generalize
- There is no group management — groups are free-form strings in Authelia's `users.yml` with no CRUD, no metadata, and every change requires an Authelia restart
- Access denial shows a generic Authelia 403 page with no context or actionable next steps

### Solution

A two-layer authentication/authorization architecture:

1. **Authelia** — authentication layer (who are you?)
2. **Gatekeeper** — authorization layer (can you access this resource?)

When access is denied, users see a helpful page with pre-filled message templates to request access from their administrator.

---

## Dual Group System

Two separate, orthogonal group systems:

### Authelia Groups (Identity Tier)

Fixed role tiers stored in `users.yml`. Determines *what kind of user you are*.

| Group | Purpose |
|-------|---------|
| `admins` | Full panel access (mTLS certificate holders) |
| `internal` | Power users — can install standalone plugins, serve resources via tunnels |
| `external` | Basic users — can access tunnels they've been granted access to |

- Managed in `users.yml`, changes require Authelia restart
- User creation UI uses hardcoded checkboxes: admin (disables others), internal (disables external), external
- Rarely change after initial user setup

### Lamaste Groups (Access Control Tier)

Admin-created, arbitrary groups for fine-grained resource authorization. Determines *what resources you can access*.

| Example Group | Purpose |
|---------------|---------|
| `developers` | Access to dev/staging tunnels |
| `design-team` | Access to design tool tunnels |
| `client-acme` | External client access to specific project tunnels |

- Full CRUD via gatekeeper library/CLI/API
- Stored in `/etc/lamalibre/lamaste/groups.json`
- No Authelia involvement — membership changes don't require any restart
- Used in grants: "group `client-acme` can access tunnel `staging-app`"

---

## Package Structure

```
packages/lamaste-gatekeeper/
  src/
    lib/
      groups.js            # Group CRUD (atomic JSON writes, promise-chain mutex)
      grants.js            # Generic grant CRUD (atomic JSON writes, promise-chain mutex)
      authz.js             # Authorization check logic (resolves groups, evaluates grants)
      templates.js         # Access request message templates (email, Teams, Slack, WhatsApp)
      constants.js         # Principal types, resource types, access modes, hard caps
      migration.js         # Migrate user-plugin-access.json → access-grants.json
    server/
      index.js             # Fastify service entry point (127.0.0.1:9294)
      routes/
        authz.js           # GET /authz/check — nginx auth_request target
        access-request.js  # GET /access-request — denial page with message templates
        groups.js          # REST API for group management
        grants.js          # REST API for grant management
    cli/
      index.js             # CLI entry point
      commands/
        groups.js          # group create|list|show|delete|rename|add-member|remove-member
        grants.js          # grant create|list|show|revoke
        access.js          # access check <username> <resource> — diagnostic tool
    index.js               # Library exports (groups, grants, authz, templates, constants)
  package.json
  tsconfig.json
```

---

## Generic Grant Model

The grant system is resource-agnostic. It doesn't know what a "tunnel" or "plugin" is — it stores generic principal-to-resource bindings.

### Schema

```js
{
  grantId: string,            // UUID (crypto.randomUUID())

  // WHO — the principal
  principalType: 'user' | 'group',
  principalId: string,        // username or Lamaste group name

  // WHAT — the resource
  resourceType: string,       // 'tunnel', 'plugin', or any future type
  resourceId: string,         // tunnel UUID, plugin package name, etc.

  // TYPE-SPECIFIC CONTEXT
  context: object,            // { target: 'agent:myagent' } for plugins, {} for tunnels

  // LIFECYCLE
  used: boolean,              // tracks single-use grants (local plugin enrollment)
  createdAt: string,          // ISO 8601
  usedAt: string | null       // ISO 8601, null if unused
}
```

### Why Generic?

- Adding a new resource type (e.g., `storage`, `site`) requires zero schema changes
- The grant system doesn't need to understand resource semantics
- Consumers validate resource-specific context at their layer
- Filter/query works uniformly across all resource types

### Examples

**App tunnel grant (user):**
```json
{
  "grantId": "a1b2c3...",
  "principalType": "user",
  "principalId": "alice",
  "resourceType": "tunnel",
  "resourceId": "uuid-of-gitlab-tunnel",
  "context": {},
  "used": true,
  "createdAt": "2026-04-04T10:00:00Z",
  "usedAt": "2026-04-04T10:00:00Z"
}
```

**App tunnel grant (group):**
```json
{
  "grantId": "d4e5f6...",
  "principalType": "group",
  "principalId": "developers",
  "resourceType": "tunnel",
  "resourceId": "uuid-of-gitlab-tunnel",
  "context": {},
  "used": true,
  "createdAt": "2026-04-04T10:00:00Z",
  "usedAt": "2026-04-04T10:00:00Z"
}
```

**Plugin grant (agent-side):**
```json
{
  "grantId": "g7h8i9...",
  "principalType": "user",
  "principalId": "bob",
  "resourceType": "plugin",
  "resourceId": "@lamalibre/herd-server",
  "context": { "target": "agent:myagent" },
  "used": true,
  "createdAt": "2026-04-04T10:00:00Z",
  "usedAt": "2026-04-04T10:00:00Z"
}
```

**Plugin grant (local/desktop):**
```json
{
  "grantId": "j0k1l2...",
  "principalType": "user",
  "principalId": "carol",
  "resourceType": "plugin",
  "resourceId": "@lamalibre/sync-server",
  "context": { "target": "local" },
  "used": false,
  "createdAt": "2026-04-04T10:00:00Z",
  "usedAt": null
}
```

---

## Library API

### Groups

```js
import { createGroup, listGroups, getGroup, updateGroup, deleteGroup,
         addMembers, removeMembers, getGroupsForUser } from '@lamalibre/lamaste-gatekeeper';

createGroup(name, { description?, createdBy? })
  // → { name, description, members: [], createdAt, createdBy }
  // Validates: lowercase alphanumeric + hyphens, not 'admins'/'internal'/'external'
  // Rejects duplicates

listGroups()
  // → [{ name, description, members, createdAt, createdBy }]

getGroup(name)
  // → group or null

updateGroup(name, { name?: newName, description? })
  // Cannot rename to reserved names
  // Renames update all grants referencing this group

deleteGroup(name)
  // Cannot delete reserved Authelia groups
  // Auto-revokes all grants referencing this group
  // Returns { deletedGrants: number } for audit

addMembers(groupName, usernames)
  // Idempotent — already-present members silently skipped
  // Validates usernames exist in Authelia users.yml

removeMembers(groupName, usernames)
  // Idempotent — already-absent members silently skipped

getGroupsForUser(username)
  // → [groupName, ...] — scans all groups for membership
```

### Grants

```js
import { createGrant, listGrants, getGrant, revokeGrant } from '@lamalibre/lamaste-gatekeeper';

createGrant({ principalType, principalId, resourceType, resourceId, context? })
  // → grant object
  // Validates principal exists (user in Authelia or group in groups.json)
  // Validates no duplicate grant (same principal + resource + context)
  // Tunnel/agent-side plugin grants: auto-consumed (used: true)
  // Local plugin grants: created unused (used: false, consumed on enrollment)

listGrants(filter?)
  // filter: { principalType?, principalId?, resourceType?, resourceId?, used? }
  // → [grant, ...]
  // No filter = all grants

getGrant(grantId)
  // → grant or null

revokeGrant(grantId)
  // Removes the grant
  // Local plugin grants: only revocable if used === false
  // All others: always revocable
  // Returns revoked grant for audit
```

### Authorization

```js
import { checkAccess } from '@lamalibre/lamaste-gatekeeper';

checkAccess(username, resourceType, resourceId)
  // 1. Find direct user grants: principalType='user', principalId=username
  // 2. Find user's Lamaste groups via getGroupsForUser(username)
  // 3. Find group grants: principalType='group', principalId in user's groups
  // 4. Any match → { allowed: true }
  // 5. No match → { allowed: false, resource: { type, id }, templates: [...] }

  // Templates include pre-filled messages with username and resource name
```

### Templates

```js
import { getAccessRequestTemplates } from '@lamalibre/lamaste-gatekeeper';

getAccessRequestTemplates(username, resourceName, { adminContact?, domain? })
  // → {
  //     email: { subject, body },
  //     slack: string,
  //     teams: string,
  //     whatsapp: string,
  //     generic: string
  //   }
```

---

## Performance: Caching Architecture

### Current State (Authelia Only)

Today, **every single request** to a tunneled service triggers a localhost HTTP roundtrip from nginx to Authelia (`127.0.0.1:9091/api/authz/forward-auth`). For a page load with 1000 requests (HTML, CSS, JS, images, fonts, API calls), that's **1000 Authelia calls**. No caching exists.

Authelia handles this because it's a lightweight Go binary with in-memory session lookup (~1-2ms per call), but it's still 1000 localhost HTTP roundtrips per page load.

### With Gatekeeper: Two-Layer Caching

Adding gatekeeper as the auth_request target doesn't increase overhead — it **reduces** it by introducing caching that benefits all tunnel types.

#### Layer 1 — nginx `proxy_cache` (eliminates most gatekeeper calls)

```nginx
proxy_cache_path /var/cache/nginx/authz levels=1:2
    keys_zone=authz_cache:1m max_size=10m inactive=5m;

location /internal/lamaste/authz {
    internal;
    proxy_pass http://127.0.0.1:9294/authz/check;
    proxy_cache authz_cache;
    proxy_cache_key "$cookie_authelia_session$http_host";
    proxy_cache_valid 200 30s;   # cache successful auth for 30s
    proxy_cache_valid 403 10s;   # cache denial for 10s (shorter — revocations take effect faster)
    # Never cache 401 — user needs fresh login redirect
}
```

Cache key is `session_cookie + hostname`:
- Same user, same tunnel = cached (correct)
- Different users = separate cache entries (correct)
- Different tunnels = separate cache entries (correct)

1000 requests on page load → **1 hits gatekeeper, 999 served from nginx cache**.

#### Layer 2 — Gatekeeper in-memory session cache (eliminates most Authelia calls)

```js
// In-memory LRU cache, keyed by Authelia session cookie hash
const sessionCache = new Map();  // cookie_hash → { username, groups, expiresAt }

async function validateAuthelia(cookie) {
  const key = hash(cookie);
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;

  // Only hits Authelia on cache miss
  const result = await forwardToAuthelia(cookie);
  sessionCache.set(key, { ...result, expiresAt: Date.now() + 30_000 });
  return result;
}
```

Even without nginx cache (e.g., after a deploy), gatekeeper handles 1000 requests with:
- **1 Authelia HTTP call** (first request, then cached 30s)
- **1000 in-memory grant lookups** (microseconds each — small array scan)

#### Performance Comparison

| Scenario | Authelia calls | Gatekeeper calls | Added latency per request |
|----------|---------------|-------------------|--------------------------|
| **Current (no gatekeeper)** | **1000** | N/A | ~1-2ms each |
| nginx cache warm | 0 | 0 | ~0.1ms (nginx cache lookup) |
| nginx cache cold, gatekeeper cache warm | 0 | 1 | ~1ms (localhost HTTP + memory lookup) |
| Both cold (first request of session) | 1 | 1 | ~5-10ms (one-time) |

**Net result:** Gatekeeper with caching turns 1000 Authelia calls into 1 (or 0 with warm cache). This is a performance improvement over the current setup, not a regression.

#### Universal Caching Benefit

The nginx `proxy_cache` layer applies to **all access modes**, not just restricted tunnels:
- `authenticated` tunnels: gatekeeper validates Authelia cookie, returns 200. Cached 30s.
- `restricted` tunnels: gatekeeper validates cookie + checks grants. Cached 30s.

Both modes benefit equally from caching. Current Authelia-only tunnels that migrate to `authenticated` mode get free caching they didn't have before.

#### Grant Revocation Latency

The tradeoff: a revoked grant takes up to 30 seconds to take effect (nginx cache TTL). This is acceptable for the use case (admin revokes access, user loses access within 30s). For immediate revocation, gatekeeper exposes `POST /api/cache/bust` — lamalibre-lamaste-serverd calls this after revoking a grant, which increments an internal version counter causing all cached responses to miss.

#### Memory Footprint

- Gatekeeper session cache: ~200 bytes per entry, 1000 concurrent users = ~200KB
- Grants/groups in memory: loaded via file watch, typically < 100KB
- nginx cache zone: 1MB key zone + 10MB data store
- **Total overhead: < 12MB** — trivial on the 512MB droplet (~245MB used by existing stack)

---

## Gatekeeper Service

### Overview

Lightweight Fastify server on `127.0.0.1:9294`. Three responsibilities:

1. **nginx auth_request target** — validate access for all tunnel types (authentication via Authelia + authorization via grants)
2. **Access request page** — user-friendly denial page with message templates
3. **Management REST API** — group and grant CRUD for CLI and desktop consumers

### nginx Integration

For all non-mTLS tunnel types, nginx uses gatekeeper as the auth_request target. Gatekeeper handles both authentication (by forwarding to Authelia) and authorization (by checking grants):

```nginx
# Restricted tunnel vhost — e.g., gitlab.example.com
server {
    listen 443 ssl;
    server_name gitlab.example.com;

    # TLS (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/gitlab.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gitlab.example.com/privkey.pem;

    # Gatekeeper auth (handles both authentication via Authelia + authorization via grants)
    location /internal/lamaste/authz {
        internal;
        proxy_pass http://127.0.0.1:9294/authz/check;
        proxy_set_header X-Original-URL $scheme://$http_host$request_uri;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Host $http_host;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        # Forward cookies so gatekeeper can validate Authelia session
        proxy_set_header Cookie $http_cookie;
    }

    location / {
        auth_request /internal/lamaste/authz;
        auth_request_set $remote_user $upstream_http_remote_user;
        auth_request_set $remote_groups $upstream_http_remote_groups;
        auth_request_set $remote_name $upstream_http_remote_name;
        auth_request_set $remote_email $upstream_http_remote_email;

        # Authentication failure → Authelia login
        error_page 401 =302 https://auth.example.com/?rd=$scheme://$http_host$request_uri;

        # Authorization failure → access request page
        error_page 403 =302 https://auth.example.com/access-request?tunnel=$http_host;

        # Set headers for backend
        proxy_set_header Remote-User $remote_user;
        proxy_set_header Remote-Groups $remote_groups;
        proxy_set_header Remote-Name $remote_name;
        proxy_set_header Remote-Email $remote_email;

        # Proxy to tunnel backend
        proxy_pass http://127.0.0.1:PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Authz Check Endpoint

`GET /authz/check`

1. Read `Cookie` and `X-Original-URL` headers from nginx
2. Forward cookie to Authelia's verification endpoint (`http://127.0.0.1:9091/api/authz/forward-auth`)
3. If Authelia returns 401 → return 401 (not authenticated)
4. If Authelia returns 200 → extract `Remote-User`, `Remote-Groups`, `Remote-Name`, `Remote-Email` from Authelia response headers
5. Parse hostname from `X-Original-URL` → look up tunnel
6. Check tunnel's `accessMode`:
   - `public` → return 200 (should not reach here, but safe fallback)
   - `authenticated` → return 200 (Authelia passed = sufficient)
   - `restricted` → call `checkAccess(username, 'tunnel', tunnelId)`
     - Allowed → return 200 + forward Authelia headers
     - Denied → return 403
7. Response headers on 200: `Remote-User`, `Remote-Groups`, `Remote-Name`, `Remote-Email` (passed through from Authelia)

### Access Request Page

`GET /access-request?tunnel=gitlab.example.com`

Serves an HTML page (server-rendered, no SPA dependency):

- User's Authelia cookie is valid (they passed authentication)
- Gatekeeper calls Authelia verify to get username
- Page shows:
  - "You don't have access to **gitlab.example.com**"
  - "Contact your administrator to request access"
  - Admin contact info (from `/etc/lamalibre/lamaste/panel.json` or gatekeeper config)
  - Pre-filled message templates with copy buttons:

```
Email:
  Subject: Access request for gitlab.example.com
  Body: Hi, I'd like to request access to gitlab.example.com.
        My username is alice. Thank you.

Slack / Teams:
  Hi, could I get access to gitlab.example.com? My username is alice.

WhatsApp:
  Hi, I need access to gitlab.example.com (username: alice). Thanks!
```

- Styled with Lamaste's dark terminal aesthetic (inline CSS, no external deps)
- Copy button per template (vanilla JS, no framework)

### Service REST API

For CLI and desktop consumption (binds 127.0.0.1 only):

**Groups:**
- `POST /api/groups` — create group
- `GET /api/groups` — list groups
- `GET /api/groups/:name` — get group with members
- `PATCH /api/groups/:name` — update group (rename, description)
- `DELETE /api/groups/:name` — delete group + auto-revoke grants
- `POST /api/groups/:name/members` — add members
- `DELETE /api/groups/:name/members/:username` — remove member

**Grants:**
- `POST /api/grants` — create grant
- `GET /api/grants` — list grants (query params for filtering)
- `GET /api/grants/:grantId` — get grant
- `DELETE /api/grants/:grantId` — revoke grant

**Diagnostic:**
- `GET /api/access/check?username=alice&resourceType=tunnel&resourceId=xxx` — test access

### File Watching

Gatekeeper watches its state files for changes (using `fs.watch` with debounce):

- `/etc/lamalibre/lamaste/groups.json` — group membership changes
- `/etc/lamalibre/lamaste/access-grants.json` — grant changes
- `/etc/lamalibre/lamaste/tunnels.json` — tunnel access mode changes

On change: reload into memory. No restart needed. Panel-server writes, gatekeeper reads.

### systemd Unit

```ini
[Unit]
Description=Lamaste Gatekeeper — tunnel authorization service
After=network.target authelia.service

[Service]
ExecStart=/usr/bin/node /usr/lib/lamaste/gatekeeper/server/index.js
Restart=always
User=lamaste
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

---

## Tunnel Access Model

### Access Modes

Tunnel creation form offers four access levels:

| Mode | Authelia | Gatekeeper | nginx Template |
|------|----------|------------|----------------|
| `admin` | N/A | N/A | mTLS only (existing panel vhost pattern) |
| `public` | No auth | No auth | Direct proxy, no auth_request |
| `authenticated` | Yes | Pass-through | auth_request to gatekeeper, always 200 after Authelia |
| `restricted` | Yes | Grant check | auth_request to gatekeeper, 200 or 403 based on grants |

### Tunnel Schema Changes

```js
{
  // Existing fields...
  id, subdomain, port, type, description, fqdn, enabled, createdAt,
  pluginName, agentLabel, pluginRoute,

  // New field
  accessMode: 'public' | 'authenticated' | 'restricted'
  // Default: 'restricted' for new tunnels
}
```

### nginx Vhost Variants

Panel-server's `nginx.js` gains new vhost template functions:

- `writePublicVhost(subdomain, domain, port, certPath)` — no auth_request, direct proxy
- `writeAuthenticatedVhost(subdomain, domain, port, certPath)` — auth_request to gatekeeper, Authelia headers forwarded
- `writeRestrictedVhost(subdomain, domain, port, certPath)` — auth_request to gatekeeper, Authelia headers forwarded, 403 → access-request redirect

Existing `writeAppVhost()` becomes `writeAuthenticatedVhost()` (backwards compatible).
Existing `writeAgentPanelVhost()` unchanged (mTLS, no gatekeeper involvement).

### Default Behavior & Migration

- **New tunnels:** default to `restricted` (admin must explicitly grant access)
- **Existing app tunnels:** migrated to `authenticated` (preserves current behavior — all Authelia users can access)
- **Existing plugin tunnels:** continue using grant system (migrated to new grant model)

---

## Admin UI Changes

### New "Groups" Page (lamaste-server-ui)

Sidebar entry under a new "Access" section.

**List view:**
- Table: name, description, member count, created date
- Create button → modal with name + description
- Row actions: edit, delete (with confirmation showing affected grant count)

**Detail view (click group name):**
- Group info (name, description, created by, created at)
- Members table with remove button
- "Add Members" button → modal with Authelia user dropdown (multi-select)

### Updated "Users" Page

- User creation: Authelia group as radio buttons (Admin / Internal / External)
  - Admin checked → Internal and External disabled
  - Internal checked → External disabled
  - External is default
- User invitation: same radio button pattern
- User list: show Authelia group badge (admin/internal/external)

### Updated Tunnel Creation Form

```
Subdomain: [____________]
Port:      [____]
Type:      [App ▼]  (app | panel | plugin)

Access:    (o) Restricted — specific users and groups
           ( ) All Authelia Users
           ( ) Public — no authentication

           [When "Restricted" selected:]
           Users:  [alice] [x]  [bob] [x]  [+ Add]
           Groups: [developers] [x]  [+ Add]
```

- Default selection: Restricted
- Adding users/groups creates grants via gatekeeper API
- Removing users/groups revokes grants
- Changing access mode updates tunnel and rewrites nginx vhost

### Updated Tunnel List

- Access mode badge on each tunnel card (Public / Authenticated / Restricted)
- For restricted tunnels: show granted user/group count
- Click to expand: list of granted users and groups with revoke buttons

### Grant Management (integrated, not standalone page)

Grants are managed in context:
- On tunnel detail: manage who can access this tunnel
- On group detail: see which resources this group can access
- On user access page: see which resources this user can access

No separate "Grants" page needed — grants are always viewed in the context of their principal or resource.

---

## CLI Commands

```bash
# Group management
lamalibre-lamaste-gatekeeper group create <name> [--description "..."]
lamalibre-lamaste-gatekeeper group list
lamalibre-lamaste-gatekeeper group show <name>
lamalibre-lamaste-gatekeeper group rename <name> <new-name>
lamalibre-lamaste-gatekeeper group delete <name> [--force]  # --force skips confirmation
lamalibre-lamaste-gatekeeper group add-member <group> <username> [<username>...]
lamalibre-lamaste-gatekeeper group remove-member <group> <username> [<username>...]

# Grant management
lamalibre-lamaste-gatekeeper grant create --user <username> --tunnel <tunnelId>
lamalibre-lamaste-gatekeeper grant create --group <groupname> --tunnel <tunnelId>
lamalibre-lamaste-gatekeeper grant create --user <username> --plugin <pluginName> --target agent:<label>
lamalibre-lamaste-gatekeeper grant list [--user <username>] [--group <groupname>] [--tunnel <tunnelId>]
lamalibre-lamaste-gatekeeper grant show <grantId>
lamalibre-lamaste-gatekeeper grant revoke <grantId>

# Diagnostic
lamalibre-lamaste-gatekeeper access check <username> tunnel <tunnelId>
lamalibre-lamaste-gatekeeper access check <username> plugin <pluginName>
```

---

## Desktop Integration

### Gatekeeper Menu (Sidebar Section)

A new top-level "Gatekeeper" section in the desktop app sidebar (visible when connected to a server). Provides full access to all gatekeeper functionality — groups, grants, access diagnostics, and configuration.

**Sidebar structure:**

```
Gatekeeper
  ├─ Dashboard        # Overview: group count, grant count, recent activity
  ├─ Groups           # Full group CRUD + member management
  ├─ Grants           # Grant list, create, revoke (filterable by resource/principal)
  ├─ Access Requests  # Pending access request log (if request logging enabled)
  └─ Settings         # Gatekeeper configuration (admin contact, templates, cache TTL)
```

### Dashboard Page

At-a-glance overview of the access control system:

- **Stats cards:** total groups, total grants, total users with grants, active tunnels with restricted access
- **Recent activity:** last 10 grant creates/revokes with timestamps
- **Quick actions:** "Create Group", "Grant Access" buttons

### Groups Page

Full CRUD for Lamaste access control groups.

**List view:**
- Table: name, description, member count, grant count (how many resources this group can access), created date
- Search/filter bar
- "Create Group" button → modal with name + description fields
- Row actions: edit (rename, description), manage members, delete (with confirmation showing affected grant count)

**Member management (inline expand or detail view):**
- Current members list with remove button per member
- "Add Members" button → dropdown of Authelia users (fetched from lamalibre-lamaste-serverd `/api/users`) with multi-select
- Shows which Authelia role tier each user belongs to (admin/internal/external badge)

### Grants Page

Unified view of all grants across all resource types.

**List view:**
- Table: principal (user/group badge + name), resource (tunnel/plugin badge + name), context, status, created date
- Filter bar: by principal type, principal name, resource type, resource name
- "Create Grant" button → modal:
  - Principal: radio (User / Group) + dropdown
  - Resource: radio (Tunnel / Plugin) + dropdown (tunnels list / plugin list)
  - Context: shown conditionally (target field for plugin grants)
- Row actions: revoke (with confirmation)

**Contextual views (also accessible from tunnel/group detail pages):**
- "Grants for this tunnel" — filtered grant list shown on tunnel detail
- "Grants for this group" — filtered grant list shown on group detail

### Access Requests Page

Log of denied access attempts (if enabled in settings):

- Table: timestamp, username, requested resource (tunnel FQDN), status (pending/noted)
- Helps admins see who is trying to access what and proactively grant access
- Optional: gatekeeper logs denied attempts to `/etc/lamalibre/lamaste/access-request-log.json` (configurable, off by default, auto-rotated)

### Settings Page

Gatekeeper configuration managed via the desktop app:

**Admin Contact Info** (used in access-request page templates):
- Admin email address
- Admin display name
- Optional: Slack channel, Teams channel
- Saved to `/etc/lamalibre/lamaste/gatekeeper.json`

**Message Templates:**
- Preview and customize the access-request message templates
- Per-channel toggle (email, Slack, Teams, WhatsApp)
- Template variables: `{{username}}`, `{{resource}}`, `{{adminName}}`, `{{adminEmail}}`

**Cache Configuration:**
- nginx cache TTL display (informational — actual value in nginx config)
- Gatekeeper session cache TTL (configurable, default 30s)
- "Bust Cache" button — immediately invalidates all cached auth decisions

**Access Request Logging:**
- Toggle on/off
- Retention period (default 30 days)
- "Clear Log" button

### Tauri Commands

```rust
// Groups
get_gatekeeper_groups(server_id) → Vec<Group>
create_gatekeeper_group(server_id, name, description) → Group
update_gatekeeper_group(server_id, name, updates) → Group
delete_gatekeeper_group(server_id, name) → DeleteResult { deleted_grants: u32 }
add_gatekeeper_group_members(server_id, group_name, usernames) → Group
remove_gatekeeper_group_members(server_id, group_name, usernames) → Group
get_gatekeeper_groups_for_user(server_id, username) → Vec<String>

// Grants
get_gatekeeper_grants(server_id, filter?) → Vec<Grant>
create_gatekeeper_grant(server_id, principal_type, principal_id, resource_type, resource_id, context?) → Grant
get_gatekeeper_grant(server_id, grant_id) → Grant
revoke_gatekeeper_grant(server_id, grant_id) → Grant

// Authorization diagnostic
check_gatekeeper_access(server_id, username, resource_type, resource_id) → AccessResult

// Settings
get_gatekeeper_settings(server_id) → GatekeeperSettings
update_gatekeeper_settings(server_id, settings) → GatekeeperSettings

// Cache
bust_gatekeeper_cache(server_id) → ()

// Access request log
get_access_request_log(server_id, limit?, offset?) → Vec<AccessRequestEntry>
clear_access_request_log(server_id) → ()
```

**Communication:** Desktop calls gatekeeper's REST API via lamalibre-lamaste-serverd's SSH tunnel (for remote servers) or directly on `127.0.0.1:9294` (for local server installs). Uses `curl_panel`-style HTTP helper in `gatekeeper.rs` — same pattern as existing Tauri → lamalibre-lamaste-serverd communication but targeting gatekeeper's port.

### React Pages (lamaste-server-ui)

Gatekeeper pages are implemented in `lamaste-server-ui` as shared components, following the same pattern as other admin pages:

```
packages/lamaste-server-ui/src/pages/
  GatekeeperDashboard.jsx
  GatekeeperGroups.jsx
  GatekeeperGrants.jsx
  GatekeeperAccessRequests.jsx
  GatekeeperSettings.jsx
```

These use `useAdminClient()` context hook — desktop provides Tauri invoke implementation, web panel provides `apiFetch()` implementation. `AdminClientContext` interface extended with all gatekeeper methods.

---

## Migration

### State File Migration

On first startup, gatekeeper checks for legacy files:

1. **`/etc/lamalibre/lamaste/user-plugin-access.json`** → migrate to `/etc/lamalibre/lamaste/access-grants.json`
   - Each legacy grant maps to new schema:
     - `username` → `principalType: 'user'`, `principalId: username`
     - `pluginName` → `resourceType: 'plugin'`, `resourceId: pluginName`
     - `target` → `context: { target }`
   - Legacy file renamed to `user-plugin-access.json.migrated` (backup)

2. **Groups extracted from Authelia `users.yml`** → NOT migrated (Lamaste groups are a new concept, start empty)

### Panel-Server Refactoring

- `lib/user-access.js` → delegates to gatekeeper library (import from `@lamalibre/lamaste-gatekeeper`)
- `lib/access-control-sync.js` → removed (gatekeeper handles authorization at nginx layer, no more Authelia config rewriting for per-user access rules)
- `routes/user-access.js` → simplified, delegates grant CRUD to gatekeeper
- Tunnel creation/update routes → call gatekeeper for access mode changes

### Installer Updates (create-lamaste)

- Install `@lamalibre/lamaste-gatekeeper` package
- Create `/etc/lamalibre/lamaste/groups.json` (empty initial state)
- Create `/etc/lamalibre/lamaste/access-grants.json` (empty or migrated)
- Create `lamalibre-lamaste-gatekeeper.service` systemd unit
- Enable and start service
- Update nginx templates for new vhost variants

---

## Security

### Boundaries

| Component | Binds to | Auth | Purpose |
|-----------|----------|------|---------|
| Gatekeeper service | `127.0.0.1:9294` | None (localhost trust) | nginx auth_request + REST API |
| Panel-server | `127.0.0.1:9292` | mTLS | Admin operations |
| Authelia | `127.0.0.1:9091` | Session cookie | User authentication |

### Attack Surface Analysis

- **Gatekeeper is not externally reachable** — binds `127.0.0.1`, nginx is the sole caller
- **No credential storage** — reads Authelia session via cookie forwarding to Authelia's own verify endpoint
- **No mTLS certs** — completely separate from the admin/agent certificate system
- **State files** — `0600` permissions, atomic writes (temp → fsync → rename)
- **DoS protection** — hard caps on groups (200), grants (1000), matching ticket system limits
- **Group name validation** — lowercase alphanumeric + hyphens, reserved names rejected
- **Grant uniqueness** — duplicate principal+resource+context rejected
- **Timing-safe checks** — not needed here (no secret comparison, just membership lookup)

### What Gatekeeper Cannot Do

- Access lamalibre-lamaste-serverd API
- Read/write mTLS certificates
- Modify Authelia `users.yml`
- Restart any service
- Access any state file outside its own scope (`groups.json`, `access-grants.json`, `tunnels.json` read-only)

---

## Relationship to lamaste-tickets

Gatekeeper and tickets are separate packages that coexist. They solve different authorization problems:

| | **Tickets** | **Gatekeeper** |
|--|------------|---------------|
| **Who** | Agent (mTLS cert CN) | Human (Authelia username) |
| **Authorizes** | Agent-to-agent communication | User-to-resource access |
| **Identity** | mTLS certificate | Authelia session cookie |
| **Mechanism** | Issue token → validate → session with heartbeats | Check grant → allow/deny (stateless) |
| **Lifecycle** | Ephemeral (30s tokens, heartbeat sessions) | Persistent (grants live until revoked) |
| **Concepts** | Scopes, instances, transport negotiation | Groups, access modes, request templates |
| **nginx** | Not involved | auth_request target |

They share infrastructure patterns (atomic JSON writes, promise-chain mutex) but their domain logic is fundamentally different. Unifying them would create confused abstractions — every function would need to ask "am I in machine mode or human mode?"

- **Tickets** = machine-to-machine authorization protocol
- **Gatekeeper** = human-to-resource access control

---

## Affected Packages

| Package | Changes |
|---------|---------|
| **lamalibre-lamaste-gatekeeper** (NEW) | Full package — library, service, CLI |
| **lamalibre-lamaste-serverd** | Refactor user-access to delegate to gatekeeper lib, remove access-control-sync, new nginx vhost templates, tunnel schema gains accessMode |
| **lamaste-server-ui** | New Gatekeeper sidebar section (Dashboard, Groups, Grants, Access Requests, Settings), updated Users page (role radio buttons), updated tunnel creation form (access mode + user/group picker), tunnel list access badges |
| **create-lamaste** | Install gatekeeper package + service, state file creation, nginx template updates, nginx proxy_cache zone |
| **lamaste-agent** | Minimal — agent reports tunnel access mode in status |
| **lamaste-desktop** | New Gatekeeper sidebar section with full management UI, Tauri commands in `gatekeeper.rs`, React pages from admin-panel |
| **tests/e2e** | Group CRUD, grant CRUD, tunnel access modes, access-request page, caching behavior, migration |
| **tests/e2e-three-vm** | Multi-agent restricted tunnel access, group-based access across agents |

---

## Resolved Decisions

1. **Access request page hosting**: **Inline on the tunnel's own FQDN.** Gatekeeper returns the full HTML page as the 403 response body — no redirect. nginx uses `error_page 403 = /internal/lamaste/authz` pattern where gatekeeper serves the "request access" page directly. The user stays on `gitlab.example.com` (the URL they tried to visit), which is the most natural UX. No extra subdomain, no extra DNS record, no extra TLS cert.

2. **Grant auto-cleanup**: **90-day lazy cleanup for consumed grants**, consistent with the existing pattern. Configurable retention period via gatekeeper settings. Grants are small (JSON entries), but auto-cleanup prevents unbounded accumulation over years of operation.

3. **Plugin tunnel migration**: **Hard cut-over.** Installer upgrade replaces all plugin tunnel vhosts with gatekeeper-based ones, migrates grants from `user-plugin-access.json` to `access-grants.json`, and removes the Authelia access control rules that `syncAllAccessControl()` previously wrote. Running two authorization systems in parallel would be more complex and error-prone than switching cleanly. The installer already handles nginx vhost rewrites during upgrades.
