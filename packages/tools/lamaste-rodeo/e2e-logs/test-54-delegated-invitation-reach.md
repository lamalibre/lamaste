# Lamaste E2E: 54 — Delegated invitations: an invitee reaches only that plugin's site (Three-VM)

> Started at `2026-11-02 17:01:09 UTC`


## Pre-flight

✅ `17:01:09` Onboarding is complete  
✅ `17:01:09` Agent test-agent is enrolled on the host  
✅ `17:01:09` Sync timer lamalibre-lamaste-sync-e2e-agent.timer is active on the agent VM  
✅ `17:01:09` The agent VM's lamaste-agent has the apphost command  
✅ `17:01:09` Base domains: A = test.lamaste.local (primary), B = lamaste-second.local, C = lamaste-third.local  
✅ `17:01:10` The agent VM's Node.js has node:sqlite, which the agent half's projection needs  

## Domain B; a coordinator (external) and a member

✅ `17:01:11` Domain lamaste-second.local added (201)  
✅ `17:01:11` …pending until activated  
✅ `17:01:11` DNS of lamaste-second.local: auth.lamaste-second.local resolves to the relay  
✅ `17:01:11` …the one required record is auth.lamaste-second.local  
✅ `17:01:12` lamaste-second.local is active  
✅ `17:01:13` User e2e54-coord created, member of lamaste-second.local (external)  
✅ `17:01:13` User e2e54-member-1793638869 created, member of lamaste-second.local  

## Two app plugins on B, each with its restricted web surface; an OIDC client of B

