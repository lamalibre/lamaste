# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-10 19:06:05 UTC`


## Pre-flight

✅ `19:06:05` Onboarding is complete  
✅ `19:06:05` Agent test-agent is enrolled on the host  
✅ `19:06:06` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `19:06:06` The agent VM's lamaste-agent has the apphost command  
✅ `19:06:06` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `19:06:06` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `19:06:08` Domain lamaste-second.local added (201)  
✅ `19:06:08` …pending until activated  
✅ `19:06:08` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `19:06:08` …the one required record is auth.lamaste-second.local  
✅ `19:06:09` lamaste-second.local is active  
✅ `19:06:10` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `19:06:11` User e2e54-member-1794337565 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `19:06:11` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `19:06:30` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `19:06:30` The agent VM reaches it at http://10.13.37.1:4874  
✅ `19:06:31` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T19:06:31.624Z"})  
✅ `19:06:31` …through its own OIDC client  
✅ `19:06:35` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `19:06:40` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `19:06:41` …approved  
✅ `19:06:41` …moved to B, before any surface  
✅ `19:06:52` …hosted on test-agent ()  
✅ `19:07:12` …its hosting is up  
✅ `19:07:12` …ready: its agent half's first complete sync ended at the head  
✅ `19:07:16` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `19:07:17` …approved  
✅ `19:07:17` …moved to B, before any surface  
✅ `19:07:28` …hosted on test-agent ()  
✅ `19:07:45` …its hosting is up  
✅ `19:07:45` …ready: its agent half's first complete sync ended at the head  
✅ `19:07:48` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `19:07:48` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `19:07:48` …served  
✅ `19:07:50` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `19:07:50` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `19:07:50` …served  
✅ `19:07:55` Installed @lamalibre/e2e-emoidc-server  
✅ `19:07:55` …on B  
✅ `19:07:56` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `19:07:58` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `19:08:01` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `19:08:04` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `19:08:08` Port 19954: the backend answers through chisel  
✅ `19:08:09` Port 19955: the backend answers through chisel  
✅ `19:08:09` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `19:08:09` e2e54-coord entitled as coordinator  
✅ `19:08:09` Granted site 9ccb8e34-8488-4876-b8f7-9220472596da to user e2e54-coord  
✅ `19:08:09` The audience holds e2e54-coord as coordinator  
✅ `19:08:09` Invitations enabled for e2e-xinv  
✅ `19:08:12` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:08:14` e2e54-member-1794337565 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `19:08:14` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `19:08:14` …a link on the sign-in host, the token in its fragment  
✅ `19:08:15` Accepted  
✅ `19:08:15` …access complete  
✅ `19:08:15` …a directory user  
✅ `19:08:15` users.yml gives them the site's hostname  
✅ `19:08:17` e2e54-invitee-1794337565 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `19:08:17` e2e54-invitee-1794337565: the shell  
✅ `19:08:17` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `19:08:17` e2e54-invitee-1794337565 on the other plugin's shell: 403  
✅ `19:08:17` …the access-request page  
✅ `19:08:17` …not the domain refusal  
✅ `19:08:17` …never a redirect to a sign-in page  
✅ `19:08:17` …never its tree  
✅ `19:08:18` e2e54-invitee-1794337565 on the other plugin's API: 403  
✅ `19:08:18` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `19:08:18` …never a redirect  
✅ `19:08:18` The other plugin's audience does not hold them  
✅ `19:08:18` …nor its agent half  

## Nothing else on B: its tunnels

✅ `19:08:18` e2e54-invitee-1794337565 on B's authenticated tunnel: 403  
✅ `19:08:18` …the access-request page  
✅ `19:08:18` …not the domain refusal  
✅ `19:08:18` …never a redirect to a sign-in page  
✅ `19:08:18` …never its backend  
✅ `19:08:18` e2e54-member-1794337565, a member of B, on the same tunnel: 200  
✅ `19:08:18` …from its backend  
✅ `19:08:19` e2e54-invitee-1794337565 on B's restricted tunnel: 403  
✅ `19:08:19` …the access-request page  
✅ `19:08:19` …not the domain refusal  
✅ `19:08:19` …never a redirect to a sign-in page  
✅ `19:08:19` …never its backend  

## Nothing on A

✅ `19:08:33` e2e54-invitee-1794337565 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `19:08:33` e2e54-invitee-1794337565, signed in at A's portal, on A's tunnel: 403  
✅ `19:08:33` …the domain refusal page  
✅ `19:08:33` …naming test.lamaste.local  
✅ `19:08:33` …never a redirect to a sign-in page (no login loop)  
✅ `19:08:33` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `19:08:33` e2e54-member-1794337565, a member of B: the client's authorization request goes on  
✅ `19:08:33` e2e54-invitee-1794337565: refused (access_denied)  
✅ `19:08:34` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `19:08:34` e2e54-invitee-1794337565, a viewer, on the inviter's API: 403  
✅ `19:08:34` …role_not_grantable  
✅ `19:08:34` …and sees nothing of e2e54-coord's invitations  
✅ `19:08:34` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `19:08:34` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `19:08:34` Cleaning up test resources...  
