# Lamaste E2E: 55 — Delegated invitations: revocation ends access (Three-VM)

> Started at `2026-11-10 19:13:27 UTC`


## Pre-flight

✅ `19:13:27` Onboarding is complete  
✅ `19:13:28` Agent test-agent is enrolled on the host  
✅ `19:13:28` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:13:28` The agent VM's lamaste-agent has the apphost command  
✅ `19:13:28` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `19:13:29` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; two coordinators; the plugin, its restricted web surface, invitations on

✅ `19:13:30` Domain lamaste-second.local added (201)  
✅ `19:13:30` …pending until activated  
✅ `19:13:30` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `19:13:30` …the one required record is auth.lamaste-second.local  
✅ `19:13:31` lamaste-second.local is active  
✅ `19:13:32` User e2e55-coord created, member of lamaste-second.local (external)  
✅ `19:13:33` User e2e55-coord2 created, member of lamaste-second.local (external)  
✅ `19:13:33` Fixture built: @lamalibre/e2e-xinv-server  
✅ `19:13:43` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `19:13:43` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:13:44` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:13:44.368Z"})  
✅ `19:13:44` …through its own OIDC client  
✅ `19:13:45` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:13:50` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `19:13:50` …approved  
✅ `19:13:50` …moved to B, before any surface  
✅ `19:14:01` …hosted on test-agent ()  
✅ `19:14:14` …its hosting is up  
✅ `19:14:15` …ready: its agent half's first complete sync ended at the head  
✅ `19:14:17` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `19:14:17` …the site e2e55web.lamaste-second.local, restricted, on B  
✅ `19:14:17` …served  
✅ `19:14:18` e2e55-coord entitled as coordinator  
✅ `19:14:18` e2e55-coord2 entitled as coordinator  
✅ `19:14:18` Granted site 81182432-6624-413d-82a7-6bb3763c1129 to user e2e55-coord  
✅ `19:14:18` Granted site 81182432-6624-413d-82a7-6bb3763c1129 to user e2e55-coord2  
✅ `19:14:18` The audience holds e2e55-coord  
✅ `19:14:18` …and e2e55-coord2  
✅ `19:14:19` Invitations enabled: two e-mail domains, 14 days  
✅ `19:14:21` e2e55-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:14:23` e2e55-coord2 signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter revokes their own; another inviter cannot

✅ `19:14:23` e2e55-coord invites a1: 201  
✅ `19:14:23` …a link on the sign-in host, the token in its fragment  
✅ `19:14:23` e2e55-coord2 revokes e2e55-coord's: 404, as none at all  
✅ `19:14:23` …it stays pending  
✅ `19:14:24` e2e55-coord revokes their own: 200  
✅ `19:14:24` …revoked, by the inviter  
✅ `19:14:24` The link: lookup 410  
✅ `19:14:24` …accept 410  
✅ `19:14:24` …no account  

## The administrator revokes any

✅ `19:14:25` e2e55-coord invites a2: 201  
✅ `19:14:25` …a link on the sign-in host, the token in its fragment  
✅ `19:14:25` DELETE /api/invitations/<id>: 200  
✅ `19:14:25` …revoked, the row kept  
✅ `19:14:25` …by the administrator  
✅ `19:14:25` The link: 410  

## Five refused acceptances lock a link

✅ `19:14:25` e2e55-coord invites a3: 201  
✅ `19:14:25` …a link on the sign-in host, the token in its fragment  
✅ `19:14:25` Refused username 1: 409  
✅ `19:14:26` Refused username 2: 409  
✅ `19:14:26` Refused username 3: 409  
✅ `19:14:26` Refused username 4: 409  
✅ `19:14:26` Four: still pending  
✅ `19:14:26` The fifth: 409  
✅ `19:14:26` …the link is locked  
✅ `19:14:26` A free username now: 410  
✅ `19:14:27` The inviter sees why  

## The policy: a domain removed, a shorter lifetime, turned off

✅ `19:14:27` e2e55-coord invites an address under the second domain: 201  
✅ `19:14:27` …a link on the sign-in host, the token in its fragment  
✅ `19:14:27` …and one under the first: 201  
✅ `19:14:27` …a link on the sign-in host, the token in its fragment  
✅ `19:14:27` The administrator removes client.example and shortens the lifetime to 2 days  
✅ `19:14:27` The invitation under the removed domain is revoked  
✅ `19:14:28` …its link 410  
✅ `19:14:28` The other stays pending  
✅ `19:14:28` …its expiry brought within the two days  
✅ `19:14:28` The policy turned off  
✅ `19:14:28` The open invitation is revoked  
✅ `19:14:29` …its link 410  
✅ `19:14:29` The inviter's API: 403  
✅ `19:14:29` On again  

