# Lamaste E2E: 55 — Delegated invitations: revocation ends access (Three-VM)

> Started at `2026-11-10 14:29:44 UTC`


## Pre-flight

✅ `14:29:44` Onboarding is complete  
✅ `14:29:45` Agent test-agent is enrolled on the host  
✅ `14:29:45` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:29:45` The agent VM's lamaste-agent has the apphost command  
✅ `14:29:45` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:29:46` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; two coordinators; the plugin, its restricted web surface, invitations on

✅ `14:29:47` Domain lamaste-second.local added (201)  
✅ `14:29:47` …pending until activated  
✅ `14:29:47` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:29:47` …the one required record is auth.lamaste-second.local  
✅ `14:29:48` lamaste-second.local is active  
✅ `14:29:49` User e2e55-coord created, member of lamaste-second.local (external)  
✅ `14:29:50` User e2e55-coord2 created, member of lamaste-second.local (external)  
✅ `14:29:50` Fixture built: @lamalibre/e2e-xinv-server  
✅ `14:29:59` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent )  
✅ `14:29:59` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:30:00` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:30:01.007Z"})  
✅ `14:30:00` …through its own OIDC client  
✅ `14:30:01` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:30:06` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:30:06` …approved  
✅ `14:30:07` …moved to B, before any surface  
✅ `14:30:18` …hosted on test-agent ()  
✅ `14:30:34` …its hosting is up  
✅ `14:30:34` …ready: its agent half's first complete sync ended at the head  
✅ `14:30:37` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:30:37` …the site e2e55web.lamaste-second.local, restricted, on B  
✅ `14:30:37` …served  
✅ `14:30:37` e2e55-coord entitled as coordinator  
✅ `14:30:37` e2e55-coord2 entitled as coordinator  
✅ `14:30:38` Granted site 940f9603-aac3-4a65-9cae-2cc524314932 to user e2e55-coord  
✅ `14:30:38` Granted site 940f9603-aac3-4a65-9cae-2cc524314932 to user e2e55-coord2  
✅ `14:30:38` The audience holds e2e55-coord  
✅ `14:30:38` …and e2e55-coord2  
✅ `14:30:38` Invitations enabled: two e-mail domains, 14 days  
✅ `14:30:40` e2e55-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:30:42` e2e55-coord2 signed in at auth.lamaste-second.local (password, TOTP)  

## The inviter revokes their own; another inviter cannot

✅ `14:30:43` e2e55-coord invites a1: 201  
✅ `14:30:43` …a link on the sign-in host, the token in its fragment  
✅ `14:30:43` e2e55-coord2 revokes e2e55-coord's: 404, as none at all  
✅ `14:30:44` …it stays pending  
✅ `14:30:44` e2e55-coord revokes their own: 200  
✅ `14:30:44` …revoked, by the inviter  
✅ `14:30:44` The link: lookup 410  
✅ `14:30:44` …accept 410  
✅ `14:30:44` …no account  

## The administrator revokes any

✅ `14:30:45` e2e55-coord invites a2: 201  
✅ `14:30:45` …a link on the sign-in host, the token in its fragment  
✅ `14:30:45` DELETE /api/invitations/<id>: 200  
✅ `14:30:45` …revoked, the row kept  
✅ `14:30:45` …by the administrator  
✅ `14:30:45` The link: 410  

## Five refused acceptances lock a link

✅ `14:30:45` e2e55-coord invites a3: 201  
✅ `14:30:45` …a link on the sign-in host, the token in its fragment  
✅ `14:30:46` Refused username 1: 409  
✅ `14:30:46` Refused username 2: 409  
✅ `14:30:46` Refused username 3: 409  
✅ `14:30:46` Refused username 4: 409  
✅ `14:30:46` Four: still pending  
✅ `14:30:46` The fifth: 409  
✅ `14:30:47` …the link is locked  
✅ `14:30:47` A free username now: 410  
✅ `14:30:47` The inviter sees why  

## The policy: a domain removed, a shorter lifetime, turned off

✅ `14:30:47` e2e55-coord invites an address under the second domain: 201  
✅ `14:30:47` …a link on the sign-in host, the token in its fragment  
✅ `14:30:47` …and one under the first: 201  
✅ `14:30:47` …a link on the sign-in host, the token in its fragment  
✅ `14:30:48` The administrator removes client.example and shortens the lifetime to 2 days  
✅ `14:30:48` The invitation under the removed domain is revoked  
✅ `14:30:48` …its link 410  
✅ `14:30:48` The other stays pending  
✅ `14:30:48` …its expiry brought within the two days  
✅ `14:30:48` The policy turned off  
✅ `14:30:48` The open invitation is revoked  
✅ `14:30:49` …its link 410  
✅ `14:30:49` The inviter's API: 403  
✅ `14:30:49` On again  

