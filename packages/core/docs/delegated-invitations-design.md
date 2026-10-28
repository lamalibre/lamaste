# Delegated Invitations — Design Document

> **Status:** decisions agreed 2026-10-28 (D1, D3–D8, D10 put to the founders, each as recommended; D2 and D9 technical, taken as recommended); independent review pending.
> **Target:** Lamaste 4.9.0, on top of 4.8.0 (multi-domain relay, external members, per-domain branding).
> **Pilot:** corral (`corral.codelama.com.tr`): the client's coordinator invites colleagues into corral, as external members of `codelama.com.tr`, with a corral role, without the relay admin.
> **Companions:** `herd/docs/r730-workload-plan.md` §15.2 (scope), §15.2a, §15.4, §15.5;
> `external-members-design.md` (a delegated invitation creates only `external` memberships);
> `identity-directory-design.md`, `gatekeeper-design.md`, `multi-domain-relay-design.md`,
> `auth-branding-design.md` (the invitation page per domain brand);
> `plugin-development/design/agent-hosted-app-plugins.md` (slices 6 and 7).

## Goal

A person who holds an **inviting role** of an agent-hosted app plugin invites
a colleague into that plugin from the plugin's own pages. The invitation:

- grants exactly one of that plugin's roles — one the manifest lets the
  inviter's role grant — plus what the plugin's site needs: the grant on the
  plugin's own `restricted` web surface and an `external` membership of the
  plugin's domain;
- never grants an Authelia group, admin, another plugin, another domain, a
  Lamaste (Gatekeeper) group, a tunnel or a static site;
- is bounded: e-mail domains the administrator allows for that installation,
  an expiry, one use, a cap on open invitations per inviter;
- is a link the inviter sends through their own mail (Lamaste sends none);
- is audited and listed in the panel with its inviter; the administrator
  revokes any invitation or user, the inviter their own pending ones;
- reaches the plugin as an ordinary audience change (the identity feed),
  so the agent half learns of the new member as of any other.

The administrator's own invitations (`POST /api/invitations`) stay as they
are, and stay the way to invite anyone into anything else.

## What exists in 4.8