## An invitee joins; their inviter loses the role

✅ `19:14:29` e2e55-coord2 invites c1: 201  
✅ `19:14:29` …a link on the sign-in host, the token in its fragment  
✅ `19:14:30` e2e55-first accepts  
✅ `19:14:30` users.yml gives e2e55-first the site's hostname  
✅ `19:14:32` e2e55-first signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:14:32` e2e55-first: the shell  

## The inviter's site grant goes: the role alone no longer invites

✅ `19:14:33` e2e55-coord2 invites c2, pending: 201  
✅ `19:14:33` …a link on the sign-in host, the token in its fragment  
✅ `19:14:33` e2e55-coord2's site grant revoked, the role left in place  
✅ `19:14:33` e2e55-coord2 on the inviter's API: 403  
✅ `19:14:33` Their open invitation cannot be accepted  
✅ `19:14:33` …revoked at the claim  
✅ `19:14:33` …no account  

## The inviter's role goes: their pending ones end; the person they invited stays (D1)

✅ `19:14:34` e2e55-coord invites d1, pending: 201  
✅ `19:14:34` …a link on the sign-in host, the token in its fragment  
✅ `19:14:34` e2e55-coord2's role removed  
✅ `19:14:34` e2e55-first, whom e2e55-coord2 invited, stays in the audience  
✅ `19:14:34` …and reaches the API  
✅ `19:14:34` …and the shell  
✅ `19:14:34` e2e55-coord's role removed  
✅ `19:14:34` Their pending invitation ends revoked (inviter_unentitled)  
✅ `19:14:35` …its link 410  
✅ `19:14:35` e2e55-coord entitled as coordinator  
✅ `19:14:35` e2e55-coord is a coordinator again  

## A chain: a coordinator invites a coordinator, who invites a viewer

✅ `19:14:35` e2e55-coord invites a coordinator: 201  
✅ `19:14:35` …a link on the sign-in host, the token in its fragment  
✅ `19:14:36` e2e55-chain accepts  
✅ `19:14:36` e2e55-chain is a coordinator  
✅ `19:14:36` users.yml gives e2e55-chain the site's hostname  
✅ `19:14:38` e2e55-chain signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:14:38` e2e55-chain invites a viewer: 201  
✅ `19:14:38` …a link on the sign-in host, the token in its fragment  
✅ `19:14:39` e2e55-leaf accepts  
✅ `19:14:39` users.yml gives e2e55-leaf the site's hostname  
✅ `19:14:41` e2e55-leaf signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:14:41` e2e55-leaf: the API  
✅ `19:14:41` e2e55-chain: the API  

## disable-invitees, transitive: both sessions end at once

✅ `19:14:41` POST /api/invitations/disable-invitees {transitive}: 200  
✅ `19:14:41` …the coordinator's invitee and theirs  
✅ `19:14:42` e2e55-leaf's session: 401 at once  
✅ `19:14:42` e2e55-chain's session: 401 at once  
✅ `19:14:42` e2e55-coord is untouched  
✅ `19:14:42` The directory holds e2e55-leaf disabled  
✅ `19:14:42` Audited invitation.invitees.disabled  

## A revocation racing an acceptance: 'marked' never leaves a working link

✅ `19:14:42` Race 1: an invitation: 201  
✅ `19:14:42` …a link on the sign-in host, the token in its fragment  
ℹ️ `19:14:43` Race 1: DELETE answered 202 marked  
✅ `19:14:47` Race 1: marked, and it ended revoked by the administrator  
✅ `19:14:47` …the link stays dead  
✅ `19:14:47` …it made no account  
✅ `19:14:48` Race 2: an invitation: 201  
✅ `19:14:48` …a link on the sign-in host, the token in its fragment  
ℹ️ `19:14:48` Race 2: DELETE answered 202 marked  
✅ `19:14:52` Race 2: marked, and it ended revoked by the administrator  
✅ `19:14:52` …the link stays dead  
✅ `19:14:53` …it made no account  
ℹ️ `19:14:53` A revocation landed on an acceptance under way 2 time(s)  
✅ `19:14:53` The races' invitees disabled (cleanup of who joined)  

## The web surface deleted: what named it ends

✅ `19:14:53` e2e55-coord invites f1: 201  
✅ `19:14:53` …a link on the sign-in host, the token in its fragment  
✅ `19:14:53` The web surface deleted  
✅ `19:14:53` The open invitation is revoked (surface_removed)  
✅ `19:14:54` …its link 410  

## Audited; nothing restarted Authelia

✅ `19:14:54` A revocation is audited once  
✅ `19:14:54` …with no address  
✅ `19:14:54` invitation.created holds no address  
✅ `19:14:54` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `19:14:54` Cleaning up test resources...  