✅ `17:01:14` Fixtures built: @lamalibre/e2e-xinv-server, @lamalibre/e2e-xoth-server, @lamalibre/e2e-emoidc-server  
✅ `17:01:17` Stand-in Feria is up on the host VM (stub-registry listening on 0.0.0.0:4874 as http://10.13.37.1:4874 with @lamalibre/e2e-xinv-server, @lamalibre/e2e-xinv-agent, @lamalibre/e2e-xoth-server, @lamalibre/e2e-xoth-agent, @lamalibre/e2e-emoidc-server )  
✅ `17:01:17` The agent VM reaches it at http://10.13.37.1:4874  
✅ `17:01:19` The panel holds the stand-in Feria's credential (a","registryUrl":"http://10.13.37.1:4874","scope":"@lamalibre","auth":"oidc","clientId":"lamaste-server","owner":"ci:auth.test.lamaste.local/lamaste-server","configuredAt":"2026-11-02T17:01:19.702Z"})  
✅ `17:01:19` …through its own OIDC client  
✅ `17:01:23` The app host helper is enabled, the relay's key pinned, and the relay knows both from the agent's host facts  
✅ `17:01:25` Installed @lamalibre/e2e-xinv-server@1.0.0  
✅ `17:01:26` …approved  
✅ `17:01:26` …moved to B, before any surface  
✅ `17:01:36` …hosted on test-agent ()  
✅ `17:01:49` …its hosting is up  
✅ `17:01:49` …ready: its agent half's first complete sync ended at the head  
✅ `17:01:51` Installed @lamalibre/e2e-xoth-server@1.0.0  
✅ `17:01:52` …approved  
✅ `17:01:52` …moved to B, before any surface  
✅ `17:02:02` …hosted on test-agent ()  
✅ `17:02:19` …its hosting is up  
✅ `17:02:19` …ready: its agent half's first complete sync ended at the head  
✅ `17:02:21` POST /api/plugins/e2e-xinv/web-surface {accessMode: restricted}  
✅ `17:02:21` …the site e2e54web.lamaste-second.local, restricted, on B  
✅ `17:02:22` …served  
✅ `17:02:24` POST /api/plugins/e2e-xoth/web-surface {accessMode: restricted}  
✅ `17:02:24` …the site e2e54oth.lamaste-second.local, restricted, on B  
✅ `17:02:24` …served  
✅ `17:02:26` Installed @lamalibre/e2e-emoidc-server  
✅ `17:02:26` …on B  
✅ `17:02:27` …enabled: B has an OIDC client  

## Tunnels on B (authenticated, restricted) and on A (authenticated)

✅ `17:02:29` Tunnel e2e54auth.lamaste-second.local (authenticated), carried by test-agent  
✅ `17:02:32` Tunnel e2e54res.lamaste-second.local (restricted), carried by test-agent  
✅ `17:02:34` Tunnel e2e54a.test.lamaste.local (authenticated), carried by test-agent  
✅ `17:02:38` Port 19954: the backend answers through chisel  
✅ `17:02:38` Port 19955: the backend answers through chisel  
✅ `17:02:39` Port 19956: the backend answers through chisel  

## The coordinator invites a colleague; they accept

✅ `17:02:39` e2e54-coord entitled as coordinator  
✅ `17:02:39` Granted site fe8f3d24-17ba-45e7-8fae-7e557b51944e to user e2e54-coord  
✅ `17:02:39` The audience holds e2e54-coord as coordinator  
✅ `17:02:39` Invitations enabled for e2e-xinv  
✅ `17:02:41` e2e54-coord signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:02:43` e2e54-member-1793638869 signed in at auth.lamaste-second.local (password, TOTP)  
✅ `17:02:43` e2e54-coord invites deniz@example.test as viewer: 201  
✅ `17:02:43` …a link on the sign-in host, the token in its fragment  
✅ `17:02:44` Accepted  
✅ `17:02:44` …access complete  
✅ `17:02:44` …a directory user  
✅ `17:02:44` users.yml gives them the site's hostname  
✅ `17:02:46` e2e54-invitee-1793638869 signed in at auth.lamaste-second.local (password, TOTP)  

## That plugin's site: the shell and the API

✅ `17:02:46` e2e54-invitee-1793638869: the shell  
✅ `17:02:46` …the API, as a viewer  

## Nothing else on B: the other plugin

✅ `17:02:46` e2e54-invitee-1793638869 on the other plugin's shell: 403  
✅ `17:02:46` …the access-request page  
✅ `17:02:46` …not the domain refusal  
✅ `17:02:46` …never a redirect to a sign-in page  
✅ `17:02:46` …never its tree  
✅ `17:02:47` e2e54-invitee-1793638869 on the other plugin's API: 403  
✅ `17:02:47` …JSON {error: forbidden}, not 'not a member': they are on the domain  
✅ `17:02:47` …never a redirect  
✅ `17:02:47` The other plugin's audience does not hold them  
✅ `17:02:47` …nor its agent half  

## Nothing else on B: its tunnels

✅ `17:02:47` e2e54-invitee-1793638869 on B's authenticated tunnel: 403  
✅ `17:02:47` …the access-request page  
✅ `17:02:47` …not the domain refusal  
✅ `17:02:47` …never a redirect to a sign-in page  
✅ `17:02:47` …never its backend  
✅ `17:02:47` e2e54-member-1793638869, a member of B, on the same tunnel: 200  
✅ `17:02:47` …from its backend  
✅ `17:02:47` e2e54-invitee-1793638869 on B's restricted tunnel: 403  
✅ `17:02:47` …the access-request page  
✅ `17:02:47` …not the domain refusal  
✅ `17:02:47` …never a redirect to a sign-in page  
✅ `17:02:47` …never its backend  

## Nothing on A

✅ `17:03:02` e2e54-invitee-1793638869 signed in at auth.test.lamaste.local (password, TOTP)  
✅ `17:03:02` e2e54-invitee-1793638869, signed in at A's portal, on A's tunnel: 403  
✅ `17:03:02` …the domain refusal page  
✅ `17:03:02` …naming test.lamaste.local  
✅ `17:03:02` …never a redirect to a sign-in page (no login loop)  
✅ `17:03:02` …never its backend  

## Nothing through OIDC: no client of the domain admits them

✅ `17:03:02` e2e54-member-1793638869, a member of B: the client's authorization request goes on  
✅ `17:03:03` e2e54-invitee-1793638869: refused (access_denied)  
✅ `17:03:03` users.yml gives them the site's hostname and the external group, no client  

## They invite no one, and the panel is not theirs

✅ `17:03:03` e2e54-invitee-1793638869, a viewer, on the inviter's API: 403  
✅ `17:03:03` …role_not_grantable  
✅ `17:03:03` …and sees nothing of e2e54-coord's invitations  
✅ `17:03:03` The admin panel's API, their session cookie and no certificate: not 200  

## Nothing restarted Authelia

✅ `17:03:03` Authelia's MainPID unchanged  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `97` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `97` |

ℹ️ `17:03:03` Cleaning up test resources...  