## An invitee joins; their inviter loses the role

✅ `14:30:49` e2e55-coord2 invites c1: 201  
✅ `14:30:49` …a link on the sign-in host, the token in its fragment  
✅ `14:30:50` e2e55-first accepts  
✅ `14:30:50` users.yml gives e2e55-first the site's hostname  
✅ `14:30:52` e2e55-first signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:30:52` e2e55-first: the shell  

## The inviter's site grant goes: the role alone no longer invites

✅ `14:30:52` e2e55-coord2 invites c2, pending: 201  
✅ `14:30:52` …a link on the sign-in host, the token in its fragment  
✅ `14:30:53` e2e55-coord2's site grant revoked, the role left in place  
✅ `14:30:53` e2e55-coord2 on the inviter's API: 403  
✅ `14:30:53` Their open invitation cannot be accepted  
✅ `14:30:53` …revoked at the claim  
✅ `14:30:53` …no account  

## The inviter's role goes: their pending ones end; the person they invited stays (D1)

✅ `14:30:53` e2e55-coord invites d1, pending: 201  
✅ `14:30:53` …a link on the sign-in host, the token in its fragment  
✅ `14:30:54` e2e55-coord2's role removed  
✅ `14:30:54` e2e55-first, whom e2e55-coord2 invited, stays in the audience  
✅ `14:30:54` …and reaches the API  
✅ `14:30:54` …and the shell  
✅ `14:30:54` e2e55-coord's role removed  
✅ `14:30:54` Their pending invitation ends revoked (inviter_unentitled)  
✅ `14:30:54` …its link 410  
✅ `14:30:55` e2e55-coord entitled as coordinator  
✅ `14:30:55` e2e55-coord is a coordinator again  

## A chain: a coordinator invites a coordinator, who invites a viewer

✅ `14:30:55` e2e55-coord invites a coordinator: 201  
✅ `14:30:55` …a link on the sign-in host, the token in its fragment  
✅ `14:30:56` e2e55-chain accepts  
✅ `14:30:56` e2e55-chain is a coordinator  
✅ `14:30:56` users.yml gives e2e55-chain the site's hostname  
✅ `14:30:58` e2e55-chain signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:30:58` e2e55-chain invites a viewer: 201  
✅ `14:30:58` …a link on the sign-in host, the token in its fragment  
✅ `14:30:59` e2e55-leaf accepts  
✅ `14:30:59` users.yml gives e2e55-leaf the site's hostname  
✅ `14:31:00` e2e55-leaf signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:31:01` e2e55-leaf: the API  
✅ `14:31:01` e2e55-chain: the API  

## disable-invitees, transitive: both sessions end at once

✅ `14:31:01` POST /api/invitations/disable-invitees {transitive}: 200  
✅ `14:31:01` …the coordinator's invitee and theirs  
✅ `14:31:01` e2e55-leaf's session: 401 at once  
✅ `14:31:01` e2e55-chain's session: 401 at once  
✅ `14:31:02` e2e55-coord is untouched  
✅ `14:31:02` The directory holds e2e55-leaf disabled  
✅ `14:31:02` Audited invitation.invitees.disabled  

## A revocation racing an acceptance: 'marked' never leaves a working link

✅ `14:31:02` Race 1: an invitation: 201  
✅ `14:31:02` …a link on the sign-in host, the token in its fragment  
ℹ️ `14:31:03` Race 1: DELETE answered 202 marked  
✅ `14:31:07` Race 1: marked, and it ended revoked by the administrator  
✅ `14:31:07` …the link stays dead  
✅ `14:31:07` …it made no account  
✅ `14:31:07` Race 2: an invitation: 201  
✅ `14:31:07` …a link on the sign-in host, the token in its fragment  
ℹ️ `14:31:08` Race 2: DELETE answered 202 marked  
✅ `14:31:12` Race 2: marked, and it ended revoked by the administrator  
✅ `14:31:12` …the link stays dead  
✅ `14:31:13` …it made no account  
ℹ️ `14:31:13` A revocation landed on an acceptance under way 2 time(s)  
✅ `14:31:13` The races' invitees disabled (cleanup of who joined)  

## The web surface deleted: what named it ends

✅ `14:31:13` e2e55-coord invites f1: 201  
✅ `14:31:13` …a link on the sign-in host, the token in its fragment  
✅ `14:31:13` The web surface deleted  
✅ `14:31:14` The open invitation is revoked (surface_removed)  
✅ `14:31:14` …its link 410  

## Audited; nothing restarted Authelia

✅ `14:31:14` A revocation is audited once  
✅ `14:31:14` …with no address  
✅ `14:31:14` invitation.created holds no address  
✅ `14:31:14` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `141` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `141` |

ℹ️ `14:31:14` Cleaning up test resources...  
