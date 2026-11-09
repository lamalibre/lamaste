# Lamaste E2E: 55 — Delegated invitations: revocation ends access (Three-VM)

> Started at `2026-11-09 14:03:10 UTC`


## Pre-flight

✅ `14:03:10` Onboarding is complete  
✅ `14:03:10` Agent test-agent is enrolled on the host  
✅ `14:03:10` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:03:11` The agent VM's lamaste-agent has the apphost command  
✅ `14:03:11` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:03:11` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; two coordinators; the plugin, its restricted web surface, invitations on

✅ `14:03:12` Domain lamaste-second.local added (201)  
✅ `14:03:12` …pending until activated  
✅ `14:03:12` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:03:12` …the one required record is auth.lamaste-second.local  
✅ `14:03:13` lamaste-second.local is active  
✅ `14:03:13` User e2e55-coord created, member of lamaste-second.local (external)  
✅ `14:03:14` User e2e55-coord2 created, member of lamaste-second.local (external)  
✅ `14:03:14` Fixture built: @lamalibre/e2e-xinv-server  
✅ `14:03:22` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `14:03:22` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:03:23` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T14:03:23.352Z"})  
✅ `14:03:23` …through its own OIDC client  
✅ `14:03:24` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:03:28` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:03:28` …approved  
✅ `14:03:28` …moved to B, before any surface  
✅ `14:03:39` …hosted on test-agent ()  
✅ `14:03:55` …its hosting is up  
✅ `14:03:56` …ready: its agent half's first complete sync ended at the head  
✅ `14:03:58` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:03:58` …the site e2e55web.lamaste-second.local, restricted, on B  
✅ `14:03:58` …served  
✅ `14:03:58` e2e55-coord entitled as coordinator  
✅ `14:03:58` e2e55-coord2 entitled as coordinator  
✅ `14:03:58` Granted site 1b069c9d-3b60-44f9-af37-f0be5c3fef6e to user e2e55-coord  
✅ `14:03:58` Granted site 1b069c9d-3b60-44f9-af37-f0be5c3fef6e to user e2e55-coord2  
✅ `14:03:59` The audience holds e2e55-coord  
✅ `14:03:59` …and e2e55-coord2  
✅ `14:03:59` Invitations enabled: two e-mail domains, 14 days  
✅ `14:04:01` e2e55-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:04:02` e2e55-coord2 signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter revokes their own; another inviter cannot

✅ `14:04:03` e2e55-coord invites a1: 201  
✅ `14:04:03` …a link on the sign-in host, the token in its fragment  
✅ `14:04:03` e2e55-coord2 revokes e2e55-coord's: 404, as none at all  
✅ `14:04:03` …it stays pending  
✅ `14:04:03` e2e55-coord revokes their own: 200  
✅ `14:04:03` …revoked, by the inviter  
✅ `14:04:03` The link: lookup 410  
✅ `14:04:03` …accept 410  
✅ `14:04:03` …no account  

## The administrator revokes any

✅ `14:04:04` e2e55-coord invites a2: 201  
✅ `14:04:04` …a link on the sign-in host, the token in its fragment  
✅ `14:04:04` DELETE /api/invitations/<id>: 200  
✅ `14:04:04` …revoked, the row kept  
✅ `14:04:04` …by the administrator  
✅ `14:04:04` The link: 410  

## Five refused acceptances lock a link

✅ `14:04:04` e2e55-coord invites a3: 201  
✅ `14:04:04` …a link on the sign-in host, the token in its fragment  
✅ `14:04:04` Refused username 1: 409  
✅ `14:04:04` Refused username 2: 409  
✅ `14:04:04` Refused username 3: 409  
✅ `14:04:04` Refused username 4: 409  
✅ `14:04:05` Four: still pending  
✅ `14:04:05` The fifth: 409  
✅ `14:04:05` …the link is locked  
✅ `14:04:05` A free username now: 410  
✅ `14:04:05` The inviter sees why  

## The policy: a domain removed, a shorter lifetime, turned off

✅ `14:04:05` e2e55-coord invites an address under the second domain: 201  
✅ `14:04:05` …a link on the sign-in host, the token in its fragment  
✅ `14:04:05` …and one under the first: 201  
✅ `14:04:05` …a link on the sign-in host, the token in its fragment  
✅ `14:04:06` The administrator removes client.example and shortens the lifetime to 2 days  
✅ `14:04:06` The invitation under the removed domain is revoked  
✅ `14:04:06` …its link 410  
✅ `14:04:06` The other stays pending  
✅ `14:04:06` …its expiry brought within the two days  
✅ `14:04:06` The policy turned off  
✅ `14:04:06` The open invitation is revoked  
✅ `14:04:06` …its link 410  
✅ `14:04:07` The inviter's API: 403  
✅ `14:04:07` On again  