| Piece             | 4.8                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitations       | Admin-only `POST /api/invitations` (mTLS): username, e-mail, Authelia groups, `domains: [{ name, kind }]`, expiry 1–30 days (default 7). Stored in `<stateDir>/invitations.json` (atomic, one mutex) **with the token in clear**; a 64-hex token, looked up by a constant-time scan. `GET /api/invitations` lists them (tokens redacted), `DELETE /api/invitations/:id` deletes.                                        |
| Acceptance        | Public `GET /api/invite/:token` (username, e-mail, expiry), `POST /api/invite/:token/accept { password }` → `changeUsers` creates the user (bcrypt), the directory gives them an id, the memberships are inserted and the domains rendered; TOTP secret generated; the invitation is marked used afterwards, by a second read. Two acceptances of one token race until `changeUsers` refuses the second username (409). |
| Invitation page   | `auth.<domain>/invite/<token>` — core `renderInvitePage(brand \| null)` (4.8), the stock page or the domain's branded one; it shows the username the admin chose and asks for a password.                                                                                                                                                                                                                               |
| Roles             | Manifest `identity.roles` (`{ id, label, description? }`, 1–32); the admin gives a role as a Gatekeeper `plugin` grant with `context.roles` (`lib/entitlements.js` `setEntitlement`, one role grant per principal). In the approval digest when declared; adding or removing a role is `identity.changed`, never auto-approved.                                                                                         |
| Audience and feed | entitled ∩ (members ∪ external members) of the plugin's domain (`lib/audience.js`); pushed to the agent half (`/admin/identity/*`, protocol 1).                                                                                                                                                                                                                                                                         |
| User surface      | `/api/<route>/app[/*]` on the host serving the plugin: nginx `auth_request` → Gatekeeper `/authz/user-surface/<fqdn>` (session, domain, external-member rule, the host's grant when `restricted`) → a relay assertion `aud: '@panel'` bound to method and raw target → the panel's `userSurfacePlugin` (Sec-Fetch-Site, Origin, `resolveUserCaller`) → the agent half's `/app/*` with a signed `user` caller.           |
| Web surface       | A plugin-owned site (`SiteEntry.owner.plugin`, `accessMode authenticated\|restricted`) serves the shell and the user-surface locations; `restricted` checks the Gatekeeper `site` grant (and the audience).                                                                                                                                                                                                             |
| External members  | `domain_members.kind = 'external'`: reach only what names them; hold no Authelia group; changes apply without restarting Authelia.                                                                                                                                                                                                                                                                                      |

So every piece an invitation must set exists: a user, an external membership,
a role grant, a site grant. What is missing is **who may ask for it**, the
bounds, and a path for a non-admin to ask.

## Design

### 1. The manifest: inviting roles

A role may name the roles a holder of it may give by invitation:

```json
"identity": {
  "roles": [
    { "id": "founder", "label": "Founder" },
    { "id": "coordinator", "label": "Coordinator", "invites": ["stakeholder"] },
    { "id": "stakeholder", "label": "Stakeholder" }
  ]
}
```

- `invites`: 1–32 role ids **of the same block**, no repeats (an unknown id is
  a manifest error). A role may name itself (a coordinator inviting another
  coordinator) — the manifest says so explicitly and the approval shows it.
- A role without `invites` invites nobody. A plugin with no role carrying
  `invites` has no delegated invitations.
- **Approval** (D2). `normalizeIdentityBlock` emits `invites` (sorted) only on
  a role that declares it, so every 4.8 digest is unchanged (pinned vectors).
  The digest covers it; `identityDiff` gains `invitesAdded: [{ role, roles }]`
  and `invitesRemoved`; an update that adds an inviting role or lets a role
  invite into one more role is `identity.changed` — never auto-approved — and
  the approval preview reads "Coordinator may invite: Stakeholder". Narrowing
  only changes the digest (as narrowing attributes does).

### 2. The installation's policy (the administrator's)

Approving the manifest says what the plugin may ask for; it does not turn
invitations on. The administrator sets a **policy per installation**
(state.db `plugin_invitation_policies`, one row per plugin name):

| Field               | Rule                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`           | default false — off until the administrator turns it on (D3).                                                                                                           |
| `emailDomains`      | 1–20 domain names (`assertDomainName`, ASCII/punycode, lower case); an invitee's address must end in `@<one of them>` exactly (no subdomains). Required to enable (D4). |
| `maxOpenPerInviter` | 1–100, default 10 (D5): pending invitations one inviter may hold on this plugin.                                                                                        |
| `lifetimeDays`      | 1–30, default 7 (D6): every delegated invitation of the plugin expires that long after it is made.                                                                      |

Enabling is refused (409, with the reason) unless the installed, approved
version declares an inviting role, the plugin has a **web surface** (its own
site) whose access mode is `restricted`, and the plugin's identity is
approved. A plugin whose user surface is only a bound tunnel cannot invite:
a tunnel grant would open the tunnel's own application to the invitee, which
the scope forbids ("an invitee reaches only that plugin's site"). An
`authenticated` web surface refuses external members (external-members
decision 9), so it would admit no invitee.

Fixed relay-wide bounds (constants, not settings): at most 200 pending
delegated invitations per plugin, 30 invitations made per inviter per hour.

Audited `invitation.policy.updated` (the fields, never an address). Turning
the policy off, or the plugin's uninstall, revokes its pending invitations
(`policy_disabled`, `plugin_removed`).

### 3. What an invitation grants — fixed by Lamaste, never by the request

An inviter names only **an e-mail address, a display name (optional) and one
role**. Everything else follows from the plugin:

| Granted on acceptance | Value                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| a new user            | the username the invitee picks (D7), the inviter's display name for them (editable), their password, a TOTP secret |
| a membership          | `{ name: <the plugin's domain>, kind: 'external' }` — always external                                              |
| the role              | a Gatekeeper `plugin` grant, `resourceId` = route, `context.roles` = `[role]` (`setEntitlement`)                   |
| the site grant (D8)   | a Gatekeeper `site` grant on the plugin's own web surface (`resourceId` = its site id)                             |
| Authelia groups       | none                                                                                                               |

The role must be one the inviter's roles may give: the union of `invites` of
the roles the inviter holds **now** (from the audience, as `resolveUserCaller`
reads it), restricted to the roles the installed version declares.

### 4. The store: invitations move to state.db

Delegated invitations need counts per inviter, per plugin, a claim on
acceptance and sweeps — and the clear token in `invitations.json` is a
secret at rest that need not exist. Both kinds move into `state.db`
(migration `0020_invitations.sql`, D9):

```sql
CREATE TABLE invitations (
  id               TEXT PRIMARY KEY,           -- UUID v4
  token_sha256     TEXT NOT NULL UNIQUE,       -- hex SHA-256 of the 32-byte token
  kind             TEXT NOT NULL CHECK (kind IN ('admin', 'delegated')),
  username         TEXT,                       -- admin: chosen; delegated: set on acceptance
  email            TEXT NOT NULL,
  display_name     TEXT,
  groups_json      TEXT NOT NULL DEFAULT '[]', -- admin only; '[]' for delegated (CHECK)
  domains_json     TEXT NOT NULL,              -- [{ name, kind }]
  plugin           TEXT,                       -- delegated: the plugin's name
  role             TEXT,                       -- delegated: the one role
  inviter_user_id  TEXT,                       -- delegated: the directory id
  created_by       TEXT NOT NULL,              -- 'admin' | 'user:<userId>'
  created_at       TEXT NOT NULL,
  expires_at       TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending', 'accepting', 'accepted', 'revoked')),
  status_at        TEXT NOT NULL,
  revoked_by       TEXT,                       -- 'admin' | 'user:<id>' | 'lamaste'
  revoked_reason   TEXT,                       -- below
  accepted_user_id TEXT,
  fulfilled_at     TEXT,                       -- delegated: every grant made
  CHECK (kind = 'admin' OR (plugin IS NOT NULL AND role IS NOT NULL AND inviter_user_id IS NOT NULL AND groups_json = '[]'))
);
CREATE INDEX invitations_open ON invitations (status, plugin, inviter_user_id);
CREATE TABLE plugin_invitation_policies (...);
```

- **Tokens.** 32 random bytes, hex in the link; only the SHA-256 is stored
  and a lookup is by that hash (no scan, no timing to measure). A token is
  shown once: in the answer that creates it.
- **Import.** The first start after the upgrade imports `invitations.json` in
  one transaction (tokens hashed, `used` → `accepted`, pending/expired kept
  as they were), then deletes the file. A pending admin invitation made
  before the update still accepts after it.
- **Expiry** is read, not swept: `pending` past `expires_at` is shown and
  refused as expired.
- **Retention.** Invitations that ended without acceptance (expired, revoked)
  are deleted 90 days after they ended (the identity tick, daily). Accepted
  ones stay until their user is erased (the record of who invited whom).
- **Erasure.** Erasing a removed user deletes the invitations accepted by them
  and the admin invitations naming their username made before they were
  removed (as 4.7); an inviter's erasure leaves their invitations naming the
  bare id.

### 5. The inviter's path: Lamaste's endpoint on the plugin's site

The plugin's pages call **Lamaste**, not their agent half: the agent half
never says who a user is, and a plugin must not be able to create accounts on
the relay. On the plugin's web surface host only, beside `/api/<route>/app`:

| Method   | Path                           | Answer                                                                                                                              |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/<route>/invitations`     | `{ policy: { grantableRoles: [{ id, label }], emailDomains, lifetimeDays, maxOpen, open }, invitations: [...] }` — the caller's own |
| `POST`   | `/api/<route>/invitations`     | `{ email, displayName?, role }` → 201 `{ invitation: {...}, inviteUrl }` — the link once                                            |
| `DELETE` | `/api/<route>/invitations/:id` | the caller's own pending invitation → `{ ok: true }`                                                                                |

An invitation as shown to its inviter: `{ id, email, displayName, role,
status, createdAt, expiresAt, acceptedAt }` — never the token, never the
username or id of who accepted (the plugin learns that from the feed).

The path is slice 6's, extended — one more location, the same gates:

1. **nginx.** The web-surface vhost (`renderWebSurfaceVhost`) gains
   `location = /api/<route>/invitations` and `location ^~
/api/<route>/invitations/` with the user-surface block (auth request,
   relay assertion, `proxy_pass` with no URI to the panel, the cleared
   headers). Same directives as `/api/<route>/app` — nothing new for
   `lamaste-priv`'s allow-list. Not rendered on a tunnel bound as a user
   surface.
2. **Gatekeeper** (`/authz/user-surface/<fqdn>`). The target may be the
   route's invitations path (core `isUserSurfaceInvitationsUrl`) only when the
   host is the route's **site**; then the same checks as `/app`: session,
   domain membership, the external-member rule, the `site` grant
   (restricted). The assertion's `target` is `{ route, path }` as today.
3. **The panel** (`userSurfacePlugin`'s context, a third route pair beside
   `/:route/app[/*]`; answered by the panel, forwarded nowhere): the same
   first steps — `Sec-Fetch-Site`, not a code fetch, the relay assertion bound
   to this route and raw target, `Origin` = the site's origin on `POST` and
   `DELETE`, `resolveUserCaller` (active, entitled, identity ready) — then:
   - the policy enabled, the web surface restricted and served
     (`403 invitations_disabled` otherwise — the reason stays in the panel's
     log);
   - `POST`: the body (zod, strict: `email` ≤ 254, valid, its domain in
     `emailDomains`; `displayName` ≤ 100, display text; `role` a declared
     role id) — `400` with the field; the role grantable by the caller now —
     `403 role_not_grantable`; the caller's open invitations below
     `maxOpenPerInviter` and the plugin's below 200 — `409 invitation_cap`;
     the hourly rate — `429`; then one transaction inserts it (the counts
     re-read inside it);
   - `DELETE`: only an invitation the caller made, still pending — `404`
     for anything else (another's is never told apart from none).
     Its own rate limit as the other user-surface routes; the user-surface
     response headers; logs metadata only (`user:<userId>`, plugin, outcome),
     never an address.

The link is `https://auth.<plugin's domain>/invite/<token>` — the domain's
sign-in portal, branded as 4.8 renders it.

Audited `invitation.created` (actor `user:<userId>`, plugin, details
`{ invitationId, role, emailDomain, expiresAt }` — the address's domain, never
the address).

### 6. Acceptance

`GET /api/invite/:token` tells the page what kind it is. For a delegated one:
`{ kind: 'delegated', email, displayName, plugin: <displayName>, role:
<label>, invitedBy: <inviter's display name or username>, expiresAt,
suggestedUsername }`; the page (one renderer, `renderInvitePage`, stock and
branded) then asks for a **username** (prefilled from the address's local
part when it is a valid username), the display name (prefilled) and a
password. `POST /api/invite/:token/accept` takes `{ username, displayName,
password }` for a delegated invitation (`{ password }` for an admin one, as
today).

In order, failing closed — `410` for any precondition that no longer holds,
with the reason only in the panel's log:

1. **Claim.** `UPDATE … SET status = 'accepting' WHERE token_sha256 = ? AND
status = 'pending' AND expires_at > now` — one row or `404`/`410`. This
   closes the two-acceptances race for both kinds. Every failure below puts
   it back to `pending`.
2. **Still allowed now** (delegated): the plugin installed, its identity
   approved and the role declared; the policy enabled and the address's
   domain still allowed; the web surface restricted, served, on the domain
   the invitation recorded; the inviter **active, and still able to grant
   the role** (D1); Gatekeeper reachable (`503`, before anything is created).
3. **The username** (delegated): the core rule; not held by any directory
   user, **removed or erased included** (`409 username_unavailable` — an
   invitee never reuses a removed person's username, so no principal
   cleanup ever runs on a stranger's request), nor by an OIDC identity.
4. **The user**, in `changeUsers` (`creates`, `domains: { <username>:
[{ name: <domain>, kind: 'external' }] }`, groups `[]`): users.yml, the
   directory id, the external membership, the rendering.
5. **The grants**: `setEntitlement` (the role, actor `invitation:<id>`), then
   the `site` grant, then a rendering (the host group of the site — external
   members are admitted by Authelia only on hosts that name them).
6. **Recorded**: `accepted`, `accepted_user_id`, `fulfilled_at`; TOTP;
   audited `invitation.accepted` (actor `invitation`, plugin, `{
invitationId, userId, inviterUserId, role }`); admins notified (D10).
   The answer's `loginUrl` is the plugin's site (`https://<site>/`), which
   sends them through their domain's sign-in.

**If step 5 fails** after the user exists (Gatekeeper went away between):
the invitation is `accepted` without `fulfilled_at`; the user exists, external,
reaching nothing. The identity tick completes it every minute while its
preconditions hold (the user active, the plugin, role and web surface as
in step 2 — the inviter's standing is not re-checked: it held at
acceptance); when they no longer hold it is recorded `revoked` /
`fulfilment_abandoned` and the admins are notified. The answer to the
invitee says the account is made and access follows shortly.

The plugin learns of the new member through the feed: the role grant puts
them in the audience (`upsert`, their role, the declared attributes).
Protocol 1 is unchanged; the feed does not say who invited them (D10).

### 7. Revocation and oversight

| Who              | May                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the inviter      | list and revoke their own pending invitations (user surface).                                                                                                            |
| an administrator | list every invitation (both kinds, with the inviter, the plugin and the role), revoke any pending one; disable or delete any user; revoke any entitlement or site grant. |
| Lamaste          | revoke pending invitations whose inviter can no longer make them (below), and every pending one of a plugin whose policy is turned off or which is uninstalled.          |

A revocation keeps the row (`revoked`, `revoked_by`, `revoked_reason`:
`inviter`, `admin`, `inviter_disabled`, `inviter_removed`,
`inviter_unentitled` — lost the role that could give it —, `policy_disabled`,
`plugin_removed`, `role_undeclared`, `fulfilment_abandoned`), audited
`invitation.revoked`. Admin `DELETE /api/invitations/:id` revokes a pending
one and deletes an ended one (as 4.8 deleted).

**The inviter disabled, removed or no longer able to grant (D1).** Their
pending invitations are revoked — checked at every acceptance (step 2) and
swept on every audience recomputation, so the listing says so too. The people
they already invited **keep their access**: they are users in their own
right, entitled by a grant Lamaste made; their access is the administrator's
to review, and the panel lists them by inviter. (Alternative in D1.)

Revoking an invitee's access is the administrator's (disable, delete, or the
plugin's People panel). The inviter cannot remove a person — only the plugin
can stop treating them as a member of its own data; Lamaste's grants are the
administrator's.

**Panel.** Users → Invitations: a kind column (admin / delegated), "invited
by" (the inviter's username and the plugin), the role, the status and its
reason, a filter by plugin and by inviter; Revoke. The plugin card gains an
**Invitations** section: the policy editor (shown only for a plugin that
declares an inviting role; enabling explains a refusal), the plugin's
invitations, and the people who joined by invitation, by inviter. A delegated
acceptance notifies admins.

### 8. The plugin's side (what corral adds)

1. The manifest: `invites` on the inviting role (corral's coordinator), an
   update approved by the administrator (`identity.changed`).
2. Its pages call `GET|POST /api/corral/invitations` and `DELETE
/api/corral/invitations/:id`, same-origin (the shell's own host, `Origin`
   sent by the browser), and show the link with a copy button and the
   inviter's own pending invitations. The agent half changes nothing; the new
   person arrives through the feed with their role.
3. The administrator: the policy (enable, the client's e-mail domain, the cap,
   the lifetime) on corral's card.

### 9. API, panel, desktop, CLI

- **Admin API** (mTLS, admin): `GET /api/invitations` gains `kind`,
  `plugin`, `role`, `inviter: { userId, username }`, `status` (`pending`,
  `expired`, `accepted`, `revoked`), `revokedReason`, `fulfilled`, and
  `?plugin=` / `?inviter=` filters; `DELETE /api/invitations/:id` as above;
  `GET|PUT /api/plugins/:name/invitation-policy`. `POST /api/invitations`
  unchanged (its stored form moves).
- **Public**: `GET /api/invite/:token` gains `kind` and the delegated fields;
  `POST /api/invite/:token/accept` takes `username`/`displayName` for a
  delegated invitation.
- **User surface**: §5.
- **Core**: `IdentityRoleSchema.invites`, normalization and diff;
  `InvitationPolicySchema`; `userSurfaceInvitationsPath`,
  `isUserSurfaceInvitationsUrl`; `hashInvitationToken`; `AdminClient`:
  `getInvitations(filter)` (shape), `getPluginInvitationPolicy`,
  `setPluginInvitationPolicy`; types.
- **Panel / desktop**: §7; web client, desktop client, `admin_*` Tauri
  commands.
- **CLI** `lamaste-server`: `invitations list [--plugin <n>] [--inviter <u>]`,
  `invitations revoke <id>`, `plugins invitations <name>` (policy and list),
  `plugins invitations <name> set [--enable|--disable] [--email-domains a,b]
[--max-open n] [--lifetime-days d]`.
- **Docs**: `04-api-reference/invitations.md` (new: both kinds),
  `agent-hosted-plugins.md` (Delegated invitations), `users.md` (link),
  `gatekeeper.md`, `03-architecture/nginx-configuration.md`,
  `01-concepts/security-model.md`, `plugin-development` (the manifest field).

### 10. Upgrade in place

1. Migration 0020; the import of `invitations.json` at first start (pending
   admin invitations keep working); the file deleted after the commit.
2. Every 4.8 approval digest unchanged (no plugin declares `invites` yet).
3. Web-surface vhosts are reconciled at start, so they gain the invitations
   location; no `lamaste-priv` change; Gatekeeper and the panel ship
   together (one release).
4. Nothing restarts Authelia (invitations write users.yml through
   `changeUsers`, as 4.7 made restart-free).

## Security notes

- **Who attests the inviter.** Gatekeeper attests the session's username to
  the panel (relay assertion bound to method and raw target); the panel reads
  the inviter's roles from its own audience. The plugin's agent half is not
  in the path and cannot invite, list or accept anything.
- **What can be granted is closed.** Lamaste fixes the membership kind, the
  domain, the site and the grant shapes; the request names one role, checked
  against the manifest the administrator approved and the inviter's roles
  now. No request field reaches groups, admin, other plugins or domains.
  External members hold no Authelia group (4.7), so a delegated invitee
  cannot reach `admins`' bypasses.
- **The link is a bearer secret.** Lamaste sends no mail and verifies no
  address: whoever opens the link first becomes the account. The e-mail
  allow-list bounds what an inviter may record, not who accepts; the inviter
  is accountable (audited, listed). The token is 256 bits, stored hashed,
  shown once, single use (claimed atomically), and expires.
- **CSRF and cross-host.** `POST`/`DELETE` need the site's `Origin`;
  `Sec-Fetch-Site` other than `same-origin`/`none` is refused; the
  endpoint exists only on the plugin's own site.
- **No enumeration by inviters.** Creating never says whether an address
  already has an account; `DELETE` of someone else's invitation is a 404.
  A link holder learns whether a chosen username is free (`409`), as with
  any sign-up; usernames are not secrets.
- **Abuse bounds.** Per-inviter cap and hourly rate, per-plugin cap, the
  user-surface rate limit, the global per-IP limit on the public accept.
- **Fail closed.** Every precondition is re-checked at acceptance; a
  partially fulfilled acceptance grants less, never more, and is completed
  or abandoned visibly.
- **Removed usernames are never re-used by an invitee**, so a stranger's
  acceptance cannot trigger a principal cleanup or inherit anything.
- **Personal data.** Addresses never in audit details or logs (the domain
  only); ended invitations deleted after 90 days; accepted ones erased with
  their user.

## Proof (rodeo)

On top of three-VM `51` and `multi-domain-harness.sh` (a fixture plugin with
roles `coordinator` (`invites: ["viewer"]`), `viewer`, `editor`; a restricted
web surface on domain B; an authenticated tunnel and a second plugin on B):

- **three-VM 53 — an inviter grants only what it may.** Policy off → `403`;
  enabling without a restricted web surface → `409`; enabled with
  `example.test`. The coordinator (external, entitled, site grant) on the
  site: `GET` lists `viewer` alone; `POST` `editor` → `403
role_not_grantable`; another domain's address → `400`; a cross-origin or
  `Sec-Fetch-Site: same-site` `POST` → `403`; the viewer `POST`s → `403`;
  the cap → `409`. Accepting: a username a removed user held → `409`;
  accepted → the user is external on B, holds no Authelia group, has the
  `viewer` grant and the site grant, appears in the agent half's projection
  as `viewer`, reaches the shell and the API with role `viewer`; the same
  link again → `410`; audited `invitation.created`/`accepted`, listed with
  its inviter.
- **three-VM 54 — the invitee reaches only that plugin's site; revocation
  ends access.** The invitee on B's authenticated tunnel → access-request
  page; on the second plugin's surface → `forbidden`; on A → refused.
  Revocations: the inviter revokes a pending one → `410` on acceptance;
  another inviter's → `404`; the admin revokes one; the coordinator's role
  taken away → their pending invitation is `revoked`/`inviter_unentitled`
  and refuses acceptance, their invitee still reaches the site (D1); the
  policy turned off → pending revoked; the admin disables the invitee → the
  same session `401` at once; no Authelia restart throughout.
- **single-VM 38 — store and refusals.** The policy's validation; the
  manifest `invites` errors; `identity.changed` on an update adding
  `invites`; the token stored hashed (no clear token in state.db);
  `invitations.json` imported and deleted.
- **upgrade `01`** (extended): a pending admin invitation made on the
  previous release accepts after the Panel Update.

## Waves

1. **Core** — the manifest field, normalization, diff and digest vectors;
   the policy schema; the user-surface invitations path helpers; the token
   hash; `AdminClient` and types; the invitation page's delegated form.
2. **serverd + Gatekeeper** — migration 0020 and the import; `lib/invitations.js`
   (store, policy, create, revoke, accept, sweep, repair); the admin routes
   moved; the policy routes; the user-surface routes; acceptance; erasure;
   the vhost location; Gatekeeper's target rule. Unit tests for every
   refusal and bound.
3. **UI, desktop, CLI, docs** — as §9.
4. **Security review** — independent, given the code.
5. **Rodeo** — 53, 54, single-VM 38, upgrade 01 on fresh VMs.

## Decisions (agreed 2026-10-28)

The founders chose the recommendation of every product decision (D1, D3–D8,
D10); D2 and D9 are technical and follow the recommendation. The
alternatives are kept for the record.

1. **The inviter disabled, removed or no longer able to grant.**
   _Recommended:_ their pending invitations are revoked; the people they
   invited keep their access (the administrator reviews them by inviter).
   Alternative: the invitees are disabled with them (a coordinator who leaves
   the client takes their colleagues' access along — surprising, and undoes
   a grant Lamaste already made on the administrator's behalf).
2. **How inviting roles are declared and approved.** _Recommended:_ `invites`
   on a role in the `identity` block; in the approval digest; widening is
   `identity.changed` (never auto-approved). Alternative: a separate
   top-level `invitations` block with its own approval reason.
3. **Who turns it on.** _Recommended:_ off until the administrator enables
   the installation's policy, in addition to approving the manifest.
   Alternative: on as soon as the manifest is approved.
4. **E-mail domain allow-list.** _Recommended:_ required (no default): the
   policy cannot be enabled without at least one domain. Alternative:
   optional, default any address.
5. **Cap on open invitations per inviter.** _Recommended:_ the
   administrator's per installation, 1–100, default 10 (plus fixed bounds:
   200 pending per plugin, 30 per inviter per hour). Alternative: one fixed
   relay-wide number.
6. **Invitation lifetime.** _Recommended:_ the administrator's per
   installation, 1–30 days, default 7 (the admin invitations' range).
   Alternative: fixed 72 hours.
7. **Who picks the username.** _Recommended:_ the invitee, on the invitation
   page (prefilled from the address). Alternative: the inviter, as the
   administrator does today.
8. **The site grant.** _Recommended:_ automatic — the grant on the plugin's
   own restricted web surface, and only that. Alternative: the administrator
   gives it after acceptance (an invitee then reaches nothing until they do).
9. **The store.** _Recommended:_ every invitation in `state.db` with hashed
   tokens, `invitations.json` imported once and deleted. Alternative: keep
   `invitations.json`, add the delegated fields (tokens stay in clear).
10. **What the plugin and the admins learn.** _Recommended:_ the feed stays
    protocol 1 (no "invited by" in the audience; the inviter sees their own
    invitations' status through the endpoint); admins are notified of every
    delegated acceptance. Alternative: an `invitedBy` attribute in the feed
    (protocol 2, an opt-in), or no notification.
