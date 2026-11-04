# Lamaste E2E: 55 — Delegated invitations: revocation ends access (Three-VM)

> Started at `2026-11-04 14:56:34 UTC`


## Pre-flight

✅ `14:56:34` Onboarding is complete  
✅ `14:56:34` Agent test-agent is enrolled on the host  
✅ `14:56:35` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:56:35` The agent VM's lamaste-agent has the apphost command  
✅ `14:56:35` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:56:35` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; two coordinators; the plugin, its restricted web surface, invitations on

✅ `14:56:36` Domain lamaste-second.local added (201)  
✅ `14:56:36` …pending until activated  
✅ `14:56:37` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:56:37` …the one required record is auth.lamaste-second.local  
✅ `14:56:38` lamaste-second.local is active  
✅ `14:56:38` User e2e55-coord created, member of lamaste-second.local (external)  
✅ `14:56:39` User e2e55-coord2 created, member of lamaste-second.local (external)  
✅ `14:56:39` Fixture built: @lamalibre/e2e-xinv-server  
✅ `14:56:42` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `14:56:42` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:56:43` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:56:44.102Z"})  
✅ `14:56:43` …through its own OIDC client  
✅ `14:56:44` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:56:46` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:56:47` …approved  
✅ `14:56:47` …moved to B, before any surface  
✅ `14:56:57` …hosted on test-agent ()  
✅ `14:57:11` …its hosting is up  
✅ `14:57:11` …ready: its agent half's first complete sync ended at the head  
✅ `14:57:13` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:57:13` …the site e2e55web.lamaste-second.local, restricted, on B  
✅ `14:57:13` …served  
✅ `14:57:14` e2e55-coord entitled as coordinator  
✅ `14:57:14` e2e55-coord2 entitled as coordinator  
✅ `14:57:14` Granted site 760dd276-4d9c-4c58-99de-88d327b5e25c to user e2e55-coord  
✅ `14:57:14` Granted site 760dd276-4d9c-4c58-99de-88d327b5e25c to user e2e55-coord2  
✅ `14:57:14` The audience holds e2e55-coord  
✅ `14:57:14` …and e2e55-coord2  
✅ `14:57:14` Invitations enabled: two e-mail domains, 14 days  
✅ `14:57:16` e2e55-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:57:18` e2e55-coord2 signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter revokes their own; another inviter cannot

✅ `14:57:18` e2e55-coord invites a1: 201  
✅ `14:57:18` …a link on the sign-in host, the token in its fragment  
✅ `14:57:18` e2e55-coord2 revokes e2e55-coord's: 404, as none at all  
✅ `14:57:19` …it stays pending  
✅ `14:57:19` e2e55-coord revokes their own: 200  
✅ `14:57:19` …revoked, by the inviter  
✅ `14:57:19` The link: lookup 410  
✅ `14:57:19` …accept 410  
✅ `14:57:19` …no account  

## The administrator revokes any

✅ `14:57:19` e2e55-coord invites a2: 201  
✅ `14:57:19` …a link on the sign-in host, the token in its fragment  
✅ `14:57:19` DELETE /api/invitations/<id>: 200  
✅ `14:57:19` …revoked, the row kept  
✅ `14:57:19` …by the administrator  
✅ `14:57:20` The link: 410  

## Five refused acceptances lock a link

✅ `14:57:20` e2e55-coord invites a3: 201  
✅ `14:57:20` …a link on the sign-in host, the token in its fragment  
✅ `14:57:20` Refused username 1: 409  
✅ `14:57:20` Refused username 2: 409  
✅ `14:57:20` Refused username 3: 409  
✅ `14:57:20` Refused username 4: 409  
✅ `14:57:20` Four: still pending  
✅ `14:57:20` The fifth: 409  
✅ `14:57:21` …the link is locked  
✅ `14:57:21` A free username now: 410  
✅ `14:57:21` The inviter sees why  

## The policy: a domain removed, a shorter lifetime, turned off

✅ `14:57:21` e2e55-coord invites an address under the second domain: 201  
✅ `14:57:21` …a link on the sign-in host, the token in its fragment  
✅ `14:57:21` …and one under the first: 201  
✅ `14:57:21` …a link on the sign-in host, the token in its fragment  
✅ `14:57:21` The administrator removes client.example and shortens the lifetime to 2 days  
✅ `14:57:22` The invitation under the removed domain is revoked  
✅ `14:57:22` …its link 410  
✅ `14:57:22` The other stays pending  
✅ `14:57:22` …its expiry brought within the two days  
✅ `14:57:22` The policy turned off  
✅ `14:57:22` The open invitation is revoked  
✅ `14:57:22` …its link 410  
✅ `14:57:22` The inviter's API: 403  
✅ `14:57:22` On again  

