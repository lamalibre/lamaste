# Lamaste E2E: 55 — Delegated invitations: revocation ends access (Three-VM)

> Started at `2026-11-02 17:07:32 UTC`


## Pre-flight

✅ `17:07:32` Onboarding is complete  
✅ `17:07:32` Agent test-agent is enrolled on the host  
✅ `17:07:33` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:07:33` The agent VM's lamaste-agent has the apphost command  
✅ `17:07:33` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `17:07:33` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; two coordinators; the plugin, its restricted web surface, invitations on

✅ `17:07:34` Domain lamaste-second.local added (201)  
✅ `17:07:34` …pending until activated  
✅ `17:07:34` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `17:07:34` …the one required record is auth.lamaste-second.local  
✅ `17:07:35` lamaste-second.local is active  
✅ `17:07:36` User e2e55-coord created, member of lamaste-second.local (external)  
✅ `17:07:37` User e2e55-coord2 created, member of lamaste-second.local (external)  
✅ `17:07:37` Fixture built: @lamalibre/e2e-xinv-server  
✅ `17:07:39` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `17:07:39` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:07:41` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T17:07:41.636Z"})  
✅ `17:07:41` …through its own OIDC client  
✅ `17:07:41` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:07:44` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `17:07:44` …approved  
✅ `17:07:44` …moved to B, before any surface  
✅ `17:07:55` …hosted on test-agent ()  
✅ `17:08:11` …its hosting is up  
✅ `17:08:11` …ready: its agent half's first complete sync ended at the head  
✅ `17:08:14` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `17:08:14` …the site e2e55web.lamaste-second.local, restricted, on B  
✅ `17:08:14` …served  
✅ `17:08:14` e2e55-coord entitled as coordinator  
✅ `17:08:14` e2e55-coord2 entitled as coordinator  
✅ `17:08:14` Granted site 0550e19a-fe2a-4daa-a025-c8749aa82b41 to user e2e55-coord  
✅ `17:08:14` Granted site 0550e19a-fe2a-4daa-a025-c8749aa82b41 to user e2e55-coord2  
✅ `17:08:14` The audience holds e2e55-coord  
✅ `17:08:15` …and e2e55-coord2  
✅ `17:08:15` Invitations enabled: two e-mail domains, 14 days  
✅ `17:08:16` e2e55-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:08:18` e2e55-coord2 signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter revokes their own; another inviter cannot

✅ `17:08:19` e2e55-coord invites a1: 201  
✅ `17:08:19` …a link on the sign-in host, the token in its fragment  
✅ `17:08:19` e2e55-coord2 revokes e2e55-coord's: 404, as none at all  
✅ `17:08:19` …it stays pending  
✅ `17:08:19` e2e55-coord revokes their own: 200  
✅ `17:08:19` …revoked, by the inviter  
✅ `17:08:19` The link: lookup 410  
✅ `17:08:19` …accept 410  
✅ `17:08:19` …no account  

## The administrator revokes any

✅ `17:08:19` e2e55-coord invites a2: 201  
✅ `17:08:19` …a link on the sign-in host, the token in its fragment  
✅ `17:08:20` DELETE /api/invitations/<id>: 200  
✅ `17:08:20` …revoked, the row kept  
✅ `17:08:20` …by the administrator  
✅ `17:08:20` The link: 410  

## Five refused acceptances lock a link

✅ `17:08:20` e2e55-coord invites a3: 201  
✅ `17:08:20` …a link on the sign-in host, the token in its fragment  
✅ `17:08:20` Refused username 1: 409  
✅ `17:08:20` Refused username 2: 409  
✅ `17:08:20` Refused username 3: 409  
✅ `17:08:20` Refused username 4: 409  
✅ `17:08:20` Four: still pending  
✅ `17:08:21` The fifth: 409  
✅ `17:08:21` …the link is locked  
✅ `17:08:21` A free username now: 410  
✅ `17:08:21` The inviter sees why  

## The policy: a domain removed, a shorter lifetime, turned off

✅ `17:08:21` e2e55-coord invites an address under the second domain: 201  
✅ `17:08:21` …a link on the sign-in host, the token in its fragment  
✅ `17:08:21` …and one under the first: 201  
✅ `17:08:21` …a link on the sign-in host, the token in its fragment  
✅ `17:08:21` The administrator removes client.example and shortens the lifetime to 2 days  
✅ `17:08:22` The invitation under the removed domain is revoked  
✅ `17:08:22` …its link 410  
✅ `17:08:22` The other stays pending  
✅ `17:08:22` …its expiry brought within the two days  
✅ `17:08:22` The policy turned off  
✅ `17:08:22` The open invitation is revoked  
✅ `17:08:22` …its link 410  
✅ `17:08:22` The inviter's API: 403  
✅ `17:08:22` On again  

