# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-09 13:56:11 UTC`


## Pre-flight

✅ `13:56:11` Onboarding is complete  
✅ `13:56:11` Agent test-agent is enrolled on the host  
✅ `13:56:11` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `13:56:11` The agent VM's lamaste-agent has the apphost command  
✅ `13:56:11` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `13:56:11` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `13:56:12` Domain lamaste-second.local added (201)  
✅ `13:56:12` …pending until activated  
✅ `13:56:13` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `13:56:13` …the one required record is auth.lamaste-second.local  
✅ `13:56:14` lamaste-second.local is active  
✅ `13:56:14` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `13:56:15` User e2e54-member-1794232571 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `13:56:15` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `13:56:34` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `13:56:34` The agent VM reaches it at http://10.13.37.1:4874  
✅ `13:56:35` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-09T13:56:35.728Z"})  
✅ `13:56:35` …through its own OIDC client  
✅ `13:56:39` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `13:56:44` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `13:56:44` …approved  
✅ `13:56:44` …moved to B, before any surface  
✅ `13:56:55` …hosted on test-agent ()  
✅ `13:57:12` …its hosting is up  
✅ `13:57:12` …ready: its agent half's first complete sync ended at the head  
✅ `13:57:16` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `13:57:16` …approved  
✅ `13:57:16` …moved to B, before any surface  
✅ `13:57:27` …hosted on test-agent ()  
✅ `13:57:43` …its hosting is up  
✅ `13:57:43` …ready: its agent half's first complete sync ended at the head  
✅ `13:57:45` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `13:57:45` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `13:57:45` …served  
✅ `13:57:47` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `13:57:47` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `13:57:47` …served  
✅ `13:57:51` Installed @lamalibre/e2e-emoidc-server  
✅ `13:57:52` …on B  
✅ `13:57:52` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `13:57:54` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `13:57:56` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `13:57:58` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `13:58:03` Port 19954: the backend answers through chisel  
✅ `13:58:03` Port 19955: the backend answers through chisel  
✅ `13:58:03` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `13:58:03` e2e54-coord entitled as coordinator  
✅ `13:58:03` Granted site 71740249-7283-452a-a504-eeb441d0a79f to user e2e54-coord  
✅ `13:58:03` The audience holds e2e54-coord as coordinator  
✅ `13:58:03` Invitations enabled for e2e-xinv  
✅ `13:58:05` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:58:07` e2e54-member-1794232571 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `13:58:07` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `13:58:07` …a link on the sign-in host, the token in its fragment  
✅ `13:58:08` Accepted  
✅ `13:58:08` …access complete  
✅ `13:58:08` …a directory user  
✅ `13:58:09` users.yml gives them the site's hostname  
✅ `13:58:10` e2e54-invitee-1794232571 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `13:58:10` e2e54-invitee-1794232571: the shell  
✅ `13:58:10` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `13:58:11` e2e54-invitee-1794232571 on the other plugin's shell: 403  
✅ `13:58:11` …the access-request page  
✅ `13:58:11` …not the domain refusal  
✅ `13:58:11` …never a redirect to a sign-in page  
✅ `13:58:11` …never its tree  
✅ `13:58:11` e2e54-invitee-1794232571 on the other plugin's API: 403  
✅ `13:58:11` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `13:58:11` …never a redirect  
✅ `13:58:11` The other plugin's audience does not hold them  
✅ `13:58:11` …nor its agent half  

## Nothing else on B: its tunnels

✅ `13:58:11` e2e54-invitee-1794232571 on B's authenticated tunnel: 403  
✅ `13:58:11` …the access-request page  
✅ `13:58:11` …not the domain refusal  
✅ `13:58:11` …never a redirect to a sign-in page  
✅ `13:58:11` …never its backend  
✅ `13:58:11` e2e54-member-1794232571, a member of B, on the same tunnel: 200  
✅ `13:58:11` …from its backend  
✅ `13:58:11` e2e54-invitee-1794232571 on B's restricted tunnel: 403  
✅ `13:58:11` …the access-request page  
✅ `13:58:11` …not the domain refusal  
✅ `13:58:11` …never a redirect to a sign-in page  
✅ `13:58:12` …never its backend  

## Nothing on A

✅ `13:58:32` e2e54-invitee-1794232571 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `13:58:32` e2e54-invitee-1794232571, signed in at A's portal, on A's tunnel: 403  
✅ `13:58:32` …the domain refusal page  
✅ `13:58:32` …naming test.lamaste.local  
✅ `13:58:32` …never a redirect to a sign-in page (no login loop)  
✅ `13:58:32` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `13:58:33` e2e54-member-1794232571, a member of B: the client's authorization request goes on  
✅ `13:58:33` e2e54-invitee-1794232571: refused (access_denied)  
✅ `13:58:33` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `13:58:33` e2e54-invitee-1794232571, a viewer, on the inviter's API: 403  
✅ `13:58:33` …role_not_grantable  
✅ `13:58:33` …and sees nothing of e2e54-coord's invitations  
✅ `13:58:33` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `13:58:33` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `13:58:33` Cleaning up test resources...  
