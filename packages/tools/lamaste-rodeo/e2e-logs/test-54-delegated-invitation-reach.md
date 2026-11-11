# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-11 10:07:58 UTC`


## Pre-flight

✅ `10:07:58` Onboarding is complete  
✅ `10:07:59` Agent test-agent is enrolled on the host  
✅ `10:07:59` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `10:07:59` The agent VM's lamaste-agent has the apphost command  
✅ `10:07:59` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `10:08:00` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `10:08:01` Domain lamaste-second.local added (201)  
✅ `10:08:01` …pending until activated  
✅ `10:08:01` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `10:08:01` …the one required record is auth.lamaste-second.local  
✅ `10:08:02` lamaste-second.local is active  
✅ `10:08:03` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `10:08:04` User e2e54-member-1794391678 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `10:08:05` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `10:08:24` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `10:08:24` The agent VM reaches it at http://10.13.37.1:4874  
✅ `10:08:41` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-11T10:08:40.141Z"})  
✅ `10:08:41` …through its own OIDC client  
✅ `10:08:50` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `10:08:57` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `10:08:57` …approved  
✅ `10:08:58` …moved to B, before any surface  
✅ `10:09:10` …hosted on test-agent ()  
✅ `10:09:28` …its hosting is up  
✅ `10:09:28` …ready: its agent half's first complete sync ended at the head  
✅ `10:09:33` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `10:09:34` …approved  
✅ `10:09:34` …moved to B, before any surface  
✅ `10:09:46` …hosted on test-agent ()  
✅ `10:09:57` …its hosting is up  
✅ `10:09:58` …ready: its agent half's first complete sync ended at the head  
✅ `10:10:03` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `10:10:03` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `10:10:04` …served  
✅ `10:10:09` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `10:10:09` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `10:10:10` …served  
✅ `10:10:16` Installed @lamalibre/e2e-emoidc-server  
✅ `10:10:17` …on B  
✅ `10:10:18` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `10:10:23` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `10:10:29` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `10:10:35` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `10:10:41` Port 19954: the backend answers through chisel  
✅ `10:10:41` Port 19955: the backend answers through chisel  
✅ `10:10:41` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `10:10:41` e2e54-coord entitled as coordinator  
✅ `10:10:42` Granted site 7385d387-417b-4088-9949-1b316d55c7a9 to user e2e54-coord  
✅ `10:10:42` The audience holds e2e54-coord as coordinator  
✅ `10:10:42` Invitations enabled for e2e-xinv  
✅ `10:10:45` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:10:48` e2e54-member-1794391678 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `10:10:48` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `10:10:48` …a link on the sign-in host, the token in its fragment  
✅ `10:10:50` Accepted  
✅ `10:10:50` …access complete  
✅ `10:10:50` …a directory user  
✅ `10:10:50` users.yml gives them the site's hostname  
✅ `10:10:52` e2e54-invitee-1794391678 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `10:10:53` e2e54-invitee-1794391678: the shell  
✅ `10:10:53` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `10:10:54` e2e54-invitee-1794391678 on the other plugin's shell: 403  
✅ `10:10:54` …the access-request page  
✅ `10:10:54` …not the domain refusal  
✅ `10:10:54` …never a redirect to a sign-in page  
✅ `10:10:54` …never its tree  
✅ `10:10:54` e2e54-invitee-1794391678 on the other plugin's API: 403  
✅ `10:10:54` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `10:10:54` …never a redirect  
✅ `10:10:54` The other plugin's audience does not hold them  
✅ `10:10:55` …nor its agent half  

## Nothing else on B: its tunnels

✅ `10:10:55` e2e54-invitee-1794391678 on B's authenticated tunnel: 403  
✅ `10:10:55` …the access-request page  
✅ `10:10:55` …not the domain refusal  
✅ `10:10:55` …never a redirect to a sign-in page  
✅ `10:10:55` …never its backend  
✅ `10:10:55` e2e54-member-1794391678, a member of B, on the same tunnel: 200  
✅ `10:10:55` …from its backend  
✅ `10:10:56` e2e54-invitee-1794391678 on B's restricted tunnel: 403  
✅ `10:10:56` …the access-request page  
✅ `10:10:56` …not the domain refusal  
✅ `10:10:56` …never a redirect to a sign-in page  
✅ `10:10:56` …never its backend  

## Nothing on A

✅ `10:11:05` e2e54-invitee-1794391678 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `10:11:06` e2e54-invitee-1794391678, signed in at A's portal, on A's tunnel: 403  
✅ `10:11:06` …the domain refusal page  
✅ `10:11:06` …naming test.lamaste.local  
✅ `10:11:06` …never a redirect to a sign-in page (no login loop)  
✅ `10:11:06` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `10:11:07` e2e54-member-1794391678, a member of B: the client's authorization request goes on  
✅ `10:11:07` e2e54-invitee-1794391678: refused (access_denied)  
✅ `10:11:13` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `10:11:14` e2e54-invitee-1794391678, a viewer, on the inviter's API: 403  
✅ `10:11:14` …role_not_grantable  
✅ `10:11:14` …and sees nothing of e2e54-coord's invitations  
✅ `10:11:15` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `10:11:15` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `10:11:15` Cleaning up test resources...  
