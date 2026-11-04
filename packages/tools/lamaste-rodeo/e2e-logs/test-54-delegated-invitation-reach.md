# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-04 14:50:04 UTC`


## Pre-flight

✅ `14:50:04` Onboarding is complete  
✅ `14:50:04` Agent test-agent is enrolled on the host  
✅ `14:50:04` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `14:50:05` The agent VM's lamaste-agent has the apphost command  
✅ `14:50:05` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `14:50:05` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `14:50:06` Domain lamaste-second.local added (201)  
✅ `14:50:06` …pending until activated  
✅ `14:50:06` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `14:50:06` …the one required record is auth.lamaste-second.local  
✅ `14:50:09` lamaste-second.local is active  
✅ `14:50:09` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `14:50:10` User e2e54-member-1793803804 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `14:50:10` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `14:50:14` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `14:50:14` The agent VM reaches it at http://10.13.37.1:4874  
✅ `14:50:15` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-04T14:50:15.442Z"})  
✅ `14:50:15` …through its own OIDC client  
✅ `14:50:16` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `14:50:18` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `14:50:18` …approved  
✅ `14:50:18` …moved to B, before any surface  
✅ `14:50:35` …hosted on test-agent ()  
✅ `14:50:49` …its hosting is up  
✅ `14:50:49` …ready: its agent half's first complete sync ended at the head  
✅ `14:50:50` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `14:50:50` …approved  
✅ `14:50:50` …moved to B, before any surface  
✅ `14:51:02` …hosted on test-agent ()  
✅ `14:51:18` …its hosting is up  
✅ `14:51:18` …ready: its agent half's first complete sync ended at the head  
✅ `14:51:20` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `14:51:20` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `14:51:20` …served  
✅ `14:51:23` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `14:51:23` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `14:51:23` …served  
✅ `14:51:24` Installed @lamalibre/e2e-emoidc-server  
✅ `14:51:24` …on B  
✅ `14:51:25` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `14:51:27` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `14:51:30` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `14:51:32` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `14:51:36` Port 19954: the backend answers through chisel  
✅ `14:51:37` Port 19955: the backend answers through chisel  
✅ `14:51:37` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `14:51:37` e2e54-coord entitled as coordinator  
✅ `14:51:37` Granted site 8cf7fa6d-9373-4e29-8d4e-f526d6a03397 to user e2e54-coord  
✅ `14:51:37` The audience holds e2e54-coord as coordinator  
✅ `14:51:38` Invitations enabled for e2e-xinv  
✅ `14:51:39` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:51:41` e2e54-member-1793803804 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `14:51:42` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `14:51:42` …a link on the sign-in host, the token in its fragment  
✅ `14:51:42` Accepted  
✅ `14:51:42` …access complete  
✅ `14:51:42` …a directory user  
✅ `14:51:43` users.yml gives them the site's hostname  
✅ `14:51:44` e2e54-invitee-1793803804 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `14:51:45` e2e54-invitee-1793803804: the shell  
✅ `14:51:45` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `14:51:45` e2e54-invitee-1793803804 on the other plugin's shell: 403  
✅ `14:51:45` …the access-request page  
✅ `14:51:45` …not the domain refusal  
✅ `14:51:45` …never a redirect to a sign-in page  
✅ `14:51:45` …never its tree  
✅ `14:51:45` e2e54-invitee-1793803804 on the other plugin's API: 403  
✅ `14:51:45` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `14:51:45` …never a redirect  
✅ `14:51:45` The other plugin's audience does not hold them  
✅ `14:51:46` …nor its agent half  

## Nothing else on B: its tunnels

✅ `14:51:46` e2e54-invitee-1793803804 on B's authenticated tunnel: 403  
✅ `14:51:46` …the access-request page  
✅ `14:51:46` …not the domain refusal  
✅ `14:51:46` …never a redirect to a sign-in page  
✅ `14:51:46` …never its backend  
✅ `14:51:46` e2e54-member-1793803804, a member of B, on the same tunnel: 200  
✅ `14:51:46` …from its backend  
✅ `14:51:46` e2e54-invitee-1793803804 on B's restricted tunnel: 403  
✅ `14:51:46` …the access-request page  
✅ `14:51:46` …not the domain refusal  
✅ `14:51:46` …never a redirect to a sign-in page  
✅ `14:51:46` …never its backend  

## Nothing on A

✅ `14:52:02` e2e54-invitee-1793803804 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `14:52:02` e2e54-invitee-1793803804, signed in at A's portal, on A's tunnel: 403  
✅ `14:52:02` …the domain refusal page  
✅ `14:52:02` …naming test.lamaste.local  
✅ `14:52:02` …never a redirect to a sign-in page (no login loop)  
✅ `14:52:02` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `14:52:03` e2e54-member-1793803804, a member of B: the client's authorization request goes on  
✅ `14:52:03` e2e54-invitee-1793803804: refused (access_denied)  
✅ `14:52:03` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `14:52:03` e2e54-invitee-1793803804, a viewer, on the inviter's API: 403  
✅ `14:52:03` …role_not_grantable  
✅ `14:52:03` …and sees nothing of e2e54-coord's invitations  
✅ `14:52:04` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `14:52:04` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `14:52:04` Cleaning up test resources...  
