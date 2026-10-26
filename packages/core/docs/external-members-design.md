# External Members of a Domain — Design Document

> **Status:** agreed 2026-10-26 (all ten decisions as recommended; Redis left for a later, separate design).
> **Base:** the multi-domain relay (`multi-domain-relay-design.md`, Lamaste 4.7.0, PR lamalibre/lamaste#1, not merged).
> **Pilot:** corral (`corral.codelama.com.tr`): the client's people are external members of `codelama.com.tr`.
> **Companions:** `herd/docs/r730-workload-plan.md` §15.2a (scope), §15.2 (delegated invitations, which come after this),
> `identity-directory-design.md`, `gatekeeper-design.md`.

## Goal

A domain membership has a **kind**: `member` or `external`.

- A **member** reaches what 4.7 gives a member: every `authenticated` host
  and OIDC client of the domain, and `restricted` ones by grant.
- An **external** member reaches only what names them (or a Lamaste group
  they belong to) explicitly:
  - `restricted` tunnels, plugin user surfaces and web surfaces, with a
    Gatekeeper grant;
  - static sites whose `allowedUsers` names them;
  - a web surface's shell only when granted (the shell is the web surface's
    static front, `/authz/user-surface-shell`);
  - OIDC clients granted to them.
- External members never join an **Authelia** group (`admins`, `feria-*`);
  **Lamaste groups** (Gatekeeper's) in grants still apply to them.
- External members count toward a plugin's audience when entitled.
- Enforced in Authelia's rendered configuration **and** in Gatekeeper
  wherever Gatekeeper is in the path.
- An invitation names the membership kind.
- Changing an external member's membership or grants does not sign anyone
  out.

## What exists in 4.7

| Piece                     | 4.7                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Membership                | `domain_members (domain, user_id, added_at, added_by, seq)` (state.db `0016`). No kind.                                                                                                                                                                                                                                                            |
| Authelia `access_control` | `renderAccessControl` (core `server/authelia.ts`): per protected static site — `allowedUsers ∩ members` as `user:` subjects, `[group:admins, user:<m>]` per member, deny; per domain — members as `user:` subjects on `[d, *.d]`, deny; `default_policy: deny`.                                                                                    |
| OIDC                      | `renderOidcAuthorizationPolicies`: one policy per domain and factor, members as `user:` subjects; a user-facing client points at its domain's policy.                                                                                                                                                                                              |
| Rendering                 | serverd `lib/domains.js` `syncDomainAccess` under `withDomainRendering`: projection `domains.json` `{v:1, domains:[{name, members}]}`, then `updateDomainAccess` (cookies, `access_control`, OIDC policies) through `rewriteAutheliaConfig`, which **restarts Authelia** whenever the section changed.                                             |
| Users file                | `changeUsers` (serverd `lib/directory.js`) writes `users.yml`, renders the domains, and **restarts Authelia** (its file backend has no `watch`: Authelia reads `users.yml` only at start). Authelia's own password reset writes the file from what it read at start, so a panel write can be lost (`expect` re-applies it).                        |
| Gatekeeper                | `authenticatedSession` → Authelia, then `checkDomain` against the projection (member or refusal page), then the access mode: `public`/`authenticated` allow, `restricted` checks grants. User surfaces and the web-surface shell the same. `setAutheliaHeaders` passes `Remote-Groups` through; plugin tunnels sign them into the relay assertion. |
| Audience                  | entitled (Gatekeeper `plugin` grants, Lamaste groups expanded) ∩ members of the plugin's domain (`lib/audience.js`).                                                                                                                                                                                                                               |
| Sessions                  | Authelia's session store is **in memory** (no Redis). A restart ends every session on every domain — residual risk **R3**.                                                                                                                                                                                                                         |

So today **every** membership change, user creation, deletion, disable and
password-unrelated `users.yml` edit restarts Authelia and signs everyone out.
With a client's people invited and revoked often (and by delegated
invitations later), that is the cost this design removes.

## Authelia facts this design rests on (4.39.28, read from the source)

Checked against `github.com/authelia/authelia` tag `v4.39.28`:

1. **Users-file watch.** `authentication_backend.file.watch: true` starts a
   watcher on the file's directory (`internal/service/file_watcher.go`); a
   `Write` or `Create` event on `users.yml` — an atomic rename into place is
   a `Create` — reloads the in-memory database (`FileUserProvider.Reload`).
   A reload within 0.5 s of the previous one (or of Authelia's own save) is
   **skipped** (`ErrWatcherCooldown`), not queued.
2. **Fresh groups on every request.** With `watch` and no explicit
   `refresh_interval`, the refresh interval becomes `always`
   (`validator/authentication.go`): every forward-auth request
   (`handleSessionValidateRefresh`) re-reads the user's details from the
   in-memory database; a user who is gone or `disabled` invalidates the
   session. So a `users.yml` change applies to existing sessions at their
   next request, without a restart.
3. **OIDC authorization-code reads fresh groups too — the device-code
   flow does not.** The authorization-code handlers call the same refresh
   before evaluating the client's authorization policy against
   `userSession.Groups` (`handler_oauth2_authorization_consent_core.go`).
   The device-code handlers (`handler_oauth2_device_authorization.go`, the
   consent POST in `handler_oauth2_consent.go`) evaluate the groups the
   session last refreshed (found by the security review, S1; residual R5).
4. **Group subjects from a hostname.** An `access_control` rule's
   `domain_regex` with a named group `(?P<Group>…)` matches only when the
   captured text is one of the user's groups (`RegexpGroupStringSubjectMatcher`,
   case-insensitive); a rule may carry `subject` too (all conditions ANDed,
   `AccessControlRule.IsMatch`).
5. **The standard `groups` OIDC claim cannot be redefined or filtered**
   (`validateOIDCScopes` refuses a custom definition of a standard scope or
   claim): an OIDC client that asks for `groups` receives every group the
   user has.
6. Sessions are in memory unless `session.redis` is configured.

## Design

### The idea: who is named lives in `users.yml`, the rules stay still

4.7 writes _who_ into `configuration.yml` (`user:` subjects), so every change
of who restarts Authelia. This design writes **who into `users.yml`** as
groups Lamaste owns, and **rules that name those groups into
`configuration.yml`**. With the users file watched (fact 1) and refreshed on
every request (facts 2, 3), a membership, kind, grant or `allowedUsers`
change becomes a `users.yml` write: Authelia reloads it in place and applies
it at each user's next request. `configuration.yml` changes — and Authelia
restarts — only when the **structure** changes: a domain added, activated or
removed; a static site protected, unprotected, created or removed; the set
of OIDC clients or a plugin's domain.

