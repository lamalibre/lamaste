# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-10 14:22:28 UTC`


## Pre-flight

✅ `14:22:28` Onboarding is complete  
✅ `14:22:29` Agent test-agent is enrolled on the host  
✅ `14:22:29` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:22:29` The agent VM's lamaste-agent has the apphost command  
✅ `14:22:29` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:22:30` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `14:22:31` Domain lamaste-second.local added (201)  
✅ `14:22:31` …pending until activated  
✅ `14:22:31` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:22:31` …the one required record is auth.lamaste-second.local  
✅ `14:22:32` lamaste-second.local is active  
✅ `14:22:33` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `14:22:34` User e2e54-member-1794320548 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `14:22:34` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `14:22:53` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `14:22:54` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:22:55` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-10T14:22:55.155Z"})  
✅ `14:22:55` …through its own OIDC client  
✅ `14:22:59` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:23:04` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:23:04` …approved  
✅ `14:23:04` …moved to B, before any surface  
✅ `14:23:15` …hosted on test-agent ()  
✅ `14:23:32` …its hosting is up  
✅ `14:23:32` …ready: its agent half's first complete sync ended at the head  
✅ `14:23:37` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `14:23:37` …approved  
✅ `14:23:37` …moved to B, before any surface  
✅ `14:23:48` …hosted on test-agent ()  
✅ `14:24:01` …its hosting is up  
✅ `14:24:02` …ready: its agent half's first complete sync ended at the head  
✅ `14:24:04` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:24:04` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `14:24:04` …served  
✅ `14:24:07` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `14:24:07` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `14:24:07` …served  
✅ `14:24:12` Installed @lamalibre/e2e-emoidc-server  
✅ `14:24:12` …on B  
✅ `14:24:12` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `14:24:15` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:24:18` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `14:24:20` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:24:25` Port 19954: the backend answers through chisel  
✅ `14:24:25` Port 19955: the backend answers through chisel  
✅ `14:24:25` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `14:24:26` e2e54-coord entitled as coordinator  
✅ `14:24:26` Granted site 7789b497-87de-4392-97f1-d3f9f99f904e to user e2e54-coord  
✅ `14:24:26` The audience holds e2e54-coord as coordinator  
✅ `14:24:26` Invitations enabled for e2e-xinv  
✅ `14:24:28` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:24:30` e2e54-member-1794320548 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:24:31` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `14:24:31` …a link on the sign-in host, the token in its fragment  
✅ `14:24:31` Accepted  
✅ `14:24:31` …access complete  
✅ `14:24:32` …a directory user  
✅ `14:24:32` users.yml gives them the site's hostname  
✅ `14:24:33` e2e54-invitee-1794320548 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `14:24:34` e2e54-invitee-1794320548: the shell  
✅ `14:24:34` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `14:24:34` e2e54-invitee-1794320548 on the other plugin's shell: 403  
✅ `14:24:34` …the access-request page  
✅ `14:24:34` …not the domain refusal  
✅ `14:24:34` …never a redirect to a sign-in page  
✅ `14:24:34` …never its tree  
✅ `14:24:34` e2e54-invitee-1794320548 on the other plugin's API: 403  
✅ `14:24:34` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `14:24:34` …never a redirect  
✅ `14:24:34` The other plugin's audience does not hold them  
✅ `14:24:35` …nor its agent half  

## Nothing else on B: its tunnels

✅ `14:24:35` e2e54-invitee-1794320548 on B's authenticated tunnel: 403  
✅ `14:24:35` …the access-request page  
✅ `14:24:35` …not the domain refusal  
✅ `14:24:35` …never a redirect to a sign-in page  
✅ `14:24:35` …never its backend  
✅ `14:24:35` e2e54-member-1794320548, a member of B, on the same tunnel: 200  
✅ `14:24:35` …from its backend  
✅ `14:24:35` e2e54-invitee-1794320548 on B's restricted tunnel: 403  
✅ `14:24:35` …the access-request page  
✅ `14:24:35` …not the domain refusal  
✅ `14:24:35` …never a redirect to a sign-in page  
✅ `14:24:35` …never its backend  

## Nothing on A

✅ `14:25:02` e2e54-invitee-1794320548 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:25:02` e2e54-invitee-1794320548, signed in at A's portal, on A's tunnel: 403  
✅ `14:25:02` …the domain refusal page  
✅ `14:25:03` …naming test.lamaste.local  
✅ `14:25:03` …never a redirect to a sign-in page (no login loop)  
✅ `14:25:03` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `14:25:03` e2e54-member-1794320548, a member of B: the client's authorization request goes on  
✅ `14:25:03` e2e54-invitee-1794320548: refused (access_denied)  
✅ `14:25:03` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `14:25:03` e2e54-invitee-1794320548, a viewer, on the inviter's API: 403  
✅ `14:25:03` …role_not_grantable  
✅ `14:25:04` …and sees nothing of e2e54-coord's invitations  
✅ `14:25:04` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `14:25:04` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `14:25:04` Cleaning up test resources...  