## An invitee joins; their inviter loses the role

✅ `17:08:23` e2e55-coord2 invites c1: 201  
✅ `17:08:23` …a link on the sign-in host, the token in its fragment  
✅ `17:08:23` e2e55-first accepts  
✅ `17:08:23` users.yml gives e2e55-first the site's hostname  
✅ `17:08:25` e2e55-first signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:08:25` e2e55-first: the shell  

## The inviter's site grant goes: the role alone no longer invites

✅ `17:08:25` e2e55-coord2 invites c2, pending: 201  
✅ `17:08:25` …a link on the sign-in host, the token in its fragment  
✅ `17:08:25` e2e55-coord2's site grant revoked, the role left in place  
✅ `17:08:25` e2e55-coord2 on the inviter's API: 403  
✅ `17:08:25` Their open invitation cannot be accepted  
✅ `17:08:26` …revoked at the claim  
✅ `17:08:26` …no account  

## The inviter's role goes: their pending ones end; the person they invited stays (D1)

✅ `17:08:26` e2e55-coord invites d1, pending: 201  
✅ `17:08:26` …a link on the sign-in host, the token in its fragment  
✅ `17:08:26` e2e55-coord2's role removed  
✅ `17:08:26` e2e55-first, whom e2e55-coord2 invited, stays in the audience  
✅ `17:08:26` …and reaches the API  
✅ `17:08:26` …and the shell  
✅ `17:08:26` e2e55-coord's role removed  
✅ `17:08:26` Their pending invitation ends revoked (inviter_unentitled)  
✅ `17:08:27` …its link 410  
✅ `17:08:27` e2e55-coord entitled as coordinator  
✅ `17:08:27` e2e55-coord is a coordinator again  

## A chain: a coordinator invites a coordinator, who invites a viewer

✅ `17:08:27` e2e55-coord invites a coordinator: 201  
✅ `17:08:27` …a link on the sign-in host, the token in its fragment  
✅ `17:08:27` e2e55-chain accepts  
✅ `17:08:28` e2e55-chain is a coordinator  
✅ `17:08:28` users.yml gives e2e55-chain the site's hostname  
✅ `17:08:29` e2e55-chain signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:08:29` e2e55-chain invites a viewer: 201  
✅ `17:08:29` …a link on the sign-in host, the token in its fragment  
✅ `17:08:30` e2e55-leaf accepts  
✅ `17:08:31` users.yml gives e2e55-leaf the site's hostname  
✅ `17:08:32` e2e55-leaf signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:08:32` e2e55-leaf: the API  
✅ `17:08:32` e2e55-chain: the API  

## disable-invitees, transitive: both sessions end at once

✅ `17:08:33` POST /api/invitations/disable-invitees {transitive}: 200  
✅ `17:08:33` …the coordinator's invitee and theirs  
✅ `17:08:33` e2e55-leaf's session: 401 at once  
✅ `17:08:33` e2e55-chain's session: 401 at once  
✅ `17:08:33` e2e55-coord is untouched  
✅ `17:08:33` The directory holds e2e55-leaf disabled  
✅ `17:08:33` Audited invitation.invitees.disabled  

## A revocation racing an acceptance: 'marked' never leaves a working link

✅ `17:08:33` Race 1: an invitation: 201  
✅ `17:08:33` …a link on the sign-in host, the token in its fragment  
ℹ️ `17:08:34` Race 1: DELETE answered 202 marked  
✅ `17:08:38` Race 1: marked, and it ended revoked by the administrator  
✅ `17:08:38` …the link stays dead  
✅ `17:08:38` …it made no account  
✅ `17:08:39` Race 2: an invitation: 201  
✅ `17:08:39` …a link on the sign-in host, the token in its fragment  
ℹ️ `17:08:39` Race 2: DELETE answered 202 marked  
✅ `17:08:43` Race 2: marked, and it ended revoked by the administrator  
✅ `17:08:43` …the link stays dead  
✅ `17:08:44` …it made no account  
ℹ️ `17:08:44` A revocation landed on an acceptance under way 2 time(s)  
✅ `17:08:44` The races' invitees disabled (cleanup of who joined)  

## The web surface deleted: what named it ends

✅ `17:08:44` e2e55-coord invites f1: 201  
✅ `17:08:44` …a link on the sign-in host, the token in its fragment  
✅ `17:08:44` The web surface deleted  
✅ `17:08:44` The open invitation is revoked (surface_removed)  
✅ `17:08:44` …its link 410  

## Audited; nothing restarted Authelia

✅ `17:08:45` A revocation is audited once  
✅ `17:08:45` …with no address  
✅ `17:08:45` invitation.created holds no address  
✅ `17:08:45` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `17:08:45` Cleaning up test resources...  
