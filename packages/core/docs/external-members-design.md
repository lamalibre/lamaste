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
3. **OIDC authorization reads fresh groups too.** The authorization and
   consent handlers call the same refresh before evaluating the client's
   authorization policy against `userSession.Groups`
   (`handler_oauth2_authorization_consent_core.go`).
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

| Group                       | Holds                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `lamaste:member@<domain>`   | active members (kind `member`) of the active domain                                     |
| `lamaste:external@<domain>` | active external members of the active domain                                            |
| `<fqdn>` (a hostname)       | **host group**: the users named on that host — below                                    |
| `lamaste:oidc@<clientId>`   | active external members of the client's domain with a grant on the client (OIDC, below) |

Host group `<fqdn>`:

- a protected **static site** with `allowedUsers`: the listed users who are
  members or external members of the site's domain (replaces 4.7's `user:`
  subjects, so editing `allowedUsers` no longer restarts Authelia);
- a **Gatekeeper-gated restricted host** — a `restricted` app or plugin
  tunnel, a `restricted` tunnel bound as a user surface, a `restricted`
  web surface: the **external** members of its domain who hold a grant on it
  (direct, or through a Lamaste group) — decision 3. Members do not need
  it: the domain rule admits them and Gatekeeper checks their grants, as in
  4.7.

`:` and `@` never occur in a hostname, and a host group is always a
hostname under a relay domain, so no Lamaste group can be mistaken for a
host or the other way round.

**Reserved names.** Groups an admin assigns (users API, invitations, the
panel's editor) must match `^[A-Za-z0-9_-]{1,64}$` (`admins`, `feria-admins`
fit); a name with `.`, `:` or `@` is refused (400 `reserved_group`). The
render owns every group that starts with `lamaste:` or is a hostname under a
relay domain (any domain record, pending included): it adds what is desired
and removes the rest, so a stray host group cannot survive a render. Groups
outside both stay as they are (an older admin group with a dot is left
alone, but cannot be newly assigned).

Lamaste-owned groups are **never shown** as groups (users list, user
editor, `/api/identity/users`, `/api/identity/self`): the user's domains
with their kinds are shown instead. Gatekeeper strips them from
`Remote-Groups` and from a plugin tunnel's relay assertion
(`groups`); they reach only Authelia — and, unavoidably, an OIDC client that
asks for the `groups` claim (fact 5; residual R4).

### `access_control`

`renderAccessControl(domains, sites)` — `domains` now
`{ name, hasMembers, hasExternals }` (no usernames: the rules name groups):

1. **Per protected static site** (domain `d`):
   - `allowedUsers` set: `subject: group:<fqdn>`, `two_factor`;
   - `subject: [[group:admins, group:lamaste:member@d]]`, `two_factor`
     (an admin who is a member — never external, below);
   - `deny`.