## An invitee joins; their inviter loses the role

✅ `14:04:07` e2e55-coord2 invites c1: 201  
✅ `14:04:07` …a link on the sign-in host, the token in its fragment  
✅ `14:04:08` e2e55-first accepts  
✅ `14:04:08` users.yml gives e2e55-first the site's hostname  
✅ `14:04:09` e2e55-first signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:04:10` e2e55-first: the shell  

## The inviter's site grant goes: the role alone no longer invites

✅ `14:04:10` e2e55-coord2 invites c2, pending: 201  
✅ `14:04:10` …a link on the sign-in host, the token in its fragment  
✅ `14:04:10` e2e55-coord2's site grant revoked, the role left in place  
✅ `14:04:10` e2e55-coord2 on the inviter's API: 403  
✅ `14:04:10` Their open invitation cannot be accepted  
✅ `14:04:10` …revoked at the claim  
✅ `14:04:11` …no account  

## The inviter's role goes: their pending ones end; the person they invited stays (D1)

✅ `14:04:11` e2e55-coord invites d1, pending: 201  
✅ `14:04:11` …a link on the sign-in host, the token in its fragment  
✅ `14:04:11` e2e55-coord2's role removed  
✅ `14:04:11` e2e55-first, whom e2e55-coord2 invited, stays in the audience  
✅ `14:04:11` …and reaches the API  
✅ `14:04:11` …and the shell  
✅ `14:04:11` e2e55-coord's role removed  
✅ `14:04:11` Their pending invitation ends revoked (inviter_unentitled)  
✅ `14:04:11` …its link 410  
✅ `14:04:12` e2e55-coord entitled as coordinator  
✅ `14:04:12` e2e55-coord is a coordinator again  

## A chain: a coordinator invites a coordinator, who invites a viewer

✅ `14:04:12` e2e55-coord invites a coordinator: 201  
✅ `14:04:12` …a link on the sign-in host, the token in its fragment  
✅ `14:04:13` e2e55-chain accepts  
✅ `14:04:13` e2e55-chain is a coordinator  
✅ `14:04:13` users.yml gives e2e55-chain the site's hostname  
✅ `14:04:14` e2e55-chain signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:04:14` e2e55-chain invites a viewer: 201  
✅ `14:04:14` …a link on the sign-in host, the token in its fragment  
✅ `14:04:15` e2e55-leaf accepts  
✅ `14:04:15` users.yml gives e2e55-leaf the site's hostname  
✅ `14:04:17` e2e55-leaf signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:04:17` e2e55-leaf: the API  
✅ `14:04:17` e2e55-chain: the API  

## disable-invitees, transitive: both sessions end at once

✅ `14:04:17` POST /api/invitations/disable-invitees {transitive}: 200  
✅ `14:04:17` …the coordinator's invitee and theirs  
✅ `14:04:17` e2e55-leaf's session: 401 at once  
✅ `14:04:17` e2e55-chain's session: 401 at once  
✅ `14:04:17` e2e55-coord is untouched  
✅ `14:04:18` The directory holds e2e55-leaf disabled  
✅ `14:04:18` Audited invitation.invitees.disabled  

## A revocation racing an acceptance: 'marked' never leaves a working link

✅ `14:04:18` Race 1: an invitation: 201  
✅ `14:04:18` …a link on the sign-in host, the token in its fragment  
ℹ️ `14:04:18` Race 1: DELETE answered 202 marked  
✅ `14:04:22` Race 1: marked, and it ended revoked by the administrator  
✅ `14:04:23` …the link stays dead  
✅ `14:04:23` …it made no account  
✅ `14:04:23` Race 2: an invitation: 201  
✅ `14:04:23` …a link on the sign-in host, the token in its fragment  
ℹ️ `14:04:23` Race 2: DELETE answered 202 marked  
✅ `14:04:28` Race 2: marked, and it ended revoked by the administrator  
✅ `14:04:28` …the link stays dead  
✅ `14:04:28` …it made no account  
ℹ️ `14:04:28` A revocation landed on an acceptance under way 2 time(s)  
✅ `14:04:28` The races' invitees disabled (cleanup of who joined)  

## The web surface deleted: what named it ends

✅ `14:04:28` e2e55-coord invites f1: 201  
✅ `14:04:28` …a link on the sign-in host, the token in its fragment  
✅ `14:04:28` The web surface deleted  
✅ `14:04:28` The open invitation is revoked (surface_removed)  
✅ `14:04:29` …its link 410  

## Audited; nothing restarted Authelia

✅ `14:04:29` A revocation is audited once  
✅ `14:04:29` …with no address  
✅ `14:04:29` invitation.created holds no address  
✅ `14:04:29` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `14:04:29` Cleaning up test resources...  
