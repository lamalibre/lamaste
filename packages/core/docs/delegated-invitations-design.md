# Delegated Invitations — Design Document

> **Status:** agreed 2026-10-28 — decisions D1–D12 (D1, D3–D8, D10–D12 put to the founders, each as recommended; D2 and D9 technical, taken as recommended); revised after two independent reviews of 2026-10-28 (24 findings, three blockers, all folded in — tables at the end; one, the `/api/invite` half of 2.5, turned out false and is marked so). Waves 1 to 4 built (core, serverd + Gatekeeper, UI + desktop + CLI + docs, the code's security review of 2026-11-02 with its fixes: see Waves); rodeo is next.
> **Target:** Lamaste 4.9.0, on top of 4.8.0 (multi-domain relay, external members, per-domain branding).
> **Pilot:** corral (`corral.codelama.com.tr`): the client's coordinator invites colleagues into corral, as external members of `codelama.com.tr`, with a corral role, without the relay admin.
> **Companions:** `herd/docs/r730-workload-plan.md` §15.2 (scope), §15.2a, §15.4, §15.5;
> `external-members-design.md` (a delegated invitation creates only `external` memberships);
> `identity-directory-design.md`, `gatekeeper-design.md`, `multi-domain-relay-design.md`,
> `auth-branding-design.md` (the auth pages per domain brand);
> `plugin-development/design/agent-hosted-app-plugins.md` (slices 6 and 7).

## Goal

A person who holds an **inviting role** of an agent-hosted app plugin invites
a colleague into that plugin, on a Lamaste page their plugin links to. The
invitation:

- grants exactly one of that plugin's roles — one the manifest lets the
  inviter's role grant — plus what the plugin's site needs: the grant on the
  plugin's own `restricted` web surface and an `external` membership of the
  plugin's domain;
- never grants an Authelia group, admin, another plugin, another domain, a
  Lamaste (Gatekeeper) group, a tunnel, a static site, or anything an earlier
  holder of a username was given;
- is bounded: e-mail domains the administrator allows for that installation,
  an expiry, one use, a cap on open invitations per inviter, a cap on the
  people who join the plugin by invitation;
- is a link the inviter sends through their own mail (Lamaste sends none);
- is audited and listed in the panel with its inviter; the administrator
  revokes any invitation or user (and everyone a person invited), the inviter
  their own pending ones;
- reaches the plugin as an ordinary audience change (the identity feed).

The plugin's own code — its web tree and its agent half — takes no part:
it cannot make, see or accept an invitation (review B2).

The administrator's own invitations (`POST /api/invitations`) stay as they
are, and stay the way to invite anyone into anything else.

## What exists in 4.8

| Piece             | 4.8                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitations       | Admin-only `POST /api/invitations` (mTLS): username, e-mail, Authelia groups, `domains: [{ name, kind }]`, expiry 1–30 days (default 7). Stored in `<stateDir>/invitations.json` (atomic, one mutex) **with the token in clear**; looked up by a constant-time scan. `GET /api/invitations` (tokens redacted), `DELETE /api/invitations/:id` deletes.                                                             |
| Acceptance        | Public `GET /api/invite/:token`, `POST /api/invite/:token/accept { password }` → `changeUsers` creates the user, the directory gives them an id, the memberships are inserted and rendered; TOTP generated; marked used afterwards by a second read. Two acceptances race until `changeUsers` refuses the second (409). Served on every auth vhost and the panel vhost; only the global 100/min per IP limits it. |
| Invitation page   | `auth.<domain>/invite/<token>` — core `renderInvitePage(brand \| null)`. Loads its QR generator from `cdn.jsdelivr.net` without SRI; the `/invite/` location sets no CSP.                                                                                                                                                                                                                                         |
| Usernames         | `withUsernamesForGrants` lets grants name a username the directory has never seen ("a user still to come"); a static site's `allowedUsers` and `user-plugin-access.json` take any username; erasure sets the directory row's username to NULL.                                                                                                                                                                    |
| Roles             | Manifest `identity.roles`; the admin gives a role as a Gatekeeper `plugin` grant with `context.roles` (`setEntitlement` — it replaces every role grant the principal holds on the plugin, and takes the users lock). In the approval digest when declared.                                                                                                                                                        |
| Audience and feed | entitled ∩ (members ∪ external members) of the plugin's domain; pushed to the agent half (protocol 1).                                                                                                                                                                                                                                                                                                            |
| Auth portal       | `auth.<d>` admits `group:lamaste:m:<key>` and `group:lamaste:x:<key>` of `d` (external-members design). Gatekeeper validates a session per host, checks the domain projection, signs relay assertions (`aud: '@panel'` today only for user-surface targets — `relay-assertion.ts` requires `isUserSurfaceUrl`).                                                                                                   |
| Web surface       | A plugin-owned site; its shell's CSP is `connect-src 'self'`, so the shell reaches everything on its host — the plugin's agent half too.                                                                                                                                                                                                                                                                          |
| Gatekeeper limits | `MAX_GRANTS = 1000` relay-wide.                                                                                                                                                                                                                                                                                                                                                                                   |

## Design

### 1. The manifest: inviting roles (built, wave 1)

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

- `invites`: 1–32 role ids **of the same block**, no repeats. A role may name
  itself; the approval shows it.
- `normalizeIdentityBlock` emits `invites` (sorted) only where declared, so
  every 4.8 digest is unchanged. `identityDiff` reports `invitesAdded` /
  `invitesRemoved`; a role allowed to invite into one more role is
  `identity.changed` ("lets coordinator invite people as stakeholder"),
  never auto-approved; narrowing only changes the digest.
- `IdentityRoleSchema` is strict: a plugin that declares `invites` does not
  install on a relay older than 4.9 (said in the plugin-development docs).
- Core `grantableRoles(block, held)`: the union of the held roles' `invites`.

### 2. The installation's policy (the administrator's)

Approving the manifest says what the plugin may ask for; it does not turn
invitations on. State.db `plugin_invitation_policies`, one row per plugin:

| Field               | Rule                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`           | default false (D3).                                                                                                                              |
| `emailDomains`      | 1–20 domain names (ASCII/punycode, lower case, `assertDomainName`); the invitee's address must end in `@<one>` exactly. Required to enable (D4). |
| `maxOpenPerInviter` | 1–100, default 10 (D5): pending (and `accepting`) invitations one inviter holds on the plugin.                                                   |
| `maxJoined`         | 1–500, default 50 (D11): people who joined the plugin by invitation and are not removed, plus every open invitation of the plugin.               |
| `lifetimeDays`      | 1–30, default 7 (D6).                                                                                                                            |

Enabling is refused (409, with the reason) unless the installed, approved
version declares an inviting role and the plugin has a web surface (its own
site) whose access mode is `restricted`. A tunnel bound as a user surface
cannot be granted (it would open the tunnel's application); an
`authenticated` web surface refuses external members.

Fixed bounds (constants): 30 invitations made per inviter per hour (counted
from the table, revoked ones included); none made or accepted while
Gatekeeper has fewer than 100 free grants (`MAX_GRANTS` less the grants
held; every invitee costs two) — `503 grant_reserve`.

A policy change takes the plugin's invitations lock (§6) and **sweeps**:
turning it off revokes every open invitation (`policy_disabled`); an e-mail
domain removed revokes the open ones to it (`email_domain_removed`); a
shorter lifetime brings each open invitation's expiry to at most `created_at

- lifetimeDays`; lowered caps revoke nothing (they bound new invitations).
Audited `invitation.policy.updated` (the fields; domains are not personal
  data).

### 3. What an invitation grants — fixed by Lamaste, never by the request

An inviter names only **an e-mail address, a display name (optional) and one
role**:

| Granted on acceptance | Value                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| a new user            | the username the invitee picks (D7, §7), their display name (prefilled with the inviter's), their password, a TOTP secret |
| a membership          | `{ name: <the plugin's domain>, kind: 'external' }`                                                                       |
| the role              | a Gatekeeper `plugin` grant, `resourceId` = route, `context.roles` = `[role]`                                             |
| the site grant (D8)   | a Gatekeeper `site` grant on the plugin's web surface, `resourceId` = the site id recorded on the invitation              |
| Authelia groups       | none                                                                                                                      |

The role must be one the inviter's roles may give now (`grantableRoles` over
the roles `resolveUserCaller` reads from the audience), restricted to the
roles the installed version declares.

### 4. The store: invitations move to state.db (D9)

Migration `0020_invitations.sql`:

```sql
CREATE TABLE invitations (
  id                TEXT PRIMARY KEY,            -- UUID v4
  token_sha256      TEXT NOT NULL UNIQUE,        -- hex SHA-256 of the 32-byte token
  kind              TEXT NOT NULL CHECK (kind IN ('admin', 'delegated')),
  username          TEXT,                        -- admin: chosen; delegated: claimed on acceptance
  email             TEXT,                        -- NULL once accepted (the directory holds it)
  display_name      TEXT,                        -- NULL once accepted
  email_domain      TEXT NOT NULL,               -- kept: the policy's sweeps and the listing
  groups_json       TEXT NOT NULL DEFAULT '[]',
  domains_json      TEXT NOT NULL,               -- [{ name, kind }]
  plugin            TEXT, role TEXT, site_id TEXT, inviter_user_id TEXT,   -- delegated
  created_by        TEXT NOT NULL,               -- 'admin' | 'user:<userId>'
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('pending', 'accepting', 'accepted', 'revoked')),
  status_at         TEXT NOT NULL,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  revoked_by        TEXT, revoked_reason TEXT,
  accepted_user_id  TEXT,
  claim_id          TEXT,                        -- the acceptance under way ('accepting')
  revoke_pending_reason TEXT,                    -- a sweep found it unacceptable while accepting
  role_granted_at   TEXT, site_granted_at TEXT, rendered_at TEXT,   -- delegated: what acceptance completed
  CHECK (kind = 'admin' OR (plugin IS NOT NULL AND role IS NOT NULL AND site_id IS NOT NULL
         AND inviter_user_id IS NOT NULL AND groups_json = '[]'))
);
CREATE INDEX invitations_open ON invitations (status, plugin, inviter_user_id);
CREATE UNIQUE INDEX invitations_open_username ON invitations (username)
  WHERE username IS NOT NULL AND status IN ('pending', 'accepting');
ALTER TABLE directory_users ADD COLUMN invitation_id TEXT;   -- the acceptance that created the user
CREATE TABLE plugin_invitation_policies (...);
```

- **Tokens.** 32 random bytes; only the SHA-256 is stored and looked up (no
  scan). Shown once, in the answer that creates it.
- **Import** (review 12, code review 12). Once: at the first start,
  `invitations.json` goes in by id, in one transaction with a marker
  (`invitations_import`, written with no file too) — a row state.db holds is
  never overwritten —, tokens hashed, `used` → `accepted`, with
  `accepted_user_id` from the directory row created by the time it was
  accepted (a later holder of the username is someone else), the rest as it
  was; then the file is deleted. A file that appears after the marker is a
  backup's and could bring back what was revoked, deleted or erased: it is
  deleted unread, with a warning and `invitation.import.refused`. A downgrade
  to 4.8 loses the invitations pending at the upgrade (upgrade notes).
- **Expiry** is read, not swept. **Retention:** ended without making an
  account → deleted 90 days later (the identity tick); one that made an
  account, accepted or not, stays until that user is erased: it is the record
  of who invited whom, `maxJoined` and `disable-invitees` read it, and an
  administrator's `DELETE` refuses it (409 `invitation_has_user`).
- **Erasure** (`purgeInvitations` moves here): erasing a removed user deletes
  the invitations accepted by them, the one that created them
  (`directory_users.invitation_id`), the delegated ones to their address that
  made nobody an account, and the admin invitations naming their username made
  before they were removed; as an inviter they stay as the bare id.

### 5. The inviter's page: Lamaste's, on the domain's sign-in host (D12)

The inviter works on a **Lamaste page at `https://auth.<plugin's
domain>/invitations/<route>`** — another origin than the plugin's site, so
nothing the plugin serves can script it, read its answers or frame it. The
plugin's pages only **link** to it (corral's _Kişiler_ page: "Davet et").

