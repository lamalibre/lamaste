# Lamaste E2E: 55 — Delegated invitations: revocation ends access (Three-VM)

> Started at `2026-11-03 10:52:11 UTC`


## Pre-flight

✅ `10:52:12` Onboarding is complete  
✅ `10:52:12` Agent test-agent is enrolled on the host  
✅ `10:52:12` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:52:12` The agent VM's lamaste-agent has the apphost command  
✅ `10:52:12` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:52:12` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; two coordinators; the plugin, its restricted web surface, invitations on

✅ `10:52:13` Domain lamaste-second.local added (201)  
✅ `10:52:13` …pending until activated  
✅ `10:52:13` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:52:13` …the one required record is auth.lamaste-second.local  
✅ `10:52:14` lamaste-second.local is active  
✅ `10:52:15` User e2e55-coord created, member of lamaste-second.local (external)  
✅ `10:52:16` User e2e55-coord2 created, member of lamaste-second.local (external)  
✅ `10:52:16` Fixture built: @lamalibre/e2e-xinv-server  
✅ `10:52:24` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `10:52:24` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:52:25` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:52:25.666Z"})  
✅ `10:52:25` …through its own OIDC client  
✅ `10:52:26` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:52:31` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `10:52:31` …approved  
✅ `10:52:31` …moved to B, before any surface  
✅ `10:52:41` …hosted on test-agent ()  
✅ `10:52:57` …its hosting is up  
✅ `10:52:58` …ready: its agent half's first complete sync ended at the head  
✅ `10:53:00` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `10:53:00` …the site e2e55web.lamaste-second.local, restricted, on B  
✅ `10:53:00` …served  
✅ `10:53:00` e2e55-coord entitled as coordinator  
✅ `10:53:00` e2e55-coord2 entitled as coordinator  
✅ `10:53:00` Granted site a68a387b-85dd-4908-8a56-2573c84c6c7d to user e2e55-coord  
✅ `10:53:00` Granted site a68a387b-85dd-4908-8a56-2573c84c6c7d to user e2e55-coord2  
✅ `10:53:00` The audience holds e2e55-coord  
✅ `10:53:01` …and e2e55-coord2  
✅ `10:53:01` Invitations enabled: two e-mail domains, 14 days  
✅ `10:53:02` e2e55-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:53:04` e2e55-coord2 signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter revokes their own; another inviter cannot

✅ `10:53:04` e2e55-coord invites a1: 201  
✅ `10:53:04` …a link on the sign-in host, the token in its fragment  
✅ `10:53:04` e2e55-coord2 revokes e2e55-coord's: 404, as none at all  
✅ `10:53:05` …it stays pending  
✅ `10:53:05` e2e55-coord revokes their own: 200  
✅ `10:53:05` …revoked, by the inviter  
✅ `10:53:05` The link: lookup 410  
✅ `10:53:05` …accept 410  
✅ `10:53:05` …no account  

## The administrator revokes any

✅ `10:53:05` e2e55-coord invites a2: 201  
✅ `10:53:05` …a link on the sign-in host, the token in its fragment  
✅ `10:53:05` DELETE /api/invitations/<id>: 200  
✅ `10:53:05` …revoked, the row kept  
✅ `10:53:05` …by the administrator  
✅ `10:53:06` The link: 410  

## Five refused acceptances lock a link

✅ `10:53:06` e2e55-coord invites a3: 201  
✅ `10:53:06` …a link on the sign-in host, the token in its fragment  
✅ `10:53:06` Refused username 1: 409  
✅ `10:53:06` Refused username 2: 409  
✅ `10:53:06` Refused username 3: 409  
✅ `10:53:06` Refused username 4: 409  
✅ `10:53:06` Four: still pending  
✅ `10:53:07` The fifth: 409  
✅ `10:53:07` …the link is locked  
✅ `10:53:07` A free username now: 410  
✅ `10:53:07` The inviter sees why  

## The policy: a domain removed, a shorter lifetime, turned off

✅ `10:53:07` e2e55-coord invites an address under the second domain: 201  
✅ `10:53:07` …a link on the sign-in host, the token in its fragment  
✅ `10:53:07` …and one under the first: 201  
✅ `10:53:07` …a link on the sign-in host, the token in its fragment  
✅ `10:53:07` The administrator removes client.example and shortens the lifetime to 2 days  
✅ `10:53:08` The invitation under the removed domain is revoked  
✅ `10:53:08` …its link 410  
✅ `10:53:08` The other stays pending  
✅ `10:53:08` …its expiry brought within the two days  
✅ `10:53:08` The policy turned off  
✅ `10:53:08` The open invitation is revoked  
✅ `10:53:08` …its link 410  
✅ `10:53:08` The inviter's API: 403  
✅ `10:53:09` On again  

