# Invitations API

> Invite someone to create their own account: an administrator into anything, or a person holding a plugin's inviting role into that plugin alone.

## In Plain English

An invitation is a link. Whoever opens it first picks a password, scans a TOTP code and has an account. Lamaste sends no mail: whoever makes an invitation copies the link and sends it themselves.

There are two kinds:

- An **administrator's** invitation names a username, an address, Authelia groups and the domains the user joins. It is made in the panel, with the admin certificate.
- A **delegated** invitation is made by a user who holds a plugin role the plugin's manifest marks as inviting — corral's coordinator, say. They name an address, a name and one of the roles their own role may give. On accepting, the invitee becomes an **external member** of the plugin's domain with that role and the grant on the plugin's own site, and reaches nothing else. The administrator decides whether a plugin's people may do this at all, and to which e-mail domains.

The plugin's own code takes no part: the inviter works on a Lamaste page on the domain's sign-in host, which the plugin only links to. See [Delegated invitations](agent-hosted-plugins.md#delegated-invitations) for the plugin's side, and `packages/core/docs/delegated-invitations-design.md` for the design.

## Important Behavior

- **Tokens are shown once.** A token is 32 random bytes; state.db keeps only its SHA-256, so nothing at rest opens an invitation and no answer can show one again. Lost link: revoke the invitation and make another.
- **The token travels in the link's fragment**, `https://auth.<domain>/invite#<token>`, which reaches no server log; the page sends it in POST bodies. A link from before 4.9 (`/invite/<token>`) still opens the page.
- **A revocation is final.** One that lands while an invitation is being accepted ends it `revoked` whatever the acceptance does next: before the account exists none is made; after, the account is disabled through the usual [offboarding](users.md#offboarding), an administrator's invitation naming `admins` included, the acceptance answers `410 invitation_revoked`, and admins are told. They may delete the account, or enable it.
- **One use.** An acceptance **claims** the invitation first (`accepting`, with a claim id checked under the users lock). A crash leaves nothing half-done: an acceptance whose user exists is finished, one whose user does not is released, and one link never makes two accounts.
- **One open invitation per username**, across kinds, and a username an open invitation names cannot be taken by anyone else: creating a user under it is refused (409 `username_invited`).
- **Five refused acceptances lock a link** (`revoked`, `attempts_exhausted`).
- **Every invitation and acceptance is audited**: `invitation.created`, `invitation.accepted`, `invitation.revoked`, `invitation.revoke.marked` (one being accepted), `invitation.deleted`, `invitation.account.disabled`, `invitation.policy.updated`, `invitation.invitees.disabled`, `invitation.import.refused`. Details name ids, the role and the address's domain, never an address. Admins are notified of every delegated acceptance.
- **Personal data.** Once accepted, an invitation's copies of the address and name go (the directory holds them). Invitations that ended without making an account are deleted 90 days later; one that made an account stays until that user is erased, as the record of who invited whom. Erasing a user also deletes the delegated invitations to their address that made nobody an account.

## The Administrator's API

mTLS, admin certificate; `503` before onboarding completes.

### `GET /api/invitations`

The newest invitations, both kinds. Query: `plugin` (name), `inviter` (directory id), `kind` (`admin` or `delegated`), `limit` (default 500, at most 2000). `truncated` says there are more.

```json
{
  "invitations": [
    {
      "id": "5f0f8c44-…",
      "kind": "delegated",
      "username": null,
      "email": "deniz@client.example",
      "displayName": "Deniz",
      "emailDomain": "client.example",
      "groups": [],
      "domains": [{ "name": "example.com", "kind": "external" }],
      "plugin": "corral",
      "role": "stakeholder",
      "inviter": { "userId": "1f7c…", "username": "ayse" },
      "createdAt": "2026-11-02T09:00:00.000Z",
      "expiresAt": "2026-11-09T09:00:00.000Z",
      "status": "pending",
      "revokedReason": null,
      "acceptedAt": null,
      "acceptedUserId": null,
      "fulfilled": false,
      "used": false,
      "mail": { "status": "sent", "sentAt": "2026-11-02T09:00:01.000Z" },
      "reissuedAt": null
    }
  ],
  "truncated": false
}
```

| Field           | Meaning                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `kind`          | `admin` or `delegated`                                                                                                         |
| `username`      | An administrator's choice; for a delegated one, the invitee's, once they claimed one                                           |
| `email`         | `null` once accepted                                                                                                           |
| `inviter`       | Delegated: the directory id and current username (`null` once the directory names them no more); `null` for an administrator's |
| `status`        | `pending`, `expired` (pending past `expiresAt`), `accepting`, `accepted`, `revoked`                                            |
| `revokedReason` | Below                                                                                                                          |
| `fulfilled`     | Accepted and, for a delegated one, every grant made. `false` on an accepted invitation: access is still being completed        |
| `mail`          | The mail of its current link: `{ status, sentAt }` ([Mail status](mail.md#mail-status)), `status` `null` when none was tried   |
| `reissuedAt`    | When its link was last replaced by a new one, or `null`                                                                        |

**Revocation reasons:** `inviter`, `admin`, `inviter_disabled`, `inviter_removed`, `inviter_unentitled` (lost every role that could give it), `policy_disabled`, `email_domain_removed`, `plugin_removed`, `role_undeclared`, `surface_removed`, `surface_not_restricted`, `attempts_exhausted`, `repair_abandoned`, `superseded` (expired, and closed when another invitation named its username).

### `POST /api/invitations`

An administrator's invitation.

| Field           | Rule                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `username`      | The users API's rule                                                                                                                    |
| `email`         | An address                                                                                                                              |
| `groups`        | Optional Authelia groups; never with an external membership (400 `external_member_groups`)                                              |
| `expiresInDays` | 1–30, default 7                                                                                                                         |
| `domains`       | Domain names (members) or `{ name, kind }`. Required on a relay with two or more domains (400 `domains_required`); with one, its member |

`201 { ok, invitation, inviteUrl, token, mail }` — `inviteUrl` and `token` here and never again. The link is mailed to `email` when the invitation's domain can send ([Mail](mail.md)); `mail` says what happened (`sent`, `failed`, `not-configured`, `deferred-budget`), and the link is answered whatever it says. `409` when the username is taken, or an open invitation names it.

### `POST /api/invitations/:id/reissue`

A new link for a **pending** invitation, an expired one included, either kind: a new token (the old link dead at once), its failed attempts reset, mailed — the same answer as creating one. Held to neither an inviter's rate nor the caps. An administrator's invitation keeps the lifetime its link last had; a delegated one gets its policy's. `404 not_found`; `409 invitation_not_pending` (accepted, being accepted or revoked); `409 username_taken` when the username exists by then. Audited `invitation.reissued`.

### `DELETE /api/invitations/:id`

| Invitation             | Answer                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| pending                | `200 { ok, action: "revoked" }`                                                                          |
| being accepted         | `202 { ok, action: "marked" }`: it ends revoked; an account made by then is disabled and admins are told |
| ended, no account made | `200 { ok, action: "deleted" }`                                                                          |
| made an account        | `409 invitation_has_user`: it stays on record (disable or delete the user)                               |
| none                   | `404`                                                                                                    |

### `POST /api/invitations/disable-invitees`

`{ "inviterUserId": "<directory id>", "transitive": false }` — disable everyone that person invited; with `transitive`, everyone those people invited too, and so on. Through the usual [offboarding](users.md#offboarding): sessions ended, registry tokens revoked, plugins told. An administrator is never disabled this way; users already disabled or removed are left alone. `{ ok, disabled: [userId…], warnings? }`, audited `invitation.invitees.disabled`.

Invitees **keep their access** when their inviter is disabled or removed: their open invitations are revoked, the people who already joined stay. This is how to end it, when that is what is wanted.

### `GET /api/plugins/:name/invitation-policy`

The policy of one plugin's delegated invitations (off when none was set), and whether the plugin can be invited into now.

```json
{
  "enabled": true,
  "emailDomains": ["client.example"],
  "maxOpenPerInviter": 10,
  "maxJoined": 50,
  "lifetimeDays": 7,
  "updatedAt": "2026-11-02T09:00:00.000Z",
  "updatedBy": "admin",
  "available": true,
  "unavailableReason": null,
  "invitingRoles": [{ "role": "coordinator", "invites": ["stakeholder"] }]
}
```

### `PUT /api/plugins/:name/invitation-policy`

The whole policy. Omitted bounds take their defaults.

| Field               | Rule                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `enabled`           | Required                                                                                                                             |
| `emailDomains`      | Up to 20 domain names, lower case. An invitee's address must end in `@<one of them>` exactly (no subdomains); at least one to enable |
| `maxOpenPerInviter` | 1–100, default 10: pending invitations one inviter may hold on the plugin                                                            |
| `maxJoined`         | 1–500, default 50: people an invitation of the plugin made and who were not removed, plus every open invitation of the plugin        |
| `lifetimeDays`      | 1–30, default 7                                                                                                                      |

Refused: `400 invalid_policy`; `404` for a plugin not installed; `409 invitations_unavailable` when enabling a plugin that cannot be invited into: no role of the approved version may invite, or it has no web surface of its own, or that surface is not `restricted`, or is not served. A tunnel bound as a user surface cannot be granted — it would open the tunnel's own application — and an `authenticated` web surface refuses external members.

Answers the policy as `GET` does, with `warnings` when the enabled policies together allow more people than Gatekeeper's free grants can take (every invitee costs two, and below 100 free grants invitations stop on every domain).

The change sweeps the plugin's open invitations: turned off, all are revoked (`policy_disabled`); a domain taken away, those to it (`email_domain_removed`); a shorter lifetime brings their expiry in. Lowered caps revoke nothing.

## The Inviter's API

On the plugin's domain's sign-in host, for its page `https://auth.<domain>/invitations/<route>` — never on the plugin's own host, whose code must not reach it. The inviter must hold the grant on the plugin's site: holding the role alone is `403 forbidden`, and at acceptance ends their invitation (`inviter_unentitled`). nginx asks Gatekeeper (`/authz/delegated-invitations/<domain>`, [Gatekeeper](gatekeeper.md#delegated-invitations-authorization-nginx-auth_request)), which authenticates the session and signs a relay assertion bound to this request. The panel then checks `Sec-Fetch-Site` (absent or `same-origin`; `none` on a `GET`), that the assertion's domain is the plugin's, `Origin` exactly `https://auth.<domain>` on a change, and the user (`active`, entitled, the plugin's identity ready). 60 requests a minute per address and route; a body of at most 8 KiB; no CORS; `Cache-Control: no-store`.

### `GET /api/delegated-invitations/:route`

```json
{
  "plugin": { "displayName": "Corral", "siteUrl": "https://corral.example.com/" },
  "policy": {
    "grantableRoles": [{ "id": "stakeholder", "label": "Stakeholder" }],
    "emailDomains": ["client.example"],
    "lifetimeDays": 7,
    "maxOpen": 10,
    "open": 2
  },
  "invitations": [
    {
      "id": "5f0f8c44-…",
      "email": "deniz@client.example",
      "displayName": "Deniz",
      "role": "stakeholder",
      "roleLabel": "Stakeholder",
      "status": "pending",
      "revokedReason": null,
      "createdAt": "2026-11-02T09:00:00.000Z",
      "expiresAt": "2026-11-09T09:00:00.000Z",
      "acceptedAt": null,
      "mail": { "status": "sent", "sentAt": "2026-11-02T09:00:01.000Z" }
    }
  ]
}
```

The caller's own invitations only, and never who accepted one.

### `POST /api/delegated-invitations/:route`

`{ "email": "deniz@client.example", "displayName": "Deniz", "role": "stakeholder" }` (`displayName` optional) → `201 { invitation, inviteUrl, mail }`, the link here and never again — mailed to the invitee, in the domain's language, when the domain can send (`mail.status`, [Mail status](mail.md#mail-status)).

### `POST /api/delegated-invitations/:route/:id/reissue`

A new link for the caller's own pending invitation (an expired one included): the old link dead, the new one mailed, answered `{ invitation, inviteUrl, mail }` once. Under the rules of making one — invitations still allowed, the address's domain still in the policy, the role still the caller's to give, the grant reserve — and it counts toward the 30 an hour; one that had expired and opens again counts toward the caps too. `404 not_found` (not the caller's, or none); `409 invitation_not_pending`. The inviter's page shows each open invitation's mail and a **New link** button.

### `DELETE /api/delegated-invitations/:route/:id`

Revoke the caller's own open invitation: `{ ok: true }`. One being accepted is marked: it ends revoked, and an account made by then is disabled. Anything else — another's invitation, one that ended, none — is `404 not_found`.

### Refusals

Every answer's `error` is English, for the panel, the CLI, scripts and logs; the inviter's page never shows it. It shows its own words, in the domain's page language ([Domains — Page language](domains.md)): those of the `code` (with its `field` or `cap`), else those of the status.

| Status | `code`                     | Meaning                                                                                                                     |
| ------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`          | The body; `field` names which. Never repeats a value                                                                        |
| 400    | `email_domain_not_allowed` | The address is under no domain of the policy                                                                                |
| 401    |                            | `{ "error": "unauthenticated" }`: no session, or two session cookies. The page links to the sign-in                         |
| 403    | `invitations_unavailable`  | The policy is off, or the surface not ready; which is in the panel's log only                                               |
| 403    | `role_not_grantable`       | The caller's roles may not give it now                                                                                      |
| 403    |                            | `{ "error": "forbidden" }` from nginx, a cross-site request, a wrong `Origin`, or a user who is not entitled                |
| 404    | `not_found`                | No such plugin, no identity, or (revoking) no such open invitation of the caller's; `resolveUserCaller`'s `404` has no code |
| 409    | `invitation_cap`           | `cap`: `inviter` (`maxOpenPerInviter`) or `plugin` (`maxJoined`)                                                            |
| 429    | `invitation_rate`          | 30 invitations by one inviter in an hour, revoked ones included                                                             |
| 503    | `grant_reserve`            | Gatekeeper has fewer than 100 free grants (every invitee costs two)                                                         |
| 503    | `gatekeeper_unavailable`   | Gatekeeper did not answer                                                                                                   |

Making an invitation never says whether the address already has an account.

## The Public API

No certificate, no session; the token is the only credential. 20 requests a minute per address.

### `POST /api/invite/lookup`

`{ "token": "<64 hex>" }` → what the page shows. An administrator's: `{ kind: "admin", username, email, expiresAt }`. A delegated one: `{ kind: "delegated", email, displayName, plugin, role, invitedBy, expiresAt, suggestedUsername }` — `plugin` and `role` are the display name and label, `invitedBy` the inviter's display name or `null`, never their username.

A delegated token is answered only by `auth.<its domain>`, read from the `Host` the vhost writes as a literal: anywhere else, `404 invitation_not_found` — the same answer as no such token. `410 invitation_used`, `invitation_expired` or `invitation_closed` (revoked) for a link that can no longer be accepted.

### `POST /api/invite/accept`

An administrator's: `{ token, password }`. A delegated one: `{ token, username, displayName, password }` — the invitee picks their username.

`{ ok, username, loginUrl, totpUri, totpQr, accessPending }`: `totpQr` is the TOTP URI as an SVG data URI, `loginUrl` the domain's sign-in (a delegated invitation: the plugin's site), and `accessPending` is true when the account exists but its access is still being completed — the panel keeps completing it.

| Status | `code`                                                   | Meaning                                                                                                                                   |
| ------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | `invalid_request`                                        | `field` names which                                                                                                                       |
| 404    | `invitation_not_found`                                   | No such token, or the wrong host                                                                                                          |
| 409    | `username_unavailable`                                   | Delegated: the one answer for every reason a username cannot be taken. Counts a failed attempt. An administrator's: its username is taken |
| 409    | `invitation_accepting`                                   | An acceptance of this link is under way                                                                                                   |
| 410    | `invitation_used`                                        | Accepted already                                                                                                                          |
| 410    | `invitation_expired`                                     | Past its expiry                                                                                                                           |
| 410    | `invitation_closed`                                      | Revoked, or no longer allowed (below)                                                                                                     |
| 410    | `invitation_revoked`                                     | Revoked while this acceptance ran: no account is handed over                                                                              |
| 503    | `gatekeeper_unavailable`, `authelia_storage_unavailable` | Try again; nothing was created                                                                                                            |
| 503    | `invitation_unavailable`                                 | The plugin cannot be joined right now (disabled, its surface not served, an operation running)                                            |

As on the inviter's API, `error` is English and the invitation page never shows it: it shows the words of the `code`, else of the status, in the domain's page language.

A username is unavailable when a directory row holds it — active, disabled or removed; an open invitation names it; Gatekeeper holds any grant or group membership under it; a static site's `allowedUsers` or a desktop plugin grant names it; or Authelia holds an OpenID Connect identifier for it. So an invitee inherits nothing, and a stranger's acceptance never starts a principal cleanup.

A delegated acceptance is refused `410` unless everything still holds: the plugin installed and approved, the role declared, the policy enabled, the address's domain allowed, the web surface restricted, served and the one recorded, and the inviter active and still able to give the role.

**What it makes:** the user, with no Authelia group; an `external` membership of the plugin's domain; the role (a Gatekeeper `plugin` grant); the `site` grant on the plugin's web surface. Each grant is re-checked just before it is made. When a grant cannot be made now, the panel completes the acceptance within 24 hours, only ever creating what is missing and giving up when an administrator changed that user's grants meanwhile (`repair_abandoned`, admins notified).

## CLI

```
lamaste-server invitations list [--plugin <name>] [--inviter <user>]
lamaste-server invitations revoke <id>
lamaste-server invitations reissue <id>
lamaste-server invitations disable-invitees <user> [--transitive]
lamaste-server plugins invitations <name>
lamaste-server plugins invitations <name> set [--enable|--disable] [--email-domains a,b]
                                              [--max-open n] [--max-joined n] [--lifetime-days d]
```

`set` changes what its flags name and keeps the rest. `<user>` is a username or a directory id.

## Related

- [Agent-Hosted Plugins — Delegated invitations](agent-hosted-plugins.md#delegated-invitations)
- [Users API](users.md)
- [Mail API](mail.md)
- [Domains API — External members](domains.md)
- [Security model — Delegated invitations](../01-concepts/security-model.md#5g-delegated-invitations)