The same switch removes the restart from every other `users.yml` change
(user created, invited, deleted, disabled, groups changed) for members too,
and makes Authelia's own password-reset write follow the file (fact 1) —
narrowing the lost-write window `changeUsers`' `expect` exists for.

### Groups Lamaste owns

Rendered by the panel into each user's `groups` in `users.yml`, beside the
groups an admin assigns:

| Group                     | Holds                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `lamaste:m:<key>`         | active members (kind `member`) of the active domain whose group key is `<key>`            |
| `lamaste:x:<key>`         | active external members of that domain                                                    |
| `lamaste:s:<site id>`     | the listed users (`allowedUsers`) of a protected static site who are people of its domain |
| `<fqdn>` (a hostname)     | **host group**: the external members granted a Gatekeeper-gated restricted host — below   |
| `lamaste:oidc@<clientId>` | active external members of the client's domain with a grant on the client (OIDC, below)   |

The **group key** is 16 random hex characters on the domain record
(`domains.group_key`, state.db `0018`): a group names no domain, so a
relying party that asks for the `groups` claim learns no tenant's name
(security review, decision 8 as revised). A site group is named by the
site's id for the same reason (replacing 4.7's `user:` subjects, editing
`allowedUsers` no longer restarts Authelia).

Host group `<fqdn>` — a **Gatekeeper-gated restricted host**: an enabled
`restricted` app or plugin tunnel (a tunnel without an access mode is
restricted, as Gatekeeper reads it), a `restricted` tunnel bound as a user
surface, a `restricted` web surface: the **external** members of its domain
who hold a grant on it (direct, or through a Lamaste group) — decision 3.
Members do not need it: the domain rule admits them and Gatekeeper checks
their grants, as in 4.7. Only these must be hostnames: Authelia's
`(?P<Group>…)` capture compares a host's name with the user's groups.

`:` never occurs in a hostname, and a host group is always a hostname under
a relay domain, so no Lamaste group can be mistaken for a host or the other
way round.

**Reserved names.** Groups an admin assigns (users API, invitations, the
panel's editor) must match `^[A-Za-z0-9_-]{1,64}$` (`admins`, `feria-admins`
fit); a name with `.`, `:` or `@` is refused (400 `reserved_group`). The
render owns every group that starts with `lamaste:` or is a hostname under a
relay domain (any domain record, pending included, and every domain removed
from the relay — `retired_domains`, state.db `0018`), compared folded as
Authelia compares groups (NFKC, then lower case: Go's `EqualFold` takes `ſ`
for `s` and the Kelvin sign for `k`): it adds what is desired and removes
the rest, so a stray or look-alike host group cannot survive a render.
Groups outside both stay as they are (an older admin group with a dot is
left alone, but cannot be newly assigned).

Lamaste-owned groups are **never shown** as groups (users list, user
editor, `/api/identity/users`, `/api/identity/self`): the user's domains
with their kinds are shown instead. Gatekeeper strips them from
`Remote-Groups` and from a plugin tunnel's relay assertion
(`groups`); they reach only Authelia — and, unavoidably, an OIDC client that
asks for the `groups` claim (fact 5; residual R4).

### `access_control`

`renderGroupAccessControl(domains, sites)` — `domains` are
`{ name, groupKey }` (no usernames: the rules name groups); `m(d)` /
`x(d)` below are `lamaste:m:<key of d>` / `lamaste:x:<key of d>`:

1. **Per protected static site** (domain `d`):
   - `allowedUsers` set: `subject: group:lamaste:s:<site id>`, `two_factor`
     (a site listing users without an id gets none: admins only);
   - `subject: [[group:admins, group:m(d)]]`, `two_factor`
     (an admin who is a member — never external, below);
   - `deny`.
2. **Per domain `d`**, in this order:
   - the sign-in portal: `domain: [auth.d]`, `subject: [group:m(d),
group:x(d)]`, `two_factor` — nginx never asks Authelia about the portal for
     a resource but the desktop's `/api/user-access/authorize`, which refuses
     external members itself; Gatekeeper asks it to learn who a refusal was
     for (below);
   - members: `domain: [d, '*.d']`, `subject: group:m(d)`, `two_factor`;
   - external members on hosts that name them:
     `domain_regex: '^(?P<Group>(?:[a-z0-9-]+\.)+<d quoted>)$'`,
     `subject: group:x(d)`, `two_factor` — admitted only on a host whose
     name is one of their groups (fact 4), and only while they are an
     external member of `d`. The apex is not matched: it is never a
     Gatekeeper-gated host;
   - `domain: [d, '*.d']`, `deny`.
3. `default_policy: deny` (unchanged).

Every rule above is fixed for a given set of domains and protected sites:
memberships, kinds, grants and `allowedUsers` never change it. A static
site's rules come first and end with `deny`, so the external rule never
reaches a static site's host — `allowedUsers` alone decides there, as the
plan asks.

**Restricted hosts appear nowhere in the configuration**: a tunnel created,
deleted or switched between `authenticated` and `restricted` changes only
which host groups the panel renders. A new `authenticated` tunnel is closed
to external members from its first request (no host group, the member rule
does not match them, deny) — fail closed by construction.

### OIDC: per-client grants and policies

- **Grant.** A Gatekeeper grant with `resourceType: 'oidc-client'`,
  `resourceId: <client id>`, principal a user or a Lamaste group — the grant
  model and API Gatekeeper already has (validated by the panel: the client
  exists and is user-facing). Gatekeeper is not in the OIDC path; it only
  stores the grant. The panel expands it (Lamaste groups too, as
  `lib/audience.js` does) into `lamaste:oidc@<clientId>` for the external
  members of the client's domain.