## An invitee joins; their inviter loses the role

✅ `10:53:09` e2e55-coord2 invites c1: 201  
✅ `10:53:09` …a link on the sign-in host, the token in its fragment  
✅ `10:53:09` e2e55-first accepts  
✅ `10:53:10` users.yml gives e2e55-first the site's hostname  
✅ `10:53:11` e2e55-first signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:53:12` e2e55-first: the shell  

## The inviter's site grant goes: the role alone no longer invites

✅ `10:53:12` e2e55-coord2 invites c2, pending: 201  
✅ `10:53:12` …a link on the sign-in host, the token in its fragment  
✅ `10:53:12` e2e55-coord2's site grant revoked, the role left in place  
✅ `10:53:12` e2e55-coord2 on the inviter's API: 403  
✅ `10:53:12` Their open invitation cannot be accepted  
✅ `10:53:12` …revoked at the claim  
✅ `10:53:12` …no account  

## The inviter's role goes: their pending ones end; the person they invited stays (D1)

✅ `10:53:12` e2e55-coord invites d1, pending: 201  
✅ `10:53:12` …a link on the sign-in host, the token in its fragment  
✅ `10:53:13` e2e55-coord2's role removed  
✅ `10:53:13` e2e55-first, whom e2e55-coord2 invited, stays in the audience  
✅ `10:53:13` …and reaches the API  
✅ `10:53:13` …and the shell  
✅ `10:53:13` e2e55-coord's role removed  
✅ `10:53:13` Their pending invitation ends revoked (inviter_unentitled)  
✅ `10:53:13` …its link 410  
✅ `10:53:13` e2e55-coord entitled as coordinator  
✅ `10:53:13` e2e55-coord is a coordinator again  

## A chain: a coordinator invites a coordinator, who invites a viewer

✅ `10:53:14` e2e55-coord invites a coordinator: 201  
✅ `10:53:14` …a link on the sign-in host, the token in its fragment  
✅ `10:53:14` e2e55-chain accepts  
✅ `10:53:15` e2e55-chain is a coordinator  
✅ `10:53:15` users.yml gives e2e55-chain the site's hostname  
✅ `10:53:16` e2e55-chain signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:53:16` e2e55-chain invites a viewer: 201  
✅ `10:53:16` …a link on the sign-in host, the token in its fragment  
✅ `10:53:17` e2e55-leaf accepts  
✅ `10:53:17` users.yml gives e2e55-leaf the site's hostname  
✅ `10:53:18` e2e55-leaf signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:53:18` e2e55-leaf: the API  
✅ `10:53:19` e2e55-chain: the API  

## disable-invitees, transitive: both sessions end at once

✅ `10:53:19` POST /api/invitations/disable-invitees {transitive}: 200  
✅ `10:53:19` …the coordinator's invitee and theirs  
✅ `10:53:19` e2e55-leaf's session: 401 at once  
✅ `10:53:19` e2e55-chain's session: 401 at once  
✅ `10:53:19` e2e55-coord is untouched  
✅ `10:53:19` The directory holds e2e55-leaf disabled  
✅ `10:53:19` Audited invitation.invitees.disabled  

## A revocation racing an acceptance: 'marked' never leaves a working link

✅ `10:53:19` Race 1: an invitation: 201  
✅ `10:53:19` …a link on the sign-in host, the token in its fragment  
ℹ️ `10:53:20` Race 1: DELETE answered 202 marked  
✅ `10:53:24` Race 1: marked, and it ended revoked by the administrator  
✅ `10:53:24` …the link stays dead  
✅ `10:53:24` …it made no account  
✅ `10:53:24` Race 2: an invitation: 201  
✅ `10:53:24` …a link on the sign-in host, the token in its fragment  
ℹ️ `10:53:25` Race 2: DELETE answered 202 marked  
✅ `10:53:29` Race 2: marked, and it ended revoked by the administrator  
✅ `10:53:29` …the link stays dead  
✅ `10:53:29` …it made no account  
ℹ️ `10:53:29` A revocation landed on an acceptance under way 2 time(s)  
✅ `10:53:30` The races' invitees disabled (cleanup of who joined)  

## The web surface deleted: what named it ends

✅ `10:53:30` e2e55-coord invites f1: 201  
✅ `10:53:30` …a link on the sign-in host, the token in its fragment  
✅ `10:53:30` The web surface deleted  
✅ `10:53:30` The open invitation is revoked (surface_removed)  
✅ `10:53:30` …its link 410  

## Audited; nothing restarted Authelia

✅ `10:53:30` A revocation is audited once  
✅ `10:53:30` …with no address  
✅ `10:53:31` invitation.created holds no address  
✅ `10:53:31` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `10:53:31` Cleaning up test resources...  