**The page.** Core `renderInvitationsPage(brand | null)` — one HTML file per
domain brand, written as 4.8 writes the invitation page (stock under
`/var/www/lamaste/invitations/`, a branded copy in the domain's rendering),
served at `/invitations/` by the auth vhost (`try_files`, named fallback). It
holds no data: its script (inline, hashed in its CSP) reads the route from
its path and calls the API below. CSP `default-src 'none'; script-src
'sha256-…'; style-src 'sha256-…'; img-src 'self' data:; connect-src 'self';
frame-ancestors 'none'; form-action 'none'; base-uri 'none'`, `Referrer-Policy:
no-referrer`. Nothing is read from the query string (a plugin cannot prefill
it). It shows: the plugin's name and the roles the inviter may give, the
form (address, display name, role), the link of a new invitation once with a
copy button, the inviter's own invitations with their status and Revoke, and
a link back to the plugin's site.

**The API**, on the same auth vhost:

| Method   | Path                                      | Answer                                                                                                                                                   |
| -------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/delegated-invitations/<route>`      | `{ plugin: { displayName, siteUrl }, policy: { grantableRoles: [{ id, label }], emailDomains, lifetimeDays, maxOpen, open }, invitations: [...] }` (own) |
| `POST`   | `/api/delegated-invitations/<route>`      | `{ email, displayName?, role }` → 201 `{ invitation, inviteUrl }` — the link once                                                                        |
| `DELETE` | `/api/delegated-invitations/<route>/<id>` | the caller's own pending invitation → `{ ok: true }`                                                                                                     |

An invitation as its inviter sees it: `{ id, email, displayName, role,
status, revokedReason, createdAt, expiresAt, acceptedAt }` — no token, not
who accepted (the plugin learns that from the feed). `delegated-invitations`
joins `RESERVED_API_PREFIXES`.

**The path:**

1. **nginx** (`renderAuthVhost`, every domain): `location ^~
/api/delegated-invitations/` → `auth_request
/internal/lamaste/delegated-invitations-authz` (Gatekeeper
   `/authz/delegated-invitations/<domain>`, never cached), the assertion
   forwarded as `X-Lamalibre-Relay-Assertion`, the browser's `Cookie`,
   `Authorization`, `Remote-*`, `X-SSL-Client-*` cleared, `proxy_pass` with no
   URI to the panel, `client_max_body_size 16k`; 401 → a JSON 401 (the page
   then sends the browser to `https://auth.<d>/?rd=<page>`), 403 → JSON
   `forbidden`. Directives the auth vhost already uses (the primary's
   `/api/user-access/authorize`); `lamaste-priv`'s allow-list is checked by
   the vhost tests.
2. **Gatekeeper** `/authz/delegated-invitations/<domain>`: the target must be
   `https://auth.<domain>` + a delegated-invitations path (core
   `isDelegatedInvitationsUrl(path, route)`, the unsafe-segment rule of
   `hasUnsafePathSegments`, `<id>` a UUID); the Authelia session for that URL
   (the portal rule admits only `d`'s members and external members); the
   domain projection (member or external of `d`, fail closed); the route
   served by its plugin's own site, and on a restricted one the inviter's
   grant on it (`checkAccess`: a role left on someone whose site grant was
   revoked invites nobody); then it signs
   an assertion `aud: '@panel'`, caller `{ type: 'user', username }`, target
   `{ invitations: <route>, domain, path }`. Core `relay-assertion.ts` gains
   that target kind beside `{ route, path }` (user surfaces keep
   `isUserSurfaceUrl`, unchanged — review 4).
3. **The panel**: a context of its own on the root instance (no mTLS, no 2FA
   session, no role guard — like the user-surface context), with a JSON
   parser and `bodyLimit` 8 KiB. Per request:
   `Sec-Fetch-Site` absent, `same-origin` or (GET only) `none` — anything
   else 403; on `POST`/`DELETE` `Origin` = `https://auth.<domain>` exactly
   (`auth.<d>` and the plugin's site are same-site: only the origin tells
   them apart); the assertion verifies, is bound to this method and raw
   target, and its domain is the plugin's domain; `resolveUserCaller(route,
username)` (active, entitled, identity ready); the policy enabled and the
   web surface restricted and served — `403 invitations_unavailable`
   otherwise (the reason in the log only); its own rate limit (60/min per
   IP + route). Answers carry `Cache-Control: no-store`, `nosniff`,
   `Cross-Origin-Resource-Policy: same-origin`.
   - `POST`: zod strict — `email` ≤ 254, valid, its domain in
     `emailDomains`; `displayName` 1–100, display text; `role` a declared
     id — 400 with the field. Under the plugin's invitations lock, in one
     transaction: the role grantable now (`403 role_not_grantable`), the
     inviter's open count < `maxOpenPerInviter`, the plugin's joined + open
     < `maxJoined` (`409 invitation_cap`, which one in `code`), the hourly
     rate (`429`), the grant reserve (`503 grant_reserve`); insert.
     Never says whether the address has an account.
   - `DELETE`: only the caller's own pending invitation (`404` for anything
     else — another's is not told apart from none); `accepting` → 409.
     Logs metadata only (`user:<userId>`, plugin, outcome), never an address.

The link is `https://auth.<plugin's domain>/invite#<token>` (§7). Audited
`invitation.created` (actor `user:<userId>`, plugin, `{ invitationId, role,
emailDomain, expiresAt }`).

### 6. Locks

The total order (review 2.3, corrected by code review 22): the tunnel lock →
the sites lock → the users lock → the domains rendering and the entitlements
lock (per plugin) → **the invitations lock**, a leaf. The invitations lock (one
`KeyedPromiseChainMutex`, per plugin; the administrator's invitations share
one key) is held only around state.db work and plain reads (the plugin row,
`sites.json`, `tunnels.json`, the directory, the audience) — never across a
Gatekeeper or nginx call, another lock, `changeUsers`, `setEntitlement` or an
audience recomputation, and it is not re-entrant, so code holding it calls
the `…Unlocked` forms of the sweeps. The sweep that follows an audience
recomputation is queued after it, never awaited inside it. Everything that
must not interleave with an acceptance under way is kept off by the claim
(an `accepting` row, its `claim_id`), not by holding a lock across it.

### 7. Acceptance

**The token never travels in a URL path** (review 2.10): the link is
`https://auth.<domain>/invite#<token>` — a fragment reaches no server log —
and the page posts it: `POST /api/invite/lookup { token }`, `POST
/api/invite/accept { token, … }`. A 4.8 link (`/invite/<token>`) still opens
the page, which reads the token from its path the same way; the path-token
API routes go. The lookup of a delegated one answers `{ kind: 'delegated',
email, displayName, plugin: <displayName>, role: <label>, invitedBy:
<inviter's display name, or nothing>, expiresAt, suggestedUsername }` (never
the inviter's username). A delegated token is answered only by
`auth.<its domain>`: every auth vhost passes `Host auth.<d>` as a literal and
clears `X-Forwarded-Host`, and the panel reads `request.headers.host`, never
`request.host` (the panel trusts the loopback hop, so `request.host` would be
a client's `X-Forwarded-Host` — review 2.5); elsewhere 404, the panel vhost
included. The page (`renderInvitePage`, stock and branded) asks for a
**username** (suggested from the local part when valid), the display name
(prefilled) and a password; the accept takes `{ token, username,
displayName, password }` (admin invitations: `{ token, password }`).

The panel and IP vhosts serve the same public API for an administrator's
invitations, and write a literal `Host 127.0.0.1` there: the IP vhost's
server name is `_`, so a client's own `Host` would otherwise pass for a
sign-in host (code review 16).

**Both pages' CSP** (review 2.6): their inline script and style are the same
for every brand — the brand's values live only in `/brand.css` — so one pair
of hashes per release goes into nginx's header (`script-src 'sha256-…';
style-src 'self' 'sha256-…'`), with `frame-ancestors 'none'`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`,
`Referrer-Policy: same-origin` (`no-referrer` would make a same-origin
`fetch` POST send `Origin: null`) and `Cache-Control: no-store`. Their
requests use `fetch`'s default `cors` mode. The QR code is the panel's: an SVG
data URI in the accept answer (`qrcode` package) — no foreign script.

In order, failing closed:

1. **Claim** (the invitations lock, one transaction): the row `pending`,
   unexpired, `failed_attempts < 5` — else `404`/`410`. The checks of step 3
   that need no lock run first; a refusal there puts nothing in `accepting`
   and counts a failed attempt (the fifth locks the link: `revoked` /
   `attempts_exhausted`, the inviter sees it). Then `status = 'accepting'`,
   `username`, a fresh random `claim_id`, `status_at`. A partial `UNIQUE`
   index on `invitations (username)` over `pending` and `accepting` rows
   (expired pending ones naming the username are first closed as
   `superseded`) makes two claims of one username impossible, across
   plugins and kinds.
2. **Still allowed now** (same lock): `whyNotAcceptable` (§8) — the plugin,
   identity approval, the role; the policy and the address's domain; the web
   surface (restricted, served, the recorded site and domain); the inviter
   active and still able to grant the role (D1) — the grant reserve, and,
   read from Gatekeeper before the lock since the lock is a leaf, the
   inviter's grant on the site (`inviter_unentitled` without it). A
   failure releases the claim (`pending`, or `revoked` with the reason when
   it can never pass) and answers `410` (the reason in the log only).
3. **The username** (review B1) — under the users lock, inside
   `changeUsers`, before anything is prepared (its `vetCreates` hook), which
   first checks that the invitation still holds **this `claim_id`** (else it
   aborts: recovery or a revocation took the claim): refused, with one
   answer `409 username_unavailable`, when it is held by a directory row
   (active, disabled or removed — an erased row names none, and its principal
   was cleared at erasure); named by another open invitation; holds anything
   in Gatekeeper (`POST /api/principals/user/inspect`); is in a site's
   `allowedUsers` or a `user-plugin-access.json` grant; or Authelia holds an
   OIDC identifier for it. The claim is then released at once and the
   refusal counts a failed attempt. Separately, **`changeUsers` refuses in
   every path** a username an open invitation names unless the call is that
   invitation's own acceptance (`invitationId`), so an administrator's
   creation cannot take a claimed name. The password is hashed only after
   these checks pass.
4. **The user**: `changeUsers` (`creates`, `invitationId`, `domains: {
<username>: <the invitation's memberships> }`, groups `[]`, the display
   name validated and passed to `createUserFromInvitation`). A `directory`
   warning or `persisted: false` is a failure of this step: the claim stays
   for recovery. **The reconcile, whenever it adopts a username an
   `accepting` or accepted invitation names** (a crash between the users.yml
   write and the directory, a failed read), takes that invitation's
   memberships — never the relay's default, which on a one-domain relay is
   `member` (review 2.1, also a 4.7 defect for an admin invitation naming
   `external`) — and stamps the new directory row's `invitation_id`
   (migration 0020 adds the column). Until then the user holds no owned
   group, so Authelia admits them nowhere. TOTP is generated as soon as the
   user exists.
5. **The grants** (outside every lock but the ones they take): the role
   (`setEntitlement`, actor `invitation:<id>`), then the `site` grant (under
   `withUsernamesForGrants`, `requireUser`), then `syncDomainAccess` (a
   partial failure: not yet rendered). Each grant runs a **precondition
   inside the users lock** just before it is made — the invitation still
   holds the claim, has no `revoke_pending_reason`, the username is still
   the accepted user's, and `whyNotAcceptable` finds nothing (an inviter's
   standing counts until the invitation is accepted, as it does for a sweep:
   only the repair ignores it, D1) — and each is recorded as it completes
   (`role_granted_at`, `site_granted_at`, `rendered_at`).
6. **Recorded** (the invitations lock): `accepted`, `accepted_user_id`;
   `email`/`display_name` nulled; audited `invitation.accepted` (actor
   `invitation`, plugin, `{ invitationId, userId, inviterUserId, role }`);
   admins notified (D10). The answer's `loginUrl` is the plugin's site. A user
   without a TOTP secret (`totp_issued_at` unset: a failed write, a crash)
   cannot sign in unaided: the admins are told to reset it, and the page tells
   the invitee to ask.

**A revocation during an acceptance** (code review 1, 2). A mark ends the
invitation `revoked`, whatever ends the claim, with the reason and the author
it was marked with (`revoke_pending_reason`, `revoke_pending_by`). Before the
account exists no account is made: giving the claim up records the revocation,
in the same statement. After it exists the account cannot be unmade by
withholding what is left, since a mark may land after the last precondition,
or between the role and the site: so whatever ended it `revoked`, a mark or a
precondition, **the account is disabled** through the usual offboarding, for
both kinds (an administrator's invitation naming `admins` included), retried
on the tick until it is (`account_disabled_at`). The acceptance answers `410
invitation_revoked`; `invitation.revoked` names the account, and the admins are
told it was disabled and may delete it, or enable it. Once disabled, nothing
disables it again.

**Sweeps and `accepting` rows** (review 2.4). A sweep never revokes an
`accepting` row: it sets `revoke_pending_reason`, which every end of the claim
reads. An administrator's or an inviter's `DELETE` of one does the same (the
administrator's answers 202), audited `invitation.revoke.marked`.

**Recovering** (review 6, 2.2). On the identity tick, which also runs at
start, under the users lock, an `accepting` row older than 10 minutes is
resolved by what exists, not by timing: a directory row stamped with its
`invitation_id` (never an erased one) → it is finished as an acceptance is;
its username in users.yml but not yet in the directory → the reconcile adopts
it (with the invitation's memberships and stamp) and it is finished; neither
→ a new `claim_id` is not issued, the row goes back to `pending`, or ends
`revoked` when marked. An acceptance still queued behind the users lock finds
its `claim_id` gone at step 3 and stops, so one link never makes two accounts
and no other user is ever credited.

**Repairing** (review 7, 2.4, code review 6, 18). An accepted invitation with
a step-5 completion missing is completed on the identity tick for 24 hours —
while `whyNotAcceptable` finds nothing but the inviter's standing, the user is
active, the audit holds no entitlement change for that user on the plugin since
by any actor but `invitation:<id>` (read by `userId` in SQL), and what it
already made still stands in Gatekeeper, read there since a site grant changes
by no audited route — and only by **creating what is missing**: the role grant
only when the user holds no role grant on the plugin, the site grant only when
none exists. It never replaces a grant. A definite refusal of the site grant
(a refused connection, Gatekeeper's limit) clears its attempt and is asked
again, so an outage is not terminal; an answer lost (`outcomeUnknown`) is not,
since an administrator may have revoked what it made. Otherwise, or after 24
hours, it stops (`repair_abandoned`, admins notified); the user keeps what they
were given. The invitee's answer says when access is still being completed.

The plugin learns of the new member through the feed: the role grant puts
them in the audience (`upsert`, role, declared attributes). Protocol 1 is
unchanged (D10). The address is the inviter's word, unverified (Lamaste
sends no mail); a plugin declaring the `email` attribute receives it as
such (said in agent-hosted-plugins.md).

### 8. Revocation, sweeps and oversight

| Who              | May                                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the inviter      | list and revoke their own pending invitations (§5).                                                                                                                                                          |
| an administrator | list every invitation (both kinds, inviter, plugin, role, status, reason); revoke any pending one; disable or delete any user; **disable everyone a person invited, transitively** (D1's complement, below). |
| Lamaste          | revoke what can no longer be accepted, at the event that causes it (below), and re-check everything at acceptance.                                                                                           |

Reasons: `inviter`, `admin`, `inviter_disabled`, `inviter_removed`,
`inviter_unentitled` (lost every role that could give it), `policy_disabled`,
`email_domain_removed`, `plugin_removed`, `role_undeclared`,
`surface_removed` (web surface deleted or recreated under a new id — needed
before any plugin domain change), `surface_not_restricted`,
`attempts_exhausted`, `repair_abandoned`, `superseded` (an expired
administrator's invitation closed when another is made for its username). Swept under the invitations lock
on: policy changes; uninstall; an update or approval that drops a role or an
`invites`; web-surface create/delete/move and access-mode changes; and on
every audience recomputation for the inviter checks. A revocation keeps the
row, audited `invitation.revoked`. Admin `DELETE /api/invitations/:id`
revokes a pending one, deletes one that ended without making an account,
refuses one that made an account (409 `invitation_has_user`), and marks an
`accepting` one (202; §7). A disabled plugin, a surface not served, or an
operation running on the plugin (an update may yet revert) revoke nothing: they
may pass again.

**The inviter disabled, removed or unentitled (D1).** Their open
invitations are revoked — a sweep sees their directory status and roles; the
site's grant is Gatekeeper's to say, and a sweep holds the invitations lock, so
that one is checked on every request of theirs and at each acceptance. The
people they invited keep their access. For the
administrator's review: the panel lists invitees by inviter, and
`POST /api/invitations/disable-invitees { inviterUserId, transitive }`
disables everyone they invited (and, transitive, everyone those invited),
audited, through the usual offboarding.

**Panel.** Users → Invitations: kind, invited by (username and plugin),
role, status and reason, filters by plugin and inviter; Revoke. The plugin
card gains **Invitations**: the policy (shown for a plugin declaring an
inviting role; a refusal explained), its invitations, the people who joined
by invitation grouped by inviter, with Disable invitees. A delegated
acceptance notifies admins.

### 9. The plugin's side (what corral adds)

1. The manifest: `invites` on its coordinator role; requires Lamaste ≥ 4.9;
   approved by the administrator (`identity.changed`).
2. Its _Kişiler_ page's "Davet" action links (top-level navigation, `rel=
"noopener"`) to `https://auth.<its domain>/invitations/corral` — the
   domain is the site's hostname without its first label. Nothing else: no
   call, no token, no list. The new person arrives through the feed.
3. The administrator: corral's policy (enable, the client's e-mail domain,
   caps, lifetime) on its card.

### 10. API, panel, desktop, CLI

- **Admin API** (mTLS): `GET /api/invitations` gains `kind`, `plugin`,
  `role`, `inviter: { userId, username }`, `status` (`pending`, `expired`,
  `accepting`, `accepted`, `revoked`), `revokedReason`, `fulfilled`,
  filters `?plugin=` / `?inviter=`; `DELETE /api/invitations/:id` as §8;
  `POST /api/invitations/disable-invitees`; `GET|PUT
/api/plugins/:name/invitation-policy`. `POST /api/invitations` unchanged.
- **Public**: `GET /api/invite/:token`, `POST …/accept` as §7.
- **Inviter**: §5.
- **Gatekeeper**: `/authz/delegated-invitations/:domain`;
  `POST /api/principals/user/inspect`; its grant count for the reserve.
- **Core**: the manifest field (wave 1); `InvitationPolicySchema`;
  `isDelegatedInvitationsUrl`, the relay assertion's target kind;
  `hashInvitationToken`; `renderInvitationsPage`, `renderInvitePage`'s
  delegated form; `AdminClient`: `getInvitations(filter)`,
  `disableInvitees`, `getPluginInvitationPolicy`,
  `setPluginInvitationPolicy`; types.
- **Panel UI / desktop**: §8; web client, desktop client, `admin_*`
  commands.
- **CLI** `lamaste-server`: `invitations list [--plugin] [--inviter]`,
  `invitations revoke <id>`, `invitations disable-invitees <user>
[--transitive]`, `plugins invitations <name>` and `plugins invitations
<name> set [--enable|--disable] [--email-domains a,b] [--max-open n]
[--max-joined n] [--lifetime-days d]`.
- **Docs**: `04-api-reference/invitations.md` (new, both kinds),
  `agent-hosted-plugins.md`, `users.md`, `gatekeeper.md`,
  `03-architecture/nginx-configuration.md`, `01-concepts/security-model.md`,
  `plugin-development` (the manifest field, the 4.9 minimum).

### 11. Upgrade in place

1. Migration 0020; the import of `invitations.json` (pending admin
   invitations keep working); the file deleted after the commit.
2. Every 4.8 approval digest unchanged.
3. Auth vhosts are re-rendered at start (the delegated-invitations
   locations); the invitations page written like the invitation page;
   Gatekeeper and the panel ship together.
4. Nothing restarts Authelia.

## Security notes

- **The plugin is not in the path** (review B2). The inviter's page and API
  are on `auth.<domain>`, an origin the plugin's tree cannot script (CSP
  `connect-src 'self'` keeps it on its own host; `frame-ancestors 'none'`
  here; `Origin` checked exactly — `auth.<d>` and the plugin's site are
  same-site, so `SameSite` cookies alone would not separate them). The page
  takes nothing from its URL but the route. A plugin can at most open the
  page; the person decides.
- **Who attests the inviter.** Gatekeeper attests the session's username to
  the panel (assertion bound to method, raw target and domain); the panel
  reads their roles from its own audience.
- **What can be granted is closed.** Lamaste fixes the kind, the domain, the
  site and the grant shapes; the request names one role, checked against the
  approved manifest and the inviter's roles now. External members hold no
  Authelia group.
- **No inheritance** (review B1). An invitee's username has never been held
  and nothing in Gatekeeper, a site list, a desktop grant, a pending
  invitation or Authelia's OIDC store names it.
- **The link is a bearer secret.** Lamaste verifies no address: whoever opens
  the link first becomes the account. The allow-list bounds what an inviter
  records, not who accepts; the inviter is accountable. 256-bit token,
  hashed, shown once, claimed atomically, 5 failed attempts lock it, expires.
- **Abuse bounds** (review 3, 10): per-inviter open cap and hourly rate,
  per-plugin joined cap, the grant reserve, rate limits on both APIs, a
  password hashed only after every check.
- **Fail closed, never undo the administrator.** Every precondition is
  re-checked at acceptance; recovery never makes a second account; repair
  only fills what is missing.
- **Personal data.** Addresses never in audit details or logs; the copies on
  an invitation nulled once accepted; ended invitations deleted after 90
  days; accepted ones erased with their user.

## Proof (rodeo)

On top of three-VM `51` and `multi-domain-harness.sh` (a fixture plugin with
roles `coordinator` (`invites: ["viewer"]`), `viewer`, `editor`; a restricted
web surface on B; an authenticated tunnel and a second plugin on B):

- **three-VM 53 — an inviter grants only what it may.** Policy off → `403`;
  enabling without a restricted web surface → `409`; enabled with
  `example.test`. The coordinator (external of B, entitled, site grant) on
  `auth.B/invitations/<route>`: the page; `GET` lists `viewer` alone;
  `POST editor` → `403 role_not_grantable`; another domain's address →
  `400`; `Origin` of the plugin's site, or `Sec-Fetch-Site: same-site` →
  `403`; the same call through the plugin's site host → no such location;
  a viewer → `403`; a member of A only → refused at `auth.B`; the cap →
  `409`. Accepting: a username a grant already names (a restricted tunnel's
  grant made for it beforehand) → `409 username_unavailable`, as for a
  removed user's; accepted → external on B, no Authelia group, the `viewer`
  and site grants, in the agent half's projection as `viewer`, reaches the
  shell and API with role `viewer`; the link again → `410`; the token on
  `auth.A` → `404`; audited, listed with its inviter, admins notified.
- **three-VM 54 — the invitee reaches only that plugin's site; revocation
  ends access.** The invitee on B's authenticated tunnel → access-request
  page; the second plugin's surface → `forbidden`; `auth.A` → refused.
  The inviter revokes a pending one → `410`; another's → `404`; the admin
  revokes one; five wrong attempts lock a link; the coordinator's role taken
  away → their pending invitation `revoked`/`inviter_unentitled`, their
  invitee still reaches the site (D1); `disable-invitees` → the invitee's
  session `401` at once; the policy off → open ones revoked; no Authelia
  restart throughout.
- **single-VM 38 — store and refusals.** The policy's validation and
  sweeps; the manifest's `invites` errors; `identity.changed` on an update
  adding `invites`; no clear token in state.db; `invitations.json` imported
  (twice, idempotently) and deleted; the invitation and invitations pages'
  CSP and no foreign script.
- **upgrade `01`** (extended): a pending admin invitation made on the
  previous release accepts after the Panel Update.

## Waves

1. **Core** — done (`5721607`, `9dd42da`, `a76ec54`, `da1a3b6`). The manifest
   field; `invitations.ts` (policy, request and acceptance schemas, views);
   the inviter's API path and the assertion's target kind; both pages with
   one CSP per release (`server/auth-pages.ts`, `invite-page.ts`,
   `invitations-page.ts`); `AdminClient`.

   **Deviation:** only a branded domain has `/brand.css`, so the stock page
   links no stylesheet and uses the dark values in its style (the design
   said brand values live only there — they do).

2. **serverd + Gatekeeper** — done (`27b12de`, `6d0122f`, `67d4189`). As
   §4–§8; acceptance is `lib/invitation-acceptance.js`, the inviter's context
   `routes/delegated-invitations.js`, the rules `lib/delegated-invitations.js`.

   **Deviations:**
   - the QR code uses `qrcode-generator` 1.5.2 (MIT, no dependencies) rather
     than `qrcode`;
   - migration 0020 adds `site_attempted_at`: an attempted site grant whose
     answer was lost is never repeated blindly, since an administrator may
     have revoked what it made;
   - `changeUsers`' refusal of a username an open invitation names is
     `409 username_invited`, so an administrator's creation meets it too;
   - found on the way: the auth portals' vhost reconcile skipped any vhost
     whose `auth_request` presence changed, so a non-primary portal would
     never have gained the inviter's API on an upgrade — it now compares
     them with `keepAuthentication: false`;
   - `POST /api/invite/accept` answers an administrator's invitation with
     `totpQr` and `accessPending` too.

3. **UI, desktop, CLI, docs** — done. As §8 and §10.

   **Deviations:**
   - the bounds, statuses, reasons and the reasons' words moved to a new
     browser-safe core entry, `@lamalibre/lamaste/invitation-limits` (the root
     entry takes `node:crypto` through `identity.ts`), so the panel and the
     CLI share them instead of copying them;
   - `AdminClient` now says what the panel answers: the policy routes the
     view itself, and revocation `action: 'marked'`;
   - `admin_revoke_invitation` rejects with the panel's refusal;
   - Revoke is offered for `pending` and `accepting` only: the API's delete
     of an ended invitation has no button, since an accepted row is the
     record of who invited whom and counts toward `maxJoined`.

4. **Security review** — done 2026-11-02: three independent reviews of the code
   (the diff line by line, a threat model, the state machine and access
   matrix), each given the code, not this document; every finding fixed
   (`7bede9a`, `2874b54`, `a91b51b`, `beef152`, `bdf1ee9`; table below). Each
   fix was checked by putting the bug back: its test failed.
5. **Rodeo** — 53, 54, single-VM 38, upgrade 01 on fresh VMs.

## Decisions (agreed 2026-10-28)

The founders chose the recommendation of every product decision (D1, D3–D8,
D10–D12); D2 and D9 are technical and follow the recommendation. The
alternatives are kept for the record.

1. **The inviter disabled, removed or no longer able to grant.** _Chosen:_
   their open invitations are revoked; the people they invited keep their
   access (the administrator reviews them by inviter, and may disable them
   all at once). Alternative: the invitees are disabled with them.
2. **How inviting roles are declared and approved.** _Chosen:_ `invites` on
   a role in the `identity` block; in the digest; widening is
   `identity.changed`. Alternative: a separate top-level `invitations` block.
3. **Who turns it on.** _Chosen:_ off until the administrator enables the
   installation's policy, in addition to approving the manifest.
   Alternative: on once approved.
4. **E-mail domain allow-list.** _Chosen:_ required, no default.
   Alternative: optional, any address.
5. **Open invitations per inviter.** _Chosen:_ the administrator's, 1–100,
   default 10 (plus fixed bounds). Alternative: one fixed number.
6. **Lifetime.** _Chosen:_ the administrator's, 1–30 days, default 7.
   Alternative: fixed 72 hours.
7. **Who picks the username.** _Chosen:_ the invitee, on the invitation page.
   Alternative: the inviter.
8. **The site grant.** _Chosen:_ automatic — on the plugin's own restricted
   web surface only. Alternative: the administrator gives it later.
9. **The store.** _Chosen:_ every invitation in `state.db`, tokens hashed,
   `invitations.json` imported and deleted. Alternative: keep the JSON file.
10. **What the plugin and the admins learn.** _Chosen:_ the feed stays
    protocol 1; admins are notified of every delegated acceptance.
    Alternatives: an `invitedBy` attribute (protocol 2), or no notification.
11. **A cap on people joining by invitation** (after review 3). _Chosen:_ the
    administrator's per installation, 1–500, default 50 — joined and not
    removed, plus open; and the grant reserve. Alternative: none.
12. **Where the inviter invites** (after review B2). _Chosen:_ a Lamaste page
    on the domain's sign-in host that the plugin links to. Alternative: the
    plugin's own pages call Lamaste's endpoint (the approved tree would act
    with the inviter's full authority).

## Review (2026-10-28)

An independent review of the first draft against the code; every finding
folded in above.

| #   | Severity   | Finding                                                                                                                 | Resolution                                                                                                     |
| --- | ---------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| B1  | blocker    | An invitee's chosen username could inherit grants made under it for "a user still to come", site lists, desktop grants. | §7 step 3: refused when anything names it; checked under the users lock; Gatekeeper `principals/user/inspect`. |
| B2  | blocker    | The plugin's shell shares the endpoint's origin: it could invite silently and pass the link to its half.                | D12: the page and API on `auth.<domain>`; the plugin only links.                                               |
| 3   | should-fix | Accounts multiply without bound and can exhaust Gatekeeper's 1000 grants.                                               | D11 `maxJoined`, the grant reserve, `disable-invitees`.                                                        |
| 4   | should-fix | The relay assertion accepts only `isUserSurfaceUrl` targets.                                                            | A target kind of its own; user surfaces unchanged.                                                             |
| 5   | should-fix | A route pair in `userSurfacePlugin` has no body parser and would shadow agent halves' `/admin/invitations`.             | Moot: no route on the plugin's host; the inviter context has its own parser and 8 KiB limit.                   |
| 6   | should-fix | `accepting` had no recovery; `persisted: false` ignored; no lock across the checks.                                     | §6 the invitations lock; §7 claim with username, recovery, `persisted` a failure.                              |
| 7   | should-fix | The repair could undo an administrator (`setEntitlement` replaces).                                                     | Repair only creates what is missing, per step, for 24 h.                                                       |
| 8   | should-fix | Erased rows hold no username.                                                                                           | "Erased" dropped from the rule (their principal is cleared at erasure).                                        |
| 9   | should-fix | Surface removed/recreated/not restricted, e-mail domain removed, lifetime shortened — no sweep.                         | `site_id` recorded; the sweeps and reasons of §2 and §8.                                                       |
| 10  | should-fix | The public accept: username oracle, bcrypt per attempt, only the global limit.                                          | Failed-attempt lock, hash after checks, one answer, rate limits.                                               |
| 11  | should-fix | The invitation page: CDN script without SRI, no CSP; `invitedBy` username; tokens accepted under any domain's brand.    | Server-rendered QR, CSP, display name only, `auth.<its domain>` only.                                          |
| 12  | note       | The import: idempotent, whenever the file exists; `purgeInvitations`; `accepted_user_id`.                               | §4.                                                                                                            |
| 13  | note       | Display name, unverified e-mail, nulled copies, TOTP on step-5 failure, hourly rate from the table, 4.8 relays.         | §1, §7, §2.                                                                                                    |

## Second review (2026-10-28)

An independent review of the revised §5–§7 against the code; every finding
folded in above.

| #    | Severity   | Finding                                                                                                                                                                                                                                | Resolution                                                                                                                                |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | blocker    | A crash or failed reconcile after the users.yml write lets the reconcile adopt the invitee with the default domains — `member` on a one-domain relay.                                                                                  | The reconcile takes an open invitation's memberships for its username; a `directory` warning is a step-4 failure.                         |
| 2.2  | should-fix | Recovery by timing could reopen a link an acceptance still queued would use, or credit another user created under the name.                                                                                                            | `claim_id`, checked under the users lock; recovery by `invitation_id` on the directory row; `changeUsers` honours claims; a unique index. |
| 2.3  | should-fix | Lock order unstated; the invitations lock could deadlock with tunnel/sites/domains locks and the audience chain.                                                                                                                       | §6: a total order, the invitations lock a leaf, sweeps after a recomputation queued.                                                      |
| 2.4  | should-fix | After step 2 a revocation could not stop the grants; the repair could recreate a role an admin removed.                                                                                                                                | `revoke_pending_reason`; preconditions inside the users lock before each grant; the repair reads the audit.                               |
| 2.5  | should-fix | `request.host` follows a client's `X-Forwarded-Host`. (Its second half, that `location /api/invite` also caught `/api/invitations*`, was **wrong**: `/api/invite` is no prefix of `/api/invitations`, and no such 4.8 defect existed.) | Literal `Host`, `X-Forwarded-Host` cleared, `request.headers.host`; `/api/invite/` kept, with no claim of a bug.                          |
| 2.6  | should-fix | A hashed CSP goes stale on a brand change; `frame-ancestors` cannot be a meta tag; `no-referrer` makes a same-origin POST send `Origin: null`.                                                                                         | Brand values only in `/brand.css`, one hash pair per release, in nginx's header; `Referrer-Policy: same-origin`.                          |
| 2.7  | note       | Gatekeeper's session cache; `X-Original-Method: GET`; asking Authelia about the portal.                                                                                                                                                | Cache bypassed; noted; spec 53 covers the portal and `rd`.                                                                                |
| 2.8  | note       | The opener handle.                                                                                                                                                                                                                     | COOP and `X-Frame-Options` on both pages; `rd` from origin + path.                                                                        |
| 2.9  | note       | Cookie tossing from a same-site host.                                                                                                                                                                                                  | `presentedSession`'s 401 (a loop, not a wrong user), explained on the page.                                                               |
| 2.10 | note       | The token in nginx's access logs.                                                                                                                                                                                                      | The link's token in its fragment; lookup and accept by POST body.                                                                         |
| 2.11 | note       | A step-3 refusal must release the claim at once.                                                                                                                                                                                       | It does, and counts a failed attempt.                                                                                                     |

## Code review (2026-11-02)

Three independent reviews of the built code. Tests are in
`packages/server/daemon/test/delegated-invitations-review.test.js` unless
named; each fails with its fix taken out.

| #   | Severity | Finding                                                                                                                                                                                                | Resolution                                                                                                                                                                          | Test                                                                       |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | high     | `releaseClaim` wiped a mark: an administrator's or inviter's revocation during an acceptance was undone, and the link worked again (run against the real functions, on an invitation naming `admins`). | A marked row ends `revoked` in the same statement, through the stale path too; `revoke_pending_by` keeps its author.                                                                | "1 — …" (three)                                                            |
| 2   | high     | A row could end `revoked` with live grants or, for an administrator's, its groups; admins were told it "reaches nothing"; a false `invitation.accepted`.                                               | Any row ending `revoked` with an account has that account disabled, retried on the tick; the answer is `410 invitation_revoked`; audit and notification say what happened.          | "2 — …" (four)                                                             |
| 3   | medium   | Audit: none for a revocation at the claim, `attempts_exhausted`, the admin's `deleted` or `marked`; a duplicate for an inviter's mark; a false one from a stale snapshot.                              | One entry per transition, from the row as recorded; `invitation.revoke.marked`, `invitation.deleted`, `invitation.account.disabled`, `invitation.import.refused`.                   | "3 — …" (six)                                                              |
| 4   | high     | A branded domain kept its 4.8 invitation page under 4.9's CSP hashes: blocked by the browser until the brand was edited (availability; fails closed).                                                  | `rendered.json` records `pagesDigest`; the reconcile renders again when it differs or is absent.                                                                                    | `auth-branding.test.js` "a rendering from before its pages were recorded…" |
| 5   | medium   | An inviter whose site grant was revoked kept inviting, and could reinstate themselves.                                                                                                                 | Gatekeeper's inviter route requires the plugin-owned site's grant; an acceptance checks it before its claim (`inviter_unentitled`). A sweep cannot: the invitations lock is a leaf. | "5 — …" (two); Gatekeeper `authz-delegated-invitations.test.js`            |
| 6   | medium   | A Gatekeeper outage at the site step looked like a lost answer: the repair gave up after one outage.                                                                                                   | The client reports `outcomeUnknown`; only that keeps `site_attempted_at`.                                                                                                           | "6 — …" (two)                                                              |
| 7   | medium   | Revoked rows that made a user were pruned, uncounted by `maxJoined`, and fell out of `disable-invitees`; an admin's `DELETE` dropped accepted rows.                                                    | Never pruned; `joined` counts by a live `accepted_user_id`; `DELETE` answers 409 `invitation_has_user`.                                                                             | "7 — …"                                                                    |
| 8   | medium   | A restart before TOTP, or a failed write, stranded the invitee silently.                                                                                                                               | `totp_issued_at`; the admins are told to reset it.                                                                                                                                  | "8, 19 — …", "8 — …"                                                       |
| 9   | low      | Erasure left other rows with the address, and an `accepting` row.                                                                                                                                      | Purged by address and by `invitation_id`; recovery skips an erased user.                                                                                                            | "9 — …" (two)                                                              |
| 10  | low      | A disabled plugin kept taking invitations and joiners.                                                                                                                                                 | `plugin_disabled`: unavailable, and a reason that may pass again.                                                                                                                   | "10 — …"                                                                   |
| 11  | low      | An update that reverted had already revoked open invitations.                                                                                                                                          | While an operation runs on the plugin nothing is revoked.                                                                                                                           | "11 — …"                                                                   |
| 12  | low      | A restored `invitations.json` revived deleted rows; `accepted_user_id` could name a later holder.                                                                                                      | One-shot marker; a later file deleted unread, audited; the holder by acceptance time.                                                                                               | "12 — …" (two)                                                             |
| 13  | low      | A role removed mid-acceptance threw past the precondition: accepted with nothing.                                                                                                                      | With a precondition the roles are checked after it: `role_undeclared`.                                                                                                              | "13 — …"                                                                   |
| 14  | low      | Comment and sweep disagreed on when an inviter's standing stops counting.                                                                                                                              | It counts until the invitation is accepted; the acceptance's precondition reads it too; only the repair ignores it.                                                                 | "14 — …"                                                                   |
| 15  | low      | A name deleted and recreated between lookup and grant would give the new holder the role (suspicion).                                                                                                  | The precondition compares the username's current holder.                                                                                                                            | "15 — …"                                                                   |
| 16  | low      | The host rule was bypassable on `:9292` (`server_name _`, `Host $host`).                                                                                                                               | The panel and IP vhosts write `Host 127.0.0.1` on `/api/invite/`.                                                                                                                   | `nginx-vhosts.test.js`, `ip-panel-vhost.test.js`                           |
| 17  | low      | Lists had no bound: about 65,000 rows for one inviter.                                                                                                                                                 | The inviter's view: the newest 200. `GET /api/invitations`: `limit` (500, at most 2000), `truncated`, shown by panel and CLI.                                                       | "17 — …"                                                                   |
| 18  | low      | The repair read the newest 200 audit rows and only entitlement actions.                                                                                                                                | By `userId` in SQL; proxied site-grant changes are not audited, so it reads Gatekeeper's grants and stops when they differ from what it made.                                       | "18 — …"                                                                   |
| 19  | low      | A failed TOTP write logged the command line, with the username.                                                                                                                                        | `exitCode` and the invitation's id.                                                                                                                                                 | "8, 19 — …"                                                                |
| 20  | low      | One client's invitees could exhaust the relay's grant table.                                                                                                                                           | `PUT invitation-policy` warns when the enabled policies' `maxJoined × 2` exceeds the free grants.                                                                                   | "20 — …"                                                                   |
| 21  | low      | The page said usernames run to 64 characters; the schema's cap is 32.                                                                                                                                  | The constants.                                                                                                                                                                      | core `auth-branding.test.js`                                               |
| 22  | note     | This design's lock order was wrong (the code takes users before domains); "recovery at start".                                                                                                         | §6 corrected; the tick runs at start.                                                                                                                                               | —                                                                          |
| 23  | note     | `location /api/invite` was said to catch `/api/invitations*`: false.                                                                                                                                   | Removed from the docs, comments and tests; row 2.5 records it.                                                                                                                      | —                                                                          |

**Kept as a residual** (security-model.md 5g): an inviter or link holder can
learn whether a username is taken, across the relay's clients, within the
attempt limits.

**A lowered cap** revokes nothing: open invitations stay and acceptance does
not recheck it, so `joined` can pass a lowered `maxJoined` by what was open.
