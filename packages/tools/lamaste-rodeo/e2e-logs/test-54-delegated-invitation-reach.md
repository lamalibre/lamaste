# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-03 10:45:14 UTC`


## Pre-flight

✅ `10:45:14` Onboarding is complete  
✅ `10:45:14` Agent test-agent is enrolled on the host  
✅ `10:45:15` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:45:15` The agent VM's lamaste-agent has the apphost command  
✅ `10:45:15` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:45:15` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `10:45:16` Domain lamaste-second.local added (201)  
✅ `10:45:16` …pending until activated  
✅ `10:45:16` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:45:16` …the one required record is auth.lamaste-second.local  
✅ `10:45:17` lamaste-second.local is active  
✅ `10:45:18` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `10:45:19` User e2e54-member-1793702714 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `10:45:19` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `10:45:38` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `10:45:38` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:45:39` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-03T10:45:39.587Z"})  
✅ `10:45:39` …through its own OIDC client  
✅ `10:45:43` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:45:48` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `10:45:48` …approved  
✅ `10:45:48` …moved to B, before any surface  
✅ `10:45:59` …hosted on test-agent ()  
✅ `10:46:15` …its hosting is up  
✅ `10:46:15` …ready: its agent half's first complete sync ended at the head  
✅ `10:46:20` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `10:46:20` …approved  
✅ `10:46:20` …moved to B, before any surface  
✅ `10:46:31` …hosted on test-agent ()  
✅ `10:46:47` …its hosting is up  
✅ `10:46:47` …ready: its agent half's first complete sync ended at the head  
✅ `10:46:49` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `10:46:49` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `10:46:49` …served  
✅ `10:46:51` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `10:46:51` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `10:46:51` …served  
✅ `10:46:55` Installed @lamalibre/e2e-emoidc-server  
✅ `10:46:55` …on B  
✅ `10:46:56` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `10:46:58` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:47:00` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `10:47:02` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `10:47:03` Port 19954: the backend answers through chisel  
✅ `10:47:03` Port 19955: the backend answers through chisel  
✅ `10:47:06` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `10:47:07` e2e54-coord entitled as coordinator  
✅ `10:47:07` Granted site 03be24f8-9e6e-41c8-851b-2a2952c65be1 to user e2e54-coord  
✅ `10:47:07` The audience holds e2e54-coord as coordinator  
✅ `10:47:07` Invitations enabled for e2e-xinv  
✅ `10:47:09` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:47:11` e2e54-member-1793702714 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:47:11` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `10:47:11` …a link on the sign-in host, the token in its fragment  
✅ `10:47:12` Accepted  
✅ `10:47:12` …access complete  
✅ `10:47:12` …a directory user  
✅ `10:47:12` users.yml gives them the site's hostname  
✅ `10:47:13` e2e54-invitee-1793702714 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `10:47:14` e2e54-invitee-1793702714: the shell  
✅ `10:47:14` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `10:47:14` e2e54-invitee-1793702714 on the other plugin's shell: 403  
✅ `10:47:14` …the access-request page  
✅ `10:47:14` …not the domain refusal  
✅ `10:47:14` …never a redirect to a sign-in page  
✅ `10:47:14` …never its tree  
✅ `10:47:14` e2e54-invitee-1793702714 on the other plugin's API: 403  
✅ `10:47:14` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `10:47:14` …never a redirect  
✅ `10:47:14` The other plugin's audience does not hold them  
✅ `10:47:15` …nor its agent half  

## Nothing else on B: its tunnels

✅ `10:47:15` e2e54-invitee-1793702714 on B's authenticated tunnel: 403  
✅ `10:47:15` …the access-request page  
✅ `10:47:15` …not the domain refusal  
✅ `10:47:15` …never a redirect to a sign-in page  
✅ `10:47:15` …never its backend  
✅ `10:47:15` e2e54-member-1793702714, a member of B, on the same tunnel: 200  
✅ `10:47:15` …from its backend  
✅ `10:47:15` e2e54-invitee-1793702714 on B's restricted tunnel: 403  
✅ `10:47:15` …the access-request page  
✅ `10:47:15` …not the domain refusal  
✅ `10:47:15` …never a redirect to a sign-in page  
✅ `10:47:15` …never its backend  

## Nothing on A

✅ `10:47:33` e2e54-invitee-1793702714 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:47:33` e2e54-invitee-1793702714, signed in at A's portal, on A's tunnel: 403  
✅ `10:47:33` …the domain refusal page  
✅ `10:47:33` …naming test.lamaste.local  
✅ `10:47:33` …never a redirect to a sign-in page (no login loop)  
✅ `10:47:33` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `10:47:33` e2e54-member-1793702714, a member of B: the client's authorization request goes on  
✅ `10:47:34` e2e54-invitee-1793702714: refused (access_denied)  
✅ `10:47:34` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `10:47:34` e2e54-invitee-1793702714, a viewer, on the inviter's API: 403  
✅ `10:47:34` …role_not_grantable  
✅ `10:47:34` …and sees nothing of e2e54-coord's invitations  
✅ `10:47:34` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `10:47:34` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `10:47:34` Cleaning up test resources...  