## An invitee joins; their inviter loses the role

✅ `14:57:23` e2e55-coord2 invites c1: 201  
✅ `14:57:23` …a link on the sign-in host, the token in its fragment  
✅ `14:57:23` e2e55-first accepts  
✅ `14:57:23` users.yml gives e2e55-first the site's hostname  
✅ `14:57:25` e2e55-first signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:57:25` e2e55-first: the shell  

## The inviter's site grant goes: the role alone no longer invites

✅ `14:57:25` e2e55-coord2 invites c2, pending: 201  
✅ `14:57:25` …a link on the sign-in host, the token in its fragment  
✅ `14:57:26` e2e55-coord2's site grant revoked, the role left in place  
✅ `14:57:26` e2e55-coord2 on the inviter's API: 403  
✅ `14:57:26` Their open invitation cannot be accepted  
✅ `14:57:26` …revoked at the claim  
✅ `14:57:26` …no account  

## The inviter's role goes: their pending ones end; the person they invited stays (D1)

✅ `14:57:26` e2e55-coord invites d1, pending: 201  
✅ `14:57:26` …a link on the sign-in host, the token in its fragment  
✅ `14:57:26` e2e55-coord2's role removed  
✅ `14:57:26` e2e55-first, whom e2e55-coord2 invited, stays in the audience  
✅ `14:57:27` …and reaches the API  
✅ `14:57:27` …and the shell  
✅ `14:57:27` e2e55-coord's role removed  
✅ `14:57:30` Their pending invitation ends revoked (inviter_unentitled)  
✅ `14:57:30` …its link 410  
✅ `14:57:30` e2e55-coord entitled as coordinator  
✅ `14:57:31` e2e55-coord is a coordinator again  

## A chain: a coordinator invites a coordinator, who invites a viewer

✅ `14:57:31` e2e55-coord invites a coordinator: 201  
✅ `14:57:31` …a link on the sign-in host, the token in its fragment  
✅ `14:57:31` e2e55-chain accepts  
✅ `14:57:32` e2e55-chain is a coordinator  
✅ `14:57:32` users.yml gives e2e55-chain the site's hostname  
✅ `14:57:33` e2e55-chain signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:57:33` e2e55-chain invites a viewer: 201  
✅ `14:57:33` …a link on the sign-in host, the token in its fragment  
✅ `14:57:34` e2e55-leaf accepts  
✅ `14:57:34` users.yml gives e2e55-leaf the site's hostname  
✅ `14:57:36` e2e55-leaf signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:57:36` e2e55-leaf: the API  
✅ `14:57:36` e2e55-chain: the API  

## disable-invitees, transitive: both sessions end at once

✅ `14:57:36` POST /api/invitations/disable-invitees {transitive}: 200  
✅ `14:57:36` …the coordinator's invitee and theirs  
✅ `14:57:36` e2e55-leaf's session: 401 at once  
✅ `14:57:37` e2e55-chain's session: 401 at once  
✅ `14:57:37` e2e55-coord is untouched  
✅ `14:57:37` The directory holds e2e55-leaf disabled  
✅ `14:57:37` Audited invitation.invitees.disabled  

## A revocation racing an acceptance: 'marked' never leaves a working link

✅ `14:57:37` Race 1: an invitation: 201  
✅ `14:57:37` …a link on the sign-in host, the token in its fragment  
ℹ️ `14:57:37` Race 1: DELETE answered 202 marked  
✅ `14:57:42` Race 1: marked, and it ended revoked by the administrator  
✅ `14:57:42` …the link stays dead  
✅ `14:57:42` …it made no account  
✅ `14:57:42` Race 2: an invitation: 201  
✅ `14:57:42` …a link on the sign-in host, the token in its fragment  
ℹ️ `14:57:42` Race 2: DELETE answered 202 marked  
✅ `14:57:47` Race 2: marked, and it ended revoked by the administrator  
✅ `14:57:47` …the link stays dead  
✅ `14:57:47` …it made no account  
ℹ️ `14:57:47` A revocation landed on an acceptance under way 2 time(s)  
✅ `14:57:47` The races' invitees disabled (cleanup of who joined)  

## The web surface deleted: what named it ends

✅ `14:57:47` e2e55-coord invites f1: 201  
✅ `14:57:47` …a link on the sign-in host, the token in its fragment  
✅ `14:57:48` The web surface deleted  
✅ `14:57:48` The open invitation is revoked (surface_removed)  
✅ `14:57:48` …its link 410  

## Audited; nothing restarted Authelia

✅ `14:57:48` A revocation is audited once  
✅ `14:57:48` …with no address  
✅ `14:57:48` invitation.created holds no address  
✅ `14:57:48` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `14:57:48` Cleaning up test resources...  