- **Policy per user-facing client** (replacing 4.7's per-domain policies),
  named `lamaste_client_<client id>` (ids are `[a-z0-9-]`, no dot for
  Authelia's loader to split on):

  ```yaml
  authorization_policies:
    lamaste_client_feria-cli:
      default_policy: deny
      rules:
        - policy: two_factor # the client's declared factor
          subject: 'group:lamaste:m:<key of codelama.com.tr>'
        - policy: two_factor
          subject: [['group:lamaste:x:<key of codelama.com.tr>', 'group:lamaste:oidc@feria-cli']]
  ```

  Members of the client's domain are admitted as in 4.7; external members
  only with the grant. The policy changes only with the client set or a
  plugin's domain; a grant is a `users.yml` change, applied at the user's
  next authorization (fact 3 — the authorization-code path; the
  device-code path reads the session's groups as they were, so a narrowing
  that reaches a device-code client restarts Authelia: security review S1).
  Pure `client_credentials` clients keep `one_factor` (unchanged).

- **Tokens already issued** survive a revocation until they expire. Plugin
  clients get no refresh tokens (4.7, R1), so the bound is the access and ID
  token lifespan: Authelia's default is one hour; decision 6 proposes
  15 minutes for user-facing clients. Registry tokens Feria minted from a
  login are revoked by Lamaste when the grant behind them ends (below).

### Gatekeeper

- **Projection v2** (`domains.json`):
  `{ "v": 2, "domains": [{ "name": "…", "members": ["…"], "externals": ["…"] }] }`.
  An unknown version is a missing projection: every check refuses (fail
  closed, as 4.7). Panel and Gatekeeper ship together (one release).
- `checkDomain` returns the kind. When Authelia refuses a signed-in
  session (its 403 names nobody), Gatekeeper asks Authelia once more about
  the same session for `https://auth.<d>/` (the portal rule admits the
  domain's members and external members): an external member is then told
  they are not granted (the access-request page, or `forbidden`), anyone
  else gets the domain refusal. Never cached, and the request stays
  refused. Then, on every route:
  - **tunnel** — `public` hosts are not gated; `authenticated`: a member
    passes, an external member is refused with the **access-request page**
    (403, "ask the administrator for access" — they are on the domain, only
    not granted), logged `external_not_granted`; `restricted`: grants, as
    today, for both kinds.
  - **user surface** — `authenticated`: external → 403 JSON `forbidden`
    (`X-Lamalibre-Refusal: forbidden`); `restricted`: the host's grant.
  - **web-surface shell** — `authenticated`: external → access-request
    page; `restricted`: audience + `site` grant (unchanged).
- `Remote-Groups` and the plugin-tunnel assertion's `groups` drop
  Lamaste-owned groups (core `isLamasteOwnedGroup`).
- Session cache: unchanged (keyed by session and host, busted on every
  change the panel makes).

Authelia and Gatekeeper each refuse an external member on an
`authenticated` host on their own: Authelia because no rule admits them
(no host group), Gatekeeper because the projection says `external`. On a
`restricted` host both check the grant: Authelia through the host group,
Gatekeeper from its database.

### The directory

`state.db` migration `0017_membership_kind.sql`:

```sql
ALTER TABLE domain_members ADD COLUMN kind TEXT NOT NULL DEFAULT 'member'
  CHECK (kind IN ('member', 'external'));
```

- Existing memberships stay `member` (no change of behaviour).
- A kind change is an update; a trigger stamps `seq` on it (as on insert),
  audited `directory.membership.changed` `{ domain, userId, from, to }`.
  `directory.membership.added` gains `kind`.
- **Authelia groups and external members** (decision 4): a user who is an
  external member of any domain holds no Authelia group. `PUT /api/users/:u`
  adding a group to such a user, or making a user with groups external
  anywhere, is refused (409 `external_member_groups`); an invitation naming
  both groups and an external membership is refused (400). The admin removes
  the groups first.
- **Disable / delete** as in 4.7 (disable keeps memberships and their kinds;
  delete removes them).
- **New users** on a one-domain relay join it as `member` (4.7, decision 1);
  an invitation or user creation may name `external` explicitly.

### Rendering — one writer, two files

`withDomainRendering` stays the one writer. `syncDomainAccess` becomes:

1. read domains (with their group keys), memberships with kinds, protected
   sites, Gatekeeper-gated restricted hosts, the grants on them and on OIDC
   clients (Gatekeeper's API, Lamaste groups expanded); when the grants
   cannot be read, external members hold no granted host or client group
   (fail closed) and the step counts as failed (audited, notified);
2. write **`users.yml`'s Lamaste-owned groups** (one file lock, compare
   first — `renderOwnedGroups`, pure, in core);
3. write the projection;
4. write `configuration.yml` (cookies, `access_control`) — compare first;
   restart only when it changed (structural); the OIDC provider follows in
   `syncOidcClients`, after the domains at start too;
5. restart Authelia when it must read `users.yml` anew: its configuration
   does not have it hold the file as Lamaste needs (watch, refresh always,
   its own password writes off) and the file changed; or a narrowing
   reached a device-code OIDC client (security review S1).

Then, outside the lock, every enabled user who lost an owned group since
the last complete rendering — whatever narrowed them, a revocation with
Gatekeeper's own CLI included — is audited (`directory.access.narrowed`,
by id and a count) and loses the registry tokens the registry's sign-in
would refuse now.

**Order.** `users.yml` is always written before the configuration: a new
site rule or policy names a group that is already filled, and a revoked
group is empty before any rule could matter (a removed site's group goes
first too: its rule then denies everyone until it goes).

**The reload cooldown** (fact 1). A write that lands within 0.5 s of the
previous reload is skipped by Authelia, silently. So `users.yml` writes are
serialized under one file lock and each is **followed by a touch** once
0.6 s have passed (`touchUsersFile`: read again, the owned groups applied
again, written), guaranteeing a reload after the cooldown with Lamaste's
groups even if something else wrote the file meanwhile; the identity tick
and the start touch it too. Authelia's own writes of the file (password
change and reset) are disabled. A write never drops a user it was not told
to delete, never adds owned groups to a user the last rendering did not
know (created since, perhaps under a deleted user's username), and only
narrows after a rendering failed.

**Triggers.** Every membership, kind, user, site, tunnel, user-surface,
web-surface and plugin-domain change already renders; additionally every
grant or Lamaste-group write the panel proxies to Gatekeeper
(`/api/gatekeeper/*`, entitlements) renders afterwards, and the identity
tick (every minute) renders — which catches grants made with Gatekeeper's
own CLI on the relay (Gatekeeper enforces them at once; Authelia's host
group follows within a minute).

**Revocations.** A user narrowed loses their registry tokens when none of
the registry's own sign-in clients — the user-facing clients whose audience
is the registry — admits them any more: as a member of the client's domain,
or as an external member granted it. No such client, or one that cannot be
read, is "no" (fail closed).

### What ends when a member is made external

Their `lamaste:m:<key>` group becomes `lamaste:x:<key>` in one write:
at their next request Authelia admits them only on hosts naming them, and
Gatekeeper (projection, session cache busted) refuses `authenticated` hosts
— within nginx's 10 s authorization cache (`AUTHZ_SUCCESS_MAX_AGE_SECONDS`,
plugin tunnels and user surfaces are never cached). Their Authelia groups
must have been removed first (decision 4). OIDC: their next authorization is
refused (a device-code client of the domain: Authelia restarts so no
session keeps the group it last read); issued access tokens live out their
15-minute lifespan. Desktop user access (primary domain only) checks the
kind at every request.

### Audience

Unchanged rule: entitled ∩ (members ∪ external members) of the plugin's
domain. Whether the plugin is told the kind is decision 7.

### Invitations

`domains` entries name a kind (decision 2):
`domains: [{ "name": "codelama.com.tr", "kind": "external" }]`. Accepting
adds the memberships with their kinds in the same `changeUsers`. The
invitation list shows the kinds. A delegated invitation (§15.2, later) will
only be able to create `external` memberships.

### API, panel, desktop, CLI

- `GET /api/domains/:name/members` adds `kind`; `PUT
/api/domains/:name/members/:user` takes `{ kind }` (default `member`;
  re-putting with another kind changes it); `GET /api/users` and
  `PUT /api/users/:username` carry `domains: [{ name, kind }]`;
  `GET /api/domains` counts members and external members.
- `POST /api/gatekeeper/grants` accepts `resourceType: 'oidc-client'`
  (validated by the panel); `GET /api/plugins/:name/oidc-clients` lists each
  user-facing client's grants.
- **Panel**: an "External" badge on Users, on the domain's member list and
  on invitations; the membership editor picks the kind per domain; the
  Authelia group editor is disabled for external users with the reason; the
  plugin card's OIDC clients section grants and revokes; the People panel
  marks external audience members.
- **AdminClient** (enforced at build time): membership methods take/return
  `kind`; `getOidcClientGrants`, `grantOidcClient`, `revokeOidcClientGrant`;
  web client, desktop client and `admin_*` Tauri commands.
- **CLI** `lamaste-server`: `domains members <d> add <user> [--external]`,
  `domains members <d> kind <user> member|external`, the kind in
  `users list`/`domains members` output, `plugins oidc-clients <name>
grants|grant|revoke <clientId> --user <u>|--group <g>`.

### Upgrade in place

1. Migrations 0017 (every membership `member`) and 0018 (a group key per
   domain, `retired_domains`); Gatekeeper 0004 (access grants never
   consumed).
2. First start after the upgrade renders the domains before the OIDC
   clients: `users.yml` gains each member's `lamaste:m:<key>`, then
   `configuration.yml` the users-file settings and the group-based rules —
   **one** restart (sessions end once, at the update, as every update does
   today); the projection becomes v2.
3. create-lamaste's redeploy keeps `users.yml` writable by Authelia's account
   and the panel (0660 `lamaste:lamaste-authelia`, the directory 2770) — the
   watcher needs nothing more.
4. A relay with no external members behaves exactly as 4.7 (same people
   reach the same hosts), minus the restarts.

## Security notes

- Two independent gates, one source: the panel renders both from `state.db`
  (and Gatekeeper's grants). Authelia: host groups, member/external groups,
  `default_policy: deny`. Gatekeeper: the projection's kind and its own
  grants.
- **Fail closed everywhere new**: a host with no host group refuses external
  members; an unknown projection version refuses everyone; a skipped reload
  is re-triggered; a render failure is audited and notified (4.7, S4).
- `users.yml` becomes security-relevant for _access_, not only credentials:
  it was already (Authelia groups, `admins`). Who may write it is unchanged
  (the panel and Authelia's account).
- **R3 narrowed**: no membership, kind, grant, user or `allowedUsers` change
  restarts Authelia — but for a narrowing that reaches a device-code OIDC
  client (R5). A restart (all sessions end) remains for structural changes
  — a domain added/activated/removed, a static site
  protected/unprotected/created/removed, the OIDC client set or a plugin's
  domain changed — all admin actions, none per person. Redis sessions,
  which would remove it, are a later, separate design.
- **R4 (narrowed by the review)**: an OIDC client that asks for `groups`
  (Feria's `feria login`) sees the user's Lamaste-owned groups. Member,
  external and site groups are opaque (random keys, site ids), so no
  domain's or site's name leaks; what remains is that two users sharing a
  key share a domain, the OIDC client ids granted to an external member,
  and an external member's granted hostnames (on their own domain).
- **R5 (new)**: Authelia's device-code flow checks a client's policy
  against the groups a session last refreshed, never re-reading them
  (`handler_oauth2_device_authorization.go`, `handler_oauth2_consent.go` in
  4.39.28). A narrowing that reaches a device-code client therefore
  restarts Authelia, ending every session on every domain: membership
  ended or made external on a domain serving one, or a grant on one
  revoked. Corral's external members hold no such grant; Code Lama's
  members leave `codelama.com.tr` rarely. To be reported upstream, so the
  flow refreshes like the authorization-code one.
- External members can never hold `admins` (decision 4), so the
  `[group:admins, …member@d]` clause cannot admit one, and Authelia's
  `admins` bypass of static-site lists stays members-only.

## Proof (rodeo)

Written 2026-10-26 in `packages/tools/lamaste-rodeo` (not run yet; each
`.json` generated from its `.sh` with rodeo's `parseBashTest`, Prettier,
`testScriptSchema`-valid; `rodeo.config.json` lists 49–51 after 01 and
single-VM 36 after 03). New three-VM specs on top of
`multi-domain-harness.sh`, which gained `user_kinds`, `domain_group_key`,
`user_groups` / `wait_group` (users.yml read as root, groups only),
`authelia_pid`, `md_kind`, `md_grant`, `wait_status`,
`assert_access_request` and `signed_in`; `tests/e2e/helpers.sh` gained
`AUTHELIA_MEMBER_KEY`, `AUTHELIA_USERS_GROUPS_JSON`, a rules filter that
includes the external `domain_regex` rule, and
`write_oidc_grant_fixture_plugin`.

- **49 — an external member reaches only what names them** (B): the
  external member holds `lamaste:x:<key>` alone; an `authenticated` tunnel →
  access-request page, and still 403 with Gatekeeper's projection held to
  call them a member (Authelia alone refuses); a `restricted` tunnel —
  refused, a direct grant (users.yml gives the hostname group) → through,
  revoked → refused within the settle time, a Lamaste-group grant → through,
  left the group → refused; a protected static site listing the member
  (listing users is structural, so before the baseline) → refused, its list
  edited to name them (`lamaste:s:<site id>`, never the hostname) → through.
  After every change the member's session of before still reaches the
  tunnel and the site, both sessions stay signed in, Authelia's `MainPID`
  never changes.
- **50 — kind changes**: a member on an authenticated tunnel, turned
  external → the same session refused (access-request page), audited
  `directory.membership.changed` by id, users.yml `m` → `x`; turned back →
  through; making a user in `e2e50team` external → 409
  `external_member_groups`; giving it to an external member → 409; a
  hostname-like or `lamaste:` group name → 400 `reserved_group`; users.yml
  holds the member group, `GET /api/users` and the backend's `Remote-Groups`
  (an echo backend) carry `e2e50team` alone; no restart.
- **51 — a plugin's web surface and audience** (the corral case): an
  identity + web-surface fixture moved to B, a member and an external
  member entitled as viewers — both in the audience and the agent half's
  projection with their role; an `authenticated` web surface: the member
  reaches the shell and the API, the entitled external member gets the
  access-request page and 403 `{error: forbidden}`; a `restricted` one:
  refused without the site's grant (the member too), the grant → shell and
  API with their directory id and role, revoked → refused; no restart.
- **single-VM 36 — OIDC by grant**: each client's policy is
  `lamaste_client_<id>` (`m:<key>`, `x:<key>`+`oidc@<id>`); an
  authorization-code client — the member admitted throughout, the external
  member refused, granted → the same session admitted, revoked → refused,
  no restart; a device-code client — revoking the external member's grant
  restarts Authelia (audited `authelia.restarted` `device-code`, new
  `MainPID`) and their session of before is gone.
- **Upgrade (`tests/e2e-upgrade/01`, extended rather than a new spec)**:
  a user signed in on the previous release and admitted to an
  authenticated tunnel; after the Panel Update every membership is `member`,
  the projection is v2 with no external member, Authelia has `watch: true`,
  `refresh_interval: always`, password change and reset off, rules on the
  member group naming no user, every users.yml user holds it, and the user,
  signed in again, is answered as before.
- **Existing specs updated** for groups instead of user subjects: three-VM
  45, 46 (a removal now refuses the same session, no restart), 47 (members'
  groups part of the snapshot), 40 (comments), single-VM 34 and 35 (per-client
  policies), the domain listings' `{name, kind}`.

Not provable without running: Authelia's admission of external members
through the `(?P<Group>…)` capture on a real host; the access-request page
after Gatekeeper's identity probe; timing within rodeo's ten minutes (51
installs and hosts a plugin). The device-code approval itself is not driven
(it needs Authelia's consent UI); 36 proves the mitigation — the restart and
the ended session.

## Waves

1. **Core** — done. Root `owned-groups.ts` (browser-safe): `memberGroup`,
   `externalGroup`, `oidcClientGroup`, `isLamasteOwnedGroup`,
   `ADMIN_GROUP_NAME_RE` / `isAssignableGroupName`, `renderOwnedGroups`
   (throws on a user both member and external of one domain, or a
   non-username — never naming it) and `mergeOwnedGroups` (replaces exactly
   the owned groups, keeps the administrator's in order, unchanged entries
   stay the same objects). Root `domains.ts`: `MembershipKind`,
   `MEMBERSHIP_KINDS`, projection v2 (`parseDomainsProjection` refuses v1,
   unknown versions and a user of both kinds), `DomainsIndex.kinds`,
   `domainMembership` → `{ domain, kind }`. Root `constants.ts`:
   `OIDC_CLIENT_ID_RE`, `OIDC_CLIENT_ID_MAX_LENGTH`, `isOidcClientId` (the
   manifest schema uses them). Server `authelia.ts`:
   `renderGroupAccessControl`, `externalHostRegex`,
   `renderOidcClientPolicies`, `oidcClientPolicyName`,
   `ensureUsersFileWatched` (run by every `rewriteAutheliaConfig`),
   `watch: true` in `writeAutheliaConfig`, and the 15-minute
   `OIDC_USER_LIFESPAN` named by every user-facing client (rendered into
   `lifespans.custom` only when such a client exists). Tests: serverd
   `external-members-core.test.js`; `multi-domain-core` (projection v2),
   `plugin-oidc` (lifespan), `domains` and Gatekeeper fixtures (v2).

   **Deviations, for wave 2:**
   - The new renderers sit **beside** 4.7's `renderAccessControl`,
     `renderOidcAuthorizationPolicies` and `oidcAuthorizationPolicyName`,
     which stay wired: switching before users.yml holds the owned groups
     would deny everyone. Wave 2 switches `updateDomainAccess`,
     `buildOidcProviderSection` and `renderOidcClient`'s
     `authorization_policy` to them and removes the old three (4.7-only
     names: edit `public-api.json` by hand). `renderGroupAccessControl` takes
     the domain names only — the rules name groups, so who is in them does
     not matter (the design's `{ name, hasMembers, hasExternals }` was not
     needed).
   - The projection is already v2 on both sides: the panel writes every
     member as `member` and `externals: []` (lib/domains.js, until kinds
     exist), and Gatekeeper admits only `kind === 'member'` (external
     members are refused everywhere until wave 2 checks the kind per route).
   - The user-facing lifespan applies from this wave on (harmless before
     the switch: shorter tokens only).

2. **serverd + Gatekeeper** — done. state.db `0017_membership_kind.sql`
   (`kind`, a trigger stamping `seq` on a kind change). `lib/domains.js`:
   `MembershipInputSchema` (a name, or `{ name, kind }`),
   `normalizeMemberships` (400 `conflicting_membership`), kinds through
   `listDomainMembers`, `domainsByUser` / `domainsOfUser` (`{ name, kind }`),
   `domainsOverview` (`externalMembers`), `domainsForNewUser`,
   `insertMembershipsSync`, `addDomainMember(…, { kind })` (a kind change
   audited `directory.membership.changed` `{ domain, userId, from, to }`),
   `setUserDomains` (kinds), invitations (`invitationMemberships`; stored
   4.7 strings read as members); `adminGroups` / `adminGroupsOf`,
   `assertAssignableGroups` (400 `reserved_group`; a group the user already
   holds is kept), `externalMemberGroupsError` / `assertNoGroupsForExternal`
   (409 `external_member_groups` — 400 when an invitation or a new user asks
   for both). `syncDomainAccess` renders, under the one writer: users.yml's
   owned groups (`lib/owned-groups.js` `desiredOwnedGroups` → core
   `renderOwnedGroups` → `lib/authelia.js` `writeOwnedGroups`), the
   projection v2, then `updateDomainAccess` (cookies + `renderGroupAccessControl`
   only — compare-first, so a restart only on a structural change or a
   configuration not yet watching users.yml). The OIDC section renders one
   policy per user-facing client (`renderOidcClientPolicies`; clients name
   `lamaste_client_<id>`); 4.7's `renderAccessControl`,
   `renderOidcAuthorizationPolicies`, `oidcAuthorizationPolicyName`,
   `AutheliaDomain` are gone (`public-api.json` edited). `writeAutheliaConfig`
   takes no members; onboarding renders before Authelia first starts.
   `changeUsers` renders and busts Gatekeeper's sessions — it restarts
   nothing (`renderDomains: false` replaces `restartAuthelia: false` for
   onboarding). Every write of users.yml goes through one file lock in
   `lib/authelia.js` (`writeUsers`, `writeOwnedGroups`; `createUser` and
   `createUserFromInvitation` moved there from core's helpers), keeps the
   owned groups the last rendering decided, and is written again
   `USERS_FILE_TOUCH_DELAY_MS` (600 ms) after the last write unless the file
   changed meanwhile. Users and identity APIs show no owned group; the users
   API keeps them across an edit. Gatekeeper proxy: `oidc-client` grants
   checked (`checkOidcClientGrant`: 400 `unknown_oidc_client` /
   `service_oidc_client`), every change re-renders, and the users a revoked
   client grant or a group change reached are checked for registry
   revocation. `revokeRegistryTokensFor` asks `reachesRegistry`: a member of
   a registry domain, or an external member of one granted a user-facing
   client of it (Gatekeeper unreachable: no). `listPluginOidcClients` adds
   `userFacing` and `grants`. Gatekeeper: `checkDomain` returns the kind,
   `externalRefused` on every route (tunnel → access-request page,
   `external_not_granted`; user surface → 403 `forbidden`; shell →
   access-request page), `shownGroups` strips owned groups from
   `Remote-Groups` and the assertion. Tests: serverd
   `external-members.test.js` (kinds, refusals, hidden and kept groups,
   host groups direct and through Lamaste groups, Gatekeeper unreachable,
   tunnel changes, static sites, OIDC grants, registry revocations, the
   touch), Gatekeeper `authz-external-members.test.js` (kind matrix,
   stripping); `domains`, `identity-directory`, `plugin-oidc`,
   `multi-domain-core`, `agent-hosted-plugins` updated (no restart per
   change; groups instead of user subjects).

   **Deviations, for review:**
   - **The owned groups are always written first**, a site's removal too
     (the design said configuration first there). A host group never
     outlives the rule that narrows its host: a static site whose rule went
     while its listed external member kept the host group would be opened to
     them by their domain's external rule. Writing the groups first only
     ever narrows in between.
   - **Tunnel and site changes render on their own**: `lib/state.js`
     `writeTunnels` / `writeSites` call `scheduleHostRender` (100 ms,
     coalesced, only while some domain has external members) — every path
     that changes a restricted host (creation, mode, release on revocation,
     web surfaces) is covered without each route asking.
   - **Gatekeeper unreachable**: the hosts and clients each external member
     holds now are kept (a warning), rather than failing the step — a
     revocation is a Gatekeeper write, so it cannot have happened; a
     membership's own group still comes from state.db.
   - Core `renderOwnedGroups` ignores a listed user or a grant's principal
     who is none of the domain's people (it threw): a typo in a site's list
     or a stale grant must not stop the whole rendering.
   - The users lock moved to `lib/users-lock.js`; a kind change takes it
     before the domains lock (never the other way round), so it and a
     groups edit are serialized. The rendering takes neither: the file lock
     and the owned-group cache keep a concurrent read-modify-write from
     writing an older set back.
   - **Left for wave 3**: every client of the changed shapes — the panel UI
     and desktop show `domains` as objects now (`{ name, kind }`), the CLI
     (`domains members`, `users list`), `AdminClient`'s types
     (`AdminUser.domains`, members' `kind`, `externalMembers`, OIDC client
     `grants`), the API reference (users, domains, invitations, Gatekeeper
     grants with `oidc-client`, registry-and-oidc), CHANGELOG, CLAUDE.md.

3. **UI, desktop, CLI, docs** — done. Core `types.ts`: `DomainMembership`
   / `DomainMembershipInput` (`AdminUser.domains`, `domains` on user
   creation, edits and invitations), `DomainView.externalMembers`,
   `DomainMemberView.kind`, `addDomainMember(name, user, { kind })`,
   `getPluginOidcClients` with `PluginOidcClientView` / `OidcClientGrantView`.
   Web client and desktop client implement them (`admin_add_domain_member`
   takes `kind`, checked before curl — `domain_member_body`, cargo-tested;
   `admin_get_plugin_oidc_clients`). Panel: UI helpers `admin/lib/domains.js`
   (`membershipsOf`, `isExternalAnywhere`, `membershipKind`,
   `withMembership`, `sameMemberships`, `externalUserIds`,
   `EXTERNAL_MEMBER_HINT`; tests), `useMembershipChoice` /
   `DomainMembershipChoice` with a kind per domain (a one-domain relay shows
   one **External member** checkbox and sends `domains` only when it is
   ticked), `ExternalBadge` on users, invitations, domain members and a
   plugin's audience, `DomainChips` marking external memberships; Users'
   `GroupsField` closes for an external member and says to remove groups
   first (the form refuses before asking the panel); the Domains page adds
   members of either kind and switches a kind (**Make external** /
   **Make member**) and counts external members; the plugin card's
   `PluginOidcClients` (**OIDC sign-in**) grants a user-facing client to
   external members of the plugin's domain or Lamaste groups and revokes.
   CLI: `domains members <d> add <user> [--external]`,
   `domains members <d> kind <user> member|external` (pure
   `memberRequest`), kinds in `domains members`, `domains list` and
   `users list` (`membershipsText`), `plugins oidc-clients <name> [grants]`
   with each client's grants, `grant|revoke <clientId> --user|--group`
   (`src/oidc-client-grants.js`); tests. Docs: `04-api-reference/domains.md`
   (kinds, where enforced), `users.md` (no restart, kinds, groups Lamaste
   owns), `registry-and-oidc.md` (per-client policies, client grants, 15-minute
   tokens), `gatekeeper.md` (projection v2, the external-member matrix, OIDC
   client grants), `01-concepts/security-model.md` (R3 narrowed, R4),
   `02-guides/second-domain.md` (External members), and the restart
   wording of `managing-users.md`, `state-management.md`,
   `authentication.md`; CHANGELOG 4.7.0; CLAUDE.md.

   **Deviations, for review:**
   - One new `AdminClient` method, `getPluginOidcClients`: granting and
     revoking go through the existing `createGatekeeperGrant` /
     `revokeGatekeeperGrant` (the panel's proxy checks an `oidc-client`
     grant and re-renders), not dedicated `grantOidcClient` /
     `revokeOidcClientGrant` methods — one grant model, one path.
   - The panel marks an external member of a plugin's audience from the
     users list (their membership of the plugin's domain), not from the
     audience rows, which do not carry the kind (decision 7).
   - The CLI's `revoke` finds the grant through
     `GET /api/plugins/:name/oidc-clients` and revokes it by id; its listing
     now labels a client's OAuth grant types `flows:` (`grants:` is the
     access grants).

4. **Security review** — done (2026-10-26, below): three independent
   reviews, every confirmed finding fixed with a test that fails without
   it; four decided with the user (S1 device code, S2 Authelia's own
   writes, S3 grant sweep, S4 opaque names).
5. **Rodeo** — specs written (Proof above), not yet run.

## Security review (2026-10-26)

Three independent reviews (code, threat model, access-decision matrix) of
`21c092c..551f36a`, each given the code, not the design's conclusions. Each
confirmed finding was fixed with a unit test that fails without the fix.

| #   | Finding                                                                                                                                                                                                                                       | Fix                                                                                                                                                                                                                                                                                                                                                                            | Test                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| S1  | Authelia's device-code flow checks a client's policy against the groups a session last refreshed (fact 3 holds for the authorization-code path only): with no restart, someone narrowed could approve a `feria login` for the session's life. | **Decided: targeted restart.** The rendering measures every narrowing against the last complete rendering; when an enabled user lost a group admitting them to a device-code client (core `reachedOidcClients`), Authelia restarts (audited `authelia.restarted` `device-code`) and Gatekeeper's sessions are busted. Unreadable clients → restart (fail closed). Residual R5. | external-members (made external, grant revoked: restart; web client, host grants: none), external-members-core (reach) |
| S2  | Authelia's own password change/reset writes users.yml from its in-memory copy, which may predate a skipped reload: revoked groups written back, repeatedly by someone changing their password.                                                | **Decided: disabled.** `authentication_backend.password_change.disable` and `password_reset.disable` rendered (they could not work: the notifier is a file) and migrated on every rewrite, with `refresh_interval: always`; `usersFileWatched` requires all four.                                                                                                              | external-members-core (settings, each one required)                                                                    |
| S3  | Gatekeeper created tunnel, site, agent-plugin and OIDC-client grants consumed, and its sweep deleted them 90 days later, silently.                                                                                                            | **Decided: fixed here.** Grants are created unused; the sweep deletes consumed local plugin grants only; Gatekeeper migration 0004 un-consumes the others.                                                                                                                                                                                                                     | gatekeeper grants-retention                                                                                            |
| S4  | The `groups` claim told an OIDC relying party every domain a user belongs to (another tenant's name) and static-site hostnames.                                                                                                               | **Decided: opaque names** (decision 8 revised). `lamaste:m:<key>` / `lamaste:x:<key>`, a random key per domain record (state.db 0018), `lamaste:s:<site id>`; hostname groups only for external members on Gatekeeper-gated hosts.                                                                                                                                             | external-members-core (names, rules name no domain), domains, external-members                                         |
| S5  | Revocations relied on Authelia watching users.yml, unchecked; an explicitly set `refresh_interval` would lag them.                                                                                                                            | The settings are rendered and checked (`autheliaWatchesUsersFile`); a rendering restarts Authelia (`unwatched`) after users.yml changed while it does not hold the file so. Start renders the domains before the OIDC clients (an upgrade's first policies name filled groups).                                                                                                | external-members (unwatched restarts once a change, not otherwise)                                                     |
| S6  | A failed rendering left the owned-groups cache stale; a username deleted and taken again got the deleted user's groups (static sites, OIDC — no Gatekeeper there).                                                                            | A write adds owned groups only to users the rendering knew (`known`), forgets a deleted user's, and only narrows after a failed rendering (`narrowOnly`, core `mergeOwnedGroups` options).                                                                                                                                                                                     | external-members-core (merge options), external-members (reused username, narrow only)                                 |
| S7  | Gatekeeper unreachable: external members kept the host and OIDC groups they held — a revocation Gatekeeper took just before stayed in Authelia (OIDC has no second gate).                                                                     | Fail closed: no granted host or client group until the grants can be read; the membership groups are rendered all the same; the step counts as failed (audited, notified). A grant revoked meanwhile is found lost by the next complete rendering.                                                                                                                             | external-members (unreachable: groups dropped, audited, restored)                                                      |
| S8  | A grant change whose rendering failed answered success with no warning.                                                                                                                                                                       | The proxy answers `warnings` and renders again within 5 s (`scheduleRenderRetry`).                                                                                                                                                                                                                                                                                             | external-members (warnings on a failed rendering)                                                                      |
| S9  | Registry tokens were kept when the user reached any user-facing client of the registry's domain.                                                                                                                                              | Only the registry's own sign-in clients count — user-facing clients whose audience is the registry; none or unreadable → revoked. Revocations follow every narrowing (a revocation with Gatekeeper's own CLI too, found by the tick).                                                                                                                                          | external-members (another client's grant revoked, the CLI revocation), domains                                         |
| S10 | `oidc-client` grants outlived their plugin's uninstall: a later install of the same client id admitted whoever was granted.                                                                                                                   | Uninstall revokes every grant on the plugin's clients (`revokeOidcClientGrants`).                                                                                                                                                                                                                                                                                              | external-members (uninstall)                                                                                           |
| S11 | The touch skipped a file something else had written; a skipped reload or a panel restart within 0.6 s of a write left Authelia on old groups.                                                                                                 | The touch re-applies the owned groups to whatever the file holds and always writes; the start and the identity tick touch too.                                                                                                                                                                                                                                                 | external-members (a hand edit gets the groups back)                                                                    |
| S12 | Ownership compared with JavaScript lower case; Authelia folds with Go's `EqualFold` (`ſ`, Kelvin sign).                                                                                                                                       | `foldGroupName`: NFKC, then lower case.                                                                                                                                                                                                                                                                                                                                        | external-members-core (look-alike spellings owned)                                                                     |
| S13 | Host groups of a removed domain became "admin groups": shown, passed in `Remote-Groups`, blocking a kind change.                                                                                                                              | Removed domains are kept in `retired_domains`; hostnames under them stay owned and are stripped.                                                                                                                                                                                                                                                                               | external-members (retired domain)                                                                                      |
| S14 | The CLI's `revoke` removed only the first of several grants naming the principal.                                                                                                                                                             | `findClientGrants` returns every match; all are revoked.                                                                                                                                                                                                                                                                                                                       | cli oidc-client-grants                                                                                                 |
| S15 | An external member Authelia refused (no host group) got the domain refusal ("not a member") and a user surface `not_a_member`.                                                                                                                | The portal rule admits members and external members on `auth.<d>`; on Authelia's 403 Gatekeeper asks once more for `https://auth.<d>/` and, for an external member, answers the access-request page / `forbidden`. Never cached; the request stays refused. The desktop's `authorize` (the one forward-auth on the portal) refuses external members itself.                    | gatekeeper authz-external-members, authz-domain-membership; external-members-core (portal rule)                        |
| S16 | A web surface moved off a tunnel left the disabled tunnel's grants in the host group.                                                                                                                                                         | `restrictedHosts` skips disabled tunnels (and agent panels).                                                                                                                                                                                                                                                                                                                   | external-members (disabled tunnel)                                                                                     |
| S17 | A tunnel without an access mode (restricted for Gatekeeper) got no host group: the two gates disagreed.                                                                                                                                       | Absent or unknown modes are restricted, as Gatekeeper reads them.                                                                                                                                                                                                                                                                                                              | external-members (mode-less tunnel)                                                                                    |
| S18 | An empty or partial users.yml read could be written back, dropping users.                                                                                                                                                                     | A write re-reads an empty file before believing it and refuses to drop a user it was not told to delete (`deleting`).                                                                                                                                                                                                                                                          | external-members (empty read, undeclared drop)                                                                         |
| S19 | Narrowings made past the panel (Gatekeeper's CLI) were neither audited nor followed; Gatekeeper's secret compared with `!==`.                                                                                                                 | Every narrowing found by a rendering is audited (`directory.access.narrowed`, id and count) and followed (registry, device code); the secret is compared in constant time (`secretMatches`).                                                                                                                                                                                   | external-members (audit), gatekeeper grants-retention (secret)                                                         |
| S20 | Desktop user access (primary domain) admitted external members and kept a member made external signed in.                                                                                                                                     | `authorize`, `exchange` and every session request require a `member` of the primary domain (`isPrimaryMember`).                                                                                                                                                                                                                                                                | external-members (desktop session)                                                                                     |

The apex of a domain is never a Gatekeeper-gated host, so the external
host rule not matching it (a reviewer's note) refuses nothing that exists.

**Residual, documented in `01-concepts/security-model.md`:** R3 narrowed
(structural changes restart; a device-code narrowing too — R5), R4
narrowed (opaque groups; the relation "these users share a domain", client
ids and an external member's granted hostnames remain), R5 (Authelia's
device flow does not refresh groups — to be reported upstream).

## Decisions (agreed 2026-10-26)

The user agreed to every recommendation below; the alternatives are kept for the record.

1. **How membership changes avoid restarts.**
   - **(a) Recommended:** Lamaste-owned groups in `users.yml` with
     `watch: true`; rules in `configuration.yml` name groups (this design).
     Removes the restart from every per-person change, for members too, with
     no new component. Revises 4.7's decision 8 (membership as `user:`
     subjects) before 4.7 is released.
   - (b) Keep `user:` subjects and move Authelia's sessions to **Redis**
     (local unix socket, ACL, ~5–10 MB): restarts no longer sign anyone out,
     but every change still restarts Authelia (a few seconds of refused
     authorizations each time, on every domain), and adds a service to
     install, harden and update.
   - (c) Both: (a) now, Redis later to remove the remaining structural
     restarts. _Recommended as a follow-up_, not in this feature.
2. **Invitation and membership shape.** _Recommended:_
   `domains: [{ name, kind }]` everywhere 4.7 has `domains: string[]`
   (users, invitations, the members API returns objects); a bare string is
   still accepted as `member` on input, so 4.7 clients and specs keep
   working. Alternative: a separate `externalDomains: string[]`.
3. **What the Authelia host group holds for a restricted host.**
   _Recommended:_ external members **with a grant** on it (Authelia enforces
   grants for external members too; a grant made with Gatekeeper's own CLI
   reaches Authelia within a minute). Alternative: every external member of
   the domain on every restricted host (simpler; Authelia then enforces only
   member/external, Gatekeeper alone the grant).
4. **Authelia groups.** _Recommended:_ a user who is external on **any**
   domain holds no Authelia group (relay-wide; groups are relay-wide).
   Alternative: per domain — groups kept, but every rule ANDs them with
   the domain's member group (Authelia) and Gatekeeper ignores them for external
   hosts; leaves `feria-*` reaching Feria through OIDC's `groups` claim for a
   user external on Feria's domain, so not recommended.
5. **OIDC grant model.** _Recommended:_ Gatekeeper grants with
   `resourceType: 'oidc-client'` (one grant model, Lamaste groups apply,
   proxied API exists), one authorization policy per user-facing client.
   Alternative: a panel-side `oidc_client_grants` table (no Lamaste groups).
6. **OIDC token lifespan.** _Recommended:_ 15 minutes for access and ID
   tokens of user-facing plugin clients (a custom lifespan the clients name),
   bounding what survives a revocation; `feria login` exchanges its token at
   once, so it is unaffected. Alternative: keep Authelia's default (1 h) and
   document it.
7. **Does the plugin learn the kind?** _Recommended: no_ in this feature —
   the plugin's roles express what a person may do there, and the identity
   feed stays protocol 1 (4.5 agent halves unchanged). Alternative: an
   optional `membership: 'member'|'external'` attribute in audience changes
   (a manifest opt-in, protocol 2).
8. **R4 — Lamaste-owned groups in the OIDC `groups` claim.** _Recommended:_
   accept and document (readable names, public-anyway hostnames; only
   admin-installed relying parties; Feria matches `feria-*` only).
   Alternative: opaque names (`lamaste:m:<random id>`) for the member and
   external groups — hides which domains, but host groups must stay
   hostnames (fact 4), and the panel and logs get harder to read.
   **Revised 2026-10-26 (security review S4, the user's decision): opaque
   names** — member, external and site groups; hostname groups only for
   external members on Gatekeeper-gated hosts.
9. **User and web surfaces for external members.** _Recommended:_ as the
   plan says — only `restricted` surfaces with the surface's grant; a plugin
   entitlement (role) alone does not admit them to an `authenticated`
   surface. Alternative: an entitlement counts as "naming them" on an
   `authenticated` surface (fewer grants to manage for corral, but a second
   meaning of `authenticated`).
10. **Version.** _Recommended:_ fold into **4.7.0** (unreleased; the group
    model replaces 4.7's user subjects before anyone runs them, and the
    upgrade restarts once instead of twice). Alternative: 4.8.0 after 4.7.0
    ships.