2. **Per domain `d`**, in this order:
   - members: `domain: [d, '*.d']`, `subject: group:lamaste:member@d`,
     `two_factor`;
   - external members on hosts that name them:
     `domain_regex: '^(?P<Group>(?:[a-z0-9-]+\.)+<d quoted>)$'`,
     `subject: group:lamaste:external@d`, `two_factor` — admitted only on a
     host whose name is one of their groups (fact 4), and only while they
     are an external member of `d`;
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
          subject: 'group:lamaste:member@codelama.com.tr'
        - policy: two_factor
          subject: ['group:lamaste:external@codelama.com.tr', 'group:lamaste:oidc@feria-cli']
  ```

  Members of the client's domain are admitted as in 4.7; external members
  only with the grant. The policy changes only with the client set or a
  plugin's domain; a grant is a `users.yml` change, applied at the user's
  next authorization (fact 3). Pure `client_credentials` clients keep
  `one_factor` (unchanged).

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
- `checkDomain` returns the kind. Then, on every route:
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

1. read domains, memberships with kinds, protected sites, Gatekeeper-gated
   restricted hosts, the grants on them and on OIDC clients (Gatekeeper's API,
   Lamaste groups expanded);
2. write **`users.yml`'s Lamaste-owned groups** (under the users lock,
   compare first — `renderOwnedGroups`, pure, in core);
3. write the projection;
4. write `configuration.yml` (cookies, `access_control`, OIDC policies) —
   compare first; restart only when it changed (structural).

**Order.** When a change both widens and narrows, `users.yml` is written
before the configuration: a new site rule or policy names a group that is
already filled, and a revoked group is empty before any rule could matter.
Removing a site writes the configuration first (the rule goes), then the
group.

**The reload cooldown** (fact 1). A write that lands within 0.5 s of the
previous reload is skipped by Authelia, silently. So `users.yml` writes are
serialized under the users lock and each is **followed by a confirming
re-write** of the same bytes once 0.6 s have passed since it
(`touchUsersFile`), guaranteeing a reload after the cooldown; the users lock
spaces writes by at least that. Cost: ≤ 1.2 s per change, under the lock.
`expect` (re-apply when Authelia's own save overwrote the change) stays.

**Triggers.** Every membership, kind, user, site, tunnel, user-surface,
web-surface and plugin-domain change already renders; additionally every
grant or Lamaste-group write the panel proxies to Gatekeeper
(`/api/gatekeeper/*`, entitlements) renders afterwards, and the identity
tick (every minute) renders — which catches grants made with Gatekeeper's
own CLI on the relay (Gatekeeper enforces them at once; Authelia's host
group follows within a minute).

**Revocations.** Losing a membership, the external kind's grant on an OIDC
client whose registry it is, or turning external, revokes the user's
registry tokens where they no longer reach the registry's client (extends
4.7's `revokeRegistryTokensFor`).

### What ends when a member is made external

Their `lamaste:member@d` group becomes `lamaste:external@d` in one write:
at their next request Authelia admits them only on hosts naming them, and
Gatekeeper (projection, session cache busted) refuses `authenticated` hosts
— within nginx's 10 s authorization cache (`AUTHZ_SUCCESS_MAX_AGE_SECONDS`,
plugin tunnels and user surfaces are never cached). Their Authelia groups
must have been removed first (decision 4). OIDC: their next authorization is
refused; issued access tokens live out their lifespan.

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

1. Migration 0017: every membership `member`.
2. First render after the upgrade: `configuration.yml` gains
   `authentication_backend.file.watch: true` and the group-based rules —
   **one** restart (sessions end once, at the update, as every update does
   today); `users.yml` gains `lamaste:member@<d>` for every member; the
   projection becomes v2.
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
  restarts Authelia. A restart (all sessions end) remains for structural
  changes only — a domain added/activated/removed, a static site
  protected/unprotected/created/removed, the OIDC client set or a plugin's
  domain changed — all admin actions, none per person. Decision 1 discusses
  removing it entirely (Redis).
- **R4 (new, accepted?)**: an OIDC client that asks for `groups` (Feria's
  `feria login`) sees the user's Lamaste-owned groups: the domains they
  belong to with the kind, and the hostnames that name them. Hostnames and
  domains are public anyway (certificate transparency); the relation
  "this user is a member of that domain" is what leaks, to a relying party
  the admin installed on the relay. Decision 8.
- External members can never hold `admins` (decision 4), so the
  `[group:admins, …member@d]` clause cannot admit one, and Authelia's
  `admins` bypass of static-site lists stays members-only.

## Proof (rodeo)

New three-VM specs on top of `multi-domain-harness.sh`:

- **49 — an external member reaches only what names them**: domain B;
  `ext` external member of B; on B: an `authenticated` tunnel → access-request
  page (Gatekeeper) and Authelia's own refusal (projection pinned, as spec 46
  does, to prove Authelia alone); a `restricted` tunnel without a grant →
  refused, with a grant → through, revoked → refused within the settle time;
  a protected static site not naming them → refusal page, naming them →
  through; a Lamaste group grant → through. A member's access on the same
  hosts is unchanged. **No sign-out**: a member's session established before
  is still valid after each of `ext`'s changes (same cookie, 200), and
  Authelia's `MainPID` never changed.
- **50 — a member turned external**: reaches an `authenticated` tunnel,
  turned external → refused at once (≤ settle), turned back → through;
  turning a user with `feria-admins` external is refused (409); adding a
  group to an external member is refused.
- **51 — surfaces and audience**: corral-like fixture plugin with a
  `restricted` web surface and user surface on B: `ext` with a role and the
  site grant reaches the shell and `/app/*`, is in the audience with their
  roles; without the site grant → access-request page / 403 JSON; on an
  `authenticated` surface → refused even when entitled.
- **single-VM 36 — OIDC by grant**: a user-facing client on A; an external
  member of A is refused (`access_denied`), granted → admitted, revoked →
  refused at the next authorization; a member admitted throughout; Authelia
  not restarted by grant changes.
- **single-VM 37 — upgrade**: a 4.7 relay (state written with the previous
  release, as the upgrade suite does) updated: every membership `member`,
  every user reaches what they did, `watch: true` rendered, one restart.

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

2. **serverd + Gatekeeper** — migration 0017, kinds in membership, users,
   invitations, `changeUsers` without restarts (owned-group write, cooldown
   re-write, `expect` kept), rendering order, host-group and client-grant
   computation from Gatekeeper, `oidc-client` grants, Authelia-group refusal,
   registry-token revocation, Gatekeeper kind checks, group stripping; tests.
3. **UI, desktop, CLI, docs** — as above; CHANGELOG; CLAUDE.md.
4. **Security review** — independent reviewers; every confirmed finding
   fixed with a test.
5. **Rodeo** — the specs above on fresh VMs.

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
   `lamaste:member@<d>` (Authelia) and Gatekeeper ignores them for external
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
